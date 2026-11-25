/* Meu Financeiro: lógica do app (sem dependências, exceto SheetJS para planilhas).
   Os dados ficam só no navegador (localStorage). As funções puras estão em lib.js (window.FinLib). */
const { fmt, pct, escapeHtml, pad2, todayISO, curMonth, shiftMonth, monthLabel, monthShort, normalizeImportText,
        parseImportNumber, parseImportDate, monthlyTotals, matchesSearch, backupStatus,
        dayLabel, groupByDay, categoryTotals, monthSummary, installmentSchedule, dataWarnings, recategorize,
        applyCategoryToSimilar, isNeutral, parseInstallment, ruleKey, guessCategory, importSanity, accountBalance, cardSummary } = FinLib;

let transactions = [];
let editingId = null;
let pendingDeleteId = null;
let pendingImport = [];
let pendingRestore = null;
let firstUseMonthValue = null; // mantido só para compatibilidade com backups antigos
let selectedMonth = curMonth();
let tipoFilter = '';
let viewFilter = ''; // '', 'conta' ou 'cartao'
let tombstones = {}; // lançamentos apagados (para a sincronização saber que foram apagados)
let configUpdatedAt = 0;
let categoryRules = {}; // categorias que o Dhiego ensinou: { 'Saída:padaria joao': 'Alimentação' }

// Valores iniciais fictícios: o app não traz dados reais de ninguém.
const DEFAULT_CONFIG = {
  salario:3200, dias:22, vr:28, vt:12, faculdade:650, celular:180, parcelasRestantes:8, cartao:800,
  lazer:400, investAlvo:300, metaReserva:10000, metaPatrim:100000, reservaAtual:2500, patrimAtual:0, metas:{},
  saldoInicial:0, saldoData:'', cartaoLimite:0, cartaoFecha:0, cartaoVence:0
};
let config = {...DEFAULT_CONFIG};
const STORAGE_KEY = 'meu-financeiro-v1';

const $ = id => document.getElementById(id);
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const sum = (list, fn) => list.reduce((total, item) => total + fn(item), 0);

function loadLocalState(){
  try{
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');
    if(!saved) return;
    if(saved.config) config = {...config, ...saved.config};
    if(Array.isArray(saved.transactions)) transactions = saved.transactions;
    if(saved.firstUseMonth) firstUseMonthValue = saved.firstUseMonth;
    if(saved.rules && typeof saved.rules==='object') categoryRules = saved.rules;
    if(saved.tombstones && typeof saved.tombstones==='object') tombstones = saved.tombstones;
    if(saved.configUpdatedAt) configUpdatedAt = saved.configUpdatedAt;
  }catch(e){ console.warn('Não foi possível ler os dados locais', e); }
}
// Cada lançamento guarda u (quando mudou) e apagar deixa uma "lápide": é isso que permite mesclar dois aparelhos.
let snapTx = new Map(), snapCfg = '', snapRules = '';
const sigOf = t => { const {u, ...rest} = t; return JSON.stringify(rest); };
function resetSnapshots(){ snapTx = new Map(transactions.map(t=>[t.id, sigOf(t)])); snapCfg = JSON.stringify(config); snapRules = JSON.stringify(categoryRules); }
function stampChanges(){
  const now = Date.now(), ids = new Set();
  transactions.forEach(t=>{ ids.add(t.id); if(snapTx.get(t.id)!==sigOf(t)) t.u = now; });
  for(const id of snapTx.keys()) if(!ids.has(id) && !String(id).startsWith('demo_')) tombstones[id] = now;
  if(JSON.stringify(config)!==snapCfg) configUpdatedAt = now;
  resetSnapshots();
}
function persistRaw(){
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify({config,transactions,firstUseMonth:firstUseMonthValue,rules:categoryRules,tombstones,configUpdatedAt})); }
  catch(e){ console.warn('Não foi possível salvar os dados locais', e); }
}
function saveLocalState(){
  stampChanges(); persistRaw();
  if(typeof scheduleSync==='function') scheduleSync();
}

function showToast(message, ms=2200){
  toast.textContent = message; toast.classList.add('show');
  clearTimeout(showToast.timer); showToast.timer = setTimeout(()=>toast.classList.remove('show'), ms);
}

// ---- Categorias: ícone e cor ----
const CATS = {
  'Salário':['💼','#0e9f6e'], 'VR':['🍽️','#f59e0b'], 'VT':['🚌','#0ea5e9'], 'Moradia':['🏠','#8b5cf6'],
  'Faculdade':['🎓','#6366f1'], 'Celular':['📱','#64748b'], 'Cartão':['💳','#ef4444'], 'Lazer':['🎬','#ec4899'],
  'Investimentos':['📈','#10b981'], 'Reserva':['🛡️','#14b8a6'], 'Transporte':['🚗','#f97316'],
  'Alimentação':['🛒','#eab308'], 'Outros':['🧾','#94a3b8'],
  'Saúde':['💊','#06b6d4'], 'Compras':['🛍️','#d946ef'], 'Taxas e impostos':['🏛️','#78716c'], 'Transferências':['🔁','#64748b'],
  'Rendimentos':['🪙','#22c55e'], 'Fatura paga':['💳','#94a3b8'], 'Transferência própria':['↔️','#94a3b8'], 'Resgate':['🏦','#94a3b8']
};
function catMeta(category){
  if(CATS[category]) return {emoji:CATS[category][0], color:CATS[category][1]};
  const palette = ['#0ea5e9','#8b5cf6','#f97316','#14b8a6','#ec4899','#eab308'];
  let hash = 0;
  for(const ch of String(category)) hash = (hash*31 + ch.charCodeAt(0)) >>> 0;
  return {emoji:'🧾', color:palette[hash % palette.length]};
}

// ---- Folhas e diálogos ----
function closeOnBackdrop(dialog){
  dialog.addEventListener('click', e=>{
    if(e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if(e.clientX<r.left || e.clientX>r.right || e.clientY<r.top || e.clientY>r.bottom) dialog.close();
  });
}
[transactionModal, moreSheet, reservaModal, deleteModal, clearModal, restoreModal, syncSheet].forEach(closeOnBackdrop);

// ---- Navegação ----
function goTab(name){
  document.querySelectorAll('.navBtn[data-tab]').forEach(b=>b.classList.toggle('active', b.dataset.tab===name));
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active', v.id==='view-'+name));
  window.scrollTo({top:0});
}
document.querySelectorAll('.navBtn[data-tab]').forEach(b=>b.addEventListener('click', ()=>goTab(b.dataset.tab)));
linkAllTx.addEventListener('click', ()=>goTab('lanc'));

function setMonth(month){
  if(!month) return;
  selectedMonth = month;
  controlMes.value = month;
  populateFilters();
  fMes.value = month;
  render();
}
btnPrevMonth.addEventListener('click', ()=>setMonth(shiftMonth(selectedMonth,-1)));
btnNextMonth.addEventListener('click', ()=>setMonth(shiftMonth(selectedMonth,1)));
controlMes.addEventListener('change', ()=>setMonth(controlMes.value));
controlMes.addEventListener('click', ()=>{ try{ controlMes.showPicker && controlMes.showPicker(); }catch(e){} });

// ---- Lançamento: criar, editar, excluir ----
function setTipo(value){
  tipo.value = value;
  segTipo.querySelectorAll('button').forEach(b=>b.classList.toggle('on', b.dataset.v===value));
}
const DEFAULT_CAT = {'Saída':'Alimentação', 'Entrada':'Salário'};
segTipo.querySelectorAll('button').forEach(b=>b.addEventListener('click', ()=>{
  const other = b.dataset.v==='Entrada' ? 'Saída' : 'Entrada';
  if(!editingId && categoria.value===DEFAULT_CAT[other]) categoria.value = DEFAULT_CAT[b.dataset.v];
  setTipo(b.dataset.v);
}));

let categoriaTouched = false;
const r2ms = msg => msg.length>40 ? 4200 : 2200;
categoria.addEventListener('change', ()=>{ categoriaTouched = true; });
desc.addEventListener('input', ()=>{
  if(editingId || categoriaTouched) return;
  const guess = guessCategory(desc.value, tipo.value, '', categoryRules);
  if(guess!=='Outros' && [...categoria.options].some(o=>o.value===guess)) categoria.value = guess;
});

function openForm(){
  editingId = null; categoriaTouched = false; form.reset(); setTipo('Saída'); categoria.value = DEFAULT_CAT['Saída']; pago.value = 'Sim'; data.value = todayISO();
  modalTitle.textContent = 'Novo lançamento'; btnSubmit.textContent = 'Salvar lançamento'; btnDeleteTx.hidden = true;
  transactionModal.showModal();
  setTimeout(()=>valor.focus(), 60);
}
btnOpenForm.addEventListener('click', openForm);
btnWelcomeAdd.addEventListener('click', openForm);
btnCloseForm.addEventListener('click', ()=>transactionModal.close());

function startEdit(id){
  const t = transactions.find(x=>x.id===id); if(!t) return;
  editingId = id;
  data.value = t.data||'';
  setTipo(t.tipo==='Entrada' ? 'Entrada' : 'Saída');
  if(![...categoria.options].some(o=>o.value===t.categoria)) categoria.add(new Option(t.categoria));
  categoria.value = t.categoria; desc.value = t.descricao;
  valor.value = t.valor; forma.value = t.forma; pago.value = t.pago;
  btnSubmit.textContent = 'Salvar alterações'; btnDeleteTx.hidden = false;
  modalTitle.textContent = 'Editar lançamento'; transactionModal.showModal();
}
btnDeleteTx.addEventListener('click', ()=>{
  if(!editingId) return;
  pendingDeleteId = editingId;
  transactionModal.close();
  deleteModal.showModal();
});
btnCancelDelete.addEventListener('click', ()=>{ pendingDeleteId = null; deleteModal.close(); });
btnConfirmDelete.addEventListener('click', ()=>{
  if(!pendingDeleteId) return;
  const id = pendingDeleteId; pendingDeleteId = null; deleteModal.close();
  removeTransaction(id); showToast('Lançamento excluído');
});

function addTransaction(t){
  t.id = 'tx_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
  transactions.push(t); saveLocalState(); render();
}
function updateTransaction(id, t){
  const idx = transactions.findIndex(x=>x.id===id); if(idx<0) return;
  t.id = id; transactions[idx] = t; saveLocalState(); render();
}
function removeTransaction(id){
  transactions = transactions.filter(t=>t.id!==id); saveLocalState(); render();
}

form.addEventListener('submit', e=>{
  e.preventDefault();
  const d = desc.value.trim(); const v = parseFloat(valor.value);
  if(!d || isNaN(v)) return;
  const payload = { descricao:d, valor:v, tipo:tipo.value, categoria:categoria.value, forma:forma.value,
    pago:pago.value, data: data.value || todayISO() };
  const prev = editingId ? transactions.find(x=>x.id===editingId) : null;
  if((prev && (prev.manual || prev.categoria!==payload.categoria)) || (!prev && categoriaTouched)) payload.manual = true; // categoria escolhida por você: o Reanalisar não mexe
  if(editingId){
    const old = transactions.find(x=>x.id===editingId);
    const id = editingId;
    updateTransaction(id, payload); editingId = null;
    let msg = 'Lançamento atualizado ✓';
    if(old && old.categoria!==payload.categoria){
      const key = ruleKey(d, payload.tipo);
      if(key.length>8) categoryRules = {...categoryRules, [key]:payload.categoria};
      const r = applyCategoryToSimilar(transactions, {...payload, id}, payload.categoria);
      if(r.changed){ transactions = r.transactions; msg += ` · "${payload.categoria}" aplicada a mais ${r.changed} parecido(s)`; }
      saveLocalState(); render();
    }
    showToast(msg, r2ms(msg));
  }
  else { addTransaction(payload); showToast('Lançamento salvo ✓'); }
  transactionModal.close();
});

// ---- Reserva ----
function showReservaModal(){
  const falta = Math.max(config.metaReserva-config.reservaAtual,0);
  const rawPct = config.metaReserva>0 ? config.reservaAtual/config.metaReserva : 0;
  const meses = config.investAlvo>0 ? Math.ceil(falta/config.investAlvo) : null;
  reservaModalValue.textContent = fmt(config.reservaAtual);
  reservaModalMeta.textContent = `de ${fmt(config.metaReserva)} · ${pct(Math.min(rawPct,1))} da meta`;
  reservaModalBar.style.width = `${Math.min(rawPct,1)*100}%`;
  reservaModalBar.classList.toggle('achieved',rawPct>=1);
  reservaModalExtra.textContent = falta>0
    ? (meses ? `Faltam ${fmt(falta)}. No ritmo atual (${fmt(config.investAlvo)}/mês), isso leva cerca de ${meses} ${meses===1?'mês':'meses'}.` : `Faltam ${fmt(falta)}.`)
    : 'Meta atingida 🎉';
  reservaModal.showModal();
}
reservaCard.addEventListener('click', showReservaModal);
btnCloseReserva.addEventListener('click', ()=>reservaModal.close());
btnUpdateReserva.addEventListener('click', ()=>{
  reservaModal.close();
  goTab('plan');
  cfgReservaAtual.focus(); cfgReservaAtual.select();
  cfgReservaAtual.scrollIntoView({behavior:'smooth',block:'center'});
});

// ---- Configurações (aba Planejar) ----
function fillCfgForm(){
  cfgSalario.value=config.salario; cfgDias.value=config.dias; cfgVr.value=config.vr; cfgVt.value=config.vt;
  cfgFaculdade.value=config.faculdade; cfgCelular.value=config.celular; cfgParcelasRestantes.value=config.parcelasRestantes;
  cfgCartao.value=config.cartao; cfgLazer.value=config.lazer; cfgInvestAlvo.value=config.investAlvo;
  cfgMetaReserva.value=config.metaReserva; cfgMetaPatrim.value=config.metaPatrim;
  cfgReservaAtual.value=config.reservaAtual; cfgPatrimAtual.value=config.patrimAtual;
  cfgSaldoInicial.value=config.saldoInicial||''; cfgSaldoData.value=config.saldoData||''; cfgLimite.value=config.cartaoLimite||'';
  cfgFecha.value=config.cartaoFecha||''; cfgVence.value=config.cartaoVence||'';
}
btnSaveCfg.addEventListener('click', ()=>{
  const n = el => parseFloat(el.value)||0;
  config = {
    ...config, salario:n(cfgSalario), dias:n(cfgDias), vr:n(cfgVr), vt:n(cfgVt), faculdade:n(cfgFaculdade), celular:n(cfgCelular),
    parcelasRestantes:n(cfgParcelasRestantes), cartao:n(cfgCartao), lazer:n(cfgLazer), investAlvo:n(cfgInvestAlvo),
    metaReserva:n(cfgMetaReserva), metaPatrim:n(cfgMetaPatrim), reservaAtual:n(cfgReservaAtual), patrimAtual:n(cfgPatrimAtual),
    saldoInicial:n(cfgSaldoInicial), saldoData:cfgSaldoData.value||'', cartaoLimite:n(cfgLimite),
    cartaoFecha:Math.min(Math.max(Math.round(n(cfgFecha)),0),31), cartaoVence:Math.min(Math.max(Math.round(n(cfgVence)),0),31)
  };
  saveLocalState(); render();
  showToast('Alterações salvas ✓');
});

// ---- Início ----
function setRing(ringEl, textEl, ratio){
  const p = Math.min(Math.max(ratio,0),1);
  ringEl.setAttribute('stroke-dasharray', `${(p*100).toFixed(2)} 100`);
  ringEl.classList.toggle('done', ratio>=1);
  textEl.textContent = pct(p);
}

function renderGeral(){
  const monthList = transactions.filter(t=>(t.data||'').startsWith(selectedMonth));
  const S = monthSummary(transactions, selectedMonth);
  const hoje = todayISO();
  const dd = iso => iso ? iso.slice(8,10)+'/'+iso.slice(5,7) : '';

  // 1) Conta: só o dinheiro que está na conta
  const acc = accountBalance(transactions, config, hoje);
  cSaldo.textContent = acc.configurado ? fmt(acc.saldo) : '—';
  cPill.textContent = acc.configurado ? '' : 'Informe o saldo atual em Planejar → Conta e cartão';
  cEntradas.textContent = fmt(S.entradas);
  cSaidas.textContent = fmt(S.saidas - S.noCartao);
  cNote.textContent = S.faturasPagas ? `Pagou de fatura neste mês: ${fmt(S.faturasPagas)} (já contado nas compras do cartão)` : '';

  // 2) Cartão: fatura aberta, última fatura e limite
  const card = cardSummary(transactions, config, hoje);
  kAberta.textContent = fmt(card.aberta.total);
  kSub.textContent = card.configurado ? 'fatura aberta' : 'compras do mês';
  kPill.textContent = card.configurado ? `Fecha ${dd(card.aberta.end)}${card.aberta.due ? ' · vence '+dd(card.aberta.due) : ''}` : 'Informe fechamento e vencimento em Planejar';
  kBarWrap.hidden = !(card.limite>0);
  if(card.limite>0){ const r = card.usado/card.limite; kBar.style.width = Math.min(Math.max(r,0),1)*100+'%'; kBar.className = r>=1 ? 'over' : r>=.8 ? 'warn' : ''; }
  if(card.fechada){
    kFechadaLabel.textContent = `Última fatura${card.fechada.due ? ' (vence '+dd(card.fechada.due)+')' : ''}`;
    kFechada.textContent = card.fechada.faltam>0 ? `${fmt(card.fechada.faltam)} a pagar` : `${fmt(card.fechada.total)} paga`;
  }else{ kFechadaLabel.textContent = 'Última fatura'; kFechada.textContent = '—'; }
  kLivre.textContent = card.limite>0 ? fmt(card.livre) : '—';
  kNote.textContent = card.limite>0 ? `${fmt(card.usado)} do limite de ${fmt(card.limite)} em uso (fatura aberta + última não paga)` : '';

  // 3) Resultado do mês: tudo que foi gasto, na conta ou no cartão
  heroMonth.textContent = monthLabel(selectedMonth);
  hSaldo.textContent = fmt(S.resultado);
  hEntradas.textContent = fmt(S.entradas); hSaidas.textContent = fmt(S.saidas);
  hSaidasConta.textContent = fmt(S.saidas - S.noCartao); hSaidasCartao.textContent = fmt(S.noCartao);
  heroPill.textContent = S.entradas>0
    ? (S.saidas>S.entradas ? 'Saídas acima das entradas' : `${pct(S.saidas/S.entradas)} das entradas gastas`)
    : (S.saidas>0 ? 'Sem entradas neste mês' : '');

  const recursos = config.salario + config.vr*config.dias + config.vt*config.dias;
  const despesas = config.faculdade + config.celular + config.cartao + config.lazer + config.investAlvo;
  vRecursos.textContent = fmt(recursos);
  vDespesas.textContent = fmt(despesas);
  vSaldoPlan.textContent = fmt(recursos-despesas);

  const rRaw = config.metaReserva>0 ? config.reservaAtual/config.metaReserva : 0;
  setRing(gReservaRing, gReservaPct, rRaw);
  gReservaInfo.textContent = `${fmt(config.reservaAtual)} de ${fmt(config.metaReserva)}`;
  const pRaw = config.metaPatrim>0 ? config.patrimAtual/config.metaPatrim : 0;
  setRing(gPatrimRing, gPatrimPct, pRaw);
  gPatrimInfo.textContent = `${fmt(config.patrimAtual)} de ${fmt(config.metaPatrim)}`;

  gParcelas.textContent = config.parcelasRestantes>0 ? `${config.parcelasRestantes} restante${config.parcelasRestantes===1?'':'s'}` : 'Quitado';
  gParcelasInfo.textContent = config.parcelasRestantes>0
    ? `Cerca de ${fmt(config.celular*config.parcelasRestantes)} a pagar (${fmt(config.celular)} por mês)` : 'Celular quitado';

  renderCategories();
  renderInsights();
  renderParcelas();
  renderRecent(monthList);
  welcomeCard.hidden = transactions.length>0;
}

function renderCategories(){
  const rows = categoryTotals(transactions, selectedMonth);
  if(!rows.length){
    catStack.innerHTML = '';
    catList.innerHTML = `<div class="empty">Nenhuma saída em ${escapeHtml(monthLabel(selectedMonth))}.</div>`;
    return;
  }
  const total = sum(rows, r=>r.total);
  catStack.innerHTML = rows.map(r=>`<i style="flex:${r.total};--c:${catMeta(r.categoria).color}"></i>`).join('');
  catList.innerHTML = rows.slice(0,8).map(r=>{
    const m = catMeta(r.categoria);
    return `<button type="button" class="catRow" data-category="${escapeHtml(r.categoria)}" style="--c:${m.color}">`
      + `<span class="catIcon" aria-hidden="true">${m.emoji}</span>`
      + `<span class="catName">${escapeHtml(r.categoria)}<small>${pct(r.total/total)} das saídas</small></span>`
      + `<span class="catAmt money">${fmt(r.total)}</span></button>`;
  }).join('');
}
catList.addEventListener('click', e=>{
  const row = e.target.closest('.catRow'); if(!row) return;
  fMes.value = selectedMonth; fCategoria.value = row.dataset.category; fBusca.value = '';
  setTipoFilter('Saída'); goTab('lanc');
});

function txItem(t){
  const m = catMeta(t.categoria);
  const entrada = t.tipo==='Entrada';
  const neutro = isNeutral(t), inst = parseInstallment(t.descricao);
  return `<button type="button" class="tx${neutro?' neutral':''}" data-id="${escapeHtml(t.id)}" style="--c:${m.color}">`
    + `<span class="txIcon" aria-hidden="true">${m.emoji}</span>`
    + `<span class="txBody"><span class="txDesc">${escapeHtml(t.descricao||'')}</span>`
    + `<span class="txMeta">${escapeHtml(t.categoria||'—')}${t.forma ? ' · '+escapeHtml(t.forma) : ''}${t.pago==='Não' ? '<em class="badge">Não pago</em>' : ''}${inst ? `<em class="badge parc">${inst.n}/${inst.total}</em>` : ''}${neutro ? '<em class="badge neutro">não conta</em>' : ''}</span></span>`
    + `<span class="txVal money ${entrada&&!neutro?'pos':''}">${neutro?'↔':entrada?'+':'−'} ${fmt(Math.abs(Number(t.valor)||0))}</span></button>`;
}
function sortRecentFirst(list){
  return list.map((t,i)=>[t,i]).sort((a,b)=> (b[0].data||'').localeCompare(a[0].data||'') || b[1]-a[1]).map(x=>x[0]);
}
function renderRecent(monthList){
  const items = sortRecentFirst(monthList).slice(0,5);
  recentList.innerHTML = items.length
    ? `<div class="txGroup">${items.map(txItem).join('')}</div>`
    : `<div class="empty">Nenhum lançamento em ${escapeHtml(monthLabel(selectedMonth))}.</div>`;
}
[recentList, list].forEach(container=>container.addEventListener('click', e=>{
  const row = e.target.closest('.tx'); if(row) startEdit(row.dataset.id);
}));

// ---- Evolução dos últimos 6 meses ----
function renderEvolution(){
  const rows = monthlyTotals(transactions, selectedMonth, 6);
  if(rows.every(d=>!d.entradas && !d.saidas)){
    evoChart.innerHTML = '<div class="empty">Sem lançamentos nos últimos 6 meses.</div>'; return;
  }
  const W = 300, H = 130, top = 8, plotH = H - top - 22, slot = W / rows.length, bw = slot * 0.3;
  const max = Math.max(1, ...rows.flatMap(d=>[d.entradas, d.saidas]));
  const bars = rows.map((d,i)=>{
    const x0 = i*slot + slot/2, he = d.entradas/max*plotH, hs = d.saidas/max*plotH;
    return `<g class="${d.month===selectedMonth?'evoCur':''}"><title>${escapeHtml(monthLabel(d.month))}: entradas ${fmt(d.entradas)}, saídas ${fmt(d.saidas)}</title>`
      + `<rect class="evoIn" x="${x0-bw-1}" y="${top+plotH-he}" width="${bw}" height="${Math.max(he,he>0?2:0)}" rx="3"/>`
      + `<rect class="evoOut" x="${x0+1}" y="${top+plotH-hs}" width="${bw}" height="${Math.max(hs,hs>0?2:0)}" rx="3"/>`
      + `<text x="${x0}" y="${H-6}" text-anchor="middle">${escapeHtml(monthShort(d.month))}</text></g>`;
  }).join('');
  evoChart.innerHTML = `<svg class="evoSvg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Entradas e saídas dos últimos 6 meses">`
    + `<line class="evoBase" x1="0" x2="${W}" y1="${top+plotH}" y2="${top+plotH}"/>${bars}</svg>`
    + '<div class="evoLegend"><span><i class="evoIn"></i>Entradas</span><span><i class="evoOut"></i>Saídas</span></div>';
}

// ---- Lançamentos: filtros e lista ----
function populateFilters(){
  const months = [...new Set([...transactions.map(t=>(t.data||'').slice(0,7)).filter(Boolean),selectedMonth])].sort().reverse();
  const curMes = fMes.value;
  fMes.innerHTML = '<option value="">Todos os meses</option>' + months.map(m=>`<option value="${escapeHtml(m)}">${escapeHtml(cap(monthShort(m))+' '+m.slice(0,4))}</option>`).join('');
  if(months.includes(curMes)) fMes.value = curMes;
  const cats = [...new Set(transactions.map(t=>t.categoria).filter(Boolean))].sort();
  const curCat = fCategoria.value;
  fCategoria.innerHTML = '<option value="">Todas categorias</option>' + cats.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  if(cats.includes(curCat)) fCategoria.value = curCat;
}
function filteredList(){
  return transactions.filter(t=>
    (!fMes.value || (t.data||'').startsWith(fMes.value)) &&
    (!fCategoria.value || t.categoria===fCategoria.value) &&
    (!tipoFilter || t.tipo===tipoFilter) &&
    (!viewFilter || (viewFilter==='cartao' ? t.forma==='Crédito' : t.forma!=='Crédito')) &&
    matchesSearch(t, fBusca.value)
  );
}
viewChips.querySelectorAll('button').forEach(b=>b.addEventListener('click', ()=>{
  viewFilter = b.dataset.v;
  viewChips.querySelectorAll('button').forEach(x=>x.classList.toggle('on', x===b));
  render();
}));
function setTipoFilter(value){
  tipoFilter = value;
  tipoChips.querySelectorAll('button').forEach(b=>b.classList.toggle('on', b.dataset.tipo===value));
}
tipoChips.querySelectorAll('button').forEach(b=>b.addEventListener('click', ()=>{ setTipoFilter(b.dataset.tipo); render(); }));
[fMes,fCategoria].forEach(el=>el.addEventListener('change', render));
fBusca.addEventListener('input', render);
quickClearFilters.addEventListener('click', ()=>{
  fMes.value = selectedMonth; fCategoria.value = ''; fBusca.value = ''; setTipoFilter(''); render();
});

function renderLancamentos(){
  const filtered = filteredList();
  let entradas = 0, saidas = 0, naoPago = 0;
  for(const t of filtered){
    const v = Number(t.valor)||0;
    // Na visão Conta, pagamento de fatura e transferência próprias contam (mexem na conta); nas outras, ficam de fora.
    if(viewFilter==='conta' || !isNeutral(t)){ if(t.tipo==='Entrada') entradas += v; else saidas += v; }
    if(t.pago==='Não') naoPago++;
  }
  const rotulos = viewFilter==='cartao' ? ['Fatura (compras − estornos)','Estornos','Compras'] : viewFilter==='conta' ? ['Movimento da conta','Entrou','Saiu'] : ['Resultado','Entradas','Saídas'];
  lbSaldo.textContent = rotulos[0]; lbEntradas.textContent = rotulos[1]; lbSaidas.textContent = rotulos[2];
  vSaldo.textContent = fmt(viewFilter==='cartao' ? saidas-entradas : entradas-saidas);
  vEntradas.textContent = fmt(entradas); vSaidas.textContent = fmt(saidas);
  viewNote.hidden = !viewFilter;
  viewNote.textContent = viewFilter==='cartao' ? 'Só compras no crédito. O pagamento da fatura aparece na visão Conta.'
    : viewFilter==='conta' ? 'Só o que entrou e saiu da conta (débito, Pix, dinheiro…). Compras no crédito aparecem na visão Cartão.' : '';
  pendMsg.hidden = naoPago===0;
  if(naoPago>0) pendMsg.innerHTML = `<b>${naoPago}</b> lançamento${naoPago===1?'':'s'} marcado${naoPago===1?'':'s'} como "Não pago"`;

  const today = todayISO();
  const days = groupByDay(sortRecentFirst(filtered));
  list.innerHTML = days.map(day=>
    `<section class="dayGroup"><header class="dayHead"><span>${escapeHtml(dayLabel(day.date, today))}</span><span class="money">${fmt(day.net)}</span></header>`
    + `<div class="txGroup">${day.items.map(txItem).join('')}</div></section>`
  ).join('');
  emptyMsg.hidden = filtered.length>0;
  quickClearFilters.hidden = !(fCategoria.value || tipoFilter || fBusca.value || fMes.value!==selectedMonth);
}

// ---- Planejar: orçamento restante ----
const FIXED_TARGETS = ['Faculdade','Celular','Cartão','Lazer','Investimentos'];
const META_CATS = ['Moradia','Alimentação','Transporte','Saúde','Compras','Taxas e impostos','Transferências','Reserva','Outros'];
function renderBudgetChart(){
  const targets = {Faculdade:config.faculdade, Celular:config.celular, Cartão:config.cartao, Lazer:config.lazer, Investimentos:config.investAlvo, ...(config.metas||{})};
  const spent = {};
  const monthOut = transactions.filter(t=>t.tipo==='Saída'&&!isNeutral(t)&&(t.data||'').startsWith(selectedMonth));
  monthOut.forEach(t=>{ const c = t.categoria||'Outros'; spent[c] = (spent[c]||0) + (Number(t.valor)||0); });
  spent['Cartão'] = sum(monthOut, t=>t.forma==='Crédito' ? (Number(t.valor)||0) : 0); // o teto do cartão vale para tudo que foi no crédito
  const rows = Object.entries(targets).map(([category,target])=>{
    const used = spent[category]||0;
    const ratio = target>0 ? used/target : 0;
    const remaining = target-used;
    const over = remaining<0, done = !over && target>0 && remaining===0, near = !over && !done && ratio>=0.9;
    const state = over ? 'over' : near ? 'near' : '';
    const fillCls = over ? 'overfill' : near ? 'warnfill' : done ? 'achieved' : '';
    const text = over ? `excedeu ${fmt(Math.abs(remaining))}` : done ? 'no valor planejado' : `restam ${fmt(remaining)}`;
    return `<div class="budgetRow"><div class="budgetHead"><span>${escapeHtml(category)}<em class="money">${fmt(used)} de ${fmt(target)}</em></span>`
      + `<small class="money ${state}">${text}</small></div>`
      + `<div class="bar"><div class="${fillCls}" style="width:${Math.min(ratio,1)*100}%"></div></div></div>`;
  }).join('');
  const semMeta = Object.entries(spent).filter(([c,v])=>v>0 && !(c in targets)).sort((a,b)=>b[1]-a[1]);
  budgetChart.innerHTML = rows + (semMeta.length
    ? `<div class="budgetExtra">Gastos sem meta neste mês: ${semMeta.slice(0,6).map(([c,v])=>`${escapeHtml(c)} <span class="money">${fmt(v)}</span>`).join(' · ')}. Crie uma meta abaixo.</div>` : '');
}

// ---- Metas por categoria ----
function renderMetas(){
  const metas = config.metas || {};
  metasList.innerHTML = Object.entries(metas).map(([c,v])=>
    `<div class="metaRow"><span>${escapeHtml(c)}</span><b class="money">${fmt(v)}</b><button type="button" data-meta="${escapeHtml(c)}" aria-label="Remover meta de ${escapeHtml(c)}">✕</button></div>`).join('');
  const used = new Set([...FIXED_TARGETS, ...Object.keys(metas)]);
  const extra = [...new Set(transactions.filter(t=>t.tipo==='Saída'&&!isNeutral(t)).map(t=>t.categoria).filter(Boolean))];
  const options = [...new Set([...META_CATS, ...extra])].filter(c=>!used.has(c));
  const cur = metaCat.value;
  metaCat.innerHTML = options.map(c=>`<option>${escapeHtml(c)}</option>`).join('');
  if(options.includes(cur)) metaCat.value = cur;
  btnAddMeta.disabled = !options.length;
}
btnAddMeta.addEventListener('click', ()=>{
  const v = parseFloat(metaValor.value);
  if(!metaCat.value || !(v>0)){ showToast('Escolha a categoria e o valor da meta'); return; }
  config = {...config, metas:{...(config.metas||{}), [metaCat.value]:v}};
  metaValor.value = ''; saveLocalState(); render(); showToast('Meta adicionada ✓');
});
metasList.addEventListener('click', e=>{
  const b = e.target.closest('button[data-meta]'); if(!b) return;
  const metas = {...(config.metas||{})}; delete metas[b.dataset.meta];
  config = {...config, metas}; saveLocalState(); render();
});

// ---- Atenção: o que não bate nos números ----
function renderInsights(){
  const warns = dataWarnings(transactions, selectedMonth);
  insightsPanel.hidden = !warns.length;
  insightList.innerHTML = warns.map(w=>{
    const label = w.fix==='fatura-paga' ? 'Corrigir' : w.fix==='reanalisar' ? 'Reanalisar' : '';
    return `<div class="insight ${w.level}"><span>${escapeHtml(w.text)}</span>`
      + (label ? `<button type="button" data-fix="${w.fix}" data-ids="${escapeHtml((w.fixIds||[]).join(','))}">${label}</button>` : '') + '</div>';
  }).join('');
}
insightList.addEventListener('click', e=>{
  const b = e.target.closest('button[data-fix]'); if(!b) return;
  if(b.dataset.fix==='fatura-paga'){
    const ids = new Set(b.dataset.ids.split(',').filter(Boolean));
    transactions = transactions.map(t=>ids.has(t.id) ? {...t, categoria:'Fatura paga'} : t);
    saveLocalState(); render(); showToast('Pagamento da fatura marcado: não conta mais em dobro ✓');
  }else if(b.dataset.fix==='reanalisar') reanalisar();
});
function reanalisar(){
  const r = recategorize(transactions, categoryRules);
  if(!r.changed){ showToast('Tudo já está classificado: nada para mudar', 3200); return; }
  const groups = {};
  r.changes.forEach(c=>{ const k = `${c.de} → ${c.para}`; groups[k] = (groups[k]||0)+1; });
  const resumo = Object.entries(groups).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k,n])=>`${n}× ${k}`).join(String.fromCharCode(10));
  const NL = String.fromCharCode(10);
  if(!window.confirm(`Reanalisar vai mudar a categoria de ${r.changed} lançamento(s):${NL}${NL}${resumo}${NL}${NL}Os que você corrigiu à mão não mudam. Continuar?`)) return;
  transactions = r.transactions; saveLocalState(); render();
  showToast(`${r.changed} lançamento(s) reclassificado(s) ✓`, 3200);
}
btnReanalisar.addEventListener('click', ()=>{ moreSheet.close(); reanalisar(); });

// ---- Parcelas já lançadas que ainda vão vencer ----
function renderParcelas(){
  const sch = installmentSchedule(transactions, selectedMonth);
  parcelasFuturas.hidden = !sch.total;
  if(!sch.total) return;
  pfTotal.textContent = fmt(sch.total);
  pfList.innerHTML = sch.meses.slice(0,4).map(m=>`<div><span>${escapeHtml(cap(monthShort(m.month))+' '+m.month.slice(0,4))}</span><b class="money">${fmt(m.total)}</b></div>`).join('')
    + sch.itens.slice(0,3).map(i=>`<div><span>${escapeHtml(i.descricao)}</span><span>${i.restantes} restante${i.restantes===1?'':'s'}</span></div>`).join('');
}

// ---- Dados de exemplo (100% fictícios) ----
const SAMPLE_PREFIX = 'demo_';
function hasSampleData(){ return transactions.some(t=>String(t.id).startsWith(SAMPLE_PREFIX)); }
function buildSampleTransactions(month){
  const at = day => `${month}-${pad2(day)}`;
  const rows = [
    ['Salário',                  3200,    'Entrada', 'Salário',       'Pix',       'Sim', 5],
    ['Vale-refeição',             616,    'Entrada', 'VR',            'Benefício', 'Sim', 5],
    ['Vale-transporte',           264,    'Entrada', 'VT',            'Benefício', 'Sim', 5],
    ['Aluguel (minha parte)',     900,    'Saída',   'Moradia',       'Pix',       'Sim', 8],
    ['Mensalidade da faculdade',  650,    'Saída',   'Faculdade',     'Débito',    'Sim', 10],
    ['Parcela do celular',        180,    'Saída',   'Celular',       'Crédito',   'Sim', 12],
    ['Mercado do mês',            312.45, 'Saída',   'Alimentação',   'Débito',    'Sim', 14],
    ['Cinema e lanche',            86.9,  'Saída',   'Lazer',         'Crédito',   'Sim', 16],
    ['Transporte por aplicativo',  38.7,  'Saída',   'Transporte',    'Crédito',   'Sim', 18],
    ['Pagamento da fatura',       420,    'Saída',   'Fatura paga',   'Pix',       'Não', 20],
    ['Aporte mensal',             300,    'Saída',   'Investimentos', 'Pix',       'Sim', 21],
  ];
  return rows.map(([descricao,valor,tipo,categoria,forma,pago,dia],i)=>({
    id: `${SAMPLE_PREFIX}${month}_${i}`, descricao, valor, tipo, categoria, forma, pago, data: at(dia)
  }));
}
function loadSampleData(){
  const month = curMonth();
  transactions = [...buildSampleTransactions(shiftMonth(month,-1)), ...buildSampleTransactions(month)];
  firstUseMonthValue = shiftMonth(month,-1);
  saveLocalState(); setMonth(month);
}
btnWelcomeSample.addEventListener('click', ()=>{ loadSampleData(); showToast('Dados de exemplo carregados ✓'); });
btnSample.addEventListener('click', ()=>{
  moreSheet.close();
  if(transactions.length){ showToast('Já existem lançamentos. Limpe-os antes de carregar o exemplo.'); return; }
  loadSampleData();
  showToast('Dados de exemplo carregados ✓');
});
btnExitDemo.addEventListener('click', ()=>{
  transactions = transactions.filter(t=>!String(t.id).startsWith(SAMPLE_PREFIX));
  saveLocalState(); render();
  showToast('Dados de exemplo removidos');
});

// ---- Backup: folha de compartilhar (iPhone: Arquivos/iCloud) ou download ----
const LAST_BACKUP_KEY = 'meu-financeiro-last-backup';
function lastBackup(){ try{ return localStorage.getItem(LAST_BACKUP_KEY); }catch(e){ return null; } }
function updateBackupChip(){
  const s = backupStatus(lastBackup(), transactions.length>0, todayISO());
  const attention = (s.level==='nunca' || s.level==='atrasado') && !hasSampleData();
  backupNotice.hidden = !attention;
  backupNoticeText.textContent = s.level==='nunca' ? 'Você ainda não fez backup dos seus dados.' : `Seu último backup foi há ${s.days} dias.`;
  backupSub.textContent = s.level==='nunca' ? 'Nenhum backup feito ainda'
    : s.level==='vazio' ? 'Salva um arquivo JSON (Arquivos, iCloud)'
    : s.days===0 ? 'Último backup: hoje' : `Último backup: há ${s.days} dia${s.days===1?'':'s'}`;
}
async function doBackup(){
  const backup = {version:1, exportedAt:new Date().toISOString(), config, transactions, firstUseMonth:firstUseMonthValue, rules:categoryRules};
  const content = JSON.stringify(backup,null,2);
  const name = `meu-financeiro-backup-${todayISO()}.json`;
  try{
    const file = new File([content], name, {type:'application/json'});
    if(navigator.canShare && navigator.canShare({files:[file]})){
      await navigator.share({files:[file], title:'Backup do Meu Financeiro'});
    }else{
      downloadFile(name, content, 'application/json');
    }
  }catch(e){
    if(e && e.name==='AbortError') return; // a pessoa fechou a folha de compartilhamento
    console.warn('Compartilhamento indisponível; baixando o arquivo', e);
    downloadFile(name, content, 'application/json');
  }
  try{ localStorage.setItem(LAST_BACKUP_KEY, todayISO()); }catch(e){}
  updateBackupChip();
  showToast('Backup criado ✓');
}
function downloadFile(filename, content, type){
  const blob = new Blob([content], {type});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  URL.revokeObjectURL(url);
}
btnBackupJson.addEventListener('click', ()=>{ moreSheet.close(); doBackup(); });
btnBackupChip.addEventListener('click', doBackup);
btnRestoreJson.addEventListener('click', ()=>{ moreSheet.close(); jsonInput.click(); });
jsonInput.addEventListener('change', async e=>{
  const file = e.target.files[0]; if(!file) return;
  try{
    const backup = JSON.parse(await file.text());
    if(!backup || !Array.isArray(backup.transactions) || !backup.config) throw new Error('Formato inválido');
    pendingRestore = backup;
    restoreSummary.textContent = `${backup.transactions.length} lançamento(s) e as configurações foram encontrados no backup. Os dados atuais serão substituídos.`;
    restoreModal.showModal();
  }catch(err){ showToast('Backup JSON inválido'); }
  e.target.value = '';
});
btnCancelRestore.addEventListener('click', ()=>{ pendingRestore=null; restoreModal.close(); });
btnConfirmRestore.addEventListener('click', ()=>{
  if(!pendingRestore) return;
  config = {...config, ...pendingRestore.config};
  transactions = pendingRestore.transactions;
  if(pendingRestore.firstUseMonth) firstUseMonthValue = pendingRestore.firstUseMonth;
  categoryRules = pendingRestore.rules && typeof pendingRestore.rules==='object' ? pendingRestore.rules : {};
  saveLocalState();
  pendingRestore = null;
  restoreModal.close();
  fillCfgForm();
  setMonth(selectedMonth);
  showToast('Backup restaurado ✓');
});

// ---- Limpar ----
btnClearData.addEventListener('click', ()=>{ moreSheet.close(); clearModal.showModal(); });
btnCancelClear.addEventListener('click', ()=>clearModal.close());
btnConfirmClear.addEventListener('click', ()=>{
  transactions = [];
  saveLocalState();
  clearModal.close();
  render();
  showToast('Lançamentos limpos ✓');
});

// ---- Importação: extrato do banco (OFX ou CSV) ou planilha (.xlsx) ----
const { decodeBytes, parseBankCSV, parseOFX, parsePdfStatement, pdfItemsToLines, bankTransactions, markDuplicates } = FinLib;

// Leitor de PDF (pdf.js), carregado só quando alguém importa um PDF. Versão fixa e verificada por SRI.
const PDFJS_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
const PDFJS_SRI = {
  'pdf.min.js':'sha512-q+4liFwdPC/bNdhUpZx6aXDx/h77yEQtn4I1slHydcbZK34nLaR3cAeYSJshoxIOq3mjEf7xJE8YWIUHMn+oCQ==',
  'pdf.worker.min.js':'sha512-BbrZ76UNZq5BhH7LL7pn9A4TKQpQeNCHOo65/akfelcIBbcVvYWOFQKPXIrykE3qZxYjmDX573oa4Ywsc7rpTw=='
};
let pdfjsReady = null;
function loadPdfjs(){
  if(pdfjsReady) return pdfjsReady;
  pdfjsReady = new Promise((resolve, reject)=>{
    if(window.pdfjsLib) return resolve(window.pdfjsLib);
    const s = document.createElement('script');
    s.src = PDFJS_BASE + 'pdf.min.js'; s.integrity = PDFJS_SRI['pdf.min.js']; s.crossOrigin = 'anonymous'; s.referrerPolicy = 'no-referrer';
    s.onload = async ()=>{
      try{
        const res = await fetch(PDFJS_BASE + 'pdf.worker.min.js', {integrity:PDFJS_SRI['pdf.worker.min.js'], mode:'cors', referrerPolicy:'no-referrer'});
        if(!res.ok) throw new Error('worker');
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(await res.blob());
        resolve(window.pdfjsLib);
      }catch(e){ reject(new Error('pdf-lib')); }
    };
    s.onerror = ()=>reject(new Error('pdf-lib'));
    document.head.appendChild(s);
  }).catch(e=>{ pdfjsReady = null; throw e; });
  return pdfjsReady;
}
async function readPdfLines(buf){
  const pdfjs = await loadPdfjs();
  let password;
  for(let attempt=0; attempt<2; attempt++){
    const task = pdfjs.getDocument({data:new Uint8Array(buf.slice(0)), password, isEvalSupported:false});
    try{
      const doc = await task.promise;
      const lines = [];
      for(let p=1; p<=Math.min(doc.numPages, 40); p++){
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        lines.push(...pdfItemsToLines(content.items));
      }
      return lines;
    }catch(err){
      if(err && err.name==='PasswordException'){
        // A senha só é usada para abrir este arquivo e não é guardada.
        password = window.prompt('Este PDF tem senha. Digite a senha para abrir (ela não é salva):');
        if(!password) throw new Error('pdf-senha');
        continue;
      }
      throw err;
    }
  }
  throw new Error('pdf-senha');
}
let importSource = null; // { kind:'bank', parsed } ou { kind:'xlsx', items }
let importIgnored = 0;

btnImport.addEventListener('click', ()=>{ moreSheet.close(); fileInput.click(); });

function readXlsx(buf){
  const wb = XLSX.read(buf, {type:'array', cellDates:true});
  const sheetName = wb.SheetNames.find(n => normalizeImportText(n).includes('lancamento')) || wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {defval:''});
  const items = [];
  for(const row of rows){
    const keys = Object.keys(row).reduce((acc,k)=>{acc[normalizeImportText(k)]=row[k];return acc;},{});
    const descricao = keys.descricao || keys.descricao_do_lancamento || '';
    const parsedValue = parseImportNumber(keys.valor ?? keys.valores ?? '');
    if(!descricao || !Number.isFinite(parsedValue)) continue;
    const tipoRaw = normalizeImportText(keys.tipo);
    const tipoImportado = tipoRaw === 'saida' || tipoRaw === 'debito' ? 'Saída' : tipoRaw === 'entrada' ? 'Entrada' : (parsedValue<0 ? 'Saída' : 'Entrada');
    const pagoRaw = normalizeImportText(keys.pago || keys.pago_sim_nao || 'sim');
    items.push({ descricao:String(descricao).trim(), valor:Math.abs(parsedValue), tipo:tipoImportado,
      categoria:String(keys.categoria || 'Outros').trim() || 'Outros', forma:String(keys.forma_de_pagamento || keys.forma || 'Outro').trim() || 'Outro',
      pago:pagoRaw.startsWith('n') ? 'Não' : 'Sim', data:parseImportDate(keys.data) });
  }
  return items;
}

function buildImportList(){
  if(!importSource) return [];
  const list = importSource.kind==='xlsx' ? importSource.items
    : bankTransactions(importSource.parsed.items, {invert:importInvert.checked, isCard:importCard.checked, rules:categoryRules});
  importIgnored = importSource.kind==='xlsx' ? 0 : importSource.parsed.items.length - list.length;
  return markDuplicates(transactions, list);
}
function renderImportPreview(){
  const all = buildImportList();
  const fresh = all.filter(i=>!i.duplicado);
  const dups = all.length - fresh.length;
  pendingImport = fresh;
  const totalIn = sum(fresh, t=>(t.tipo==='Entrada' && !isNeutral(t)) ? (Number(t.valor)||0) : 0);
  const totalOut = sum(fresh, t=>(t.tipo==='Entrada' || isNeutral(t)) ? 0 : (Number(t.valor)||0));
  const warns = importSource && importSource.kind==='bank' ? importSanity(fresh, {isCard:importCard.checked}) : [];
  const pdfParsed = importSource && importSource.pdf ? importSource.parsed : null;
  const ignoredText = (importIgnored ? ` ${importIgnored} pagamento(s) de fatura ignorado(s), pois já aparecem como saída na conta.` : '')
    + (pdfParsed ? ` PDF lido pelo texto: confira cada linha.` + (pdfParsed.uncertain ? ` Em ${pdfParsed.uncertain} item(ns) o PDF não indica entrada ou saída e marquei como saída.` : '') : '');
  if(!all.length && !importIgnored){
    const p = importSource && importSource.kind==='bank' ? importSource.parsed : null;
    importSummary.textContent = !p ? 'Nenhum lançamento válido encontrado.'
      : p.error==='pdf'
        ? 'Li o PDF, mas não reconheci lançamentos nele (precisa ser um PDF com texto, não foto).' + (p.shapes && p.shapes.length ? ` Formato das linhas: ${p.shapes.join(' | ')}. Me passe só isso para eu ajustar.` : '')
      : p.error==='colunas'
        ? 'Não reconheci as colunas deste CSV (preciso de data, descrição e valor).' + (p.header && p.header.length ? ` Colunas que encontrei: ${p.header.join(' | ')}. Me passe só esses nomes para eu ajustar.` : '')
        : 'Não encontrei lançamentos neste arquivo.';
  }else if(!fresh.length){
    importSummary.textContent = (dups ? `Os ${dups} lançamento(s) deste arquivo já estão no app. Nada novo para importar.` : 'Nada novo para importar.') + ignoredText;
  }else{
    importSummary.textContent = `${fresh.length} lançamento(s) novo(s)` + (dups ? ` · ${dups} já existe(m) e será(ão) ignorado(s)` : '')
      + `. Entradas ${fmt(totalIn)}, saídas ${fmt(totalOut)}.${ignoredText} Confira antes de salvar; se estiver trocado, use as opções abaixo.`;
  }
  importSummary.innerHTML = escapeHtml(importSummary.textContent) + warns.map(w=>`<br><b>⚠</b> ${escapeHtml(w)}`).join('');
  importPreview.innerHTML = fresh.length
    ? `<table class="previewTable"><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Valor</th></tr></thead><tbody>${fresh.slice(0,20).map(item=>`<tr><td>${escapeHtml(item.data ? item.data.slice(8,10)+'/'+item.data.slice(5,7) : '—')}</td><td>${escapeHtml(item.descricao)}</td><td>${escapeHtml(item.categoria)}</td><td>${item.tipo==='Entrada'?'+':'−'} ${fmt(item.valor)}</td></tr>`).join('')}</tbody></table>${fresh.length>20?'<div class="hint">Mostrando os 20 primeiros itens.</div>':''}`
    : '<div class="empty">Nada novo para importar.</div>';
  btnConfirmImport.disabled = fresh.length===0;
}
importCard.addEventListener('change', renderImportPreview);
importInvert.addEventListener('change', renderImportPreview);

fileInput.addEventListener('change', async e=>{
  const file = e.target.files[0]; e.target.value = '';
  if(!file) return;
  if(file.size > 8*1024*1024){ showToast('Arquivo grande demais (máximo 8 MB)'); return; }
  try{
    const name = file.name.toLowerCase();
    const buf = await file.arrayBuffer();
    const head = new Uint8Array(buf.slice(0,4));
    const isPdf = head[0]===0x25 && head[1]===0x50 && head[2]===0x44 && head[3]===0x46; // %PDF
    const isZip = head[0]===0x50 && head[1]===0x4B && !/\.(xlsx|xls)$/.test(name);
    if(isPdf || /\.pdf$/.test(name)){
      showToast('Lendo o PDF…', 8000);
      const parsed = parsePdfStatement(await readPdfLines(buf));
      toast.classList.remove('show');
      importSource = {kind:'bank', parsed, pdf:true};
      importCard.checked = Boolean(parsed.cardHint);
      importInvert.checked = Boolean(parsed.invertHint);
      importOptions.hidden = false;
      renderImportPreview();
      importModal.showModal();
      return;
    }
    if(isZip || /\.zip$/.test(name)){ showToast('Este arquivo é um ZIP. Abra-o e escolha o OFX ou CSV de dentro', 5000); return; }
    if(/\.(xlsx|xls)$/.test(name)){
      importSource = {kind:'xlsx', items:readXlsx(buf)};
      importOptions.hidden = true;
    }else{
      const text = decodeBytes(buf);
      const parsed = /<OFX>|OFXHEADER/i.test(text) ? parseOFX(text) : parseBankCSV(text);
      importSource = {kind:'bank', parsed};
      importCard.checked = Boolean(parsed.cardHint);
      importInvert.checked = Boolean(parsed.invertHint);
      importOptions.hidden = false;
    }
    renderImportPreview();
    importModal.showModal();
  }catch(err){
    console.error(err && err.name);
    showToast(err && err.message==='pdf-senha' ? 'PDF protegido: senha não aceita' : err && err.message==='pdf-lib' ? 'Não consegui carregar o leitor de PDF (precisa de internet na primeira vez)' : 'Não foi possível ler o arquivo', 5000);
  }
});
btnCancelImport.addEventListener('click', ()=>{ pendingImport=[]; importSource=null; importModal.close(); });
btnConfirmImport.addEventListener('click', ()=>{
  const items = pendingImport; pendingImport = []; importSource = null;
  items.forEach((item,i)=>{
    const {duplicado, ...t} = item;
    t.id = 'tx_' + Date.now() + '_' + i + '_' + Math.random().toString(36).slice(2,6);
    transactions.push(t);
  });
  saveLocalState();
  const months = items.map(t=>(t.data||'').slice(0,7)).filter(Boolean).sort();
  const target = months.includes(selectedMonth) ? selectedMonth : (months[months.length-1] || selectedMonth);
  importModal.close();
  setMonth(target);
  if(items.length) goTab('lanc');
  showToast(items.length ? `${items.length} lançamento(s) importado(s) ✓` : 'Nenhum lançamento importado');
});

// ---- Exportar planilha ----
btnExport.addEventListener('click', ()=>{
  moreSheet.close();
  const sorted = [...transactions].sort((a,b)=> (a.data||'').localeCompare(b.data||''));
  const rows = sorted.map(t=>({Data:t.data||'', Tipo:t.tipo||'', Categoria:t.categoria||'', Descrição:t.descricao||'',
    Valor:Number(t.valor)||0, 'Forma de pagamento':t.forma||'', 'Pago?':t.pago||''}));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Lançamentos');
  const out = XLSX.write(wb, {bookType:'xlsx', type:'base64'});
  const bin = atob(out); const bytes = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
  const blob = new Blob([bytes], {type:'application/octet-stream'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download='lancamentos-financeiro.xlsx'; a.click();
  URL.revokeObjectURL(url);
});

// ---- Menu "Mais", tema e privacidade ----
btnMore.addEventListener('click', ()=>{ updateBackupChip(); syncThemeSeg(); moreSheet.showModal(); });
btnCloseMore.addEventListener('click', ()=>moreSheet.close());

const THEME_KEY = 'meu-financeiro-theme';
function currentTheme(){ const t = document.documentElement.dataset.theme; return t==='light'||t==='dark' ? t : 'auto'; }
function syncThemeSeg(){ themeSeg.querySelectorAll('button').forEach(b=>b.classList.toggle('on', b.dataset.theme===currentTheme())); }
themeSeg.querySelectorAll('button').forEach(b=>b.addEventListener('click', ()=>{
  const mode = b.dataset.theme;
  if(mode==='auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = mode;
  try{ if(mode==='auto') localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, mode); }catch(e){}
  syncThemeSeg();
}));

const PRIVACY_KEY = 'meu-financeiro-privacy';
function applyPrivacy(on){
  document.body.classList.toggle('privacy', on);
  btnPrivacy.setAttribute('aria-pressed', String(on));
  btnPrivacy.setAttribute('aria-label', on ? 'Mostrar valores' : 'Ocultar valores');
  btnPrivacy.innerHTML = `<svg class="ic"><use href="#${on ? 'i-eye-off' : 'i-eye'}"/></svg>`;
}
btnPrivacy.addEventListener('click', ()=>{
  const on = !document.body.classList.contains('privacy');
  try{ localStorage.setItem(PRIVACY_KEY, on ? '1' : '0'); }catch(e){}
  applyPrivacy(on);
});

// ---- Aviso de instalação no iPhone (Safari fora da tela de início) ----
const IOS_HINT_KEY = 'meu-financeiro-ios-hint';
function isIOS(){ return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1); }
function isStandalone(){ return navigator.standalone===true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches); }
function maybeShowIosHint(forced){
  let dismissed = false; try{ dismissed = localStorage.getItem(IOS_HINT_KEY)==='1'; }catch(e){}
  iosHint.hidden = !(forced || (isIOS() && !isStandalone() && !dismissed));
}
btnIosHintClose.addEventListener('click', ()=>{
  try{ localStorage.setItem(IOS_HINT_KEY, '1'); }catch(e){}
  iosHint.hidden = true;
});

// ---- Render geral ----

// ---- Sincronização entre aparelhos (criptografada; veja docs/sincronizacao.md) ----
const APP_VERSION = 'v18'; // igual ao cache do sw.js
const SYNC_KEY = 'meu-financeiro-sync';
let syncCfg = null, syncTimer = null, syncBusy = false, syncMsg = {text:'', err:false};
function loadSyncCfg(){ try{ syncCfg = JSON.parse(localStorage.getItem(SYNC_KEY)||'null'); }catch(e){ syncCfg = null; } }
function saveSyncCfg(){ try{ if(syncCfg) localStorage.setItem(SYNC_KEY, JSON.stringify(syncCfg)); else localStorage.removeItem(SYNC_KEY); }catch(e){} }
const syncWhen = at => new Date(at).toLocaleString('pt-BR', {dateStyle:'short', timeStyle:'short'});
function syncErrorText(e){
  const m = e && e.message || '';
  if(m==='senha-incorreta') return 'A senha de criptografia não confere com a do outro aparelho.';
  if(m==='sem-dados') return 'Não encontrei dados com este código. Confira o código.';
  if(m==='conflito') return 'Dois aparelhos gravaram ao mesmo tempo. Tente de novo.';
  if(m==='http-401' || m==='http-403') return 'O Supabase recusou a chave. Confira o endereço e a chave pública.';
  if(m==='http-404') return 'O Supabase não achou as funções mf_get e mf_put. Confira: 1) o SQL deu Success (Run) no SQL Editor DESTE projeto; 2) o Project URL é deste mesmo projeto; 3) em Project Settings → Data API, a API está ligada e o schema public está exposto. Depois espere 1 minuto e tente de novo.';
  if(e && e.name==='TypeError') return 'Sem conexão com o servidor. Confira a internet e o endereço.';
  return 'Não foi possível sincronizar agora.';
}
function renderSync(){
  appVersion.textContent = `Versão do app: ${APP_VERSION}`;
  const on = Boolean(syncCfg);
  syncOff.hidden = on; syncOn.hidden = !on;
  syncSub.textContent = !on ? 'Notebook e celular, com criptografia'
    : syncBusy ? 'Sincronizando…' : syncCfg.error ? 'Ativa · com erro' : syncCfg.last ? `Ativa · última: ${syncWhen(syncCfg.last)}` : 'Ativa';
  const text = syncBusy ? 'Sincronizando…' : on ? (syncCfg.error ? syncErrorText({message:syncCfg.error}) + (syncCfg.errorDetail ? ` [${syncCfg.errorDetail}]` : '') : syncCfg.last ? `Última sincronização: ${syncWhen(syncCfg.last)}` : '') : syncMsg.text;
  syncStatus.textContent = text; syncStatus.classList.toggle('err', Boolean(on ? syncCfg.error : syncMsg.err));
  if(on) syncCodeShow.value = FinSync.makePairCode({url:syncCfg.url, key:syncCfg.key, id:syncCfg.id});
}
function getSyncState(){ return {transactions, tombstones, config, configUpdatedAt, rules:categoryRules}; }
async function applyMerged(merged){
  const m = FinSync.mergeStates(getSyncState(), merged); // reaplica o que você mexeu durante o envio
  transactions = [...transactions.filter(t=>String(t.id).startsWith('demo_')), ...m.transactions];
  tombstones = m.tombstones; config = {...DEFAULT_CONFIG, ...m.config}; configUpdatedAt = m.configUpdatedAt; categoryRules = m.rules;
  resetSnapshots(); persistRaw(); fillCfgForm(); render();
}
async function runSync(){
  if(!syncCfg || syncBusy) return;
  syncBusy = true; renderSync();
  try{
    const key = await FinSync.importKey(syncCfg.keyB64);
    const client = FinSync.createClient({url:syncCfg.url, key:syncCfg.key});
    const r = await FinSync.syncOnce({client, key, syncId:syncCfg.id, getLocal:getSyncState, applyMerged});
    syncCfg.last = r.at; delete syncCfg.error; delete syncCfg.errorDetail;
  }catch(e){ syncCfg.error = (e && e.message) || 'erro'; syncCfg.errorDetail = e && e.code ? `${e.code}: ${e.detail||''}` : ''; if(e && e.name==='TypeError') syncCfg.error = 'TypeError'; console.warn('sincronização falhou:', e && e.message); }
  syncBusy = false; saveSyncCfg(); renderSync();
}
function scheduleSync(){
  if(!syncCfg) return;
  clearTimeout(syncTimer); syncTimer = setTimeout(runSync, 2500);
}
function mapSyncError(e){ return syncErrorText(e && e.name==='TypeError' ? {name:'TypeError'} : e) + (e && e.code ? ` [${e.code}: ${e.detail||''}]` : ''); }
async function activateSync({url, key, id, pass, joining}){
  const derived = await FinSync.deriveKey(pass, id);
  const keyB64 = await FinSync.exportKey(derived);
  if(joining){ // ao conectar, o código precisa apontar para dados que existem e a senha precisa abri-los
    const client = FinSync.createClient({url, key});
    const remote = await client.get(id);
    if(!remote) throw new Error('sem-dados');
    await FinSync.decryptJSON(derived, remote.data);
  }
  syncCfg = {url, key, id, keyB64};
  saveSyncCfg(); await runSync();
}
syncMode.querySelectorAll('button').forEach(b=>b.addEventListener('click', ()=>{
  syncMode.querySelectorAll('button').forEach(x=>x.classList.toggle('on', x===b));
  syncCreate.hidden = b.dataset.m!=='create'; syncJoin.hidden = b.dataset.m!=='join';
  syncMsg = {text:'', err:false}; renderSync();
}));
btnSyncCreate.addEventListener('click', async ()=>{
  const url = FinSync.normalizeUrl(syncUrl.value), key = syncKey.value.trim();
  if(!FinSync.validUrl(url) || !key){ syncMsg = {text:'Preencha o endereço (https://…) e a chave pública.', err:true}; renderSync(); return; }
  if(syncPass.value.length<8){ syncMsg = {text:'Use uma senha de pelo menos 8 caracteres.', err:true}; renderSync(); return; }
  if(syncPass.value!==syncPass2.value){ syncMsg = {text:'As duas senhas não são iguais.', err:true}; renderSync(); return; }
  syncUrl.value = url; syncMsg = {text:'Ativando…', err:false}; renderSync();
  try{ await activateSync({url, key, id:crypto.randomUUID(), pass:syncPass.value}); syncPass.value = syncPass2.value = ''; if(syncCfg && syncCfg.error){ const e = new Error(syncCfg.error); const d = syncCfg.errorDetail||''; e.code = d.split(':')[0]||undefined; e.detail = d.slice(d.indexOf(':')+1).trim(); syncCfg = null; saveSyncCfg(); throw e; } }
  catch(e){ syncCfg = null; saveSyncCfg(); syncMsg = {text:mapSyncError(e), err:true}; renderSync(); }
});
btnSyncJoin.addEventListener('click', async ()=>{
  const p = FinSync.parsePairCode(syncCode.value);
  if(!p){ syncMsg = {text:'Código inválido. Copie de novo, inteiro.', err:true}; renderSync(); return; }
  if(!syncPassJoin.value){ syncMsg = {text:'Digite a senha de criptografia.', err:true}; renderSync(); return; }
  syncMsg = {text:'Conectando…', err:false}; renderSync();
  try{ await activateSync({...p, pass:syncPassJoin.value, joining:true}); syncPassJoin.value = ''; syncCode.value = ''; if(syncCfg && syncCfg.error){ const e = new Error(syncCfg.error); const d = syncCfg.errorDetail||''; e.code = d.split(':')[0]||undefined; e.detail = d.slice(d.indexOf(':')+1).trim(); syncCfg = null; saveSyncCfg(); throw e; } }
  catch(e){ syncCfg = null; saveSyncCfg(); syncMsg = {text:mapSyncError(e), err:true}; renderSync(); }
});
btnSyncNow.addEventListener('click', runSync);
btnCopySql.addEventListener('click', async ()=>{
  try{ await navigator.clipboard.writeText(FinSync.SQL_SETUP); showToast('SQL copiado ✓ Cole no SQL Editor do Supabase', 4000); }
  catch(e){ showToast('Não consegui copiar. Abra docs/sincronizacao.sql no GitHub', 4500); }
});
btnSyncOff.addEventListener('click', ()=>{ syncCfg = null; saveSyncCfg(); syncMsg = {text:'Sincronização desativada neste aparelho.', err:false}; renderSync(); });
btnCopyCode.addEventListener('click', async ()=>{
  const code = syncCodeShow.value;
  try{
    if(navigator.share){ await navigator.share({text:code}); return; }
    await navigator.clipboard.writeText(code); showToast('Código copiado ✓');
  }catch(e){ if(e && e.name==='AbortError') return; syncCodeShow.select(); showToast('Selecione e copie o código'); }
});
btnSync.addEventListener('click', ()=>{ moreSheet.close(); renderSync(); syncSheet.showModal(); });
btnCloseSync.addEventListener('click', ()=>syncSheet.close());
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible') scheduleSync(); });
window.addEventListener('online', scheduleSync);

function render(){
  monthText.textContent = cap(monthLabel(selectedMonth));
  controlMes.value = selectedMonth;
  demoBanner.hidden = !hasSampleData();
  populateFilters();
  renderGeral();
  renderEvolution();
  renderLancamentos();
  renderBudgetChart();
  renderMetas();
  updateBackupChip();
}

(function init(){
  try{
    loadLocalState();
    resetSnapshots();
    selectedMonth = curMonth();
    applyPrivacy(localStorage.getItem(PRIVACY_KEY)==='1');
    // pede ao navegador para não apagar os dados do site por falta de espaço (iOS/Android)
    if(navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(()=>{});
  }catch(e){ console.error('init failed', e); }
  fillCfgForm();
  populateFilters();
  fMes.value = selectedMonth;
  loadSyncCfg(); renderSync();
  render();
  scheduleSync();
  // Atalhos de URL para apresentação: ?demo carrega os dados de exemplo; &tab=lanc|plan abre a aba;
  // &privacidade oculta os valores; &tema=claro|escuro força o tema sem gravá-lo.
  const params = new URLSearchParams(location.search);
  maybeShowIosHint(params.has('ios'));
  if(params.has('privacidade')) applyPrivacy(true);
  const temaParam = params.get('tema'); // só para apresentação; não grava a escolha
  if(temaParam==='claro') document.documentElement.dataset.theme = 'light';
  if(temaParam==='escuro') document.documentElement.dataset.theme = 'dark';
  if(params.has('demo') && !transactions.length) loadSampleData();
  const tabParam = params.get('tab');
  if(['geral','lanc','plan'].includes(tabParam)) goTab(tabParam);
})();
