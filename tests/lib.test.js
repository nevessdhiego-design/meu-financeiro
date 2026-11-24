// Testes das funções puras de js/lib.js. Rodam com: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const lib = require('../js/lib.js');

test('fmt formata em reais, com sinal e duas casas', () => {
  assert.equal(lib.fmt(1234.5), 'R$ 1.234,50');
  assert.equal(lib.fmt(-80), '-R$ 80,00');
  assert.equal(lib.fmt(0), 'R$ 0,00');
});

test('pct formata percentual com uma casa', () => {
  assert.equal(lib.pct(0.25), '25%');
  assert.equal(lib.pct(0.9074), '90,7%');
});

test('escapeHtml neutraliza marcação e aspas', () => {
  assert.equal(lib.escapeHtml('<img src=x onerror="a()">'), '&lt;img src=x onerror=&quot;a()&quot;&gt;');
  assert.equal(lib.escapeHtml("a'b&c"), 'a&#39;b&amp;c');
});

test('todayISO e curMonth usam o fuso local, não UTC', () => {
  // 31/12/2026 23:30 no horário local: em UTC (UTC-3) já seria 2027
  const lateNight = new Date(2026, 11, 31, 23, 30);
  assert.equal(lib.todayISO(lateNight), '2026-12-31');
  assert.equal(lib.curMonth(lateNight), '2026-12');
});

test('shiftMonth atravessa anos', () => {
  assert.equal(lib.shiftMonth('2026-01', -1), '2025-12');
  assert.equal(lib.shiftMonth('2026-11', 3), '2027-02');
  assert.equal(lib.shiftMonth('2026-05', 0), '2026-05');
});

test('parseImportNumber entende formatos brasileiros e internacionais', () => {
  assert.equal(lib.parseImportNumber('R$ 1.234,56'), 1234.56);
  assert.equal(lib.parseImportNumber('12,5'), 12.5);
  assert.equal(lib.parseImportNumber('1234.56'), 1234.56);
  assert.equal(lib.parseImportNumber(42), 42);
  assert.ok(Number.isNaN(lib.parseImportNumber('')));
  assert.ok(Number.isNaN(lib.parseImportNumber(null)));
});

test('parseImportDate aceita dd/mm/aaaa, ISO, Date e número de série do Excel', () => {
  assert.equal(lib.parseImportDate('5/11/2026'), '2026-11-05');
  assert.equal(lib.parseImportDate('2026-11-05T10:00:00'), '2026-11-05');
  assert.equal(lib.parseImportDate(new Date(2026, 10, 5)), '2026-11-05');
  assert.equal(lib.parseImportDate(46331), '2026-11-05'); // série do Excel para 05/11/2026
});

test('normalizeImportText remove acento e vira chave com sublinhado', () => {
  assert.equal(lib.normalizeImportText('Forma de pagamento'), 'forma_de_pagamento');
  assert.equal(lib.normalizeImportText('  Descrição '), 'descricao');
  assert.equal(lib.normalizeImportText('Pago?'), 'pago');
});

test('monthlyTotals soma entradas e saídas por mês e preenche meses vazios', () => {
  const list = [
    { data: '2026-11-05', tipo: 'Entrada', valor: 3000 },
    { data: '2026-11-10', tipo: 'Saída', valor: 100.5 },
    { data: '2026-11-20', tipo: 'Saída', valor: 49.5 },
    { data: '2026-09-02', tipo: 'Saída', valor: 70 },
    { data: '2025-01-02', tipo: 'Saída', valor: 999 }, // fora da janela
    { data: '', tipo: 'Saída', valor: 5 },              // sem data
  ];
  const result = lib.monthlyTotals(list, '2026-11', 3);
  assert.deepEqual(result.map((r) => r.month), ['2026-09', '2026-10', '2026-11']);
  assert.deepEqual(result.map((r) => r.entradas), [0, 0, 3000]);
  assert.deepEqual(result.map((r) => r.saidas), [70, 0, 150]);
});

test('matchesSearch ignora acento e caixa e exige todos os termos', () => {
  const t = { descricao: 'Mensalidade da faculdade', categoria: 'Faculdade', forma: 'Débito' };
  assert.equal(lib.matchesSearch(t, ''), true);
  assert.equal(lib.matchesSearch(t, 'FACULDADE'), true);
  assert.equal(lib.matchesSearch(t, 'debito mensalidade'), true);
  assert.equal(lib.matchesSearch(t, 'mercado'), false);
  assert.equal(lib.matchesSearch({}, 'x'), false);
});

test('backupStatus: vazio, nunca, em dia e atrasado', () => {
  assert.deepEqual(lib.backupStatus(null, false, '2026-11-24'), { level: 'vazio', days: null });
  assert.deepEqual(lib.backupStatus(null, true, '2026-11-24'), { level: 'nunca', days: null });
  assert.deepEqual(lib.backupStatus('2026-11-20', true, '2026-11-24'), { level: 'em-dia', days: 4 });
  assert.deepEqual(lib.backupStatus('2026-11-10', true, '2026-11-24'), { level: 'em-dia', days: 14 });
  assert.deepEqual(lib.backupStatus('2026-11-09', true, '2026-11-24'), { level: 'atrasado', days: 15 });
});

test('daysBetween cruza meses e anos sem erro de fuso', () => {
  assert.equal(lib.daysBetween('2026-12-30', '2027-01-02'), 3);
  assert.equal(lib.daysBetween('2026-03-01', '2026-03-01'), 0);
});
