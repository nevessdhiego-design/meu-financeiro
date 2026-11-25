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

test('pdfItemsToLines junta os itens de texto por linha, na ordem da página', () => {
  const t = (str, x, y, width = 30) => ({ str, transform: [1, 0, 0, 1, x, y], width });
  const lines = lib.pdfItemsToLines([t('Compra', 50, 700), t('05/11', 20, 700, 25), t(' ', 60, 700, 3), t('-45,90', 400, 700), t('Saldo', 20, 650)]);
  assert.deepEqual(lines, ['05/11 Compra  -45,90', 'Saldo']);
});

test('parsePdfStatement lê extrato de conta com sinal, datas com e sem ano e ignora saldos', () => {
  const r = lib.parsePdfStatement([
    'Extrato de 01/11/2026 a 30/11/2026',
    '01/11/2026 SALDO ANTERIOR 1.000,00',
    '03/11/2026 Pix enviado Fulano -120,50 879,50',
    '04/11 Compra no débito Mercado Bairro 1.234,56- 0,00',
    '05/11/2026 Transferência recebida Empresa Exemplo 3.200,00 C',
  ]);
  assert.equal(r.cardHint, false);
  assert.deepEqual(r.items.map((i) => [i.data, i.valor, i.descricao]), [
    ['2026-11-03', -120.5, 'Pix enviado Fulano'],
    ['2026-11-04', -1234.56, 'Compra no débito Mercado Bairro'],
    ['2026-11-05', 3200, 'Transferência recebida Empresa Exemplo'],
  ]);
  assert.equal(r.uncertain, 0);
});

test('parsePdfStatement decide entrada ou saída por palavras quando o PDF não traz sinal, e conta os palpites', () => {
  const r = lib.parsePdfStatement([
    'Período 01/11/2026 a 30/11/2026',
    '03/11/2026 Pix recebido Fulano 250,00 1.250,00',
    '04/11/2026 Compra Padaria 18,40 1.231,60',
    '05/11/2026 Serviço qualquer 10,00 1.221,60',
  ]);
  assert.deepEqual(r.items.map((i) => i.valor), [250, -18.4, -10]);
  assert.equal(r.uncertain, 1);
});

test('parsePdfStatement lê fatura de cartão (dia e mês por extenso, gastos positivos) e títulos por dia', () => {
  const f = lib.parsePdfStatement([
    'Fatura de novembro 2026 Vencimento 10/11/2026 Limite disponível',
    '05 NOV Pizzaria Exemplo R$ 89,90',
    '07 NOV Estorno Loja −R$ 20,00',
    'Total da fatura R$ 69,90',
  ]);
  assert.equal(f.cardHint, true);
  assert.equal(f.invertHint, true);
  assert.deepEqual(f.items.map((i) => [i.data, i.valor]), [['2026-11-05', 89.9], ['2026-11-07', -20]]);
  const dia = lib.parsePdfStatement([
    '03 de novembro de 2026 Total de entradas + 1.000,00',
    'Transferência recebida Empresa Exemplo 1.000,00',
    '04 de novembro de 2026 Total de saídas - 45,00',
    'Compra no débito Padaria 45,00',
  ]);
  assert.deepEqual(dia.items.map((i) => [i.data, i.valor]), [['2026-11-03', 1000], ['2026-11-04', -45]]);
});

test('parsePdfStatement sem lançamentos devolve só o formato das linhas, sem nomes nem valores', () => {
  const r = lib.parsePdfStatement(['Cabeçalho', 'Fulano de Tal 12345 78,90']);
  assert.equal(r.items.length, 0);
  assert.equal(r.error, 'pdf');
  assert.deepEqual(r.shapes, ['a a a 99999 99,99']);
});

test('guessCategory sugere categoria pelas palavras e evita falsos positivos', () => {
  assert.equal(lib.guessCategory('UBER *TRIP', 'Saída'), 'Transporte');
  assert.equal(lib.guessCategory('iFood Restaurante', 'Saída'), 'Alimentação');
  assert.equal(lib.guessCategory('Supermercado Bairro', 'Saída'), 'Alimentação');
  assert.equal(lib.guessCategory('Mercado Livre', 'Saída'), 'Compras');
  assert.equal(lib.guessCategory('Pagamento de fatura', 'Saída'), 'Fatura paga');
  assert.equal(lib.guessCategory('Mensalidade Academia Smart', 'Saída'), 'Lazer');
  assert.equal(lib.guessCategory('Netflix.com', 'Saída'), 'Lazer');
  assert.equal(lib.guessCategory('Aluguel novembro', 'Saída'), 'Moradia');
  assert.equal(lib.guessCategory('Pix enviado - Fulano', 'Saída'), 'Transferências');
  assert.equal(lib.guessCategory('Drogasil 123', 'Saída'), 'Saúde');
  assert.equal(lib.guessCategory('Resgate RDB', 'Entrada'), 'Resgate');
  assert.equal(lib.guessCategory('Loja Desconhecida', 'Saída'), 'Outros');
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

test('parseInstallment reconhece parcelas em vários formatos e ignora o que não é parcela', () => {
  assert.deepEqual(lib.parseInstallment('Magalu - Parcela 3/10'), { n: 3, total: 10 });
  assert.deepEqual(lib.parseInstallment('LOJA X PARC 03 de 12'), { n: 3, total: 12 });
  assert.deepEqual(lib.parseInstallment('Celular (2/6)'), { n: 2, total: 6 });
  assert.deepEqual(lib.parseInstallment('Americanas 04/10'), { n: 4, total: 10 });
  assert.equal(lib.parseInstallment('Parcela 11/10'), null);
  assert.equal(lib.parseInstallment('Padaria Central'), null);
});

test('merchantKey ignora números, parcelas e palavras genéricas; regras aprendidas valem para o mesmo estabelecimento', () => {
  assert.equal(lib.merchantKey('Compra no débito - Padaria do João 1234'), 'padaria joao');
  assert.equal(lib.merchantKey('Magalu - Parcela 3/10'), 'magalu');
  const rules = { [lib.ruleKey('Padaria do João', 'Saída')]: 'Lazer' };
  assert.equal(lib.guessCategory('Compra no débito - Padaria do João 99', 'Saída', '', rules), 'Lazer');
  assert.equal(lib.guessCategory('Compra no débito - Padaria do João 99', 'Saída'), 'Alimentação');
});

test('pagamento de fatura e transferência própria ficam neutros e não entram em entradas, saídas nem categorias', () => {
  const raw = [
    { data: '2026-11-05', valor: -4000, descricao: 'Pagamento de fatura Nubank' },
    { data: '2026-11-06', valor: -500, descricao: 'Transferência enviada - Dhiego Exemplo' },
    { data: '2026-11-06', valor: 500, descricao: 'Transferência recebida - Dhiego Exemplo' },
    { data: '2026-11-07', valor: -120, descricao: 'Pix enviado - Maria Silva' },
    { data: '2026-11-08', valor: 3000, descricao: 'Pagamento de salário' },
  ];
  const list = lib.bankTransactions(raw).map((t, i) => ({ ...t, id: String(i) }));
  assert.deepEqual(list.map((t) => t.categoria), ['Fatura paga', 'Transferência própria', 'Transferência própria', 'Transferências', 'Salário']);
  const s = lib.monthSummary(list, '2026-11');
  assert.equal(s.entradas, 3000);
  assert.equal(s.saidas, 120);
  assert.equal(s.emConta, 3000 - 4000 - 500 + 500 - 120); // o que mexeu na conta de fato
  assert.deepEqual(lib.categoryTotals(list, '2026-11').map((c) => c.categoria), ['Transferências']);
  assert.equal(lib.monthlyTotals(list, '2026-11', 1)[0].saidas, 120);
});

test('monthSummary separa o que foi no cartão do que saiu da conta', () => {
  const t = [
    { id: '1', data: '2026-11-02', valor: 3000, tipo: 'Entrada', categoria: 'Salário', forma: 'Pix' },
    { id: '2', data: '2026-11-03', valor: 200, tipo: 'Saída', categoria: 'Alimentação', forma: 'Débito' },
    { id: '3', data: '2026-11-04', valor: 800, tipo: 'Saída', categoria: 'Compras', forma: 'Crédito' },
  ];
  const s = lib.monthSummary(t, '2026-11');
  assert.deepEqual([s.entradas, s.saidas, s.resultado, s.noCartao, s.emConta], [3000, 1000, 2000, 800, 2800]);
});

test('dataWarnings avisa mês só de cartão, contagem em dobro da fatura e excesso de "Outros"', () => {
  const soCartao = [{ id: 'a', data: '2026-11-04', valor: 4000, tipo: 'Saída', categoria: 'Compras', forma: 'Crédito', descricao: 'Loja' }];
  const w1 = lib.dataWarnings(soCartao, '2026-11');
  assert.equal(w1[0].id, 'sem-entradas');
  assert.ok(/no cartão/.test(w1[0].text));
  const dobro = [
    { id: 'b', data: '2026-11-05', valor: 1000, tipo: 'Saída', categoria: 'Cartão', forma: 'Débito', descricao: 'Pagamento fatura cartão' },
    { id: 'c', data: '2026-11-02', valor: 900, tipo: 'Saída', categoria: 'Compras', forma: 'Crédito', descricao: 'Loja' },
    { id: 'd', data: '2026-11-01', valor: 3000, tipo: 'Entrada', categoria: 'Salário', forma: 'Pix', descricao: 'Salário' },
  ];
  const w2 = lib.dataWarnings(dobro, '2026-11').find((w) => w.id === 'dupla-contagem');
  assert.deepEqual(w2.fixIds, ['b']);
  const outros = [{ id: 'e', data: '2026-11-01', valor: 100, tipo: 'Entrada', categoria: 'Salário', forma: 'Pix' }, { id: 'f', data: '2026-11-02', valor: 50, tipo: 'Saída', categoria: 'Outros', forma: 'Débito' }];
  assert.ok(lib.dataWarnings(outros, '2026-11').some((w) => w.id === 'muito-outros'));
});

test('installmentSchedule projeta as parcelas que faltam a partir da última parcela vista', () => {
  const t = [
    { data: '2026-10-10', valor: 100, tipo: 'Saída', descricao: 'Magalu - Parcela 2/5', categoria: 'Compras' },
    { data: '2026-11-10', valor: 100, tipo: 'Saída', descricao: 'Magalu - Parcela 3/5', categoria: 'Compras' },
    { data: '2026-11-12', valor: 50, tipo: 'Saída', descricao: 'Celular 1/2', categoria: 'Celular' },
  ];
  const r = lib.installmentSchedule(t, '2026-11');
  assert.deepEqual(r.meses, [{ month: '2026-12', total: 150 }, { month: '2027-01', total: 100 }]);
  assert.equal(r.total, 250);
  assert.deepEqual(r.itens.map((i) => [i.descricao, i.restantes]), [['Magalu - Parcela 3/5', 2], ['Celular 1/2', 1]]);
});

test('recategorize e applyCategoryToSimilar só mexem no que deve', () => {
  const t = [
    { id: '1', descricao: 'Drogasil 1', tipo: 'Saída', categoria: 'Outros' },
    { id: '2', descricao: 'Coisa estranha', tipo: 'Saída', categoria: 'Outros' },
    { id: '3', descricao: 'Padaria', tipo: 'Saída', categoria: 'Lazer', manual: true },
    { id: '4', descricao: 'Pagamento fatura cartão', tipo: 'Saída', categoria: 'Cartão', data: '2026-11-10', valor: 100 },
    { id: '5', descricao: 'Parcela do celular', tipo: 'Saída', categoria: 'Celular' },
    { id: '6', descricao: 'Transferência enviada - Dhiego Exemplo', tipo: 'Saída', categoria: 'Outros', data: '2026-11-12', valor: 50 },
    { id: '7', descricao: 'Transferência recebida - Dhiego Exemplo', tipo: 'Entrada', categoria: 'Outros', data: '2026-11-12', valor: 50 },
  ];
  const r = lib.recategorize(t);
  assert.deepEqual(r.transactions.map((x) => x.categoria), ['Saúde', 'Outros', 'Lazer', 'Fatura paga', 'Celular', 'Transferência própria', 'Transferência própria']);
  assert.equal(r.changed, 4);
  assert.deepEqual(r.changes.find((c) => c.id === '4'), { id: '4', de: 'Cartão', para: 'Fatura paga' });
  assert.equal(t[3].categoria, 'Cartão'); // a lista original não é alterada
  const base = [{ id: 'a', descricao: 'Padaria Central 1', tipo: 'Saída', categoria: 'Outros' }, { id: 'b', descricao: 'Compra - Padaria Central 22', tipo: 'Saída', categoria: 'Outros' }, { id: 'c', descricao: 'Mercado X', tipo: 'Saída', categoria: 'Outros' }];
  const a = lib.applyCategoryToSimilar(base, base[0], 'Alimentação');
  assert.equal(a.changed, 1);
  assert.deepEqual(a.transactions.map((x) => x.categoria), ['Outros', 'Alimentação', 'Outros']);
});

test('importSanity avisa conta tratada como fatura, só saídas e parcelas sem marcar fatura', () => {
  const conta = lib.bankTransactions([{ data: '2026-11-03', valor: 3000, descricao: 'Pagamento de salário' }, { data: '2026-11-04', valor: -30, descricao: 'Padaria' }]);
  assert.ok(lib.importSanity(conta, { isCard: true }).some((w) => /extrato de conta/.test(w)));
  const soSaidas = lib.bankTransactions([1, 2, 3, 4].map((i) => ({ data: '2026-11-0' + i, valor: -10 * i, descricao: 'Compra ' + i })));
  assert.ok(lib.importSanity(soSaidas).some((w) => /Só há saídas/.test(w)));
  const parcelas = lib.bankTransactions([1, 2, 3, 4].map((i) => ({ data: '2026-11-0' + i, valor: -10 * i, descricao: 'Loja ' + i + ' Parcela 2/10' })));
  assert.ok(lib.importSanity(parcelas).some((w) => /fatura de cartão/.test(w)));
});

test('PDF de conta que cita "pagamento de fatura" não é confundido com fatura de cartão', () => {
  const r = lib.parsePdfStatement(['Extrato conta corrente', 'Saldo anterior 100,00', '03/11/2026 Pagamento de fatura cartão -500,00', 'Limite disponível 300,00']);
  assert.equal(r.cardHint, false);
});

test('accountBalance: saldo informado + movimentos depois da data; crédito, não pago e futuro ficam de fora', () => {
  const t = [
    { data: '2026-11-01', valor: 999, tipo: 'Saída', forma: 'Débito' }, // antes do saldo informado: já está nele
    { data: '2026-11-10', valor: 200, tipo: 'Saída', forma: 'Pix' },
    { data: '2026-11-11', valor: 3000, tipo: 'Entrada', forma: 'Pix' },
    { data: '2026-11-12', valor: 800, tipo: 'Saída', forma: 'Crédito' }, // cartão: não mexe na conta
    { data: '2026-11-13', valor: 50, tipo: 'Saída', forma: 'Débito', pago: 'Não' },
    { data: '2026-12-01', valor: 70, tipo: 'Saída', forma: 'Débito' }, // futuro
    { data: '2026-11-14', valor: 1000, tipo: 'Saída', forma: 'Pix', categoria: 'Fatura paga' }, // pagar a fatura sai da conta
  ];
  const r = lib.accountBalance(t, { saldoInicial: 1500, saldoData: '2026-11-05' }, '2026-11-20');
  assert.equal(r.saldo, 1500 - 200 + 3000 - 1000);
  assert.equal(r.configurado, true);
  assert.equal(lib.accountBalance([], {}, '2026-11-20').configurado, false);
});

test('invoiceCycle: fatura aberta, fechamento e vencimento, inclusive virada de mês e ano', () => {
  assert.deepEqual(lib.invoiceCycle('2026-11-03', 5, 12), { start: '2026-10-06', end: '2026-11-05', due: '2026-11-12' });
  assert.deepEqual(lib.invoiceCycle('2026-11-06', 5, 12), { start: '2026-11-06', end: '2026-12-05', due: '2026-12-12' });
  assert.deepEqual(lib.invoiceCycle('2026-12-20', 25, 5), { start: '2026-11-26', end: '2026-12-25', due: '2027-01-05' }); // vence no mês seguinte
  assert.deepEqual(lib.invoiceCycle('2026-02-10', 31, 10), { start: '2026-02-01', end: '2026-02-28', due: '2026-03-10' }); // fechamento no dia 31 em mês curto
});

test('cardSummary: fatura aberta, fatura vencida com o que falta pagar e limite livre', () => {
  const t = [
    { data: '2026-10-10', valor: 500, tipo: 'Saída', forma: 'Crédito', categoria: 'Compras' }, // fatura que vence 12/11
    { data: '2026-10-20', valor: 100, tipo: 'Saída', forma: 'Crédito', categoria: 'Lazer' },
    { data: '2026-11-08', valor: 300, tipo: 'Saída', forma: 'Crédito', categoria: 'Compras' }, // fatura aberta (vence 12/12)
    { data: '2026-11-09', valor: 40, tipo: 'Entrada', forma: 'Crédito', categoria: 'Compras' }, // estorno
    { data: '2026-11-10', valor: 400, tipo: 'Saída', forma: 'Pix', categoria: 'Fatura paga' }, // pagou parte da vencida
  ];
  const c = lib.cardSummary(t, { cartaoFecha: 5, cartaoVence: 12, cartaoLimite: 2000 }, '2026-11-15');
  assert.equal(c.configurado, true);
  assert.equal(c.aberta.total, 260);
  assert.equal(c.aberta.end, '2026-12-05');
  assert.equal(c.pendentes.length, 1);
  assert.deepEqual([c.pendentes[0].total, c.pendentes[0].pago, c.pendentes[0].faltam, c.pendentes[0].due, c.pendentes[0].status], [600, 400, 200, '2026-11-12', 'vencida']);
  assert.deepEqual([c.usado, c.livre], [460, 1540]);
  const sem = lib.cardSummary(t, {}, '2026-11-15'); // sem fechamento: uma fatura por mês do calendário
  assert.equal(sem.configurado, false);
  assert.equal(sem.aberta.total, 260);
  const marcada = lib.cardSummary(t, { cartaoFecha: 5, cartaoVence: 12, faturasPagas: { '2026-11': true } }, '2026-11-15');
  assert.equal(marcada.pendentes.length, 0); // "marcar como paga" tira da lista
});

test('fatura pela etiqueta: compras de antes do fechamento ficam juntas na fatura importada', () => {
  const t = [
    { data: '2026-10-28', valor: 120, tipo: 'Saída', forma: 'Crédito', categoria: 'Compras', fatura: '2026-12' },
    { data: '2026-11-20', valor: 80, tipo: 'Saída', forma: 'Crédito', categoria: 'Compras', fatura: '2026-12' },
    { data: '2026-07-15', valor: 200, tipo: 'Saída', forma: 'Crédito', categoria: 'Compras', fatura: '2026-12', descricao: 'Magalu - Parcela 4/10' },
  ];
  const c = lib.cardSummary(t, { cartaoFecha: 5, cartaoVence: 13 }, '2026-11-25');
  assert.equal(c.aberta.key, '2026-12');
  assert.equal(c.aberta.total, 400);
  assert.equal(c.pendentes.length, 0);
  assert.equal(lib.faturaKey({ data: '2026-11-20' }, { cartaoFecha: 5, cartaoVence: 13 }), '2026-12');
  assert.equal(lib.suggestFatura([{ data: '2026-11-20', descricao: 'Padaria' }, { data: '2026-07-15', descricao: 'Magalu - Parcela 4/10' }], { cartaoFecha: 5, cartaoVence: 13 }), '2026-12');
});

test('reimportar a mesma fatura reconhece os lançamentos (pela data original) e devolve o id para atualizar', () => {
  const existing = [
    { id: 'a', data: '2026-07-15', valor: 200, tipo: 'Saída', descricao: 'Magalu - Parcela 4/10' }, // importado antes, com a data original
    { id: 'b', data: '2026-11-04', valor: 120, tipo: 'Saída', descricao: 'Pizzaria', ref: 'R1' },
  ];
  const incoming = lib.bankTransactions([
    { data: '2026-11-04', valor: 120, descricao: 'Pizzaria', ref: 'R1' },
    { data: '2026-07-15', valor: 200, descricao: 'Magalu - Parcela 4/10' },
    { data: '2026-11-06', valor: 30, descricao: 'Padaria' },
  ], { isCard: true, invert: true });
  const mark = lib.markDuplicates(existing, incoming);
  assert.deepEqual(mark.map((m) => [m.duplicado, m.existingId]), [[true, 'b'], [true, 'a'], [false, undefined]]);
});

test('neutralSummary mostra o que ficou de fora das contas no mês', () => {
  const r = lib.neutralSummary([
    { data: '2026-11-05', valor: 400, tipo: 'Saída', categoria: 'Fatura paga' },
    { data: '2026-11-06', valor: 100, tipo: 'Saída', categoria: 'Transferência própria' },
    { data: '2026-11-06', valor: 100, tipo: 'Entrada', categoria: 'Transferência própria' },
    { data: '2026-10-06', valor: 9, tipo: 'Saída', categoria: 'Resgate' },
  ], '2026-11');
  assert.deepEqual(r.map((x) => [x.categoria, x.n, x.total]), [['Fatura paga', 1, 400], ['Transferência própria', 2, 200]]);
});

test('monthSummary soma as faturas pagas do mês à parte', () => {
  const s = lib.monthSummary([{ data: '2026-11-10', valor: 400, tipo: 'Saída', forma: 'Pix', categoria: 'Fatura paga' }], '2026-11');
  assert.deepEqual([s.faturasPagas, s.saidas], [400, 0]);
});

test('limite do cartão: parcelas que ainda vão vir contam como limite em uso', () => {
  const t = [
    { data: '2026-11-08', valor: 300, tipo: 'Saída', forma: 'Crédito', categoria: 'Compras', descricao: 'Padaria' },
    { data: '2026-11-09', valor: 100, tipo: 'Saída', forma: 'Crédito', categoria: 'Compras', descricao: 'Magalu - Parcela 3/10' }, // faltam 7 x 100
    { data: '2026-11-09', valor: 50, tipo: 'Saída', forma: 'Débito', categoria: 'Compras', descricao: 'Loja X 1/3' }, // débito: não pesa no limite
  ];
  const c = lib.cardSummary(t, { cartaoFecha: 5, cartaoVence: 12, cartaoLimite: 2000 }, '2026-11-15');
  assert.equal(c.aberta.total, 400);
  assert.equal(c.parcelas, 700);
  assert.equal(c.usado, 1100);
  assert.equal(c.livre, 900);
});

test('parcelas com a data da compra original vão para a data da fatura (na importação e no que já foi importado)', () => {
  const raw = [
    { data: '2026-11-02', valor: 80, descricao: 'Padaria Central' },
    { data: '2026-11-04', valor: 120, descricao: 'Pizzaria Exemplo' },
    { data: '2026-07-15', valor: 200, descricao: 'Magalu - Parcela 4/10' }, // compra de julho, 4ª parcela na fatura de novembro
    { data: '2026-11-03', valor: 90, descricao: 'Loja Y - Parcela 1/6' }, // 1ª parcela: data é a da compra
  ];
  const list = lib.bankTransactions(raw.map((r) => ({ ...r, valor: r.valor })), { isCard: true });
  assert.deepEqual(list.map((x) => x.data), ['2026-11-02', '2026-11-04', '2026-11-04', '2026-11-03']);
  assert.equal(list[2].dataOriginal, '2026-07-15');
  assert.ok(lib.importSanity(list, { isCard: true }).some((w) => /data da compra original/.test(w)));
  const antigo = [
    { id: 'tx_1700000000000_0_a', data: '2026-11-04', valor: 120, tipo: 'Saída', forma: 'Crédito', descricao: 'Pizzaria' },
    { id: 'tx_1700000000000_1_b', data: '2026-07-15', valor: 200, tipo: 'Saída', forma: 'Crédito', descricao: 'Magalu - Parcela 4/10' },
    { id: 'tx_1700000099999_0_c', data: '2026-07-15', valor: 10, tipo: 'Saída', forma: 'Crédito', descricao: 'Sozinha - Parcela 2/3' }, // lote sem âncora: não mexe
  ];
  const r = lib.fixInstallmentDates(antigo);
  assert.equal(r.changed, 1);
  assert.deepEqual(r.transactions.map((x) => x.data), ['2026-11-04', '2026-11-04', '2026-07-15']);
  assert.ok(lib.dataWarnings(antigo, '2026-11').some((w) => w.id === 'parcelas-datas'));
});

test('várias contas e cartões: cada lançamento vai para a sua conta, sem conta cai na primeira', () => {
  const config = { contas: [
    { id: 'c1', nome: 'Nubank', tipo: 'conta', saldoInicial: 1000, saldoData: '2026-11-01' },
    { id: 'c2', nome: 'Inter', tipo: 'conta', saldoInicial: 500, saldoData: '2026-11-01' },
    { id: 'k1', nome: 'Nubank Roxo', tipo: 'cartao', limite: 2000, fecha: 5, vence: 12 },
    { id: 'k2', nome: 'Inter Gold', tipo: 'cartao', limite: 1000, fecha: 20, vence: 27 },
  ] };
  const t = [
    { id: 'a', data: '2026-11-05', valor: 100, tipo: 'Saída', forma: 'Pix', conta: 'c1' },
    { id: 'b', data: '2026-11-06', valor: 40, tipo: 'Saída', forma: 'Débito', conta: 'c2' },
    { id: 'c', data: '2026-11-07', valor: 30, tipo: 'Saída', forma: 'Pix' }, // sem conta: primeira conta
    { id: 'd', data: '2026-11-08', valor: 25, tipo: 'Saída', forma: 'Pix', conta: 'sumiu' }, // conta que não existe mais: primeira
    { id: 'e', data: '2026-11-08', valor: 300, tipo: 'Saída', forma: 'Crédito', conta: 'k2' },
    { id: 'f', data: '2026-11-09', valor: 80, tipo: 'Saída', forma: 'Crédito' }, // primeiro cartão
  ];
  const accs = lib.accountsOverview(t, config, '2026-11-20');
  assert.deepEqual(accs.map((a) => [a.entity.nome, a.saldo]), [['Nubank', 1000 - 100 - 30 - 25], ['Inter', 500 - 40]]);
  const cards = lib.cardsOverview(t, config, '2026-11-15');
  assert.deepEqual(cards.map((c) => [c.entity.nome, c.aberta.total]), [['Nubank Roxo', 80], ['Inter Gold', 300]]);
  assert.equal(cards[1].aberta.end, '2026-11-20'); // este cartão fecha dia 20
});

test('várias contas e cartões: configuração antiga vira conta e cartão principais; pago antigo vale para o primeiro cartão', () => {
  const antiga = { saldoInicial: 700, saldoData: '2026-11-01', cartaoLimite: 3000, cartaoFecha: 5, cartaoVence: 12, faturasPagas: { '2026-11': true } };
  const ents = lib.entitiesOf(antiga);
  assert.deepEqual(ents.map((e) => [e.id, e.tipo]), [['conta1', 'conta'], ['cartao1', 'cartao']]);
  assert.equal(lib.entityConfig(ents[1], antiga, ents).faturasPagas['2026-11'], true);
  const nova = { contas: [...ents, { id: 'k2', nome: 'Outro', tipo: 'cartao', limite: 0, fecha: 1, vence: 8 }], faturasPagas: { 'cartao1|2026-11': true, 'k2|2026-12': true } };
  const e2 = lib.entitiesOf(nova);
  assert.deepEqual(Object.keys(lib.entityConfig(e2[1], nova, e2).faturasPagas), ['2026-11']);
  assert.deepEqual(Object.keys(lib.entityConfig(e2[2], nova, e2).faturasPagas), ['2026-12']);
});

test('com mais de um cartão, pagamento de fatura só abate a fatura se disser de qual cartão', () => {
  const config = { contas: [
    { id: 'k1', nome: 'A', tipo: 'cartao', limite: 0, fecha: 5, vence: 12 },
    { id: 'k2', nome: 'B', tipo: 'cartao', limite: 0, fecha: 5, vence: 12 },
  ] };
  const t = [
    { id: 'a', data: '2026-10-10', valor: 500, tipo: 'Saída', forma: 'Crédito', conta: 'k1' },
    { id: 'b', data: '2026-10-10', valor: 500, tipo: 'Saída', forma: 'Crédito', conta: 'k2' },
    { id: 'p', data: '2026-11-10', valor: 500, tipo: 'Saída', forma: 'Pix', categoria: 'Fatura paga', cartao: 'k2' },
  ];
  const [k1, k2] = lib.cardsOverview(t, config, '2026-11-15');
  assert.deepEqual([k1.pendentes.length, k2.pendentes.length], [1, 0]);
});
