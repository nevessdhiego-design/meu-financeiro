// Testes da importação de extratos (OFX e CSV). Todos os dados abaixo são fictícios.
// Rodam com: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const lib = require('../js/lib.js');

test('decodeBytes lê UTF-8 e cai para Windows-1252 quando há bytes inválidos', () => {
  const utf8 = new TextEncoder().encode('Alimentação');
  assert.equal(lib.decodeBytes(utf8), 'Alimentação');
  const latin1 = Uint8Array.from([0x41, 0x6c, 0x69, 0x6d, 0x65, 0x6e, 0x74, 0x61, 0xe7, 0xe3, 0x6f]);
  assert.equal(lib.decodeBytes(latin1), 'Alimentação');
});

test('parseBankDate aceita os formatos de extrato e rejeita datas inválidas', () => {
  assert.equal(lib.parseBankDate('05/11/2026'), '2026-11-05');
  assert.equal(lib.parseBankDate('5/11/26'), '2026-11-05');
  assert.equal(lib.parseBankDate('05-11-2026'), '2026-11-05');
  assert.equal(lib.parseBankDate('2026-11-05T10:30:00'), '2026-11-05');
  assert.equal(lib.parseBankDate('20261105120000[-3:BRT]'), '2026-11-05');
  assert.equal(lib.parseBankDate('32/13/2026'), '');
  assert.equal(lib.parseBankDate('abc'), '');
});

test('parseMoney entende sinal, parênteses, sufixo e formatos brasileiros', () => {
  assert.equal(lib.parseMoney('R$ -1.234,56'), -1234.56);
  assert.equal(lib.parseMoney('(45,90)'), -45.9);
  assert.equal(lib.parseMoney('45,90-'), -45.9);
  assert.equal(lib.parseMoney('1234.5'), 1234.5);
  assert.ok(Number.isNaN(lib.parseMoney('')));
});

test('parseCSV trata BOM, aspas, CRLF e detecta o separador', () => {
  const rows = lib.parseCSV(String.fromCharCode(0xFEFF) + 'a;b;c\r\n1;"x;y";3\r\n\r\n4;5;6');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['1', 'x;y', '3'], ['4', '5', '6']]);
  assert.deepEqual(lib.parseCSV('a,b\n"1,5",2'), [['a', 'b'], ['1,5', '2']]);
});

test('parseBankCSV lê extrato de conta com identificador e valores com ponto decimal', () => {
  const csv = 'Data,Valor,Identificador,Descrição\n'
    + '01/11/2026,-45.90,id-1,Compra no débito - Padaria Central\n'
    + '05/11/2026,3200.00,id-2,Transferência recebida - Empresa Exemplo\n';
  const r = lib.parseBankCSV(csv);
  assert.equal(r.items.length, 2);
  assert.equal(r.items[0].data, '2026-11-01');
  assert.equal(r.items[0].valor, -45.9);
  assert.equal(r.items[0].descricao, 'Compra no débito - Padaria Central');
  assert.equal(r.items[0].ref, 'id-1');
  assert.equal(r.items[1].valor, 3200);
  assert.equal(r.invertHint, false);
});

test('parseBankCSV pula o cabeçalho do banco, linhas de saldo e junta histórico com descrição', () => {
  const csv = 'Extrato Conta Corrente\nPeríodo;01/11/2026 a 30/11/2026\n\n'
    + 'Data Lançamento;Histórico;Descrição;Valor;Saldo\n'
    + '01/11/2026;SALDO ANTERIOR;;;1.000,00\n'
    + '03/11/2026;Pix enviado;Fulano de Tal;-120,50;879,50\n'
    + '04/11/2026;Compra no débito;Mercado Bairro;"-1.234,56";0,00\n';
  const r = lib.parseBankCSV(csv);
  assert.equal(r.items.length, 2);
  assert.equal(r.items[0].descricao, 'Pix enviado - Fulano de Tal');
  assert.equal(r.items[0].valor, -120.5);
  assert.equal(r.items[1].valor, -1234.56);
});

test('parseBankCSV reconhece fatura de cartão (gastos positivos) e colunas de crédito e débito', () => {
  const fatura = 'date,category,title,amount\n2026-11-02,restaurante,Pizzaria Exemplo,89.90\n2026-11-10,,Pagamento recebido,-500.00\n';
  const r = lib.parseBankCSV(fatura);
  assert.equal(r.invertHint, true);
  assert.equal(r.cardHint, true);
  assert.equal(r.items[0].hint, 'restaurante');
  const separado = 'Data;Descrição;Crédito;Débito\n02/11/2026;Venda;150,00;\n03/11/2026;Conta de luz;;80,25\n';
  const s = lib.parseBankCSV(separado);
  assert.deepEqual(s.items.map((i) => i.valor), [150, -80.25]);
});

test('parseBankCSV avisa quando não acha as colunas e devolve só os nomes do cabeçalho', () => {
  const r = lib.parseBankCSV('foo;bar\n1;2\n');
  assert.equal(r.items.length, 0);
  assert.equal(r.error, 'colunas');
  const s = lib.parseBankCSV('Extrato\nCampo A;Campo B;Campo C\n05/11/2026;Padaria;-9,90\n');
  assert.deepEqual(s.header, ['Campo A', 'Campo B', 'Campo C']); // linhas com dígitos nunca entram
});

test('parseBankCSV aceita cabeçalhos com unidade, como "Crédito (R$)", e coluna D/C', () => {
  const brad = 'Data;Histórico;Docto.;Crédito (R$);Débito (R$);Saldo (R$)\n'
    + '03/11/2026;Pix recebido;123;250,00;;1.250,00\n04/11/2026;Compra Padaria;124;;18,40;1.231,60\n';
  const r = lib.parseBankCSV(brad);
  assert.deepEqual(r.items.map((i) => [i.descricao, i.valor]), [['Pix recebido', 250], ['Compra Padaria', -18.4]]);
  const c6 = 'Data Lançamento,Data Contábil,Título,Descrição,Entrada(R$),Saída(R$),Saldo do Dia(R$)\n'
    + '05/11/2026,05/11/2026,Pix,Pix enviado Fulano,0,30.00,100.00\n';
  assert.equal(lib.parseBankCSV(c6).items[0].valor, -30);
  const caixa = 'Data;Histórico;Valor;D/C\n06/11/2026;Compra débito;45,00;D\n07/11/2026;Depósito;100,00;C\n';
  assert.deepEqual(lib.parseBankCSV(caixa).items.map((i) => i.valor), [-45, 100]);
});

test('parseOFX lê SGML antigo e XML de cartão', () => {
  const sgml = 'OFXHEADER:100\nCHARSET:1252\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>\n'
    + '<STMTTRN>\n<TRNTYPE>DEBIT\n<DTPOSTED>20261105120000[-3:BRT]\n<TRNAMT>-45.90\n<FITID>abc1\n<MEMO>Uber *Trip\n</STMTTRN>\n'
    + '<STMTTRN>\n<TRNTYPE>CREDIT\n<DTPOSTED>20261106\n<TRNAMT>3200,00\n<FITID>abc2\n<NAME>Empresa Exemplo\n<MEMO>Salario\n</STMTTRN>\n'
    + '</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>';
  const r = lib.parseOFX(sgml);
  assert.equal(r.cardHint, false);
  assert.equal(r.items.length, 2);
  assert.equal(r.items[0].data, '2026-11-05');
  assert.equal(r.items[0].valor, -45.9);
  assert.equal(r.items[0].descricao, 'Uber *Trip');
  assert.equal(r.items[0].ref, 'abc1');
  assert.equal(r.items[1].valor, 3200);
  assert.equal(r.items[1].descricao, 'Empresa Exemplo - Salario');
  const xml = '<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><BANKTRANLIST>'
    + '<STMTTRN><DTPOSTED>20261107</DTPOSTED><TRNAMT>-12.00</TRNAMT><FITID>x1</FITID><MEMO>Caf&amp;e</MEMO></STMTTRN>'
    + '</BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>';
  const c = lib.parseOFX(xml);
  assert.equal(c.cardHint, true);
  assert.equal(c.items[0].descricao, 'Caf&e');
});

test('guessCategory sugere categoria pelas palavras e evita falsos positivos', () => {
  assert.equal(lib.guessCategory('UBER *TRIP', 'Saída'), 'Transporte');
  assert.equal(lib.guessCategory('iFood Restaurante', 'Saída'), 'Alimentação');
  assert.equal(lib.guessCategory('Supermercado Bairro', 'Saída'), 'Alimentação');
  assert.equal(lib.guessCategory('Mercado Livre', 'Saída'), 'Outros');
  assert.equal(lib.guessCategory('Pagamento de fatura', 'Saída'), 'Cartão');
  assert.equal(lib.guessCategory('Mensalidade Academia Smart', 'Saída'), 'Lazer');
  assert.equal(lib.guessCategory('Netflix.com', 'Saída'), 'Lazer');
  assert.equal(lib.guessCategory('Aluguel novembro', 'Saída'), 'Moradia');
  assert.equal(lib.guessCategory('Pix enviado - Fulano', 'Saída'), 'Outros');
  assert.equal(lib.guessCategory('Pagamento de salário', 'Entrada'), 'Salário');
  assert.equal(lib.guessCategory('Crédito Alelo', 'Entrada'), 'VR');
  assert.equal(lib.guessCategory('Compra', 'Saída', 'transporte'), 'Transporte');
});

test('bankTransactions define tipo pelo sinal, inverte e marca crédito', () => {
  const raw = [
    { data: '2026-11-05', valor: -45.9, descricao: 'Uber *Trip', ref: 'a' },
    { data: '2026-11-06', valor: 3200, descricao: 'Pagamento de salário' },
  ];
  const normal = lib.bankTransactions(raw);
  assert.deepEqual(normal.map((t) => [t.tipo, t.valor, t.categoria, t.forma]), [['Saída', 45.9, 'Transporte', 'Débito'], ['Entrada', 3200, 'Salário', 'Outro']]);
  assert.equal(normal[0].ref, 'a');
  assert.equal(normal[1].ref, undefined);
  const fatura = lib.bankTransactions([{ data: '2026-11-02', valor: 89.9, descricao: 'Pizzaria' }, { data: '2026-11-10', valor: -500, descricao: 'Pagamento recebido' }], { invert: true, isCard: true });
  assert.deepEqual(fatura.map((t) => [t.tipo, t.forma]), [['Saída', 'Crédito']]); // pagamento da fatura é ignorado
  const estorno = lib.bankTransactions([{ data: '2026-11-11', valor: -20, descricao: 'Estorno compra' }], { invert: true, isCard: true });
  assert.deepEqual(estorno.map((t) => t.tipo), ['Entrada']);
  assert.equal(lib.bankTransactions([{ data: '2026-11-05', valor: -10, descricao: 'Pix enviado' }])[0].forma, 'Pix');
});

test('markDuplicates usa o identificador do banco e consome um existente por vez', () => {
  const existing = [
    { id: '1', ref: 'abc1', data: '2026-11-05', valor: 45.9, tipo: 'Saída', descricao: 'Uber *Trip' },
    { id: '2', data: '2026-11-07', valor: 5, tipo: 'Saída', descricao: 'Café' },
  ];
  const incoming = [
    { ref: 'abc1', data: '2026-11-05', valor: 45.9, tipo: 'Saída', descricao: 'Uber Trip' },
    { data: '2026-11-07', valor: 5, tipo: 'Saída', descricao: 'cafe' },
    { data: '2026-11-07', valor: 5, tipo: 'Saída', descricao: 'Café' },
    { data: '2026-11-08', valor: 9, tipo: 'Saída', descricao: 'Novo' },
  ];
  assert.deepEqual(lib.markDuplicates(existing, incoming).map((i) => i.duplicado), [true, true, false, false]);
});
