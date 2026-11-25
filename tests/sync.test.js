// Testes da sincronização (criptografia, mesclagem e ciclo entre dois aparelhos). Dados fictícios.
// Rodam com: node --test "tests/*.test.js"
const test = require('node:test');
const assert = require('node:assert/strict');
const sync = require('../js/sync.js');

const ITER = 1000; // poucas iterações só nos testes
const tx = (id, u, extra = {}) => ({ id, u, data: '2026-11-05', valor: 10, tipo: 'Saída', categoria: 'Outros', descricao: 'x' + id, ...extra });
const state = (transactions, extra = {}) => ({ transactions, tombstones: {}, config: {}, configUpdatedAt: 0, rules: {}, ...extra });
const NOW = 1_800_000_000_000;

test('criptografia: ida e volta funciona, senha errada falha e o texto não mostra os dados', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const key = await sync.deriveKey('senha forte', id, ITER);
  const text = await sync.encryptJSON(key, { segredo: 'Padaria 45,90' });
  assert.ok(!text.includes('Padaria'));
  assert.deepEqual(await sync.decryptJSON(key, text), { segredo: 'Padaria 45,90' });
  const outra = await sync.deriveKey('senha errada', id, ITER);
  await assert.rejects(() => sync.decryptJSON(outra, text), /senha-incorreta/);
  const again = await sync.importKey(await sync.exportKey(key));
  assert.deepEqual(await sync.decryptJSON(again, text), { segredo: 'Padaria 45,90' });
});

test('mesclagem: o mais novo ganha, união de lançamentos diferentes, demo_ não sincroniza', () => {
  const local = state([tx('a', 5, { valor: 99 }), tx('b', 1), tx('demo_1', 9)]);
  const remote = state([tx('a', 3, { valor: 10 }), tx('c', 2)]);
  const m = sync.mergeStates(local, remote, NOW);
  assert.deepEqual(m.transactions.map((t) => [t.id, t.valor]), [['a', 99], ['b', 10], ['c', 10]]);
});

test('mesclagem: apagar vale se for mais novo que a edição, e edição mais nova ressuscita', () => {
  const local = state([], { tombstones: { a: NOW - 1000, b: NOW - 5000 } });
  const remote = state([tx('a', NOW - 2000), tx('b', NOW - 1000)]);
  const m = sync.mergeStates(local, remote, NOW);
  assert.deepEqual(m.transactions.map((t) => t.id), ['b']);
  assert.equal(m.tombstones.a, NOW - 1000);
});

test('mesclagem: a mesma importação nos dois aparelhos vira um lançamento só; config e regras', () => {
  const a = state([tx('x1', 1, { ref: 'F1' }), tx('z', 1)], { config: { salario: 1 }, configUpdatedAt: 10, rules: { 'Saída:padaria': 'Lazer' } });
  const b = state([tx('x2', 1, { ref: 'F1' })], { config: { salario: 2 }, configUpdatedAt: 20, rules: { 'Saída:mercado': 'Alimentação' } });
  const m = sync.mergeStates(a, b, NOW);
  assert.deepEqual(m.transactions.map((t) => t.id).sort(), ['x1', 'z']);
  assert.equal(m.config.salario, 2);
  assert.deepEqual(Object.keys(m.rules).sort(), ['Saída:mercado', 'Saída:padaria']);
  assert.deepEqual(sync.mergeStates(b, a, NOW).transactions.map((t) => t.id).sort(), ['x1', 'z']); // mesmo resultado nos dois sentidos
});

// Servidor falso em memória, com o mesmo contrato das funções mf_get e mf_put.
function fakeServer() {
  const rows = new Map();
  let conflictOnce = false;
  return {
    rows,
    failNextPut() { conflictOnce = true; },
    client: {
      async get(id) { const r = rows.get(id); return r ? { data: r.data, version: r.version } : null; },
      async put(id, data, expected) {
        if (conflictOnce) { conflictOnce = false; return -1; }
        const r = rows.get(id);
        if (expected === 0) { if (r) return -1; rows.set(id, { data, version: 1 }); return 1; }
        if (!r || r.version !== expected) return -1;
        r.data = data; r.version++; return r.version;
      },
    },
  };
}

function device(server, key, id) {
  const d = { s: state([]), pushes: 0 };
  d.sync = () => sync.syncOnce({ client: server.client, key, syncId: id, now: () => NOW, getLocal: () => d.s, applyMerged: async (m) => { d.s = m; } });
  return d;
}

test('dois aparelhos: lançar num, aparece no outro; editar e apagar também; conflito é refeito', async () => {
  const id = '22222222-2222-4222-8222-222222222222';
  const key = await sync.deriveKey('senha', id, ITER);
  const server = fakeServer();
  const notebook = device(server, key, id), celular = device(server, key, id);

  notebook.s = state([tx('a', NOW - 10, { descricao: 'Padaria Secreta do Bairro' }), tx('b', NOW - 10)], { config: { salario: 3000 }, configUpdatedAt: NOW - 10 });
  const r1 = await notebook.sync();
  assert.equal(r1.pushed, true);
  const guardado = [...server.rows.values()][0].data;
  assert.ok(!guardado.includes('Padaria') && !guardado.includes('Secreta')); // o servidor só vê texto ilegível

  const r2 = await celular.sync();
  assert.equal(r2.pulled, true);
  assert.deepEqual(celular.s.transactions.map((t) => t.id), ['a', 'b']);
  assert.equal(celular.s.config.salario, 3000);

  celular.s.transactions = celular.s.transactions.map((t) => (t.id === 'a' ? { ...t, categoria: 'Lazer', u: NOW - 5 } : t));
  celular.s.transactions = celular.s.transactions.filter((t) => t.id !== 'b');
  celular.s.tombstones = { b: NOW - 4 };
  server.failNextPut(); // outro aparelho "gravou no meio": o ciclo tem que repetir sozinho
  await celular.sync();
  await notebook.sync();
  assert.deepEqual(notebook.s.transactions.map((t) => [t.id, t.categoria]), [['a', 'Lazer']]);

  const again = await notebook.sync();
  assert.deepEqual([again.pushed, again.pulled], [false, false]); // nada a fazer: não regrava à toa
});

test('senha diferente não abre o que o outro aparelho gravou', async () => {
  const id = '33333333-3333-4333-8333-333333333333';
  const server = fakeServer();
  const certo = device(server, await sync.deriveKey('certa', id, ITER), id);
  const errado = device(server, await sync.deriveKey('errada', id, ITER), id);
  certo.s = state([tx('a', 1)]);
  await certo.sync();
  await assert.rejects(() => errado.sync(), /senha-incorreta/);
});

test('código de pareamento: ida e volta, sem a senha, e recusa endereço que não é https', () => {
  const id = '44444444-4444-4444-8444-444444444444';
  const code = sync.makePairCode({ url: 'https://abc.supabase.co/', key: 'sb_publishable_x', id });
  assert.ok(code.startsWith('MF1.'));
  assert.deepEqual(sync.parsePairCode(code), { url: 'https://abc.supabase.co', key: 'sb_publishable_x', id });
  assert.equal(sync.parsePairCode(sync.makePairCode({ url: 'http://abc.supabase.co', key: 'k', id })), null);
  assert.equal(sync.parsePairCode('lixo'), null);
  assert.ok(sync.parsePairCode(sync.makePairCode({ url: 'http://127.0.0.1:9', key: 'k', id })));
});

test('cliente: chama as funções do servidor com a chave pública e entende conflito', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([url, init.headers, JSON.parse(init.body)]);
    return { ok: true, json: async () => (url.endsWith('mf_get') ? [] : -1) };
  };
  const client = sync.createClient({ url: 'https://abc.supabase.co/', key: 'sb_publishable_x', fetchImpl });
  assert.equal(await client.get('id1'), null);
  assert.equal(await client.put('id1', 'dados', 0), -1);
  assert.equal(calls[0][0], 'https://abc.supabase.co/rest/v1/rpc/mf_get');
  assert.equal(calls[0][1].apikey, 'sb_publishable_x');
  assert.equal(calls[0][1].Authorization, undefined);
  assert.deepEqual(calls[1][2], { p_id: 'id1', p_data: 'dados', p_expected: 0 });
});

test('o SQL copiado pelo app é idêntico ao arquivo docs/sincronizacao.sql', () => {
  let fs = null;
  try { fs = require('node:fs'); } catch (e) { /* navegador: sem arquivos */ }
  if (!fs || !fs.readFileSync) return;
  const file = fs.readFileSync(require('node:path').join(__dirname, '..', 'docs', 'sincronizacao.sql'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(sync.SQL_SETUP, file);
});

test('endereço do projeto: tira /rest/v1, barras e caminhos colados junto', async () => {
  assert.equal(sync.normalizeUrl(' https://abc.supabase.co/rest/v1/ '), 'https://abc.supabase.co');
  assert.equal(sync.normalizeUrl('https://abc.supabase.co/dashboard/project/abc'), 'https://abc.supabase.co');
  assert.equal(sync.normalizeUrl('http://127.0.0.1:8767/'), 'http://127.0.0.1:8767');
  const calls = [];
  const c = sync.createClient({ url: 'https://abc.supabase.co/rest/v1/', key: 'k', fetchImpl: async (u) => { calls.push(u); return { ok: true, json: async () => [] }; } });
  await c.get('id1');
  assert.equal(calls[0], 'https://abc.supabase.co/rest/v1/rpc/mf_get');
});
