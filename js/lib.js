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
  // Movimentações que não são ganho nem gasto: pagamento da fatura (as compras do cartão já contam),
  // transferência entre contas próprias e resgate de investimento. Ficam fora de entradas, saídas e categorias.
  const NEUTRAL_CATEGORIES = ['Fatura paga', 'Transferência própria', 'Resgate'];
  function isNeutral(t) {
    return NEUTRAL_CATEGORIES.includes(t && t.categoria);
  }

  function monthlyTotals(transactions, endMonth, count = 6) {
    const months = [];
    for (let i = count - 1; i >= 0; i--) months.push(shiftMonth(endMonth, -i));
    const totals = new Map(months.map((month) => [month, { month, entradas: 0, saidas: 0 }]));
    for (const t of transactions) {
      const bucket = totals.get(String(t.data || '').slice(0, 7));
      if (!bucket || isNeutral(t)) continue;
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
      if (t.tipo !== tipo || isNeutral(t) || !String(t.data || '').startsWith(month)) continue;
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
      else if (cols.credit === undefined && startsWithAny(name, ['credito', 'entrada', 'entradas'])) cols.credit = i;
      else if (cols.debit === undefined && startsWithAny(name, ['debito', 'saida', 'saidas'])) cols.debit = i;
      else if (cols.tipo === undefined && (name === 'tipo' || name.startsWith('tipo_') || name === 'natureza' || name === 'deb_cred' || name === 'd_c' || name === 'dc')) cols.tipo = i;
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
    if (!found) {
      // Só os nomes das colunas (sem valores), para o usuário poder pedir ajuste sem expor dados.
      // Só linhas sem dígitos entram, para nunca mostrar uma linha de lançamento.
      const candidates = rows.slice(0, 40).map((row) => row.map((c) => c.trim()).filter(Boolean))
        .filter((cells) => cells.length >= 2 && !cells.some((c) => /\d/.test(c)));
      const header = candidates.reduce((best, cells) => (cells.length > best.length ? cells : best), []);
      return { items: [], invertHint: false, cardHint: false, error: 'colunas', header: header.map((c) => c.slice(0, 30)).slice(0, 12) };
    }
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
        if (Number.isFinite(valor) && valor > 0 && /^(deb|saida|compra|pagamento|d$)/.test(tipoText)) valor = -valor;
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

  // ---- PDF de extrato ou fatura ----
  // O app extrai o texto do PDF (pdf.js) e entrega aqui os itens de texto com posição; estas funções
  // são puras para poderem ser testadas sem PDF de verdade.
  function pdfItemsToLines(items) {
    const rows = [];
    for (const it of items || []) {
      if (!it || typeof it.str !== 'string' || !it.str.trim() || !Array.isArray(it.transform)) continue;
      const y = it.transform[5];
      let row = rows.find((r) => Math.abs(r.y - y) <= 2.5);
      if (!row) { row = { y, cells: [] }; rows.push(row); }
      row.cells.push({ x: it.transform[4], w: it.width || 0, s: it.str.trim() });
    }
    rows.sort((a, b) => b.y - a.y);
    return rows.map((row) => {
      row.cells.sort((a, b) => a.x - b.x);
      let out = '', end = null;
      for (const c of row.cells) {
        if (end !== null) { const gap = c.x - end; out += gap > 12 ? '  ' : gap > 1.5 ? ' ' : ''; }
        out += c.s;
        end = c.x + c.w;
      }
      return out;
    });
  }

  const PT_MONTHS = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
  const DATE_NUM = /^\s*(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}|\d{2}))?(?=\s|$)/;
  const DATE_TXT = /^\s*(\d{1,2})\s+(?:de\s+)?(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-zç]*\.?(?:\s+(?:de\s+)?(\d{4}))?(?=\s|$)/i;
  const MONEY_END = /(?:^|\s)((?:[-−–+]\s?)?(?:R\$\s?)?(?:[-−–+]\s?)?\(?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}\)?(?:\s?[CD]\b|-)?)\s*$/i;
  const PDF_SKIP = /^(total|subtotal|saldo|limite|vencimento|pagamento minimo|valor total|resumo|encargos|juros)\b|saldo (anterior|do dia|final|disponivel|inicial)/;
  const PDF_OUT = /compra|debito|pagamento|pagto|pgto|pix enviado|transferencia enviada|enviad[ao]|saque|tarifa|taxa|boleto|fatura|\biof\b|juros|anuidade|debitado/;
  const PDF_IN = /recebid[ao]|deposito|credito|salario|estorno|rendimento|reembolso|provento|devolucao|devolvid[ao]|cashback/;

  function pdfDate(line, year) {
    let m = DATE_NUM.exec(line), day, month, y;
    if (m) { day = +m[1]; month = +m[2]; y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : year; }
    else if ((m = DATE_TXT.exec(line))) { day = +m[1]; month = PT_MONTHS[normalizeText(m[2]).slice(0, 3)]; y = m[3] ? +m[3] : year; }
    else return null;
    if (!y || month < 1 || month > 12 || day < 1 || day > 31) return null;
    const d = new Date(y, month - 1, day);
    if (d.getMonth() !== month - 1) return null;
    return { iso: `${y}-${pad2(month)}-${pad2(day)}`, rest: line.slice(m[0].length).trim(), numeric: m === null ? false : /^\s*\d{1,2}[/.-]/.test(m[0]) };
  }

  function moneyToken(token) {
    const digits = token.match(/(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}/)[0];
    const valor = parseMoney(digits);
    const neg = /[-−–]/.test(token) || /^\(/.test(token.trim()) || /\bD$/i.test(token.trim());
    const pos = /\+/.test(token) || /\bC$/i.test(token.trim());
    return { valor, sign: neg ? -1 : pos ? 1 : 0 };
  }

  // Mostra só o "formato" da linha (dígitos viram 9, palavras viram a), sem nomes nem valores.
  function maskLine(line) {
    return String(line).slice(0, 60).replace(/\d/g, '9').replace(/[A-Za-zÀ-ÿ]+/g, 'a');
  }

  function parsePdfStatement(lines, { year } = {}) {
    const all = (lines || []).map((l) => String(l).replace(/\s+/g, ' ').trim()).filter(Boolean);
    const norm = normalizeText(all.join('\n'));
    // Fatura só se houver sinais próprios de fatura e nenhum de extrato de conta (senão a conta seria lida ao contrário).
    const cardHint = /total da fatura|fatura fechada|fatura atual|pagamento minimo|fechamento da fatura|vencimento da fatura|limite (total|disponivel)/.test(norm)
      && !/saldo (anterior|do dia|final|inicial)|extrato (de )?conta|conta corrente|agencia/.test(norm);
    const yearCount = {};
    for (const m of norm.matchAll(/\b(20\d\d)\b/g)) yearCount[m[1]] = (yearCount[m[1]] || 0) + 1;
    const topYear = Object.keys(yearCount).sort((a, b) => yearCount[b] - yearCount[a])[0];
    const yearHint = topYear ? +topYear : year;
    const items = [];
    let current = '', section = 0, uncertain = 0;
    for (const line of all) {
      const date = pdfDate(line, yearHint);
      let body = date ? date.rest : line;
      if (date && date.numeric) { const second = pdfDate(body, yearHint); if (second && second.numeric) body = second.rest; }
      const amounts = [];
      for (let guard = 0; guard < 3; guard++) {
        const m = MONEY_END.exec(body);
        if (!m) break;
        amounts.unshift(m[1]);
        body = body.slice(0, m.index).trim();
      }
      const nBody = normalizeText(body);
      if (!date && !amounts.length) {
        if (/^(total de )?entradas?$/.test(nBody)) section = 1;
        else if (/^(total de )?(saidas?|gastos|debitos)$/.test(nBody)) section = -1;
        continue;
      }
      if (date && (!amounts.length || PDF_SKIP.test(nBody))) { current = date.iso; section = 0; continue; }
      if (!amounts.length || PDF_SKIP.test(nBody)) continue;
      if (date) current = date.iso;
      if (!current) continue;
      if (!/[a-zà-ÿ]{2}/i.test(body) || (!date && body.length < 4)) continue;
      const { valor, sign } = moneyToken(amounts[0]);
      if (!Number.isFinite(valor) || valor === 0) continue;
      let signed;
      if (cardHint) signed = sign < 0 ? -valor : valor; // fatura: gastos positivos
      else if (sign !== 0) signed = sign * valor;
      else if (section !== 0) signed = section * valor;
      else if (PDF_IN.test(nBody)) signed = valor;
      else if (PDF_OUT.test(nBody)) signed = -valor;
      else { signed = -valor; uncertain++; }
      items.push({ data: date ? date.iso : current, valor: signed, descricao: body });
    }
    const result = { items, invertHint: cardHint, cardHint, uncertain };
    if (!items.length) {
      result.error = 'pdf';
      result.shapes = all.filter((l) => MONEY_END.test(l) || DATE_NUM.test(l) || DATE_TXT.test(l)).slice(0, 6).map(maskLine);
    }
    return result;
  }

  // Categoria sugerida pelas palavras da descrição (e, se houver, da categoria do banco).
  const EXPENSE_RULES = [
    ['Fatura paga', /(pagamento|pgto|pagto|pag)\s*(de\s*|da\s*|do\s*)?(fatura|cartao)|fatura\s*(do\s*)?cartao|pagamento de cartao/],
    ['Transferência própria', /mesma titularidade|entre contas|conta propria|para (a )?(sua|minha) conta/],
    ['Investimentos', /aplicacao|\brdb\b|\bcdb\b|\blci\b|\blca\b|tesouro|nuinvest|rico invest|xp invest|investiment|corretora|poupanca/],
    ['Reserva', /reserva de emergencia/],
    ['Lazer', /academia|smartfit|bluefit|gympass/],
    ['Faculdade', /faculdade|universidade|\busjt\b|\bunip\b|anhanguera|estacio|mensalidade|udemy|alura|coursera|\bcurso|escola|educacao/],
    ['Moradia', /aluguel|condominio|\biptu\b|\benel\b|\bcpfl\b|energia|sabesp|copasa|comgas|internet|fibra|imobiliaria|\bluz\b|\bagua\b/],
    ['Celular', /recarga|\bclaro\b|\bvivo\b|\btim\b|\boi\b|algar/],
    ['Transporte', /\buber\b|99 ?app|99 ?pop|99 ?taxi|99 ?tecnologia|cabify|indriver|\bposto\b|\bshell\b|ipiranga|petrobras|combustivel|gasolina|estacionamento|pedagio|sem parar|conectcar|\bmetro\b|\bcptm\b|sptrans|bilhete unico|onibus|transporte|\bbrt\b|bike/],
    ['Saúde', /farmacia|drogaria|drogasil|droga raia|pacheco|panvel|hospital|clinica|consulta|laboratorio|dentista|odonto|plano de saude|unimed|amil|hapvida|medic|exame|psicolog|saude/],
    ['Lazer', /netflix|spotify|cinema|ingresso|\bsteam\b|playstation|xbox|nintendo|disney|\bhbo\b|prime video|amazon prime|youtube|deezer|apple\.com|icloud|globoplay|paramount|crunchyroll|\bbar\b|\bpub\b|balada|teatro|academia|smartfit|bluefit|gympass|lazer|viagem|hotel|airbnb|booking|decolar|latam|\bgol\b|azul linhas/],
    ['Alimentação', /ifood|rappi|mercado(?! ?(livre|pago))|supermercado|atacadao|assai|carrefour|pao de acucar|padaria|restaurante|lanchonete|acougue|hortifruti|sacolao|mcdonald|burger|subway|habib|outback|starbucks|cafeteria|cafe\b|pizza|sorvete|doceria|confeitaria|zaffari|condor|alimenta|supermercado|lanche/],
    ['Compras', /mercado ?livre|mercadolivre|amazon|magalu|magazine|americanas|shopee|shein|aliexpress|casas bahia|kabum|renner|riachuelo|centauro|netshoes|decathlon|leroy|zara|c&a|vestuario|roupa|calcado|livraria|saraiva/],
    ['Taxas e impostos', /tarifa|anuidade|\biof\b|juros|encargos|multa|imposto|\birpf\b|\binss\b|seguro|cartorio|detran|licenciamento|\bipva\b/],
    ['Transferências', /pix (enviado|para|saida)|transferencia (enviada|para|pix)|transf(erencia)? enviad|\bted\b|\bdoc\b|\bpix\b/],
  ];
  const INCOME_RULES = [
    ['Salário', /salario|proventos|folha de pagamento|folha pgto/],
    ['VR', /\balelo\b|sodexo|\bticket\b|vr beneficios|\bflash\b|ben visa/],
    ['VT', /vale transporte|sptrans|riocard|bilhete unico/],
    ['Resgate', /resgate/],
    ['Transferência própria', /mesma titularidade|entre contas|conta propria/],
    ['Rendimentos', /rendimento|juros sobre|dividendo|\bjcp\b|cashback/],
    ['Transferências', /pix (recebido|de)|transferencia (recebida|de|pix)|transf(erencia)? recebid|\bted\b|\bdoc\b|deposito|\bpix\b/],
  ];

  // ---- Entender o lançamento: parcelas, "comerciante" e regras aprendidas ----
  const GENERIC_WORDS = new Set(['compra', 'compras', 'debito', 'credito', 'pix', 'enviado', 'enviada', 'recebido', 'recebida', 'transferencia', 'transf', 'pagamento', 'pgto', 'pagto', 'pag', 'ted', 'doc', 'via', 'cartao', 'parcela', 'parc', 'parcelado', 'ltda', 'com', 'app', 'online', 'loja', 'para', 'por', 'pela', 'pelo', 'the']);

  // "Parcela 3/10", "PARC 03 de 10", "(3/10)" ou "... 03/10" no fim: devolve { n, total } ou null.
  function parseInstallment(descricao) {
    const text = normalizeText(descricao);
    const m = /\bparc(?:ela|elamento)?\.?\s*(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})\b/.exec(text)
      || /\b(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})\s*parc/.exec(text)
      || /\((\d{1,2})\s*\/\s*(\d{1,2})\)/.exec(text)
      || /\s(\d{1,2})\/(\d{1,2})$/.exec(text);
    if (!m) return null;
    const n = Number(m[1]), total = Number(m[2]);
    return total >= 2 && total <= 60 && n >= 1 && n <= total ? { n, total } : null;
  }

  // Chave estável do estabelecimento ("uber trip"), sem números, parcelas nem palavras genéricas.
  function merchantKey(descricao) {
    const text = normalizeText(descricao)
      .replace(/\bparc(?:ela)?\.?\s*\d+\s*(?:\/|de)\s*\d+/g, ' ')
      .replace(/\b\d+\/\d+\b/g, ' ')
      .replace(/[^a-z\s]/g, ' ');
    return text.split(/\s+/).filter((w) => w.length >= 3 && !GENERIC_WORDS.has(w)).slice(0, 3).join(' ');
  }
  const ruleKey = (descricao, tipo) => `${tipo === 'Entrada' ? 'Entrada' : 'Saída'}:${merchantKey(descricao)}`;

  // Categoria sugerida: primeiro o que o Dhiego já ensinou (rules), depois as palavras da descrição e a categoria do banco.
  function guessCategory(descricao, tipo = 'Saída', hint = '', rules = null) {
    if (rules) {
      const key = ruleKey(descricao, tipo);
      if (key.length > 8 && rules[key]) return rules[key];
    }
    const text = normalizeText(`${descricao} ${hint}`);
    const list = tipo === 'Entrada' ? INCOME_RULES : EXPENSE_RULES;
    for (const [category, pattern] of list) if (pattern.test(text)) return category;
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

  function daysApart(a, b) {
    const [y1, m1, d1] = a.split('-').map(Number), [y2, m2, d2] = b.split('-').map(Number);
    return Math.abs(Math.round((Date.UTC(y1, m1 - 1, d1) - Date.UTC(y2, m2 - 1, d2)) / 86400000));
  }

  // Uma saída e uma entrada de mesmo valor, até 2 dias de distância e com o mesmo nome na descrição,
  // são o mesmo dinheiro mudando de conta (não é ganho nem gasto).
  function markInternalTransfers(list) {
    const used = new Set();
    list.forEach((out, i) => {
      if (out.tipo !== 'Saída' || used.has(i) || isNeutral(out)) return;
      const key = merchantKey(out.descricao);
      if (!key || !/transfer|pix|\bted\b|\bdoc\b|resgate|aplica/.test(normalizeText(out.descricao))) return;
      const j = list.findIndex((inc, k) => k !== i && !used.has(k) && inc.tipo === 'Entrada' && !isNeutral(inc)
        && Math.abs(inc.valor - out.valor) < 0.005 && daysApart(inc.data, out.data) <= 2 && merchantKey(inc.descricao) === key);
      if (j < 0) return;
      used.add(i); used.add(j);
      out.categoria = 'Transferência própria';
      list[j].categoria = 'Transferência própria';
    });
    return list;
  }

  // Muitas faturas trazem cada parcela com a data da compra original (meses atrás). Dentro de um mesmo arquivo, a data
  // da fatura é a da última compra à vista (ou 1ª parcela); parcelas 2, 3... bem mais velhas que ela vão para essa data,
  // para entrar na fatura certa.
  function installmentAnchor(items) {
    const dates = items.filter((t) => { const p = parseInstallment(t.descricao); return !p || p.n === 1; }).map((t) => t.data).filter(Boolean).sort();
    return dates.length ? dates[dates.length - 1] : '';
  }
  const needsReanchor = (t, anchor) => { const p = parseInstallment(t.descricao); return Boolean(p && p.n > 1 && anchor && t.data < anchor && daysApart(t.data, anchor) > 35); };

  // Mesma correção para o que já foi importado: agrupa pelo "lote" (o id de importação carrega a hora) e reancora.
  function fixInstallmentDates(transactions) {
    const batches = new Map();
    for (const t of transactions) {
      const m = /^tx_(\d+)_/.exec(String(t.id));
      if (!m || t.forma !== 'Crédito' || t.tipo !== 'Saída' || !t.data) continue;
      if (!batches.has(m[1])) batches.set(m[1], []);
      batches.get(m[1]).push(t);
    }
    const patch = new Map();
    for (const items of batches.values()) {
      const anchor = installmentAnchor(items);
      for (const t of items) if (needsReanchor(t, anchor)) patch.set(t.id, anchor);
    }
    const list = transactions.map((t) => (patch.has(t.id) ? { ...t, data: patch.get(t.id), dataOriginal: t.data } : t));
    return { transactions: list, changed: patch.size };
  }

  function bankTransactions(raw, { invert = false, isCard = false, rules = null } = {}) {
    const list = raw.filter((item) => !(isCard && CARD_PAYMENT.test(normalizeText(item.descricao)))).map((item) => {
      const expense = invert ? item.valor > 0 : item.valor < 0;
      const tipo = expense ? 'Saída' : 'Entrada';
      const transaction = {
        descricao: item.descricao,
        valor: Math.abs(item.valor),
        tipo,
        categoria: guessCategory(item.descricao, tipo, item.hint, rules),
        forma: guessForma(item.descricao, tipo, isCard),
        pago: 'Sim',
        data: item.data,
      };
      if (item.ref) transaction.ref = item.ref;
      return transaction;
    });
    if (isCard) {
      const anchor = installmentAnchor(list);
      for (const t of list) if (needsReanchor(t, anchor)) { t.dataOriginal = t.data; t.data = anchor; }
      return list;
    }
    return markInternalTransfers(list);
  }

  // Avisos sobre o arquivo antes de gravar: sentido invertido, conta tratada como fatura (e vice-versa).
  function importSanity(list, { isCard = false } = {}) {
    const warnings = [];
    if (!list.length) return warnings;
    const incomeLike = list.filter((t) => t.tipo === 'Entrada' && /salario|pix recebido|transferencia recebida|deposito|proventos/.test(normalizeText(t.descricao)));
    if (isCard && incomeLike.length) warnings.push('Há salário ou transferências recebidas neste arquivo, então ele parece um extrato de conta, não uma fatura. Desmarque "É fatura de cartão".');
    const parcelados = list.filter((t) => parseInstallment(t.descricao)).length;
    if (!isCard && list.length >= 4 && parcelados / list.length >= 0.4) warnings.push('Muitos itens parcelados: parece fatura de cartão. Se for, marque "É fatura de cartão".');
    const entradas = list.filter((t) => t.tipo === 'Entrada' && !isNeutral(t)).length;
    if (!isCard && list.length >= 4 && entradas === 0) warnings.push('Só há saídas neste arquivo. Se ele tem entradas, tente "Inverter entradas e saídas".');
    const reancoradas = list.filter((t) => t.dataOriginal).length;
    if (reancoradas) warnings.push(`${reancoradas} parcela(s) vieram com a data da compra original; usei a data da fatura para elas, para entrarem no mês certo.`);
    const neutros = list.filter(isNeutral).length;
    if (neutros) warnings.push(`${neutros} movimentação(ões) (pagamento de fatura, transferência própria ou resgate) não entram nas entradas e saídas, para não contar em dobro.`);
    return warnings;
  }

  function contentKey(t) {
    return `${t.dataOriginal || t.data}|${Math.abs(Number(t.valor) || 0).toFixed(2)}|${t.tipo}|${normalizeText(t.descricao)}`;
  }

  // Marca como duplicado o que já existe (mesmo identificador do banco ou mesmo dia, valor, tipo e descrição).
  // Dois lançamentos iguais no mesmo arquivo continuam valendo: cada um só consome um existente.
  function markDuplicates(existing, incoming) {
    const refs = new Map(existing.filter((t) => t.ref).map((t) => [t.ref, t.id]));
    const byKey = new Map();
    for (const t of existing) { const k = contentKey(t); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(t.id); }
    return incoming.map((item) => {
      if (item.ref && refs.has(item.ref)) return { ...item, duplicado: true, existingId: refs.get(item.ref) };
      const ids = byKey.get(contentKey(item));
      if (ids && ids.length) return { ...item, duplicado: true, existingId: ids.shift() };
      return { ...item, duplicado: false };
    });
  }

  // ---- Visão do mês: conta x cartão, sem contar a mesma coisa duas vezes ----
  function monthSummary(transactions, month) {
    const r = { entradas: 0, saidas: 0, resultado: 0, noCartao: 0, emConta: 0, count: 0, outros: 0, faturasPagas: 0 };
    for (const t of transactions) {
      if (!String(t.data || '').startsWith(month)) continue;
      const v = Number(t.valor) || 0, entrada = t.tipo === 'Entrada', credito = t.forma === 'Crédito';
      r.count++;
      if (!credito) r.emConta += entrada ? v : -v; // dinheiro que de fato entrou ou saiu da conta
      if (t.categoria === 'Fatura paga' && !entrada && t.pago !== 'Não') r.faturasPagas += v;
      if (isNeutral(t)) continue;
      if (entrada) r.entradas += v;
      else { r.saidas += v; if (credito) r.noCartao += v; if ((t.categoria || 'Outros') === 'Outros') r.outros += v; }
    }
    r.resultado = r.entradas - r.saidas;
    return r;
  }

  // ---- Conta e cartão: cada um com o seu saldo, sem somar um no outro ----
  const daysInMonth = (y, m) => new Date(y, m, 0).getDate();
  const isoDay = (y, m, d) => `${y}-${pad2(m)}-${pad2(Math.min(d, daysInMonth(y, m)))}`;
  function addMonthsISO(date, delta, day) {
    const [y, m] = date.split('-').map(Number);
    const t = new Date(y, m - 1 + delta, 1);
    return isoDay(t.getFullYear(), t.getMonth() + 1, day);
  }
  function addDaysISO(date, n) {
    const [y, m, d] = date.split('-').map(Number);
    const t = new Date(y, m - 1, d + n);
    return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;
  }

  // Saldo da conta = saldo informado (no fim do dia saldoData) + o que entrou e saiu da conta depois disso, até hoje.
  // Compra no crédito não mexe na conta; pagamento de fatura e transferência própria mexem. "Não pago" e datas futuras ficam de fora.
  function accountBalance(transactions, config, refISO) {
    const base = Number(config.saldoInicial) || 0, from = config.saldoData || '';
    let saldo = base;
    for (const t of transactions) {
      if (t.forma === 'Crédito' || t.pago === 'Não' || !t.data || t.data > refISO || (from && t.data <= from)) continue;
      const v = Number(t.valor) || 0;
      saldo += t.tipo === 'Entrada' ? v : -v;
    }
    return { saldo, configurado: Boolean(from || base !== 0) };
  }

  // Fatura aberta no dia refISO: do dia seguinte ao fechamento anterior até o fechamento, e o vencimento dela.
  function invoiceCycle(refISO, fecha, vence) {
    const [y, m, d] = refISO.split('-').map(Number);
    const end = d <= Math.min(fecha, daysInMonth(y, m)) ? isoDay(y, m, fecha) : addMonthsISO(refISO, 1, fecha);
    const start = addDaysISO(addMonthsISO(end, -1, fecha), 1);
    const [ey, em] = end.split('-').map(Number);
    const due = vence > 0 ? (vence > fecha ? isoDay(ey, em, vence) : addMonthsISO(end, 1, vence)) : '';
    return { start, end, due };
  }

  // Cada compra no crédito pertence a uma FATURA, identificada pelo mês do vencimento ("2026-12"). Quem importou a fatura
  // grava a etiqueta (fatura) em cada lançamento; os demais caem na fatura pelo dia de fechamento. Assim as parcelas com a
  // data da compra original, ou um fechamento informado errado, não espalham a mesma fatura em duas.
  const faturaOf = (t, fecha, vence) => {
    if (t.fatura) return t.fatura;
    if (fecha >= 1 && fecha <= 31) { const c = invoiceCycle(t.data, fecha, vence); return (c.due || c.end).slice(0, 7); }
    return String(t.data).slice(0, 7);
  };
  const cardDays = (config) => [Math.round(Number(config.cartaoFecha)) || 0, Math.round(Number(config.cartaoVence)) || 0];
  function faturaKey(t, config) { const [f, v] = cardDays(config); return faturaOf(t, f, v); }
  // Fatura sugerida para um arquivo importado: a da compra à vista mais recente dele.
  function suggestFatura(items, config) {
    const anchor = installmentAnchor(items);
    return anchor ? faturaKey({ data: anchor }, config) : '';
  }

  function cardSummary(transactions, config, refISO, payments) {
    const [fecha, vence] = cardDays(config);
    const limite = Number(config.cartaoLimite) || 0;
    const configurado = fecha >= 1 && fecha <= 31;
    const manuais = config.faturasPagas || {};
    const map = new Map();
    const touch = (key) => { if (!map.has(key)) map.set(key, { key, total: 0, n: 0 }); return map.get(key); };
    for (const t of transactions) {
      if (t.forma !== 'Crédito' || isNeutral(t) || !t.data) continue;
      const e = touch(faturaOf(t, fecha, vence));
      e.total += (t.tipo === 'Entrada' ? -1 : 1) * (Number(t.valor) || 0);
      e.n++;
    }
    const refKey = faturaOf({ data: refISO }, fecha, vence);
    touch(refKey); // a fatura aberta existe mesmo sem compras
    const invoices = [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
    const pays = (payments || transactions).filter((t) => t.categoria === 'Fatura paga' && t.tipo === 'Saída' && t.pago !== 'Não' && t.data)
      .map((t) => ({ data: t.data, left: Number(t.valor) || 0 })).sort((a, b) => a.data.localeCompare(b.data));
    for (const inv of invoices) {
      const [y, m] = inv.key.split('-').map(Number);
      inv.due = configurado && vence > 0 ? isoDay(y, m, vence) : '';
      inv.end = configurado ? (vence === 0 || vence > fecha ? isoDay(y, m, fecha) : addMonthsISO(`${inv.key}-01`, -1, fecha)) : '';
      inv.start = inv.end ? addDaysISO(addMonthsISO(inv.end, -1, fecha), 1) : '';
      const ancora = inv.due || inv.end || `${inv.key}-28`;
      let pago = 0;
      if (!manuais[inv.key] && inv.total > 0) { // pagamentos de fatura perto do vencimento abatem esta fatura, um por vez
        const from = addDaysISO(ancora, -35), to = addDaysISO(ancora, 10);
        for (const p of pays) {
          if (p.left <= 0 || p.data < from || p.data > to) continue;
          const take = Math.min(p.left, inv.total - pago);
          if (take <= 0) break;
          pago += take; p.left -= take;
        }
      }
      inv.pago = pago;
      inv.paga = Boolean(manuais[inv.key]) || (inv.n > 0 && pago >= inv.total * 0.95);
      inv.faltam = inv.paga ? 0 : Math.max(inv.total - pago, 0);
      inv.status = inv.paga ? 'paga'
        : inv.end && refISO <= inv.end ? 'aberta'
        : inv.due && refISO > inv.due ? 'vencida'
        : configurado ? 'fechada' : (inv.key === refKey ? 'aberta' : 'fechada');
    }
    const aberta = invoices.find((i) => i.status === 'aberta') || invoices.find((i) => i.key === refKey);
    const pendentes = invoices.filter((i) => (i.status === 'fechada' || i.status === 'vencida') && i.faltam > 0.005);
    const parcelas = installmentSchedule(transactions, shiftMonth((aberta.end || refISO).slice(0, 7), -1), 6, true);
    const usado = limite > 0 ? aberta.total + pendentes.reduce((s, i) => s + i.faltam, 0) + parcelas.total : 0;
    return { configurado, invoices, aberta, pendentes, aPagar: pendentes.reduce((s, i) => s + i.faltam, 0), limite, usado, livre: limite > 0 ? limite - usado : 0, parcelas: parcelas.total };
  }

  // ---- Várias contas e cartões, cada um com o seu saldo ----
  // config.contas = [{ id, nome, tipo: 'conta', saldoInicial, saldoData } | { id, nome, tipo: 'cartao', limite, fecha, vence }].
  // Lançamento sem "conta" (ou com uma que não existe mais) vai para a primeira conta (ou o primeiro cartão, se for crédito).
  function defaultEntities(config) {
    const c = config || {};
    return [
      { id: 'conta1', nome: 'Conta', tipo: 'conta', saldoInicial: Number(c.saldoInicial) || 0, saldoData: c.saldoData || '' },
      { id: 'cartao1', nome: 'Cartão', tipo: 'cartao', limite: Number(c.cartaoLimite) || 0, fecha: Math.round(Number(c.cartaoFecha)) || 0, vence: Math.round(Number(c.cartaoVence)) || 0 },
    ];
  }
  function entitiesOf(config) {
    const list = Array.isArray(config.contas) ? config.contas.filter((e) => e && e.id && (e.tipo === 'conta' || e.tipo === 'cartao')) : [];
    const def = defaultEntities(config);
    if (!list.some((e) => e.tipo === 'conta')) list.unshift(def[0]);
    if (!list.some((e) => e.tipo === 'cartao')) list.push(def[1]);
    return list;
  }
  function belongsTo(t, entity, entities) {
    const credit = t.forma === 'Crédito';
    if ((entity.tipo === 'cartao') !== credit) return false;
    const peers = entities.filter((e) => e.tipo === entity.tipo);
    return (peers.some((e) => e.id === t.conta) ? t.conta : peers[0].id) === entity.id;
  }
  function entityConfig(entity, config, entities) {
    if (entity.tipo === 'conta') return { saldoInicial: entity.saldoInicial, saldoData: entity.saldoData };
    const first = entities.find((e) => e.tipo === 'cartao');
    const pagas = {};
    for (const [k, v] of Object.entries(config.faturasPagas || {})) {
      if (k.includes('|')) { const [id, key] = k.split('|'); if (id === entity.id) pagas[key] = v; }
      else if (first && first.id === entity.id) pagas[k] = v; // chave antiga (um cartão só) vale para o primeiro
    }
    return { cartaoLimite: entity.limite, cartaoFecha: entity.fecha, cartaoVence: entity.vence, faturasPagas: pagas };
  }
  function accountsOverview(transactions, config, refISO) {
    const ents = entitiesOf(config);
    return ents.filter((e) => e.tipo === 'conta').map((entity) => ({ entity, ...accountBalance(transactions.filter((t) => belongsTo(t, entity, ents)), entityConfig(entity, config, ents), refISO) }));
  }
  // Pagamento de fatura só abate sozinho a fatura de um cartão se houver um cartão só ou se o lançamento disser qual (cartao).
  function cardsOverview(transactions, config, refISO) {
    const ents = entitiesOf(config), cards = ents.filter((e) => e.tipo === 'cartao');
    return cards.map((entity) => {
      const own = transactions.filter((t) => belongsTo(t, entity, ents));
      const pays = transactions.filter((t) => t.categoria === 'Fatura paga' && (t.cartao ? t.cartao === entity.id : cards.length === 1));
      return { entity, ...cardSummary(own, entityConfig(entity, config, ents), refISO, pays) };
    });
  }

  // O que NÃO conta como ganho nem gasto no mês (fatura paga, transferência própria, resgate): para mostrar e conferir.
  function neutralSummary(transactions, month) {
    const by = new Map();
    for (const t of transactions) {
      if (!isNeutral(t) || !String(t.data || '').startsWith(month)) continue;
      const e = by.get(t.categoria) || { categoria: t.categoria, n: 0, total: 0 };
      e.n++; e.total += Number(t.valor) || 0;
      by.set(t.categoria, e);
    }
    return [...by.values()];
  }

  // Parcelas já lançadas que ainda vão cair nos próximos meses (a partir da última parcela vista de cada compra).
  function installmentSchedule(transactions, fromMonth, horizon = 6, onlyCredit = false) {
    const groups = new Map();
    for (const t of transactions) {
      if (t.tipo !== 'Saída' || isNeutral(t) || (onlyCredit && t.forma !== 'Crédito')) continue;
      const inst = parseInstallment(t.descricao);
      const key = merchantKey(t.descricao);
      if (!inst || !key || !t.data) continue;
      const id = `${key}|${(Number(t.valor) || 0).toFixed(2)}|${inst.total}`;
      const g = groups.get(id);
      if (!g || inst.n > g.n) groups.set(id, { descricao: t.descricao, valor: Number(t.valor) || 0, n: inst.n, total: inst.total, month: t.data.slice(0, 7) });
    }
    const porMes = new Map(), itens = [];
    for (const g of groups.values()) {
      let restantes = 0;
      for (let k = 1; k <= g.total - g.n; k++) {
        const m = shiftMonth(g.month, k);
        if (m <= fromMonth) continue;
        restantes++;
        porMes.set(m, (porMes.get(m) || 0) + g.valor);
      }
      if (restantes) itens.push({ descricao: g.descricao, valor: g.valor, n: g.n, total: g.total, restantes });
    }
    const meses = [...porMes.keys()].sort().slice(0, horizon).map((month) => ({ month, total: porMes.get(month) }));
    const total = [...porMes.values()].reduce((a, b) => a + b, 0);
    return { itens: itens.sort((a, b) => b.valor * b.restantes - a.valor * a.restantes), meses, total };
  }

  // Avisos de "isso não bate": cada um explica o problema e, quando dá, aponta a correção automática.
  function dataWarnings(transactions, month) {
    const out = [];
    const s = monthSummary(transactions, month);
    const inMonth = transactions.filter((t) => String(t.data || '').startsWith(month));
    if (!inMonth.length) return out;
    if (s.saidas > 0 && s.entradas === 0) {
      const share = s.noCartao / s.saidas;
      out.push({ id: 'sem-entradas', level: 'warn', text: share >= 0.7
        ? `${Math.round(share * 100)}% das saídas deste mês (${fmt(s.noCartao)}) estão no cartão, que só sai da conta quando a fatura é paga. Não há entradas lançadas: importe também o extrato da conta para ver o salário e o saldo de verdade.`
        : 'Este mês tem saídas e nenhuma entrada. Se você recebeu algo, importe o extrato da conta ou lance a entrada.' });
    }
    const lump = inMonth.filter((t) => t.tipo === 'Saída' && t.categoria === 'Cartão' && /fatura/.test(normalizeText(t.descricao)));
    const lumpSum = lump.reduce((a, t) => a + (Number(t.valor) || 0), 0);
    const itemized = inMonth.filter((t) => t.tipo === 'Saída' && t.forma === 'Crédito' && t.categoria !== 'Cartão' && !isNeutral(t)).reduce((a, t) => a + (Number(t.valor) || 0), 0);
    if (lump.length && itemized >= lumpSum * 0.5) {
      out.push({ id: 'dupla-contagem', level: 'warn', fix: 'fatura-paga', fixIds: lump.map((t) => t.id),
        text: `O pagamento da fatura (${fmt(lumpSum)}) e as compras do cartão (${fmt(itemized)}) estão somados em dobro. Marcar o pagamento como "Fatura paga" faz contar só uma vez.` });
    }
    const fixable = fixInstallmentDates(transactions);
    if (fixable.changed) {
      out.push({ id: 'parcelas-datas', level: 'warn', fix: 'parcelas-datas',
        text: `${fixable.changed} parcela(s) do cartão estão com a data da compra original (meses atrás) e por isso não entram na fatura certa nem no limite. Corrigir leva cada uma para a data da fatura em que veio.` });
    }
    if (s.saidas > 0 && s.outros / s.saidas > 0.25) {
      out.push({ id: 'muito-outros', level: 'info', fix: 'classificar',
        text: `${Math.round((s.outros / s.saidas) * 100)}% das saídas estão em "Outros" (${fmt(s.outros)}). Reanalisar as categorias ou corrigir um lançamento ensina o app.` });
    }
    if (s.entradas > 0 && s.saidas > s.entradas) {
      out.push({ id: 'saidas-maiores', level: 'info', text: `As saídas passaram as entradas em ${fmt(s.saidas - s.entradas)} neste mês.` });
    }
    return out;
  }

  // Reanalisa todos os lançamentos que o Dhiego não corrigiu à mão (manual): aplica as regras aprendidas e as palavras
  // da descrição e refaz o pareamento de transferências próprias. Nunca troca uma categoria por "Outros".
  // Devolve a nova lista, quantos mudaram e a lista de mudanças ({ id, de, para }) para mostrar antes de gravar.
  function recategorize(transactions, rules = null) {
    const work = transactions.map((t) => ({ ...t }));
    const before = new Map(work.map((t) => [t.id, t.categoria]));
    for (const t of work) {
      if (t.manual) continue;
      const guess = guessCategory(t.descricao, t.tipo, '', rules);
      if (guess !== 'Outros' && guess !== t.categoria) t.categoria = guess;
    }
    markInternalTransfers(work.filter((t) => !t.manual && t.data && (t.tipo === 'Saída' || t.tipo === 'Entrada')));
    const changes = [];
    const list = transactions.map((orig, i) => {
      if (work[i].categoria === before.get(orig.id)) return orig;
      changes.push({ id: orig.id, de: orig.categoria || 'Outros', para: work[i].categoria });
      return work[i];
    });
    return { transactions: list, changed: changes.length, changes };
  }

  // Aplica uma categoria a todos os lançamentos do mesmo estabelecimento e tipo (exceto o próprio). Devolve quantos mudaram.
  function applyCategoryToSimilar(transactions, source, categoria) {
    const key = ruleKey(source.descricao, source.tipo);
    if (key.length <= 8) return { transactions, changed: 0 };
    let changed = 0;
    const list = transactions.map((t) => {
      if (t.id === source.id || t.categoria === categoria || ruleKey(t.descricao, t.tipo) !== key) return t;
      changed++;
      return { ...t, categoria };
    });
    return { transactions: list, changed };
  }

  return {
    fmt, pct, escapeHtml, pad2, todayISO, curMonth, shiftMonth, monthLabel, monthShort,
    normalizeText, normalizeImportText, parseImportNumber, parseImportDate,
    monthlyTotals, matchesSearch, daysBetween, backupStatus, dayLabel, groupByDay, categoryTotals,
    decodeBytes, parseBankDate, parseMoney, parseCSV, parseBankCSV, parseOFX,
    pdfItemsToLines, parsePdfStatement, guessCategory, guessForma, bankTransactions, markDuplicates,
    NEUTRAL_CATEGORIES, isNeutral, parseInstallment, merchantKey, ruleKey, markInternalTransfers, importSanity,
    monthSummary, accountBalance, invoiceCycle, cardSummary, defaultEntities, entitiesOf, belongsTo, entityConfig, accountsOverview, cardsOverview, faturaKey, suggestFatura, neutralSummary, fixInstallmentDates, installmentSchedule, dataWarnings, recategorize, applyCategoryToSimilar,
  };
});
