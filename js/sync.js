/* Meu Financeiro: sincronização entre aparelhos com criptografia de ponta a ponta.
   Tudo é criptografado NO APARELHO (AES-GCM) antes de sair; o servidor só guarda um texto ilegível.
   A chave nasce de uma senha que só você sabe (PBKDF2) e nunca é enviada.
   No navegador fica em window.FinSync; no Node, em module.exports. */
(function (root, factory) {
  const lib = factory();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else root.FinSync = lib;
})(typeof self !== 'undefined' ? self : this, function () {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const subtle = () => globalThis.crypto.subtle;
  const TOMBSTONE_TTL_MS = 180 * 24 * 3600 * 1000;

  function toB64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function fromB64(text) {
    const bin = atob(text);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  // ---- Criptografia ----
  async function deriveKey(passphrase, syncId, iterations = 200000) {
    const base = await subtle().importKey('raw', encoder.encode(String(passphrase)), 'PBKDF2', false, ['deriveKey']);
    const salt = new Uint8Array(await subtle().digest('SHA-256', encoder.encode('meu-financeiro:' + syncId))).slice(0, 16);
    return subtle().deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  }
  async function exportKey(key) {
    return toB64(new Uint8Array(await subtle().exportKey('raw', key)));
  }
  async function importKey(b64) {
    return subtle().importKey('raw', fromB64(b64), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
  }
  async function encryptJSON(key, value) {
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(value)));
    return JSON.stringify({ v: 1, iv: toB64(iv), ct: toB64(new Uint8Array(ct)) });
  }
  async function decryptJSON(key, text) {
    let box;
    try { box = JSON.parse(text); } catch (e) { throw new Error('dados-invalidos'); }
    if (!box || box.v !== 1 || !box.iv || !box.ct) throw new Error('dados-invalidos');
    try {
      const plain = await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(box.iv) }, key, fromB64(box.ct));
      return JSON.parse(decoder.decode(plain));
    } catch (e) { throw new Error('senha-incorreta'); }
  }

  // ---- Mesclagem ----
  // Estado sincronizado: { transactions, tombstones: {id: quando}, config, configUpdatedAt, rules }.
  // Cada lançamento tem u (quando mudou); o mais novo ganha. Apagar vira "lápide" (tombstone): vale se for
  // mais nova que a última edição. A mesma importação feita em dois aparelhos (mesmo identificador do banco) vira uma só.
  function canon(value) {
    if (Array.isArray(value)) return value.map(canon);
    if (value && typeof value === 'object') return Object.keys(value).sort().reduce((acc, k) => { acc[k] = canon(value[k]); return acc; }, {});
    return value;
  }
  const signature = (state) => JSON.stringify(canon(state));
  const isDemo = (t) => String(t.id).startsWith('demo_');

  function mergeStates(local, remote, now = Date.now()) {
    const tomb = {};
    for (const src of [remote.tombstones || {}, local.tombstones || {}]) {
      for (const [id, ts] of Object.entries(src)) if (now - ts < TOMBSTONE_TTL_MS) tomb[id] = Math.max(tomb[id] || 0, ts);
    }
    const byId = new Map();
    for (const t of [...(remote.transactions || []), ...(local.transactions || [])]) {
      if (!t || !t.id || isDemo(t)) continue;
      const cur = byId.get(t.id);
      if (!cur || (t.u || 0) >= (cur.u || 0)) byId.set(t.id, t); // empate: vale o local (vem por último)
    }
    const alive = [...byId.values()].filter((t) => !(tomb[t.id] && tomb[t.id] >= (t.u || 0)));
    const byRef = new Map();
    for (const t of alive.sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
      const key = t.ref ? `${t.tipo}|${t.ref}` : `id|${t.id}`;
      if (!byRef.has(key)) byRef.set(key, t); // fica o de menor id: todos os aparelhos escolhem o mesmo
    }
    const transactions = [...byRef.values()].sort((a, b) => String(a.data || '').localeCompare(String(b.data || '')) || String(a.id).localeCompare(String(b.id)));
    const useRemoteConfig = (remote.configUpdatedAt || 0) > (local.configUpdatedAt || 0);
    return {
      transactions,
      tombstones: tomb,
      config: (useRemoteConfig ? remote.config : local.config) || remote.config || local.config || {},
      configUpdatedAt: Math.max(local.configUpdatedAt || 0, remote.configUpdatedAt || 0),
      rules: { ...(remote.rules || {}), ...(local.rules || {}) },
    };
  }

  function normalize(state) {
    return {
      transactions: (state.transactions || []).filter((t) => t && t.id && !isDemo(t)),
      tombstones: state.tombstones || {},
      config: state.config || {},
      configUpdatedAt: state.configUpdatedAt || 0,
      rules: state.rules || {},
    };
  }

  // ---- Código de pareamento (vai de um aparelho para o outro; NÃO leva a senha) ----
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function validUrl(url) {
    try {
      const u = new URL(url);
      return u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname));
    } catch (e) { return false; }
  }
  function makePairCode({ url, key, id }) {
    return 'MF1.' + btoa(unescape(encodeURIComponent(JSON.stringify({ u: url, k: key, i: id })))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function parsePairCode(code) {
    try {
      const body = String(code).trim().replace(/^MF1\./, '').replace(/-/g, '+').replace(/_/g, '/');
      const data = JSON.parse(decodeURIComponent(escape(atob(body + '='.repeat((4 - (body.length % 4)) % 4)))));
      if (!validUrl(data.u) || !data.k || !UUID.test(data.i)) return null;
      return { url: data.u.replace(/\/+$/, ''), key: data.k, id: data.i.toLowerCase() };
    } catch (e) { return null; }
  }

  // ---- Servidor (Supabase: duas funções RPC, veja docs/sincronizacao.sql) ----
  function createClient({ url, key, fetchImpl }) {
    const doFetch = fetchImpl || ((...args) => globalThis.fetch(...args));
    const base = url.replace(/\/+$/, '');
    const headers = { 'Content-Type': 'application/json', apikey: key };
    if (/^eyJ/.test(key)) headers.Authorization = 'Bearer ' + key; // chaves antigas são JWT; as novas só usam apikey
    async function call(name, body) {
      const res = await doFetch(`${base}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(body) });
      if (!res.ok) {
        const err = new Error('http-' + res.status);
        err.status = res.status;
        try { const info = await res.json(); err.code = info && info.code; } catch (e) { /* sem corpo */ }
        throw err;
      }
      return res.json();
    }
    return {
      async get(id) {
        const rows = await call('mf_get', { p_id: id });
        return rows && rows.length ? { data: rows[0].data, version: Number(rows[0].version) } : null;
      },
      async put(id, data, expected) {
        return Number(await call('mf_put', { p_id: id, p_data: data, p_expected: expected }));
      },
    };
  }

  // Um ciclo: baixa, mescla, envia o resultado (se mudou) e só então atualiza o aparelho. Repete se outro aparelho gravou no meio.
  async function syncOnce({ client, key, syncId, getLocal, applyMerged, now = () => Date.now() }) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const remote = await client.get(syncId);
      const remoteState = remote ? normalize(await decryptJSON(key, remote.data)) : null;
      const local = normalize(getLocal());
      const merged = remoteState ? mergeStates(local, remoteState, now()) : mergeStates(local, { transactions: [], tombstones: {} }, now());
      const mergedSig = signature(merged);
      const pushNeeded = !remoteState || mergedSig !== signature(mergeStates(remoteState, { transactions: [], tombstones: {} }, now()));
      const pullNeeded = mergedSig !== signature(mergeStates(local, { transactions: [], tombstones: {} }, now()));
      if (pushNeeded) {
        const version = await client.put(syncId, await encryptJSON(key, merged), remote ? remote.version : 0);
        if (version < 0) continue; // outro aparelho gravou antes: tenta de novo
      }
      if (pullNeeded) await applyMerged(merged);
      return { pushed: pushNeeded, pulled: pullNeeded, at: now() };
    }
    throw new Error('conflito');
  }

  const SQL_SETUP = `-- Meu Financeiro: sincronização entre aparelhos (Supabase).
-- Cole este arquivo inteiro em SQL Editor > New query e clique em Run. Pode rodar mais de uma vez.
--
-- O que ele cria: uma tabela fechada (ninguém lê nem grava direto) e duas funções que o app chama.
-- O app só envia texto já criptografado no aparelho; o servidor não consegue ler nada.

create table if not exists public.sync_blobs (
  id         uuid primary key,
  data       text not null,
  version    bigint not null default 1,
  updated_at timestamptz not null default now()
);

-- Segurança em linha ligada e SEM nenhuma política: a chave pública não acessa a tabela diretamente.
alter table public.sync_blobs enable row level security;
revoke all on public.sync_blobs from anon, authenticated;

-- Lê o texto criptografado de um código de sincronização (o id é um UUID aleatório, impossível de adivinhar).
create or replace function public.mf_get(p_id uuid)
returns table (data text, version bigint)
language sql
security definer
set search_path = public
as $$
  select b.data, b.version from public.sync_blobs b where b.id = p_id;
$$;

-- Grava com controle de versão: devolve a nova versão, ou -1 se outro aparelho gravou antes (o app tenta de novo).
create or replace function public.mf_put(p_id uuid, p_data text, p_expected bigint)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v bigint;
begin
  if length(p_data) > 8000000 then
    raise exception 'dados grandes demais';
  end if;
  if p_expected = 0 then
    insert into public.sync_blobs (id, data, version) values (p_id, p_data, 1)
    on conflict (id) do nothing;
    if found then return 1; end if;
    return -1;
  end if;
  update public.sync_blobs
     set data = p_data, version = version + 1, updated_at = now()
   where id = p_id and version = p_expected
  returning version into v;
  return coalesce(v, -1);
end;
$$;

revoke all on function public.mf_get(uuid) from public;
revoke all on function public.mf_put(uuid, text, bigint) from public;
grant execute on function public.mf_get(uuid) to anon;
grant execute on function public.mf_put(uuid, text, bigint) to anon;

-- Pede ao Supabase para reconhecer as funções novas agora (evita erro 404 logo após criar).
notify pgrst, 'reload schema';
`;

  return { SQL_SETUP, deriveKey, exportKey, importKey, encryptJSON, decryptJSON, mergeStates, normalize, signature, makePairCode, parsePairCode, validUrl, createClient, syncOnce, toB64, fromB64 };
});
