/* ============================================================
   FINANCEIRO
   Duas telas: a planilha de clientes (igual à que o time já usa)
   e o dashboard com os números do mês.
   Falam com /api/financeiro, que tem a mesma porta do painel.
   ============================================================ */

let FIN_CLIENTES = [];

/* ============================================================
   COMPETÊNCIA (mês/ano)
   Um estado só, usado pela tela de Cobranças E pelo Dashboard —
   é isso que impede um mostrar agosto enquanto o outro calcula
   setembro. Começa no mês atual e o servidor confirma qual é.
   ============================================================ */
const FIN_MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

let FIN_COMP = null;              // {mes, ano} — null = "use o mês atual"
let FIN_COMPS = [];               // as competências que existem no banco
let FIN_COMP_ATUAL = null;        // qual é o mês corrente, segundo o servidor

function finCompParams() {
  return FIN_COMP ? { mes: FIN_COMP.mes, ano: FIN_COMP.ano } : {};
}

// Guarda o que o servidor devolveu sobre competências.
function finGuardaComp(d) {
  if (d.competencia) FIN_COMP = { mes: d.competencia.mes, ano: d.competencia.ano };
  if (d.competencia_atual) FIN_COMP_ATUAL = d.competencia_atual;
  if (Array.isArray(d.competencias)) FIN_COMPS = d.competencias;
}

// Os anos que o seletor oferece: os que existem no banco, mais o ano
// corrente e o seguinte. Nada travado em 2026.
function finAnosDisponiveis() {
  const anos = {};
  FIN_COMPS.forEach(function (c) { anos[c.ano] = true; });
  const base = (FIN_COMP_ATUAL && FIN_COMP_ATUAL.ano) || new Date().getFullYear();
  anos[base] = true;
  anos[base + 1] = true;
  if (FIN_COMP) anos[FIN_COMP.ano] = true;
  return Object.keys(anos).map(Number).sort(function (a, b) { return b - a; });
}

// O seletor em si. `onde` é só um prefixo de id, para a mesma peça
// poder aparecer nas duas telas sem os ids colidirem.
function finSeletorComp(onde) {
  const c = FIN_COMP || FIN_COMP_ATUAL || { mes: new Date().getMonth() + 1, ano: new Date().getFullYear() };
  const ehAtual = FIN_COMP_ATUAL && c.mes === FIN_COMP_ATUAL.mes && c.ano === FIN_COMP_ATUAL.ano;
  return '<div class="fin-comp">' +
    '<svg width="15" height="15" viewBox="0 0 24 24" style="fill:none;stroke:currentColor;stroke-width:1.9;' +
      'stroke-linecap:round;flex:none;opacity:.7"><rect x="3.5" y="5" width="17" height="15" rx="2.2"/>' +
      '<path d="M3.5 9.6h17M8 3.4v3M16 3.4v3"/></svg>' +
    '<select id="' + onde + '-mes">' +
      FIN_MESES.map(function (nome, i) {
        return '<option value="' + (i + 1) + '"' + (c.mes === i + 1 ? ' selected' : '') + '>' + nome + '</option>';
      }).join('') +
    '</select>' +
    '<span class="barra">/</span>' +
    '<select id="' + onde + '-ano">' +
      finAnosDisponiveis().map(function (a) {
        return '<option value="' + a + '"' + (c.ano === a ? ' selected' : '') + '>' + a + '</option>';
      }).join('') +
    '</select>' +
    (ehAtual ? '<span class="agora">mês atual</span>'
      : '<button type="button" class="voltar" id="' + onde + '-hoje">ir para o mês atual</button>') +
  '</div>';
}

// Liga o seletor: trocou mês ou ano, recarrega a tela que o chamou.
function finLigaSeletor(onde, recarrega) {
  function troca() {
    const mes = Number((document.getElementById(onde + '-mes') || {}).value);
    const ano = Number((document.getElementById(onde + '-ano') || {}).value);
    if (mes && ano) FIN_COMP = { mes: mes, ano: ano };
    recarrega();
  }
  const m = document.getElementById(onde + '-mes');
  const a = document.getElementById(onde + '-ano');
  if (m) m.addEventListener('change', troca);
  if (a) a.addEventListener('change', troca);
  const hoje = document.getElementById(onde + '-hoje');
  if (hoje) hoje.addEventListener('click', function () {
    FIN_COMP = FIN_COMP_ATUAL ? { mes: FIN_COMP_ATUAL.mes, ano: FIN_COMP_ATUAL.ano } : null;
    recarrega();
  });
}

async function apiFin(action, opts) {
  opts = opts || {};
  const qs = new URLSearchParams(Object.assign({ action: action }, opts.params || {}));
  const res = await fetch('/api/financeiro?' + qs.toString(), {
    method: opts.body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json().catch(function () { return { ok: false, error: 'resposta invalida' }; });
  if (res.status === 401) { sair(); throw new Error('sessao expirada'); }
  if (!data.ok) throw new Error(data.error || 'erro');
  return data;
}

function finDinheiro(v) {
  return 'R$ ' + Number(v || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
}

/* ============================================================
   TELA 1 — a planilha
   ============================================================ */
async function carregaFinanceiro() {
  const alvo = document.getElementById('painel-financeiro');
  alvo.innerHTML = '<div class="spinner"></div>';
  try {
    const d = await apiFin('fin_lista', { params: finCompParams() });
    finGuardaComp(d);
    FIN_CLIENTES = d.clientes || [];
    if ((d.viradas || []).length) {
      toast('Competência ' + d.viradas.join(', ') + ' criada a partir do mês anterior');
    }
    desenhaFinanceiro();
  } catch (e) {
    alvo.innerHTML = '<div class="alert alert-erro">' + esc(e.message) + '</div>';
  }
}

/* ============================================================
   AS CONTAS DA TELA DE COBRANÇAS
   Funções puras, de propósito: os indicadores nascem das MESMAS
   linhas da tabela — nada de número paralelo — e dá para testar
   a matemática das datas sem abrir tela nenhuma.
   ============================================================ */

// Inadimplente = o vencimento desta cobrança já passou e não há
// pagamento confirmado. Vale o que o time marcou (inadimplente) e
// também o "aguardando" com a data estourada.
function finEhInadimplente(c, hoje) {
  if (!c.ativo || c.status === 'pago') return false;
  if (c.status === 'inadimplente') return true;
  const ultimo = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
  const venc = new Date(hoje.getFullYear(), hoje.getMonth(), Math.min(Number(c.vencimento_dia) || 1, ultimo));
  const hoje0 = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  return venc < hoje0;
}

// A PRÓXIMA semana do calendário: de segunda a domingo, a que vem.
// Não é "os próximos 7 dias" — se hoje é quarta, começa na segunda
// que vem e termina no domingo seguinte.
function finJanelaProximaSemana(hoje) {
  const dia = hoje.getDay();                       // 0=domingo … 6=sábado
  const ateSegunda = dia === 0 ? 1 : (8 - dia);    // quantos dias até a próxima segunda
  const de = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + ateSegunda);
  const ate = new Date(de.getFullYear(), de.getMonth(), de.getDate() + 6, 23, 59, 59);
  return { de: de, ate: ate };
}

// O dia de vencimento (ex.: "todo dia 30") cai dentro da janela?
// Mês curto encosta no último dia, como a cobrança faz na vida real.
function finVenceNaJanela(diaVenc, janela) {
  const d = Math.min(Math.max(Number(diaVenc) || 1, 1), 31);
  let ano = janela.de.getFullYear(), mes = janela.de.getMonth();
  for (let volta = 0; volta < 2; volta++) {
    const ultimo = new Date(ano, mes + 1, 0).getDate();
    const cand = new Date(ano, mes, Math.min(d, ultimo), 12);
    if (cand >= janela.de && cand <= janela.ate) return true;
    mes++;
    if (mes > 11) { mes = 0; ano++; }
  }
  return false;
}

/* Qual é o "hoje" da competência que estou olhando?
   No mês corrente, é hoje mesmo. Num mês já fechado, é o último dia
   daquele mês — em agosto fechado, tudo que não foi pago venceu. Num
   mês futuro, é a véspera: nada venceu ainda. */
function finHojeDaCompetencia() {
  const agora = new Date();
  const c = FIN_COMP || FIN_COMP_ATUAL;
  if (!c) return agora;
  const at = FIN_COMP_ATUAL || { mes: agora.getMonth() + 1, ano: agora.getFullYear() };
  const ord = function (x) { return x.ano * 12 + x.mes; };
  if (ord(c) === ord(at)) return agora;
  if (ord(c) < ord(at)) return new Date(c.ano, c.mes, 0, 23, 59, 59);   // último dia do mês
  return new Date(c.ano, c.mes - 1, 1, 0, 0, 0);                        // 1º dia do mês futuro
}

function finIndicadores(linhas, hoje) {
  const abertas = linhas.filter(function (c) { return c.ativo && c.status !== 'pago'; });
  const janela = finJanelaProximaSemana(hoje);
  let aReceber = 0, semana = 0, inad = 0;
  abertas.forEach(function (c) {
    const cent = Math.round(Number(c.valor || 0) * 100);
    aReceber += cent;
    if (finVenceNaJanela(c.vencimento_dia, janela)) semana += cent;
    if (finEhInadimplente(c, hoje)) inad++;
  });
  function diaMes(d) {
    return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
  }
  return {
    a_receber: aReceber / 100,
    a_receber_qtd: abertas.length,
    proxima_semana: semana / 100,
    semana_de: diaMes(janela.de),
    semana_ate: diaMes(janela.ate),
    inadimplentes: inad
  };
}

/* O filtro da tabela. '' = todas; 'inadimplentes' = só quem venceu. */
let FIN_FILTRO = '';

function desenhaFinanceiro() {
  const linhas = FIN_CLIENTES;
  const hoje = finHojeDaCompetencia();
  const ind = finIndicadores(linhas, hoje);
  const compAtual = FIN_COMP_ATUAL &&
    FIN_COMP && FIN_COMP.mes === FIN_COMP_ATUAL.mes && FIN_COMP.ano === FIN_COMP_ATUAL.ano;

  // a MESMA regra do indicador decide quem fica na tabela filtrada
  const visiveis = FIN_FILTRO === 'inadimplentes'
    ? linhas.filter(function (c) { return finEhInadimplente(c, hoje); })
    : linhas;

  document.getElementById('painel-financeiro').innerHTML =
    '<div class="row row-wrap" style="justify-content:space-between;align-items:center;margin-bottom:16px;gap:12px">' +
      finSeletorComp('fc') +
      '<div class="row row-wrap" style="gap:10px">' +
        '<button class="btn btn-sm btn-ghost" id="fin-baixar">Baixar relatório</button>' +
        '<button class="btn btn-sm btn-ghost" id="fin-importar">Importar clientes</button>' +
        '<button class="btn btn-sm" id="fin-novo">Novo cliente</button>' +
      '</div>' +
    '</div>' +
    '<div class="small muted" style="margin:-6px 0 14px">' + linhas.length + ' cobrança(s) nesta competência' +
      (compAtual ? '' : ' · mês já fechado, o histórico fica como está') + '</div>' +

    /* ---- os indicadores, nascidos das mesmas linhas da tabela ---- */
    '<div class="fd2-grade" style="margin-bottom:16px">' +
      '<div class="fd2-carta">' +
        '<div class="fd2-tit">Valor total a receber</div>' +
        '<div class="fd2-val" style="color:#157347">' + finDinheiro(ind.a_receber) + '</div>' +
        '<div class="fd2-sub">' + ind.a_receber_qtd + ' cobrança(s) em aberto</div>' +
        '<div class="fd2-barra" style="background:#1fbf6e"></div>' +
      '</div>' +
      '<div class="fd2-carta">' +
        '<div class="fd2-tit">Previsão próxima semana</div>' +
        '<div class="fd2-val" style="color:#26418f">' +
          (compAtual ? finDinheiro(ind.proxima_semana) : '<span style="color:var(--label-3)">—</span>') + '</div>' +
        '<div class="fd2-sub">' + (compAtual
          ? 'vencimentos de ' + esc(ind.semana_de) + ' a ' + esc(ind.semana_ate)
          : 'só no mês corrente') + '</div>' +
        '<div class="fd2-barra" style="background:' + (compAtual ? '#6f8bf0' : 'var(--fio)') + '"></div>' +
      '</div>' +
      '<button type="button" class="fd2-carta fd2-clique' +
        (FIN_FILTRO === 'inadimplentes' ? ' on' : '') + '" id="fin-card-inad">' +
        '<div class="fd2-tit">Inadimplentes</div>' +
        '<div class="fd2-val" style="color:#b02a20">' + ind.inadimplentes +
          ' <span style="font-size:15px;font-weight:600">cliente' + (ind.inadimplentes === 1 ? '' : 's') + '</span></div>' +
        '<div class="fd2-sub">' + (FIN_FILTRO === 'inadimplentes'
          ? 'filtrando a tabela — clique para ver todas'
          : 'clique para filtrar a tabela') + '</div>' +
        '<div class="fd2-barra" style="background:#d9453a"></div>' +
      '</button>' +
    '</div>' +

    (FIN_FILTRO === 'inadimplentes'
      ? '<div class="row" style="margin-bottom:12px"><span class="fin-chip">Mostrando só os inadimplentes' +
        '<button type="button" id="fin-limpa-filtro" title="ver todas">✕ ver todas</button></span></div>'
      : '') +

    '<div class="fin-quadro">' +
      '<div class="fin-topo">' +
        '<div class="fin-marca"><img src="/favicon-32.png" alt="">' +
          '<span><b>StartDigital</b><small>Assessoria de Marketing</small></span></div>' +
        '<div class="fin-titulo">FINANCEIRO START DIGITAL</div>' +
      '</div>' +
      '<div style="overflow-x:auto">' +
      '<table class="fin-tab"><thead><tr>' +
        '<th>Cliente</th><th>Valor</th><th>Vencimento</th><th>Status</th>' +
        '<th>Responsável</th><th>Observação</th><th></th>' +
      '</tr></thead><tbody>' +
      (visiveis.length ? visiveis.map(finLinha).join('')
        : '<tr><td colspan="7" style="padding:26px">' +
          (FIN_FILTRO ? 'Nenhum inadimplente. 🎉' : 'Nenhuma cobrança cadastrada ainda.') + '</td></tr>') +
      '</tbody></table>' +
      '</div>' +
    '</div>';

  finLigaSeletor('fc', carregaFinanceiro);
  document.getElementById('fin-novo').addEventListener('click', function () { abreFinCliente(null); });
  document.getElementById('fin-baixar').addEventListener('click', baixaRelatorioFin);
  document.getElementById('fin-importar').addEventListener('click', abreImportacao);
  document.querySelectorAll('.fin-editar').forEach(function (b) {
    b.addEventListener('click', function () { abreFinCliente(b.dataset.id); });
  });

  // o cartão liga e desliga o filtro — sem recarregar nada
  document.getElementById('fin-card-inad').addEventListener('click', function () {
    FIN_FILTRO = FIN_FILTRO === 'inadimplentes' ? '' : 'inadimplentes';
    desenhaFinanceiro();
  });
  const limpa = document.getElementById('fin-limpa-filtro');
  if (limpa) limpa.addEventListener('click', function () {
    FIN_FILTRO = '';
    desenhaFinanceiro();
  });
}

function finLinha(r) {
  return '<tr>' +
    '<td class="fin-nome' + (r.destaque ? ' on' : '') + '">' + esc(r.cliente) + '</td>' +
    '<td class="fin-val">' + finDinheiro(r.valor) + '</td>' +
    '<td>' + String(r.vencimento_dia).padStart(2, '0') + '/mês</td>' +
    '<td><span class="fin-st ' + esc(r.status) + '">' + esc(r.status_nome) + '</span></td>' +
    '<td class="fin-resp">' + esc(r.responsavel || '') +
      (r.telefone ? ' <span class="muted">' + esc(r.telefone) + '</span>' : '') + '</td>' +
    '<td class="fin-obs">' + esc(r.observacao || '') + '</td>' +
    '<td><button class="fin-editar" data-id="' + esc(r.id) + '">editar</button></td>' +
  '</tr>';
}

/* ---------------------------------------------- a gaveta de edição */
function abreFinCliente(id) {
  const novo = !id;
  const d = novo ? { status: 'aguardando', vencimento_dia: 10 }
    : (FIN_CLIENTES.filter(function (x) { return x.id === id; })[0] || {});

  document.getElementById('g-nome').textContent = novo ? 'Novo cliente' : (d.cliente || 'Cliente');
  document.getElementById('g-sub').textContent = novo
    ? 'Entra na planilha e já conta no dashboard.'
    : 'Alterou aqui, o dashboard muda junto.';

  const campo = function (id2, rot, valor, dica, tipo) {
    return '<div class="field"><label for="' + id2 + '">' + rot + '</label>' +
      (dica ? '<span class="hint">' + dica + '</span>' : '') +
      '<input id="' + id2 + '" type="' + (tipo || 'text') + '" value="' + esc(valor == null ? '' : valor) + '"></div>';
  };

  document.getElementById('g-corpo').innerHTML =
    campo('fc-cliente', 'Nome do cliente', d.cliente, 'Como aparece na planilha.') +
    '<div class="row row-wrap" style="gap:14px">' +
      '<div style="flex:1;min-width:150px">' + campo('fc-valor', 'Mensalidade', d.valor, 'Só o número. Ex.: 2500') + '</div>' +
      '<div style="flex:1;min-width:150px">' + campo('fc-setup', 'Setup', d.setup, 'Deixe 0 se não tem.') + '</div>' +
      '<div style="flex:1;min-width:150px">' + campo('fc-hosp', 'Hospedagem', d.hospedagem, 'Valor mensal.') + '</div>' +
    '</div>' +
    '<div class="row row-wrap" style="gap:14px">' +
      '<div style="flex:1;min-width:150px">' + campo('fc-dia', 'Dia do vencimento', d.vencimento_dia, 'De 1 a 31.', 'number') + '</div>' +
      '<div style="flex:1;min-width:180px"><div class="field"><label for="fc-status">Status</label>' +
        '<span class="hint">É isto que o dashboard soma.</span>' +
        '<select id="fc-status">' +
          ['pago', 'aguardando', 'inadimplente'].map(function (s) {
            const nome = { pago: 'Pago', aguardando: 'Aguardando', inadimplente: 'Inadimplente' }[s];
            return '<option value="' + s + '"' + (d.status === s ? ' selected' : '') + '>' + nome + '</option>';
          }).join('') +
        '</select></div></div>' +
    '</div>' +
    '<div class="row row-wrap" style="gap:14px">' +
      '<div style="flex:1;min-width:180px">' + campo('fc-resp', 'Responsável', d.responsavel, 'Quem fala com a gente.') + '</div>' +
      '<div style="flex:1;min-width:180px">' + campo('fc-fone', 'Telefone', d.telefone, '') + '</div>' +
    '</div>' +
    campo('fc-obs', 'Observação', d.observacao, 'Aparece na última coluna.') +

    '<label class="cp-item cp-chave' + (d.destaque ? ' on' : '') + '" id="fc-dest-cx" style="margin-top:14px">' +
      '<input type="checkbox" id="fc-destaque"' + (d.destaque ? ' checked' : '') + '>' +
      '<span><strong>Pintar o nome na planilha</strong>' +
      '<em>Para os clientes que você quer achar de longe.</em></span>' +
    '</label>' +

    '<div class="row row-wrap" style="gap:18px;align-items:center;margin-top:14px">' +
      '<label class="row small" style="gap:7px;align-items:center"><input type="checkbox" id="fc-ativo" ' +
      (d.ativo !== false ? 'checked' : '') + ' style="width:16px;height:16px"> contrato ativo</label>' +
    '</div>' +

    '<div class="row" style="gap:12px;margin-top:20px">' +
      '<button class="btn" id="fc-salvar">' + (novo ? 'Adicionar' : 'Salvar') + '</button>' +
      (novo ? '' : '<button class="btn btn-ghost" id="fc-excluir" style="color:var(--red)">Excluir</button>') +
    '</div>' +
    '<div id="fc-saida"></div>';

  document.getElementById('fundo').style.display = 'block';
  document.getElementById('gaveta').style.display = 'flex';

  const cxDest = document.getElementById('fc-destaque');
  cxDest.addEventListener('change', function () {
    document.getElementById('fc-dest-cx').classList.toggle('on', cxDest.checked);
  });

  const val = function (i) { return (document.getElementById(i) || {}).value || ''; };

  document.getElementById('fc-salvar').addEventListener('click', async function () {
    const corpo = {
      cliente: val('fc-cliente'), valor: val('fc-valor'), setup: val('fc-setup'),
      hospedagem: val('fc-hosp'), vencimento_dia: val('fc-dia'), status: val('fc-status'),
      responsavel: val('fc-resp'), telefone: val('fc-fone'), observacao: val('fc-obs'),
      destaque: cxDest.checked,
      ativo: document.getElementById('fc-ativo').checked
    };
    if (!novo) corpo.id = d.id;
    if (!corpo.cliente.trim()) return toast('Escreva o nome do cliente', true);

    this.disabled = true;
    this.innerHTML = '<span class="spinner"></span> Salvando…';
    try {
      await apiFin('fin_salvar', { body: Object.assign(corpo, novo ? finCompParams() : {}) });
      toast(novo ? 'Cliente adicionado' : 'Cliente salvo');
      fechaGaveta();
      carregaFinanceiro();
    } catch (e) {
      document.getElementById('fc-saida').innerHTML =
        '<div class="alert alert-erro" style="margin-top:14px">' + esc(e.message) + '</div>';
      this.disabled = false;
      this.textContent = novo ? 'Adicionar' : 'Salvar';
    }
  });

  const btnEx = document.getElementById('fc-excluir');
  if (btnEx) {
    btnEx.addEventListener('click', async function () {
      if (!confirm('Tirar ' + (d.cliente || 'este cliente') + ' da planilha?')) return;
      try {
        await apiFin('fin_excluir', { body: { id: d.id } });
        toast('Cliente removido');
        fechaGaveta();
        carregaFinanceiro();
      } catch (e) { toast(e.message, true); }
    });
  }
}

/* ============================================================
   IMPORTAÇÃO DE CLIENTES (CSV, XLS e XLSX)
   A leitura acontece aqui na tela: o arquivo vira uma tabela, você
   confere a prévia e diz qual coluna é o quê. Só então as linhas vão
   para o servidor, que valida de novo e barra duplicados.
   ============================================================ */

// Os campos que a planilha pode preencher. "cliente" é o único
// obrigatório; o resto entra se existir no arquivo.
const IMP_CAMPOS = [
  { chave: 'cliente', rotulo: 'Cliente (nome)', pistas: ['cliente', 'nome', 'empresa', 'razao'] },
  { chave: 'valor', rotulo: 'Mensalidade', pistas: ['valor', 'mensal', 'fee'] },
  { chave: 'setup', rotulo: 'Setup', pistas: ['setup'] },
  { chave: 'hospedagem', rotulo: 'Hospedagem', pistas: ['hosped', 'hosting'] },
  { chave: 'vencimento_dia', rotulo: 'Dia do vencimento', pistas: ['venc', 'dia'] },
  { chave: 'status', rotulo: 'Status', pistas: ['status', 'situa', 'pagament'] },
  { chave: 'responsavel', rotulo: 'Responsável', pistas: ['respons', 'contato'] },
  { chave: 'telefone', rotulo: 'Telefone', pistas: ['telefone', 'fone', 'celular', 'whats'] },
  { chave: 'observacao', rotulo: 'Observação', pistas: ['obs', 'nota', 'coment'] }
];

// CSV lido na mão: descobre o separador (; , ou tab), respeita aspas
// e ignora o BOM que o Excel poe na frente.
function leCsv(texto) {
  texto = String(texto || '').replace(/^﻿/, '');
  const primeira = (texto.split(/\r?\n/)[0] || '');
  let sep = ';';
  let melhor = -1;
  [';', ',', '\t'].forEach(function (s) {
    const n = primeira.split(s).length - 1;
    if (n > melhor) { melhor = n; sep = s; }
  });

  const linhas = [];
  let linha = [], celula = '', aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (aspas) {
      if (ch === '"' && texto[i + 1] === '"') { celula += '"'; i++; }
      else if (ch === '"') aspas = false;
      else celula += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === sep) { linha.push(celula); celula = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && texto[i + 1] === '\n') i++;
      linha.push(celula); celula = '';
      if (linha.some(function (c) { return String(c).trim() !== ''; })) linhas.push(linha);
      linha = [];
    } else celula += ch;
  }
  linha.push(celula);
  if (linha.some(function (c) { return String(c).trim() !== ''; })) linhas.push(linha);
  return linhas;
}

// XLS/XLSX precisam de um leitor de verdade (SheetJS). Ele só é
// baixado NA HORA em que alguém importa um .xls — o painel continua
// leve no dia a dia. Se o carregamento falhar, o CSV segue vivo.
let IMP_XLSX_PRONTO = null;
function carregaLeitorXlsx() {
  if (window.XLSX) return Promise.resolve(true);
  if (IMP_XLSX_PRONTO) return IMP_XLSX_PRONTO;
  IMP_XLSX_PRONTO = new Promise(function (ok, falhou) {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = function () { ok(true); };
    s.onerror = function () {
      IMP_XLSX_PRONTO = null;
      falhou(new Error('Não consegui baixar o leitor de planilhas. Salve o arquivo como CSV e tente de novo.'));
    };
    document.head.appendChild(s);
  });
  return IMP_XLSX_PRONTO;
}

function leArquivoImportacao(arq) {
  const nome = String(arq.name || '').toLowerCase();
  if (/\.csv$/.test(nome)) {
    return arq.text().then(leCsv);
  }
  if (/\.(xls|xlsx)$/.test(nome)) {
    return carregaLeitorXlsx().then(function () {
      return arq.arrayBuffer();
    }).then(function (buf) {
      const wb = window.XLSX.read(buf, { type: 'array' });
      const aba = wb.Sheets[wb.SheetNames[0]];
      return window.XLSX.utils.sheet_to_json(aba, { header: 1, raw: false, defval: '' });
    });
  }
  return Promise.reject(new Error('Use um arquivo .csv, .xls ou .xlsx.'));
}

// tenta adivinhar qual coluna do arquivo é cada campo, pelos títulos
function adivinhaColunas(cabecalho) {
  const palpite = {};
  const usadas = {};
  IMP_CAMPOS.forEach(function (c) {
    for (let i = 0; i < cabecalho.length; i++) {
      if (usadas[i]) continue;
      const t = String(cabecalho[i] || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      if (c.pistas.some(function (p) { return t.indexOf(p) >= 0; })) {
        palpite[c.chave] = i;
        usadas[i] = true;
        break;
      }
    }
  });
  return palpite;
}

let IMP_TABELA = null;

function abreImportacao() {
  IMP_TABELA = null;
  document.getElementById('g-nome').textContent = 'Importar clientes';
  document.getElementById('g-sub').textContent = 'CSV, XLS ou XLSX — você confere tudo antes de entrar.';
  document.getElementById('g-corpo').innerHTML =
    '<div class="anexo-aviso" id="imp-area" style="display:flex;gap:12px;align-items:center;' +
      'padding:16px;border:1.5px dashed var(--fio);border-radius:12px;cursor:pointer">' +
      '<svg width="22" height="22" viewBox="0 0 24 24" style="fill:none;stroke:var(--label-3);' +
        'stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;flex:none">' +
        '<path d="M12 16.5V4.8M7.8 9l4.2-4.2L16.2 9"/>' +
        '<path d="M4.5 15v2.7a1.8 1.8 0 0 0 1.8 1.8h11.4a1.8 1.8 0 0 0 1.8-1.8V15"/></svg>' +
      '<span style="flex:1"><b id="imp-nome" style="display:block;font-size:14px">Escolher arquivo</b>' +
      '<span class="small muted">A primeira linha deve ser o título das colunas</span></span>' +
      '<input type="file" id="imp-arquivo" accept=".csv,.xls,.xlsx" style="display:none">' +
    '</div>' +
    '<div id="imp-passo2"></div>' +
    '<div id="imp-saida"></div>';

  document.getElementById('fundo').style.display = 'block';
  document.getElementById('gaveta').style.display = 'flex';

  const area = document.getElementById('imp-area');
  const input = document.getElementById('imp-arquivo');
  area.addEventListener('click', function () { input.click(); });
  input.addEventListener('change', async function () {
    const arq = (this.files || [])[0];
    if (!arq) return;
    document.getElementById('imp-nome').textContent = arq.name;
    document.getElementById('imp-saida').innerHTML = '';
    document.getElementById('imp-passo2').innerHTML =
      '<div class="small muted" style="margin-top:14px"><span class="spinner"></span> Lendo o arquivo…</div>';
    try {
      const tabela = await leArquivoImportacao(arq);
      if (!tabela || tabela.length < 2) {
        throw new Error('O arquivo precisa ter a linha de títulos e pelo menos um cliente.');
      }
      IMP_TABELA = tabela;
      desenhaPreviaImportacao();
    } catch (e) {
      document.getElementById('imp-passo2').innerHTML = '';
      document.getElementById('imp-saida').innerHTML =
        '<div class="alert alert-erro" style="margin-top:14px">' + esc(e.message) + '</div>';
    }
  });
}

function desenhaPreviaImportacao() {
  const cab = IMP_TABELA[0].map(function (c) { return String(c || '').trim(); });
  const corpo = IMP_TABELA.slice(1);
  const palpite = adivinhaColunas(cab);

  document.getElementById('imp-passo2').innerHTML =
    '<h3 style="font-size:14px;margin:18px 0 4px">O que é cada coluna</h3>' +
    '<p class="small muted" style="margin:0 0 12px">Confira o palpite do sistema. Só o ' +
    '<strong>nome do cliente</strong> é obrigatório — o resto entra se existir.</p>' +
    '<div class="row row-wrap" style="gap:10px">' +
      IMP_CAMPOS.map(function (c) {
        return '<div class="field" style="margin:0;min-width:170px;flex:1">' +
          '<label>' + esc(c.rotulo) + (c.chave === 'cliente' ? ' *' : '') + '</label>' +
          '<select class="imp-mapa" data-campo="' + c.chave + '">' +
            '<option value="">— não tem —</option>' +
            cab.map(function (t, i) {
              return '<option value="' + i + '"' + (palpite[c.chave] === i ? ' selected' : '') + '>' +
                esc(t || ('coluna ' + (i + 1))) + '</option>';
            }).join('') +
          '</select></div>';
      }).join('') +
    '</div>' +

    '<h3 style="font-size:14px;margin:20px 0 8px">Prévia (' + corpo.length + ' cliente(s) no arquivo)</h3>' +
    '<div style="overflow-x:auto;border:1px solid var(--fio);border-radius:12px">' +
      '<table class="tbl" style="min-width:520px"><thead><tr>' +
        cab.map(function (t) { return '<th style="padding:10px">' + esc(t) + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      corpo.slice(0, 5).map(function (l) {
        return '<tr>' + cab.map(function (_, i) {
          return '<td class="small" style="padding:10px">' + esc(String(l[i] == null ? '' : l[i]).slice(0, 40)) + '</td>';
        }).join('') + '</tr>';
      }).join('') +
      '</tbody></table>' +
    '</div>' +
    (corpo.length > 5 ? '<div class="small muted" style="margin-top:6px">…e mais ' + (corpo.length - 5) + ' linha(s)</div>' : '') +

    '<div class="row" style="gap:12px;margin-top:18px">' +
      '<button class="btn" id="imp-confirmar">Importar ' + corpo.length + ' cliente(s)</button>' +
    '</div>';

  document.getElementById('imp-confirmar').addEventListener('click', async function () {
    const mapa = {};
    document.querySelectorAll('.imp-mapa').forEach(function (s) {
      if (s.value !== '') mapa[s.dataset.campo] = Number(s.value);
    });
    if (mapa.cliente === undefined) return toast('Diga qual coluna é o nome do cliente', true);

    const linhas = corpo.map(function (l, i) {
      const obj = { linha: i + 2 };   // +2: pula o título e conta como no Excel
      IMP_CAMPOS.forEach(function (c) {
        if (mapa[c.chave] !== undefined) obj[c.chave] = String(l[mapa[c.chave]] == null ? '' : l[mapa[c.chave]]).trim();
      });
      return obj;
    }).filter(function (o) {
      return Object.keys(o).some(function (k) { return k !== 'linha' && o[k] !== ''; });
    });

    this.disabled = true;
    this.innerHTML = '<span class="spinner"></span> Importando…';
    try {
      const r = await apiFin('fin_importar', { body: Object.assign({ linhas: linhas }, finCompParams()) });
      document.getElementById('imp-saida').innerHTML =
        '<div class="alert ' + (r.importados ? 'alert-ok' : 'alert-aviso') + '" style="margin-top:16px">' +
          '<strong>' + r.importados + ' cliente(s) importado(s).</strong>' +
          (r.total_pulados ? ' ' + r.total_pulados + ' ficaram de fora — veja o motivo abaixo.' : ' Nenhum ficou de fora.') +
        '</div>' +
        ((r.pulados || []).length
          ? '<div style="overflow-x:auto;margin-top:10px"><table class="tbl"><thead><tr>' +
            '<th>Linha</th><th>Cliente</th><th>Motivo</th></tr></thead><tbody>' +
            r.pulados.map(function (p) {
              return '<tr><td class="small muted">' + p.linha + '</td><td>' + esc(p.nome) + '</td>' +
                '<td class="small muted">' + esc(p.motivo) + '</td></tr>';
            }).join('') + '</tbody></table></div>'
          : '');
      if (r.importados) carregaFinanceiro();
    } catch (e) {
      document.getElementById('imp-saida').innerHTML =
        '<div class="alert alert-erro" style="margin-top:16px">' + esc(e.message) + '</div>';
      this.disabled = false;
      this.textContent = 'Importar ' + corpo.length + ' cliente(s)';
    }
  });
}

/* ============================================================
   OUTROS GASTOS
   De propósito simples: um caderninho de despesas avulsas com o
   total do período em cima. O mesmo filtro do dashboard.
   ============================================================ */
let GASTOS_PERIODO = { tipo: 'mes', de: '', ate: '' };

function gastosPeriodoDatas() {
  const hoje = new Date();
  function iso(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }
  if (GASTOS_PERIODO.tipo === 'hoje') return { de: iso(hoje), ate: iso(hoje) };
  if (GASTOS_PERIODO.tipo === 'ano') return { de: hoje.getFullYear() + '-01-01', ate: hoje.getFullYear() + '-12-31' };
  if (GASTOS_PERIODO.tipo === 'personalizado' && GASTOS_PERIODO.de && GASTOS_PERIODO.ate) {
    return { de: GASTOS_PERIODO.de, ate: GASTOS_PERIODO.ate };
  }
  return {
    de: iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)),
    ate: iso(new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0))
  };
}

async function carregaFinGastos() {
  const alvo = document.getElementById('painel-fingastos');
  alvo.innerHTML = '<div class="spinner"></div>';
  try {
    const p = gastosPeriodoDatas();
    const d = await apiFin('fg_lista', { params: { de: p.de, ate: p.ate } });
    desenhaFinGastos(d);
  } catch (e) {
    alvo.innerHTML = '<div class="alert alert-erro">' + esc(e.message) + '</div>';
  }
}

function dataBrCurta(iso) {
  if (!iso) return '—';
  const p = String(iso).split('-');
  return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso;
}

function desenhaFinGastos(d) {
  const gastos = d.gastos || [];
  const P = GASTOS_PERIODO;

  document.getElementById('painel-fingastos').innerHTML =
    '<div class="row row-wrap" style="justify-content:space-between;align-items:center;margin-bottom:16px;gap:12px">' +
      '<div class="fd2-filtro" id="fg-filtro">' +
        ['hoje|Hoje', 'mes|Este mês', 'ano|Este ano', 'personalizado|Personalizado'].map(function (op) {
          const par = op.split('|');
          return '<button type="button" data-p="' + par[0] + '"' +
            (P.tipo === par[0] ? ' class="on"' : '') + '>' + par[1] + '</button>';
        }).join('') +
      '</div>' +
      '<button class="btn btn-sm" id="fg-novo">+ Novo gasto</button>' +
    '</div>' +

    '<div class="row row-wrap" id="fg-datas" style="gap:10px;align-items:flex-end;margin:0 0 14px;' +
      (P.tipo === 'personalizado' ? '' : 'display:none') + '">' +
      '<div class="field" style="margin:0"><label for="fg-de">Data inicial</label>' +
        '<input type="date" id="fg-de" value="' + esc(P.de) + '"></div>' +
      '<div class="field" style="margin:0"><label for="fg-ate">Data final</label>' +
        '<input type="date" id="fg-ate" value="' + esc(P.ate) + '"></div>' +
      '<button class="btn btn-sm" id="fg-aplicar">Aplicar</button>' +
    '</div>' +

    '<div class="fd2-grade" style="grid-template-columns:minmax(240px,340px);margin-bottom:16px">' +
      '<div class="fd2-carta">' +
        '<div class="fd2-tit">Total de gastos</div>' +
        '<div class="fd2-val" style="color:#b02a20">' + finDinheiro(d.total) + '</div>' +
        '<div class="fd2-sub">' + gastos.length + ' gasto(s) no período</div>' +
        '<div class="fd2-barra" style="background:#d9453a"></div>' +
      '</div>' +
    '</div>' +

    '<div class="card" style="padding:0;overflow:hidden">' +
      '<div style="overflow-x:auto">' +
      '<table class="tbl" style="min-width:560px"><thead><tr>' +
        '<th style="padding:14px 16px 10px">Item</th><th>Valor</th><th>Data</th><th>Observação</th><th></th>' +
      '</tr></thead><tbody>' +
      (gastos.length ? gastos.map(function (g) {
        return '<tr>' +
          '<td style="padding-left:16px;font-weight:600">' + esc(g.item) + '</td>' +
          '<td style="font-variant-numeric:tabular-nums">' + finDinheiro(g.valor) + '</td>' +
          '<td class="small muted" style="white-space:nowrap">' + dataBrCurta(g.data) + '</td>' +
          '<td class="small muted">' + esc(g.observacao || '') + '</td>' +
          '<td style="text-align:right;padding-right:14px;white-space:nowrap">' +
            '<button class="btn btn-sm btn-ghost fg-editar" data-id="' + esc(g.id) + '">Editar</button>' +
          '</td>' +
        '</tr>';
      }).join('')
        : '<tr><td colspan="5" style="padding:26px" class="muted">Nenhum gasto neste período.</td></tr>') +
      '</tbody></table>' +
      '</div>' +
    '</div>';

  document.getElementById('fg-novo').addEventListener('click', function () { abreGasto(null, d); });
  document.querySelectorAll('.fg-editar').forEach(function (b) {
    b.addEventListener('click', function () { abreGasto(b.dataset.id, d); });
  });

  document.querySelectorAll('#fg-filtro button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      GASTOS_PERIODO.tipo = btn.dataset.p;
      if (GASTOS_PERIODO.tipo === 'personalizado') {
        document.querySelectorAll('#fg-filtro button').forEach(function (x) { x.classList.toggle('on', x === btn); });
        document.getElementById('fg-datas').style.display = '';
        if (GASTOS_PERIODO.de && GASTOS_PERIODO.ate) carregaFinGastos();
      } else {
        carregaFinGastos();
      }
    });
  });
  const aplicar = document.getElementById('fg-aplicar');
  if (aplicar) aplicar.addEventListener('click', function () {
    const de = (document.getElementById('fg-de') || {}).value;
    const ate = (document.getElementById('fg-ate') || {}).value;
    if (!de || !ate) return toast('Escolha as duas datas', true);
    GASTOS_PERIODO.de = de;
    GASTOS_PERIODO.ate = ate;
    carregaFinGastos();
  });
}

function abreGasto(id, dados) {
  const novo = !id;
  const g = novo ? { data: gastosPeriodoDatas().ate ? new Date().toISOString().slice(0, 10) : '' }
    : ((dados.gastos || []).filter(function (x) { return x.id === id; })[0] || {});

  document.getElementById('g-nome').textContent = novo ? 'Novo gasto' : (g.item || 'Gasto');
  document.getElementById('g-sub').textContent = 'Entra na tabela e o total do período atualiza sozinho.';

  document.getElementById('g-corpo').innerHTML =
    '<div class="field"><label for="fg-item">O que foi</label>' +
      '<span class="hint">Ex.: Material de escritório, cabo HDMI, café, manutenção…</span>' +
      '<input id="fg-item" value="' + esc(g.item || '') + '" maxlength="160"></div>' +
    '<div class="row row-wrap" style="gap:14px">' +
      '<div class="field" style="flex:1;min-width:150px"><label for="fg-valor">Valor</label>' +
        '<span class="hint">Ex.: 350 ou 89,90</span>' +
        '<input id="fg-valor" value="' + esc(g.valor === undefined ? '' : g.valor) + '"></div>' +
      '<div class="field" style="flex:1;min-width:170px"><label for="fg-data">Data</label>' +
        '<span class="hint">Quando o gasto aconteceu.</span>' +
        '<input type="date" id="fg-data" value="' + esc(g.data || new Date().toISOString().slice(0, 10)) + '"></div>' +
    '</div>' +
    '<div class="field"><label for="fg-obs">Observação</label>' +
      '<span class="hint">Opcional.</span>' +
      '<input id="fg-obs" value="' + esc(g.observacao || '') + '" maxlength="400"></div>' +
    '<div class="row" style="gap:12px;margin-top:20px">' +
      '<button class="btn" id="fg-salvar">' + (novo ? 'Adicionar' : 'Salvar') + '</button>' +
      (novo ? '' : '<button class="btn btn-ghost" id="fg-excluir" style="color:var(--red)">Excluir</button>') +
    '</div>' +
    '<div id="fg-saida"></div>';

  document.getElementById('fundo').style.display = 'block';
  document.getElementById('gaveta').style.display = 'flex';

  document.getElementById('fg-salvar').addEventListener('click', async function () {
    const corpo = {
      item: (document.getElementById('fg-item') || {}).value || '',
      valor: (document.getElementById('fg-valor') || {}).value || '',
      data: (document.getElementById('fg-data') || {}).value || '',
      observacao: (document.getElementById('fg-obs') || {}).value || ''
    };
    if (!novo) corpo.id = g.id;
    if (!corpo.item.trim()) return toast('Escreva o que foi o gasto', true);

    this.disabled = true;
    this.innerHTML = '<span class="spinner"></span> Salvando…';
    try {
      await apiFin('fg_salvar', { body: corpo });
      toast(novo ? 'Gasto adicionado' : 'Gasto salvo');
      fechaGaveta();
      carregaFinGastos();
    } catch (e) {
      document.getElementById('fg-saida').innerHTML =
        '<div class="alert alert-erro" style="margin-top:14px">' + esc(e.message) + '</div>';
      this.disabled = false;
      this.textContent = novo ? 'Adicionar' : 'Salvar';
    }
  });

  const btnEx = document.getElementById('fg-excluir');
  if (btnEx) {
    btnEx.addEventListener('click', function () {
      spConfirma('Excluir este gasto?', '<strong>' + esc(g.item || '') + '</strong> de ' +
        finDinheiro(g.valor) + ' sai da tabela e do total.', async function () {
        try {
          await apiFin('fg_excluir', { body: { id: g.id } });
          toast('Gasto excluído');
          fechaGaveta();
          carregaFinGastos();
        } catch (e) { toast(e.message, true); }
      }, 'Excluir');
    });
  }
}

/* ---------------------------------------------- o relatório
   Vem pronto do servidor, com a linha de total no fim. Baixa
   com o crachá no cabeçalho, então não dá para abrir o endereço
   direto no navegador e vazar a carteira. */
async function baixaRelatorioFin() {
  const b = document.getElementById('fin-baixar');
  const antes = b ? b.textContent : '';
  if (b) { b.disabled = true; b.textContent = 'Gerando…'; }
  try {
    const qs = new URLSearchParams(Object.assign({ action: 'fin_relatorio' }, finCompParams()));
    const res = await fetch('/api/financeiro?' + qs, {
      headers: { Authorization: 'Bearer ' + TOKEN }
    });
    if (!res.ok) throw new Error('Não deu para gerar o relatório agora.');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const hoje = new Date();
    a.href = url;
    a.download = 'financeiro-startdigital-' + hoje.getFullYear() +
      String(hoje.getMonth() + 1).padStart(2, '0') +
      String(hoje.getDate()).padStart(2, '0') + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    toast('Relatório baixado');
  } catch (e) {
    toast(e.message, true);
  }
  if (b) { b.disabled = false; b.textContent = antes || 'Baixar relatório'; }
}

/* ---------------------------------------------- gentileza com o menu
   Quem não enxerga o financeiro não precisa ver o botão e levar um
   erro vermelho na cara. E a Automação só aparece se estiver ligada
   nos Ajustes. Quem barra de verdade continua sendo o servidor —
   isto aqui só evita o clique inútil. */
async function escondeFinanceiroSeNaoPode() {
  try {
    const r = await (await fetch('/api/admin?action=usuarios_eu', {
      headers: { Authorization: 'Bearer ' + TOKEN }
    })).json();
    if (!r.ok) return;

    // Automação: escondida por padrão; a chave fica em Ajustes.
    if (r.mostrar_automacao !== true) {
      const auto = document.querySelector('#abas .nav-grupo[data-grupo="automacao"]');
      if (auto) auto.style.display = 'none';
    }

    if (!Array.isArray(r.menu) || r.menu.indexOf('financeiro') >= 0) return;
    const grupo = document.querySelector('#abas .nav-grupo[data-grupo="financeiro"]');
    if (grupo) grupo.style.display = 'none';
  } catch (e) { /* na dúvida, deixa o botão: o servidor barra */ }
}

/* ============================================================
   TELA 2 — o dashboard
   ============================================================ */
async function carregaFinDash() {
  const alvo = document.getElementById('painel-findash');
  alvo.innerHTML = '<div class="spinner"></div>';
  try {
    const d = await apiFin('fin_resumo', { params: finCompParams() });
    finGuardaComp(d);
    desenhaFinDash(d.resumo || {}, d.cartoes || {});
  } catch (e) {
    alvo.innerHTML = '<div class="alert alert-erro">' + esc(e.message) + '</div>';
  }
}

/* Os três cartões no padrão da referência: borda clara, canto bem
   arredondado, valor grande colorido, barrinha e o rodapé de clientes. */
function finCartoesHtml(c) {
  function cartao(chave, titulo, cor, corBarra, dados, listrada) {
    const d = dados || { valor: 0, clientes: 0 };
    const vazio = !d.clientes;
    return '<div class="fd2-carta">' +
      '<div class="fd2-tit">' + esc(titulo) + '</div>' +
      '<div class="fd2-val" style="color:' + cor + '">' + finDinheiro(d.valor) + '</div>' +
      '<div class="fd2-sub">' + d.clientes + ' cobrança(s) no período</div>' +
      '<div class="fd2-barra' + (vazio && listrada ? ' listras' : '') + '"' +
        (vazio && listrada ? '' : ' style="background:' + corBarra + '"') + '></div>' +
      '<button type="button" class="fd2-linha fd2-ver-clientes"' + (vazio ? ' disabled' : '') + '>' +
        '<span>' + d.clientes + ' cliente' + (d.clientes === 1 ? '' : 's') + '</span>' +
        '<svg width="13" height="13" viewBox="0 0 24 24" style="fill:none;stroke:currentColor;' +
        'stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round"><path d="m9 5 7 7-7 7"/></svg>' +
      '</button>' +
    '</div>';
  }
  return '<div class="fd2-grade" id="fd2-cartoes">' +
    cartao('recebidas', 'Recebidas', '#157347', '#1fbf6e', c.recebidas) +
    cartao('aguardando', 'Aguardando pagamento', '#b45309', '#f5c26b', c.aguardando, true) +
    cartao('vencidas', 'Vencidas', '#b02a20', '#d9453a', c.vencidas) +
  '</div>';
}

function fdTile(rot, valor, pe, classe) {
  return '<div class="fd-tile' + (classe ? ' ' + classe : '') + '">' +
    '<div class="rot">' + esc(rot) + '</div>' +
    '<div class="num">' + finDinheiro(valor) + '</div>' +
    '<div class="pe">' + esc(pe || '') + '</div>' +
  '</div>';
}

function fdFila(s) {
  return '<div class="fd-sem-linha">' +
    '<span class="fd-sem-dia">' + esc(s.quando) + '</span>' +
    '<span class="fd-sem-nome">' + esc(s.cliente) + '</span>' +
    '<span class="fd-pino ' + esc(s.status) + '">' + esc(s.status_nome) + '</span>' +
    '<span class="fd-sem-val">' + finDinheiro(s.valor) + '</span>' +
  '</div>';
}

function desenhaFinDash(r, cartoes) {
  const semana = r.proxima_semana_lista || [];
  const depois = r.proximas_depois || [];

  document.getElementById('painel-findash').innerHTML =
    '<div class="row row-wrap" style="justify-content:space-between;align-items:center;margin-bottom:16px;gap:12px">' +
      '<div class="small muted">' + (r.clientes || 0) + ' cobrança(s) nesta competência</div>' +
      '<div class="row row-wrap" style="gap:10px;align-items:center">' +
        finSeletorComp('fd') +
        '<button class="btn btn-sm" id="fd-baixar">Baixar relatório completo</button>' +
      '</div>' +
    '</div>' +

    finCartoesHtml(cartoes || {}) +
    '<div style="height:10px"></div>' +

    '<div class="fd-grade">' +
      fdTile('Total — Setup', r.total_setup, 'Cobrado uma vez, na entrada.') +
      fdTile('Total — Mensalidade', r.total_mensalidade, 'O que entra todo mês.') +
      fdTile('Total — Hospedagem', r.total_hospedagem, 'Somado por mês.') +
      fdTile('Inadimplentes', r.inadimplente,
        (r.inadimplente_qtd || 0) + ' cliente(s) atrasado(s).', 'ruim') +
      fdTile('A receber — aguardando', r.aguardando,
        (r.aguardando_qtd || 0) + ' cliente(s) na fila.', 'espera') +
      fdTile('Já recebido', r.recebido,
        (r.recebido_qtd || 0) + ' cliente(s) em dia.', 'ok') +
    '</div>' +

    // a previsão olha para a frente: em mês fechado, não faz sentido
    (r.competencia_corrente === false ? '' :
      '<hr class="sep" style="margin:26px 0 18px">' +
      '<h3 style="font-size:15px;margin:0 0 4px">Previsão de recebimento — próxima semana</h3>' +
      '<p class="small muted" style="margin:0 0 14px">De hoje até ' + esc(r.proxima_semana_ate || '') +
        '. Total previsto: <strong>' + finDinheiro(r.proxima_semana) + '</strong> ' +
        'em ' + (r.proxima_semana_qtd || 0) + ' cobrança(s).</p>' +
      '<div class="fd-sem">' +
        (semana.length ? semana.map(fdFila).join('')
          : '<div class="fd-sem-linha"><span class="muted">Nada vence nos próximos 7 dias.</span></div>') +
      '</div>' +
      (semana.length || !depois.length ? '' :
        '<p class="small muted" style="margin:18px 0 8px">O que vem depois:</p>' +
        '<div class="fd-sem">' + depois.map(fdFila).join('') + '</div>')) +

    '<hr class="sep" style="margin:26px 0 18px">' +
    '<div class="card" style="padding:18px">' +
      '<h3 style="font-size:15px;margin:0 0 6px">Relatório para bater com o time</h3>' +
      '<p class="small muted" style="margin:0 0 14px">Uma planilha com todas as colunas — cliente, ' +
      'mensalidade, setup, hospedagem, total, vencimento, status, responsável, telefone e observação — ' +
      'e a linha de total no fim. Abre direto no Excel.</p>' +
      '<button class="btn" id="fd-baixar2">Baixar relatório completo</button>' +
    '</div>';

  ['fd-baixar', 'fd-baixar2'].forEach(function (id) {
    const b = document.getElementById(id);
    if (b) b.addEventListener('click', baixaRelatorioFinDash);
  });

  // ---- a competência manda em tudo nesta tela ----
  finLigaSeletor('fd', carregaFinDash);

  // os cartões levam para a lista de clientes
  document.querySelectorAll('.fd2-ver-clientes').forEach(function (b) {
    b.addEventListener('click', function () {
      const aba = document.querySelector('#abas button[data-aba="financeiro"]');
      if (aba) aba.click();
    });
  });
}

// mesma coisa do outro botão, mas mexendo no botão daqui
async function baixaRelatorioFinDash() {
  const b = this;
  const antes = b.textContent;
  b.disabled = true; b.textContent = 'Gerando…';
  try {
    const qs = new URLSearchParams(Object.assign({ action: 'fin_relatorio' }, finCompParams()));
    const res = await fetch('/api/financeiro?' + qs, {
      headers: { Authorization: 'Bearer ' + TOKEN }
    });
    if (!res.ok) throw new Error('Não deu para gerar o relatório agora.');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const hoje = new Date();
    a.href = url;
    a.download = 'financeiro-startdigital-' + hoje.getFullYear() +
      String(hoje.getMonth() + 1).padStart(2, '0') +
      String(hoje.getDate()).padStart(2, '0') + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    toast('Relatório baixado');
  } catch (e) { toast(e.message, true); }
  b.disabled = false; b.textContent = antes;
}
