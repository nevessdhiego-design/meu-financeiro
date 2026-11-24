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

  // Rótulo do cabeçalho de um dia na lista: "Hoje", "Ontem" ou "qua, 12 de nov".
  function dayLabel(dateISO, todayStr) {
    if (!dateISO) return 'Sem data';
    const diff = daysBetween(dateISO, todayStr);
    if (diff === 0) return 'Hoje';
    if (diff === 1) return 'Ontem';
    const [y, m, d] = dateISO.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const weekday = date.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
    const rest = date.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.', '');
    return `${weekday}, ${rest}`;
  }

  // Agrupa lançamentos por dia (dia mais recente primeiro) com o saldo líquido de cada dia.
  function groupByDay(list) {
    const days = new Map();
    for (const t of list) {
      const key = t.data || '';
      if (!days.has(key)) days.set(key, { date: key, items: [], net: 0 });
      const day = days.get(key);
      day.items.push(t);
      day.net += (t.tipo === 'Entrada' ? 1 : -1) * (Number(t.valor) || 0);
    }
    return [...days.values()].sort((a, b) => b.date.localeCompare(a.date));
  }

  // Total por categoria das saídas de um mês, da maior para a menor.
  function categoryTotals(transactions, month, tipo = 'Saída') {
    const totals = new Map();
    for (const t of transactions) {
      if (t.tipo !== tipo || !String(t.data || '').startsWith(month)) continue;
      const key = t.categoria || 'Outros';
      totals.set(key, (totals.get(key) || 0) + (Number(t.valor) || 0));
    }
    return [...totals.entries()].map(([categoria, total]) => ({ categoria, total })).sort((a, b) => b.total - a.total);
  }

  // ---------------------------------------------------------------------------
  // Importação de extratos de banco (OFX e CSV). Tudo roda no aparelho.
  // Os parsers devolvem lançamentos "crus" com valor com sinal (negativo = saída):
  //   { data: 'AAAA-MM-DD', valor: -45.9, descricao, ref?, hint? }
  // ---------------------------------------------------------------------------

  // Texto de um arquivo: tenta UTF-8 e, se houver bytes inválidos, cai para Windows-1252 (comum em bancos).
  function decodeBytes(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e) {
      return new TextDecoder('windows-1252').decode(bytes);
    }
  }

  // Data de extrato: dd/mm/aaaa, dd/mm/aa, dd-mm-aaaa, aaaa-mm-dd (com hora), aaaa/mm/dd ou aaaammdd(hhmmss).
  function parseBankDate(value) {
    const text = String(value ?? '').trim();
    let y, m, d, match;
    if ((match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/))) [, y, m, d] = match;
    else if ((match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/))) [, d, m, y] = match;
    else if ((match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2})(?!\d)/))) { [, d, m, y] = match; y = '20' + y; }
    else if ((match = text.match(/^(\d{4})(\d{2})(\d{2})/))) [, y, m, d] = match;
    else return '';
    const mi = Number(m), di = Number(d);
    if (mi < 1 || mi > 12 || di < 1 || di > 31) return '';
    return `${y}-${pad2(mi)}-${pad2(di)}`;
  }

  // Valor monetário de extrato: "R$ -1.234,56", "(45,90)", "45,90-", "1234.5".
  function parseMoney(value) {
    if (typeof value === 'number') return value;
    let text = String(value ?? '').trim();
    if (!text) return NaN;
    let negative = false;
    if (/^\(.*\)$/.test(text)) { negative = true; text = text.slice(1, -1); }
    if (text.endsWith('-')) { negative = true; text = text.slice(0, -1); }
    const n = parseImportNumber(text);
    return negative && Number.isFinite(n) ? -Math.abs(n) : n;
  }

  // CSV simples (aspas, BOM, ; , ou tab). Devolve uma matriz de textos.
  function parseCSV(text) {
    const raw = String(text ?? '');
    const source = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw; // tira o BOM
    const lines = source.split(/\r?\n/).filter((line) => line.trim()).slice(0, 8);
    const counts = { ';': 0, ',': 0, '\t': 0 };
    for (const line of lines) {
      let quoted = false;
      for (const ch of line) {
        if (ch === '"') quoted = !quoted;
        else if (!quoted && ch in counts) counts[ch]++;
      }
    }
    const delimiter = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || (a === ';' ? -1 : 1))[0];
    const rows = [];
    let row = [], field = '', quoted = false;
    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      if (quoted) {
        if (ch === '"' && source[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') quoted = false;
        else field += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === delimiter) { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && source[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some((cell) => cell.trim())) rows.push(row);
        row = [];
      } else field += ch;
    }
    row.push(field);
    if (row.some((cell) => cell.trim())) rows.push(row);
    return rows;
  }

  const DESC_COLUMNS = ['historico', 'descricao', 'description', 'title', 'titulo', 'estabelecimento', 'detalhes', 'memo', 'nome', 'lancamento'];
  const startsWithAny = (name, list) => list.some((key) => name === key || name.startsWith(key + '_'));

  // Descobre quais colunas do cabeçalho são data, descrição, valor etc.
  function mapCsvColumns(headerCells) {
    const names = headerCells.map(normalizeImportText);
    const cols = { desc: [] };
    names.forEach((name, i) => {
      if (!name) return;
      if (cols.date === undefined && (name === 'date' || name.startsWith('data') || name.startsWith('dt_'))) cols.date = i;
      else if (!name.includes('saldo') && cols.amount === undefined && (name === 'amount' || name === 'value' || name === 'quantia' || name.startsWith('valor'))) cols.amount = i;
      else if (cols.credit === undefined && (name === 'credito' || name === 'entrada' || name === 'entradas')) cols.credit = i;
      else if (cols.debit === undefined && (name === 'debito' || name === 'saida' || name === 'saidas')) cols.debit = i;
      else if (cols.tipo === undefined && (name === 'tipo' || name.startsWith('tipo_') || name === 'natureza')) cols.tipo = i;
      else if (cols.category === undefined && (name === 'categoria' || name === 'category')) cols.category = i;
      else if (cols.id === undefined && (name === 'identificador' || name === 'id' || name === 'protocolo')) cols.id = i;
      else if (startsWithAny(name, DESC_COLUMNS) && !name.includes('saldo')) cols.desc.push(i);
    });
    cols.desc.sort((a, b) => DESC_COLUMNS.findIndex((k) => startsWithAny(names[a], [k])) - DESC_COLUMNS.findIndex((k) => startsWithAny(names[b], [k])));
    const hasValue = cols.amount !== undefined || cols.credit !== undefined || cols.debit !== undefined;
    return cols.date !== undefined && hasValue && cols.desc.length ? { cols, names } : null;
  }

  function parseBankCSV(text) {
    const rows = parseCSV(text);
    let found = null, headerIndex = -1;
    for (let i = 0; i < Math.min(rows.length, 40) && !found; i++) {
      found = mapCsvColumns(rows[i]);
      headerIndex = i;
    }
    if (!found) return { items: [], invertHint: false, cardHint: false, error: 'colunas' };
    const { cols, names } = found;
    // Fatura do Nubank: date, category, title, amount; os gastos vêm positivos.
    const invertHint = names.includes('title') && names.includes('category') && names.includes('amount') && names.includes('date');
    const cell = (row, i) => (i === undefined ? '' : String(row[i] ?? '').trim());
    const items = [];
    for (const row of rows.slice(headerIndex + 1)) {
      const data = parseBankDate(cell(row, cols.date));
      if (!data) continue;
      const parts = [];
      for (const i of cols.desc) { const part = cell(row, i); if (part && !parts.includes(part)) parts.push(part); }
      const descricao = parts.join(' - ');
      if (!descricao || /^saldo\b/.test(normalizeText(descricao))) continue;
      let valor;
      if (cols.amount !== undefined) {
        valor = parseMoney(cell(row, cols.amount));
        const tipoText = normalizeText(cell(row, cols.tipo));
        if (Number.isFinite(valor) && valor > 0 && /^(deb|saida|compra|pagamento)/.test(tipoText)) valor = -valor;
      } else {
        const credit = parseMoney(cell(row, cols.credit)), debit = parseMoney(cell(row, cols.debit));
        valor = (Number.isFinite(credit) ? Math.abs(credit) : 0) - (Number.isFinite(debit) ? Math.abs(debit) : 0);
        if (!Number.isFinite(credit) && !Number.isFinite(debit)) valor = NaN;
      }
      if (!Number.isFinite(valor) || valor === 0) continue;
      items.push({ data, valor, descricao, ref: cell(row, cols.id) || undefined, hint: cell(row, cols.category) || undefined });
    }
    return { items, invertHint, cardHint: invertHint };
  }

  function decodeEntities(text) {
    return text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
  }

  // OFX (SGML antigo ou XML): conta corrente e cartão de crédito.
  function parseOFX(text) {
    const source = String(text ?? '');
    const cardHint = /<CCSTMTRS>|<CREDITCARDMSGSRSV1>/i.test(source);
    const tag = (block, name) => {
      const match = block.match(new RegExp('<' + name + '>\\s*([^<\\r\\n]*)', 'i'));
      return match ? decodeEntities(match[1].trim()) : '';
    };
    const items = [];
    const blocks = source.match(/<STMTTRN>[\s\S]*?(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>|$)/gi) || [];
    for (const block of blocks) {
      const data = parseBankDate(tag(block, 'DTPOSTED'));
      const valor = Number(tag(block, 'TRNAMT').replace(',', '.'));
      const parts = [];
      for (const part of [tag(block, 'NAME'), tag(block, 'MEMO')]) if (part && !parts.includes(part)) parts.push(part);
      const descricao = parts.join(' - ');
      if (!data || !Number.isFinite(valor) || valor === 0 || !descricao) continue;
      items.push({ data, valor, descricao, ref: tag(block, 'FITID') || undefined });
    }
    return { items, invertHint: false, cardHint };
  }

  // Categoria sugerida pelas palavras da descrição (e, se houver, da categoria do banco).
  const EXPENSE_RULES = [
    ['Cartão', /(pagamento|pgto|pag)\s*(de\s*)?fatura|fatura\s*(do\s*)?cartao/],
    ['Investimentos', /aplicacao|\bcdb\b|\blci\b|\blca\b|tesouro|nuinvest|rico invest|xp invest|investiment|corretora/],
    ['Reserva', /reserva de emergencia/],
    ['Lazer', /academia|smartfit|bluefit|gympass/],
    ['Faculdade', /faculdade|universidade|\busjt\b|\bunip\b|anhanguera|estacio|mensalidade|udemy|alura|coursera|\bcurso|escola|educacao/],
    ['Moradia', /aluguel|condominio|\biptu\b|\benel\b|\bcpfl\b|energia|sabesp|copasa|comgas|internet|fibra|imobiliaria/],
    ['Celular', /recarga|\bclaro\b|\bvivo\b|\btim\b|\boi\b|algar/],
    ['Transporte', /\buber\b|\b99\b|99app|99pop|cabify|indriver|\bposto\b|\bshell\b|ipiranga|petrobras|combustivel|gasolina|estacionamento|pedagio|sem parar|conectcar|\bmetro\b|\bcptm\b|sptrans|bilhete unico|onibus|transporte/],
    ['Lazer', /netflix|spotify|cinema|ingresso|\bsteam\b|playstation|xbox|nintendo|disney|\bhbo\b|prime video|amazon prime|youtube|deezer|apple\.com|\bbar\b|\bpub\b|balada|teatro|academia|smartfit|bluefit|gympass|lazer/],
    ['Alimentação', /ifood|rappi|mercado(?! ?(livre|pago))|supermercado|atacadao|assai|carrefour|pao de acucar|padaria|restaurante|lanchonete|acougue|hortifruti|sacolao|mcdonald|burger|subway|habib|outback|starbucks|cafeteria|pizza|sorvete|doceria|confeitaria|zaffari|condor|alimenta/],
  ];
  const INCOME_RULES = [
    ['Salário', /salario|proventos|folha de pagamento|folha pgto/],
    ['VR', /\balelo\b|sodexo|\bticket\b|vr beneficios|\bflash\b|ben visa/],
    ['VT', /vale transporte|sptrans|riocard|bilhete unico/],
  ];
  function guessCategory(descricao, tipo = 'Saída', hint = '') {
    const text = normalizeText(`${descricao} ${hint}`);
    const rules = tipo === 'Entrada' ? INCOME_RULES : EXPENSE_RULES;
    for (const [category, pattern] of rules) if (pattern.test(text)) return category;
    return 'Outros';
  }

  function guessForma(descricao, tipo, isCard) {
    if (isCard) return 'Crédito';
    if (/\bpix\b/.test(normalizeText(descricao))) return 'Pix';
    return tipo === 'Saída' ? 'Débito' : 'Outro';
  }

  // Transforma os lançamentos crus do parser em lançamentos do app.
  // Em fatura de cartão, o pagamento da própria fatura já aparece como saída na conta: ignorar para não contar em dobro.
  const CARD_PAYMENT = /^(pagamento|pgto|pag)\s*(recebido|efetuado|de fatura|da fatura|fatura|on ?line)/;

  function bankTransactions(raw, { invert = false, isCard = false } = {}) {
    return raw.filter((item) => !(isCard && CARD_PAYMENT.test(normalizeText(item.descricao)))).map((item) => {
      const expense = invert ? item.valor > 0 : item.valor < 0;
      const tipo = expense ? 'Saída' : 'Entrada';
      const transaction = {
        descricao: item.descricao,
        valor: Math.abs(item.valor),
        tipo,
        categoria: guessCategory(item.descricao, tipo, item.hint),
        forma: guessForma(item.descricao, tipo, isCard),
        pago: 'Sim',
        data: item.data,
      };
      if (item.ref) transaction.ref = item.ref;
      return transaction;
    });
  }

  function contentKey(t) {
    return `${t.data}|${Math.abs(Number(t.valor) || 0).toFixed(2)}|${t.tipo}|${normalizeText(t.descricao)}`;
  }

  // Marca como duplicado o que já existe (mesmo identificador do banco ou mesmo dia, valor, tipo e descrição).
  // Dois lançamentos iguais no mesmo arquivo continuam valendo: cada um só consome um existente.
  function markDuplicates(existing, incoming) {
    const refs = new Set(existing.map((t) => t.ref).filter(Boolean));
    const counts = new Map();
    for (const t of existing) counts.set(contentKey(t), (counts.get(contentKey(t)) || 0) + 1);
    return incoming.map((item) => {
      if (item.ref && refs.has(item.ref)) return { ...item, duplicado: true };
      const key = contentKey(item), left = counts.get(key) || 0;
      if (left > 0) { counts.set(key, left - 1); return { ...item, duplicado: true }; }
      return { ...item, duplicado: false };
    });
  }

  return {
    fmt, pct, escapeHtml, pad2, todayISO, curMonth, shiftMonth, monthLabel, monthShort,
    normalizeText, normalizeImportText, parseImportNumber, parseImportDate,
    monthlyTotals, matchesSearch, daysBetween, backupStatus, dayLabel, groupByDay, categoryTotals,
    decodeBytes, parseBankDate, parseMoney, parseCSV, parseBankCSV, parseOFX,
    guessCategory, guessForma, bankTransactions, markDuplicates,
  };
});
