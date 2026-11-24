/* Meu Financeiro: lógica do app (sem dependências, exceto SheetJS para planilhas).
   Os dados ficam só no navegador (localStorage). As funções puras estão em lib.js (window.FinLib). */
const { fmt, pct, escapeHtml, pad2, todayISO, curMonth, shiftMonth, monthLabel, monthShort, normalizeImportText,
        parseImportNumber, parseImportDate, monthlyTotals, matchesSearch, backupStatus } = FinLib;
let transactions = [];
let editingId = null;
let pendingDeleteId = null;
let pendingImport = [];
let pendingRestore = null;
let firstUseMonthValue = null;
let selectedMonth = curMonth();
// Valores iniciais fictícios: o app não traz dados reais de ninguém.
const DEFAULT_CONFIG = {
  salario:3200, dias:22, vr:28, vt:12, faculdade:650, celular:180, parcelasRestantes:8, cartao:800,
  lazer:400, investAlvo:300, metaReserva:10000, metaPatrim:100000, reservaAtual:2500, patrimAtual:0
};
let config = {...DEFAULT_CONFIG};
const STORAGE_KEY = 'meu-financeiro-v1';

function loadLocalState(){
  try{
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');
    if(!saved) return;
    if(saved.config) config = {...config, ...saved.config};
    if(Array.isArray(saved.transactions)) transactions = saved.transactions;
    if(saved.firstUseMonth) firstUseMonthValue = saved.firstUseMonth;
  }catch(e){ console.warn('Não foi possível ler os dados locais', e); }
}
function saveLocalState(){
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify({config,transactions,firstUseMonth:firstUseMonthValue})); }
  catch(e){ console.warn('Não foi possível salvar os dados locais', e); }
}

function showToast(message){
  toast.textContent = message; toast.classList.add('show');
  clearTimeout(showToast.timer); showToast.timer = setTimeout(()=>toast.classList.remove('show'), 2000);
}
function showReservaModal(){
  const falta = Math.max(config.metaReserva-config.reservaAtual,0);
  const rawPct = config.metaReserva>0 ? config.reservaAtual/config.metaReserva : 0;
  const meses = config.investAlvo>0 ? Math.ceil(falta/config.investAlvo) : null;
  reservaModalValue.textContent = fmt(config.reservaAtual);
  reservaModalMeta.textContent = `de ${fmt(config.metaReserva)} · meta · ${pct(Math.min(rawPct,1))}`;
  reservaModalBar.style.width = `${Math.min(rawPct,1)*100}%`;
  reservaModalBar.classList.toggle('achieved',rawPct>=1);
  reservaModalExtra.textContent = falta>0
    ? `faltam ${fmt(falta)} · no ritmo atual (${fmt(config.investAlvo)}/mês) isso leva ~${meses} meses`
    : 'Meta atingida';
  reservaModal.showModal();
}
function updateQuickSummary(){
  const month = selectedMonth;
  const monthTotals = transactions.filter(t=>(t.data||'').startsWith(month)).reduce((totals,t)=>{
    const value = Number(t.valor)||0;
    if(t.tipo==='Entrada') totals.entradas += value; else totals.saidas += value;
    return totals;
  },{entradas:0,saidas:0});
  quickSaldo.textContent = fmt(monthTotals.entradas-monthTotals.saidas);
  quickReserva.textContent = fmt(config.reservaAtual);
  quickReservaPct.textContent = pct(config.metaReserva>0 ? Math.min(config.reservaAtual/config.metaReserva,1) : 0);
}

btnOpenForm.addEventListener('click', ()=>{
  editingId = null; form.reset(); tipo.value='Entrada'; pago.value='Sim';
  modalTitle.textContent='Novo lançamento'; btnSubmit.textContent='Adicionar lançamento'; btnCancelEdit.style.display='none';
  transactionModal.showModal();
});
btnCloseForm.addEventListener('click', ()=>transactionModal.close());
transactionModal.addEventListener('click', e=>{ if(e.target===transactionModal) transactionModal.close(); });
reservaCard.addEventListener('keydown', e=>{ if(e.key==='Enter' || e.key===' ') { e.preventDefault(); showReservaModal(); } });
btnUpdateReserva.addEventListener('click', ()=>{
  reservaModal.close();
  document.querySelector('details').open = true;
  cfgReservaAtual.focus();
  cfgReservaAtual.select();
  cfgReservaAtual.scrollIntoView({behavior:'smooth',block:'center'});
});
quickFab.addEventListener('click', ()=>{ updateQuickSummary(); quickModal.showModal(); });
quickModal.addEventListener('click', e=>{ if(e.target===quickModal) quickModal.close(); });
controlMes.value = selectedMonth;
controlMes.addEventListener('change', ()=>{
  if(!controlMes.value) return;
  selectedMonth = controlMes.value;
  fMes.value = selectedMonth;
  render();
});
btnChooseMonth.addEventListener('click', ()=>{
  firstUseMonth.value = firstUseMonthValue || selectedMonth;
  monthModal.showModal();
});
btnCloseMonth.addEventListener('click', ()=>monthModal.close());
monthForm.addEventListener('submit', e=>{
  e.preventDefault();
  if(!firstUseMonth.value) return;
  firstUseMonthValue = firstUseMonth.value;
  selectedMonth = firstUseMonth.value;
  controlMes.value = selectedMonth;
  saveLocalState();
  monthHint.hidden = true;
  monthModal.close();
  render();
  showToast('Mês inicial salvo ✓');
});
btnCloseImport.addEventListener('click', ()=>importModal.close());
btnCancelImport.addEventListener('click', ()=>{ pendingImport=[]; importModal.close(); });
btnCancelClear.addEventListener('click', ()=>clearModal.close());
btnConfirmClear.addEventListener('click', ()=>{
  transactions = [];
  saveLocalState();
  clearModal.close();
  render();
  showToast('Lançamentos limpos ✓');
});
btnCancelRestore.addEventListener('click', ()=>{ pendingRestore=null; restoreModal.close(); });
btnConfirmRestore.addEventListener('click', ()=>{
  if(!pendingRestore) return;
  config = {...config, ...pendingRestore.config};
  transactions = pendingRestore.transactions;
  if(pendingRestore.firstUseMonth) firstUseMonthValue = pendingRestore.firstUseMonth;
  saveLocalState();
  pendingRestore = null;
  restoreModal.close();
  fillCfgForm();
  render();
  showToast('Backup restaurado ✓');
});
quickCurrentMonth.addEventListener('click', ()=>{
  fMes.value = selectedMonth; fCategoria.value = ''; fTipo.value = ''; fBusca.value = ''; render();
});
quickExpenses.addEventListener('click', ()=>{
  fMes.value = selectedMonth; fCategoria.value = ''; fTipo.value = 'Saída'; fBusca.value = ''; render();
});
quickClearFilters.addEventListener('click', ()=>{
  fMes.value = ''; fCategoria.value = ''; fTipo.value = ''; fBusca.value = ''; render();
});
btnCancelDelete.addEventListener('click', ()=>deleteModal.close());
deleteModal.addEventListener('click', e=>{ if(e.target===deleteModal) deleteModal.close(); });
btnConfirmDelete.addEventListener('click', async ()=>{
  if(!pendingDeleteId) return;
  const id = pendingDeleteId; pendingDeleteId = null; deleteModal.close();
  await removeTransaction(id); showToast('Lançamento excluído');
});

document.querySelectorAll('.tab').forEach(t=>{
  t.addEventListener('click', ()=>{
    document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
    document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));
    t.classList.add('active');
    document.getElementById('view-'+t.dataset.tab).classList.add('active');
  });
});

function fillCfgForm(){
  cfgSalario.value=config.salario; cfgDias.value=config.dias; cfgVr.value=config.vr; cfgVt.value=config.vt;
  cfgFaculdade.value=config.faculdade; cfgCelular.value=config.celular; cfgParcelasRestantes.value=config.parcelasRestantes;
  cfgCartao.value=config.cartao; cfgLazer.value=config.lazer; cfgInvestAlvo.value=config.investAlvo;
  cfgMetaReserva.value=config.metaReserva; cfgMetaPatrim.value=config.metaPatrim;
  cfgReservaAtual.value=config.reservaAtual; cfgPatrimAtual.value=config.patrimAtual;
}

function gastosPorCategoria(list, tipo){
  const m = {};
  for(const t of list){ if(t.tipo!==tipo) continue; m[t.categoria]=(m[t.categoria]||0)+(Number(t.valor)||0); }
  return Object.entries(m).sort((a,b)=>b[1]-a[1]);
}

function renderGeral(){
  const recursos = config.salario + config.vr*config.dias + config.vt*config.dias;
  const despesas = config.faculdade + config.celular + config.cartao + config.lazer + config.investAlvo;
  document.getElementById('vRecursos').textContent = fmt(recursos);
  document.getElementById('vDespesas').textContent = fmt(despesas);
  document.getElementById('vSaldoPlan').textContent = fmt(recursos-despesas);

  const rRaw = config.metaReserva>0 ? config.reservaAtual/config.metaReserva : 0;
  const rPct = Math.min(rRaw,1);
  gReservaPct.textContent = pct(rPct); gReservaBar.style.width=(rPct*100)+'%';
  gReservaBar.classList.toggle('achieved',rRaw>=1);
  gReservaInfo.textContent = `${fmt(config.reservaAtual)} de ${fmt(config.metaReserva)} · faltam ${fmt(Math.max(config.metaReserva-config.reservaAtual,0))}`;

  const pRaw = config.metaPatrim>0 ? config.patrimAtual/config.metaPatrim : 0;
  const pPct = Math.min(pRaw,1);
  gPatrimPct.textContent = pct(pPct); gPatrimBar.style.width=(pPct*100)+'%';
  gPatrimBar.classList.toggle('achieved',pRaw>=1);
  gPatrimInfo.textContent = `${fmt(config.patrimAtual)} de ${fmt(config.metaPatrim)} · faltam ${fmt(Math.max(config.metaPatrim-config.patrimAtual,0))}`;

  const cm = selectedMonth;
  const cartaoGasto = transactions.filter(t=>t.tipo==='Saída'&&t.forma==='Crédito'&&(t.data||'').startsWith(cm)).reduce((s,t)=>s+(Number(t.valor)||0),0);
  const cPct = config.cartao>0 ? Math.min(cartaoGasto/config.cartao,1) : 0;
  gCartaoPct.textContent = pct(cPct);
  gCartaoBar.style.width=(cPct*100)+'%';
  gCartaoBar.className = cPct>=1 ? 'negfill' : (cPct>=0.9 ? 'warnfill' : '');
  gCartaoInfo.textContent = `${fmt(cartaoGasto)} de ${fmt(config.cartao)}` + (cPct>=0.9?' · perto do teto':'');

  gParcelas.textContent = config.parcelasRestantes + ' restante(s)';
  gParcelasInfo.textContent = config.parcelasRestantes>0 ? `~${fmt(config.celular*config.parcelasRestantes)} ainda a pagar (R$ ${config.celular.toLocaleString('pt-BR')}/mês)` : 'Celular quitado';

  cartaoMesLabel.textContent = monthLabel(cm);
}

btnSaveCfg.addEventListener('click', async ()=>{
  config = {
    salario:parseFloat(cfgSalario.value)||0, dias:parseFloat(cfgDias.value)||0, vr:parseFloat(cfgVr.value)||0,
    vt:parseFloat(cfgVt.value)||0, faculdade:parseFloat(cfgFaculdade.value)||0, celular:parseFloat(cfgCelular.value)||0,
    parcelasRestantes:parseFloat(cfgParcelasRestantes.value)||0, cartao:parseFloat(cfgCartao.value)||0,
    lazer:parseFloat(cfgLazer.value)||0, investAlvo:parseFloat(cfgInvestAlvo.value)||0,
    metaReserva:parseFloat(cfgMetaReserva.value)||0, metaPatrim:parseFloat(cfgMetaPatrim.value)||0,
    reservaAtual:parseFloat(cfgReservaAtual.value)||0, patrimAtual:parseFloat(cfgPatrimAtual.value)||0
  };
  renderGeral();
  showToast('Configurações salvas ✓');
  saveLocalState();
  if(reservaModal.open) reservaModal.close();
});

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
    ['Fatura do cartão',          420,    'Saída',   'Cartão',        'Crédito',   'Não', 20],
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
  selectedMonth = month; controlMes.value = month;
  saveLocalState(); render();
}
btnSample.addEventListener('click', ()=>{
  if(transactions.length){ showToast('Já existem lançamentos. Limpe-os antes de carregar o exemplo.'); return; }
  loadSampleData();
  document.querySelector('.dataMenu').open = false;
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
  btnBackupChip.hidden = s.level==='vazio' || hasSampleData();
  btnBackupChip.dataset.level = s.level;
  btnBackupChip.textContent = s.level==='nunca' ? '💾 Sem backup ainda'
    : s.level==='atrasado' ? `💾 Backup há ${s.days} dias`
    : s.days===0 ? '💾 Backup de hoje' : `💾 Backup há ${s.days} dia(s)`;
}
async function doBackup(){
  const backup = {version:1, exportedAt:new Date().toISOString(), config, transactions, firstUseMonth:firstUseMonthValue};
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

// ---- Modo privacidade: borra os valores na tela ----
const PRIVACY_KEY = 'meu-financeiro-privacy';
function applyPrivacy(on){
  document.body.classList.toggle('privacy', on);
  btnPrivacy.setAttribute('aria-pressed', String(on));
  btnPrivacy.textContent = on ? '🙈 Valores ocultos' : '👁 Ocultar valores';
}
btnPrivacy.addEventListener('click', ()=>{
  const on = !document.body.classList.contains('privacy');
  try{ localStorage.setItem(PRIVACY_KEY, on ? '1' : '0'); }catch(e){}
  applyPrivacy(on);
});

// ---- Evolução dos últimos 6 meses ----
function renderEvolution(){
  const data = monthlyTotals(transactions, selectedMonth, 6);
  if(data.every(d=>!d.entradas && !d.saidas)){
    evoChart.innerHTML = '<div class="empty">Sem lançamentos nos últimos 6 meses.</div>'; return;
  }
  const W = 300, H = 120, top = 8, plotH = H - top - 22, slot = W / data.length, bw = slot * 0.3;
  const max = Math.max(1, ...data.flatMap(d=>[d.entradas, d.saidas]));
  const bars = data.map((d,i)=>{
    const x0 = i*slot + slot/2, he = d.entradas/max*plotH, hs = d.saidas/max*plotH;
    return `<g><title>${escapeHtml(monthLabel(d.month))}: entradas ${fmt(d.entradas)}, saídas ${fmt(d.saidas)}</title>`
      + `<rect class="evoIn" x="${x0-bw-1}" y="${top+plotH-he}" width="${bw}" height="${he}" rx="2"/>`
      + `<rect class="evoOut" x="${x0+1}" y="${top+plotH-hs}" width="${bw}" height="${hs}" rx="2"/>`
      + `<text x="${x0}" y="${H-6}" text-anchor="middle">${escapeHtml(monthShort(d.month))}</text></g>`;
  }).join('');
  evoChart.innerHTML = `<svg class="evoSvg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Entradas e saídas dos últimos 6 meses">${bars}</svg>`
    + '<div class="evoLegend"><span><i class="evoIn"></i>Entradas</span><span><i class="evoOut"></i>Saídas</span></div>';
}

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

// ---- Filtros ----
function populateFilters(){
  const months = [...new Set([...transactions.map(t=>(t.data||'').slice(0,7)).filter(Boolean),selectedMonth])].sort().reverse();
  const curMes = fMes.value;
  fMes.innerHTML = '<option value="">Todos os meses</option>' + months.map(m=>`<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
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
    (!fTipo.value || t.tipo===fTipo.value) &&
    matchesSearch(t, fBusca.value)
  );
}
[fMes,fCategoria,fTipo].forEach(el=> el.addEventListener('change', render));
fBusca.addEventListener('input', render);

function renderCatChart(list){
  const rows = gastosPorCategoria(list, 'Saída');
  if(rows.length===0){ catChart.innerHTML = '<div class="empty">Nenhuma saída neste filtro.</div>'; return; }
  const max = rows[0][1];
  const colors = {};
  rows.forEach(([category])=>{ colors[category] = categoryColor(category); });
  catLegend.innerHTML = rows.map(([category])=>`<span class="catLegendItem" data-category="${escapeHtml(category)}" style="--cat-color:${colors[category]}"><i class="catSwatch"></i>${escapeHtml(category)}</span>`).join('');
  catChart.innerHTML = rows.map(([cat,val])=>
    `<div class="catrow" data-category="${escapeHtml(cat)}" style="--cat-color:${colors[cat]}"><span class="name">${escapeHtml(cat)}</span><div class="bar"><div style="width:${(val/max*100)}%"></div></div><span class="amt">${fmt(val)}</span></div>`
  ).join('');
  catChart.querySelectorAll('.catrow').forEach(row=>row.addEventListener('click',()=>showCategoryTip(row.dataset.category,row)));
  catLegend.querySelectorAll('.catLegendItem').forEach(item=>item.addEventListener('click',()=>{
    fCategoria.value = item.dataset.category;
    render();
  }));
}

function categoryColor(category){
  const palette = ['#25e6e0','#d7b56d','#ff7a90','#8bd17c','#a78bfa','#f59e0b','#60a5fa','#f472b6','#34d399','#fb7185'];
  let hash = 0;
  for(const character of String(category)) hash = (hash*31 + character.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length];
}

function renderBudgetChart(){
  const targets = {Faculdade:config.faculdade, Celular:config.celular, Cartão:config.cartao, Lazer:config.lazer, Investimentos:config.investAlvo};
  const spent = {};
  transactions.filter(t=>t.tipo==='Saída'&&(t.data||'').startsWith(selectedMonth)).forEach(t=>{
    spent[t.categoria] = (spent[t.categoria]||0) + (Number(t.valor)||0);
  });
  budgetChart.innerHTML = Object.entries(targets).map(([category,target])=>{
    const used = spent[category]||0;
    const ratio = target>0 ? used/target : 0;
    const remaining = target-used;
    const fill = Math.min(ratio,1)*100;
    const state = remaining<0 ? 'over' : 'under';
    return `<div class="budgetRow"><div class="budgetHead"><span>${escapeHtml(category)}</span><strong class="${state}">${remaining<0?'excedeu ':'restam '}${fmt(Math.abs(remaining))}</strong></div><div class="bar"><div class="${remaining<0?'overfill':''}" style="width:${fill}%"></div></div></div>`;
  }).join('');
}

function renderSaldoChart(list,lineId='saldoChartLine',areaId='saldoChartArea'){
  const line = document.getElementById(lineId);
  const area = document.getElementById(areaId);
  const ordered = [...list].sort((a,b)=> (a.data||'').localeCompare(b.data||''));
  if(!ordered.length){
    line.setAttribute('d','M0 22 L100 22');
    area.setAttribute('d','M0 22 L100 22 L100 44 L0 44 Z');
    return;
  }
  let balance = 0;
  const points = [{x:0,value:0}];
  ordered.forEach((transaction,index)=>{
    const amount = Number(transaction.valor)||0;
    balance += transaction.tipo==='Entrada' ? amount : -amount;
    points.push({x:(index+1)/(ordered.length)*100,value:balance});
  });
  const values = points.map(point=>point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max-min || Math.max(Math.abs(max),1);
  const lower = min-spread*.12;
  const upper = max+spread*.12;
  const toY = value => 38-((value-lower)/(upper-lower))*32;
  const path = points.map(point=>`${point===points[0]?'M':'L'}${point.x.toFixed(2)} ${toY(point.value).toFixed(2)}`).join(' ');
  line.setAttribute('d',path);
  area.setAttribute('d',`${path} L100 44 L0 44 Z`);
}

function showCategoryTip(category, anchor){
  const items = transactions.filter(t=>t.tipo==='Saída'&&t.categoria===category&&(t.data||'').startsWith(selectedMonth));
  categoryTip.innerHTML = `<strong>${escapeHtml(category)}</strong><br>${items.map(t=>`${escapeHtml(t.descricao||'—')} · ${fmt(Number(t.valor)||0)}`).join('<br>') || 'Nenhum lançamento neste mês.'}`;
  categoryTip.hidden = false;
  const rect = anchor.getBoundingClientRect();
  categoryTip.style.left = Math.min(Math.max(8,rect.left),window.innerWidth-288)+'px';
  categoryTip.style.top = Math.min(rect.bottom+8,window.innerHeight-120)+'px';
  clearTimeout(showCategoryTip.timer); showCategoryTip.timer=setTimeout(()=>categoryTip.hidden=true,3500);
}
document.addEventListener('click',e=>{ if(!e.target.closest('.catrow')&&!e.target.closest('#categoryTip')) categoryTip.hidden=true; });

function render(){
  monthHint.hidden = Boolean(firstUseMonthValue);
  demoBanner.hidden = !hasSampleData();
  populateFilters();
  const list = filteredList();
  document.getElementById('list').innerHTML = '';
  const sorted = [...list].sort((a,b)=> (b.data||'').localeCompare(a.data||''));
  emptyMsg.style.display = sorted.length===0 ? 'block' : 'none';
  let entradas=0, saidas=0, naoPago=0;
  for(const t of list){
    const v = Number(t.valor)||0;
    if(t.tipo==='Entrada') entradas += v; else saidas += v;
    if(t.pago==='Não') naoPago++;
  }
  vSaldo.textContent = fmt(entradas-saidas); vEntradas.textContent = fmt(entradas); vSaidas.textContent = fmt(saidas);
  renderSaldoChart(list);
  if(naoPago>0){ pendMsg.style.display='block'; pendMsg.innerHTML = `<b>${naoPago}</b> lançamento(s) marcado(s) como "Não pago"`; }
  else pendMsg.style.display='none';
  const ul = document.getElementById('list');
  for(const t of sorted){
    const li = document.createElement('li');
    const sign = t.tipo==='Entrada' ? '+' : '-';
    const cls = t.tipo==='Entrada' ? 'pos' : 'neg';
    li.innerHTML = `<div><div class="desc">${escapeHtml(t.descricao||'')}</div>
      <div class="meta">${escapeHtml(t.categoria||'—')}${t.data? ' · '+t.data:''}${t.forma? ' · '+escapeHtml(t.forma):''}
      <span class="tag ${t.pago==='Não'?'nao':''}">${t.pago==='Não'?'Não pago':'Pago'}</span></div></div>
      <div style="display:flex;align-items:center;gap:6px;">
      <div class="val ${cls}">${sign} ${fmt(Math.abs(Number(t.valor)||0))}</div>
      <div class="icons"><button class="iconbtn edit" data-id="${escapeHtml(t.id)}" aria-label="Editar lançamento">✎</button><button class="iconbtn del" data-id="${escapeHtml(t.id)}" aria-label="Excluir lançamento">✕</button></div></div>`;
    ul.appendChild(li);
  }
  ul.querySelectorAll('.del').forEach(b=> b.addEventListener('click', ()=>{
    pendingDeleteId=b.dataset.id; deleteModal.showModal();
  }));
  ul.querySelectorAll('.edit').forEach(b=> b.addEventListener('click', ()=> startEdit(b.dataset.id)));
  renderCatChart(list);
  renderBudgetChart();
  renderGeral();
  renderEvolution();
  updateBackupChip();
  updateQuickSummary();
}

function startEdit(id){
  const t = transactions.find(x=>x.id===id); if(!t) return;
  editingId = id;
  document.getElementById('data').value = t.data||'';
  tipo.value = t.tipo; categoria.value = t.categoria; desc.value = t.descricao;
  valor.value = t.valor; forma.value = t.forma; pago.value = t.pago;
  btnSubmit.textContent = 'Salvar edição'; btnCancelEdit.style.display='block';
  modalTitle.textContent='Editar lançamento'; transactionModal.showModal();
  document.querySelector('[data-tab="lanc"]').click();
}
btnCancelEdit.addEventListener('click', ()=>{
  editingId = null; document.getElementById('form').reset();
  btnSubmit.textContent = 'Adicionar lançamento'; btnCancelEdit.style.display='none';
  modalTitle.textContent='Novo lançamento'; transactionModal.close();
});

async function addTransaction(t){
  t.id = 'tx_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
  transactions.push(t); render();
  saveLocalState();
}
async function updateTransaction(id, t){
  const idx = transactions.findIndex(x=>x.id===id); if(idx<0) return;
  t.id = id; transactions[idx] = t; render();
  saveLocalState();
}
async function removeTransaction(id){
  transactions = transactions.filter(t=>t.id!==id); render();
  saveLocalState();
}

document.getElementById('form').addEventListener('submit', (e)=>{
  e.preventDefault();
  const d = desc.value.trim(); const v = parseFloat(valor.value);
  if(!d || isNaN(v)) return;
  const payload = { descricao:d, valor:v, tipo:tipo.value, categoria:categoria.value, forma:forma.value,
    pago:pago.value, data: document.getElementById('data').value || todayISO() };
  if(editingId){ updateTransaction(editingId, payload); editingId=null; btnSubmit.textContent='Adicionar lançamento'; btnCancelEdit.style.display='none'; showToast('Lançamento atualizado ✓'); }
  else { addTransaction(payload); showToast('Lançamento salvo ✓'); }
  e.target.reset(); tipo.value='Entrada'; pago.value='Sim';
  modalTitle.textContent='Novo lançamento'; transactionModal.close();
});

btnImport.addEventListener('click', ()=> fileInput.click());
fileInput.addEventListener('change', async (e)=>{
  const file = e.target.files[0]; if(!file) return;
  try{
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, {type:'array', cellDates:true});
    const sheetName = wb.SheetNames.find(n => normalizeImportText(n).includes('lancamento')) || wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {defval:''});
    pendingImport = [];
    for(const row of rows){
      const keys = Object.keys(row).reduce((acc,k)=>{acc[normalizeImportText(k)]=row[k];return acc;},{});
      const descricao = keys.descricao || keys.descricao_do_lancamento || '';
      const valorRaw = keys.valor ?? keys.valores ?? '';
      const parsedValue = parseImportNumber(valorRaw);
      if(!descricao || !Number.isFinite(parsedValue)) continue;
      const tipoRaw = normalizeImportText(keys.tipo);
      const tipoImportado = tipoRaw === 'saida' || tipoRaw === 'debito' ? 'Saída' : tipoRaw === 'entrada' ? 'Entrada' : (parsedValue<0 ? 'Saída' : 'Entrada');
      const categoria = String(keys.categoria || 'Outros').trim() || 'Outros';
      const forma = String(keys.forma_de_pagamento || keys.forma || 'Outro').trim() || 'Outro';
      const pagoRaw = normalizeImportText(keys.pago || keys.pago_sim_nao || 'sim');
      pendingImport.push({ descricao:String(descricao).trim(), valor:Math.abs(parsedValue), tipo:tipoImportado, categoria,
        forma, pago:pagoRaw.startsWith('n') ? 'Não' : 'Sim', data:parseImportDate(keys.data) });
    }
    importSummary.textContent = `${pendingImport.length} lançamento(s) válido(s) encontrado(s). Revise antes de salvar.`;
    importPreview.innerHTML = pendingImport.length ? `<table class="previewTable"><thead><tr><th>Data</th><th>Descrição</th><th>Tipo</th><th>Valor</th></tr></thead><tbody>${pendingImport.slice(0,20).map(item=>`<tr><td>${escapeHtml(item.data||'—')}</td><td>${escapeHtml(item.descricao)}</td><td>${escapeHtml(item.tipo)}</td><td>${fmt(item.valor)}</td></tr>`).join('')}</tbody></table>${pendingImport.length>20?'<div class="hint">Mostrando os 20 primeiros itens.</div>':''}` : '<div class="empty">Nenhum lançamento válido encontrado.</div>';
    btnConfirmImport.disabled = pendingImport.length===0;
    importModal.showModal();
  }catch(err){ console.error(err); showToast('Não foi possível importar a planilha'); }
  e.target.value = '';
});
btnConfirmImport.addEventListener('click', async ()=>{
  const items = pendingImport; pendingImport=[];
  for(const item of items) await addTransaction(item);
  importModal.close();
  showToast(items.length ? `${items.length} lançamento(s) importado(s) ✓` : 'Nenhum lançamento importado');
});

btnExport.addEventListener('click', ()=>{
  const sorted = [...transactions].sort((a,b)=> (a.data||'').localeCompare(b.data||''));
  const data = sorted.map(t=>({Data:t.data||'', Tipo:t.tipo||'', Categoria:t.categoria||'', Descrição:t.descricao||'',
    Valor:Number(t.valor)||0, 'Forma de pagamento':t.forma||'', 'Pago?':t.pago||''}));
  const ws = XLSX.utils.json_to_sheet(data);
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

function downloadFile(filename, content, type){
  const blob = new Blob([content], {type});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  URL.revokeObjectURL(url);
}
btnBackupJson.addEventListener('click', doBackup);
btnBackupChip.addEventListener('click', doBackup);
btnRestoreJson.addEventListener('click', ()=>jsonInput.click());
btnClearData.addEventListener('click', ()=>clearModal.showModal());
jsonInput.addEventListener('change', async e=>{
  const file = e.target.files[0]; if(!file) return;
  try{
    const backup = JSON.parse(await file.text());
    if(!backup || !Array.isArray(backup.transactions) || !backup.config) throw new Error('Formato inválido');
    pendingRestore = backup;
    restoreSummary.textContent = `${backup.transactions.length} lançamento(s) e configurações da reserva encontrados no backup.`;
    restoreModal.showModal();
  }catch(err){ showToast('Backup JSON inválido'); }
  e.target.value = '';
});

(async ()=>{
  try{
    loadLocalState();
    // abre no mês atual; só usa o primeiro mês de uso se ele ainda estiver no futuro
    selectedMonth = (firstUseMonthValue && firstUseMonthValue > curMonth()) ? firstUseMonthValue : curMonth();
    controlMes.value = selectedMonth;
    saveLocalState();
    applyPrivacy(localStorage.getItem(PRIVACY_KEY)==='1');
    // pede ao navegador para não apagar os dados do site por falta de espaço (iOS/Android)
    if(navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(()=>{});
  }catch(e){ console.error('init failed', e); }
  fillCfgForm(); render();
  // Atalhos de URL para apresentação: ?demo carrega os dados de exemplo; &tab=lanc|plan abre a aba.
  const params = new URLSearchParams(location.search);
  maybeShowIosHint(params.has('ios'));
  if(params.has('privacidade')) applyPrivacy(true);
  if(params.has('demo') && !transactions.length) loadSampleData();
  const tabParam = params.get('tab');
  if(['geral','lanc','plan'].includes(tabParam)) document.querySelector(`[data-tab="${tabParam}"]`).click();
})();
