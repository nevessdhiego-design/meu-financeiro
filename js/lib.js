/* Meu Financeiro: funções puras (sem DOM e sem estado), testáveis no Node e no navegador.
   No navegador ficam em window.FinLib; no Node, em module.exports. */
(function (root, factory) {
  const lib = factory();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else root.FinLib = lib;
})(typeof self !== 'undefined' ? self : this, function () {
  function fmt(n) {
    return (n < 0 ? '-' : '') + 'R$ ' + Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function pct(n) {
    return (n * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  // Data e mês no fuso local (toISOString() usa UTC e erra o dia perto da meia-noite).
  function todayISO(now = new Date()) {
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  }

  function curMonth(now = new Date()) {
    return todayISO(now).slice(0, 7);
  }

  function shiftMonth(month, delta) {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  }

  function monthLabel(month) {
    if (!month) return 'mês selecionado';
    const [year, value] = month.split('-');
    return new Date(Number(year), Number(value) - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  }

  function monthShort(month) {
    const [year, value] = month.split('-');
    return new Date(Number(year), Number(value) - 1, 1).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
  }

  function normalizeText(value) {
    return String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }

  function normalizeImportText(value) {
    return normalizeText(value).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  }

  function parseImportNumber(value) {
    if (typeof value === 'number') return value;
    let text = String(value ?? '').replace(/[^\d,.-]/g, '').trim();
    if (!text) return NaN;
    if (text.includes(',') && text.includes('.')) text = text.replace(/\./g, '').replace(',', '.');
    else if (text.includes(',')) text = text.replace(',', '.');
    return Number(text);
  }

  function parseImportDate(value) {
    if (value instanceof Date && !isNaN(value)) {
      return [value.getFullYear(), pad2(value.getMonth() + 1), pad2(value.getDate())].join('-');
    }
    if (typeof value === 'number' && value > 0) {
      // número de série do Excel (dias desde 30/12/1899, em UTC)
      return new Date(Date.UTC(1899, 11, 30) + value * 86400000).toISOString().slice(0, 10);
    }
    const text = String(value ?? '').trim();
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(text)) {
      const [day, month, year] = text.split('/');
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    return text.slice(0, 10);
  }

  // Entradas e saídas por mês, dos últimos `count` meses até `endMonth` (mais antigo primeiro).
  function monthlyTotals(transactions, endMonth, count = 6) {
    const months = [];
    for (let i = count - 1; i >= 0; i--) months.push(shiftMonth(endMonth, -i));
    const totals = new Map(months.map((month) => [month, { month, entradas: 0, saidas: 0 }]));
    for (const t of transactions) {
      const bucket = totals.get(String(t.data || '').slice(0, 7));
      if (!bucket) continue;
      const value = Number(t.valor) || 0;
      if (t.tipo === 'Entrada') bucket.entradas += value;
      else bucket.saidas += value;
    }
    return months.map((month) => totals.get(month));
  }

  // Busca por texto na descrição, categoria e forma de pagamento (sem acento e sem diferenciar maiúsculas).
  function matchesSearch(transaction, query) {
    const terms = normalizeText(query).split(/\s+/).filter(Boolean);
    if (!terms.length) return true;
    const haystack = normalizeText(`${transaction.descricao || ''} ${transaction.categoria || ''} ${transaction.forma || ''}`);
    return terms.every((term) => haystack.includes(term));
  }

  function daysBetween(fromISO, toISO) {
    const [fy, fm, fd] = fromISO.split('-').map(Number);
    const [ty, tm, td] = toISO.split('-').map(Number);
    return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
  }

  // Situação do backup: 'vazio' (sem dados), 'nunca', 'em-dia' ou 'atrasado'.
  function backupStatus(lastBackupISO, hasData, todayStr, maxDays = 14) {
    if (!hasData) return { level: 'vazio', days: null };
    if (!lastBackupISO) return { level: 'nunca', days: null };
    const days = daysBetween(lastBackupISO, todayStr);
    return { level: days > maxDays ? 'atrasado' : 'em-dia', days };
  }

  return {
    fmt, pct, escapeHtml, pad2, todayISO, curMonth, shiftMonth, monthLabel, monthShort,
    normalizeText, normalizeImportText, parseImportNumber, parseImportDate,
    monthlyTotals, matchesSearch, daysBetween, backupStatus,
  };
});
