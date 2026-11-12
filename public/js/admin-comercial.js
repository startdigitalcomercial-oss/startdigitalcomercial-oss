/* ============================================================
   COMERCIAL — SIMULAÇÕES

   Três telas dentro de uma:
     Dashboard     — os cinco números e o desempenho por SDR
     Participantes — quem está na simulação
     Painel        — a carteira de um SDR, com os leads dele

   Quem abre o módulo cai na tela que faz sentido para ele: o
   gestor cai no Dashboard; o SDR cai direto na própria carteira,
   porque é só isso que ele tem para fazer aqui.

   Leads, Agenda e Atendimento são telas de espera honestas: o
   menu existe, a tela diz o que ainda não existe, e ninguém
   inventa um fluxo comercial que não foi pedido.
   ============================================================ */

let CM = null;                 // o que veio do servidor na tela atual
let CM_VISTA = 'dashboard';    // dashboard | participantes | painel
let CM_QUEM = null;            // id do participante aberto no painel
let CM_FAIXA = 'tudo';         // tudo | hoje | semana | mes | personalizado
let CM_DE = '', CM_ATE = '';
let CM_SDR = '';               // filtro do dashboard
let CM_BUSCA = '', CM_F_COMP = '', CM_F_QUAL = '';

async function apiCm(action, opts) {
  opts = opts || {};
  const qs = new URLSearchParams(Object.assign({ action: action }, opts.params || {}));
  const res = await fetch('/api/comercial?' + qs.toString(), {
    method: opts.body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json().catch(function () { return { ok: false, error: 'resposta invalida' }; });
  if (res.status === 401) { sair(); throw new Error('sessao expirada'); }
  if (!data.ok) throw new Error(data.error || 'erro');
  return data;
}

/* o período vira parâmetros de busca */
function cmPeriodo() {
  if (CM_FAIXA === 'personalizado' && CM_DE && CM_ATE) return { de: CM_DE, ate: CM_ATE };
  if (CM_FAIXA === 'tudo') return {};
  return { faixa: CM_FAIXA };
}

function cmDataBr(iso) {
  if (!iso) return '—';
  const p = String(iso).slice(0, 10).split('-');
  return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso;
}
/* a reunião é guardada com fuso; mostrar em São Paulo */
function cmQuando(iso) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit',
      hour: '2-digit', minute: '2-digit'
    }).format(new Date(iso)).replace(',', ' ·');
  } catch (e) { return cmDataBr(iso); }
}
function cmHoraValor(iso) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false
    }).format(new Date(iso));
  } catch (e) { return ''; }
}
function cmDataValor(iso) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date(iso));
  } catch (e) { return ''; }
}

/* ---------------- entrada ---------------- */
async function carregaSimulacoes() {
  const alvo = document.getElementById('painel-cmsimulacoes');
  if (!CM) alvo.innerHTML = '<div class="spinner"></div>';
  try {
    // Quem não gerencia não tem Dashboard geral para ver: vai direto
    // para a própria carteira.
    if (!CM_QUEM && COMERCIAL && !COMERCIAL.gerente && COMERCIAL.participante) {
      CM_VISTA = 'painel';
      CM_QUEM = COMERCIAL.participante.id;
    }
    await cmBusca();
    cmDesenha();
  } catch (e) {
    alvo.innerHTML = '<div class="alert alert-erro">' + esc(e.message) + '</div>';
  }
}

async function cmBusca() {
  const p = cmPeriodo();
  if (CM_VISTA === 'painel' && CM_QUEM) {
    CM = await apiCm('cm_painel', { params: Object.assign({ id: CM_QUEM }, p) });
    CM.vista = 'painel';
  } else if (CM_VISTA === 'participantes') {
    CM = await apiCm('cm_participantes', { params: p });
    CM.vista = 'participantes';
  } else {
    CM = await apiCm('cm_dashboard', { params: Object.assign(CM_SDR ? { participante_id: CM_SDR } : {}, p) });
    CM.vista = 'dashboard';
  }
}

/* Troca só o miolo. O cabeçalho, as abas e os filtros ficam onde
   estão — o mesmo princípio da Agenda. */
let CM_VOANDO = false;
async function cmRemonta() {
  if (CM_VOANDO) return;
  const miolo = document.getElementById('cm-miolo');
  if (!miolo) { carregaSimulacoes(); return; }
  CM_VOANDO = true;
  miolo.classList.add('ag-esperando');
  try {
    await cmBusca();
    miolo.innerHTML = cmMiolo();
    // os números nascem em "0" e sobem contando. Sem esta linha, um
    // miolo trocado ficava com cinco zeros parados na tela enquanto
    // os leads estavam logo abaixo — o pior tipo de erro, o que
    // parece certo até alguém conferir.
    opAnima('painel-cmsimulacoes');
    cmLigaMiolo();
  } catch (e) { toast(e.message, true); }
  const d = document.getElementById('cm-miolo');
  if (d) d.classList.remove('ag-esperando');
  CM_VOANDO = false;
}

/* ---------------- a tela ---------------- */
function cmDesenha() {
  const gerente = !!(CM && CM.gerente) || !!(COMERCIAL && COMERCIAL.gerente);

  document.getElementById('painel-cmsimulacoes').innerHTML =
    '<div class="op">' +

    '<div class="op-cab op-entra">' +
      '<div><div class="small muted">Gestão de participantes e acompanhamento de resultados.</div></div>' +
      '<div class="op-filtros">' +
        cmFiltroPeriodo() +
        (gerente ? '<button class="btn btn-sm" id="cm-novo-part">+ Novo Participante</button>' : '') +
      '</div>' +
    '</div>' +

    (gerente ? cmAbas() : '') +

    '<div class="op-entra" id="cm-miolo" style="animation-delay:60ms">' + cmMiolo() + '</div>' +
    '</div>';

  opAnima('painel-cmsimulacoes');
  cmLiga();
  cmLigaMiolo();
}

function cmAbas() {
  return '<div class="fd2-filtro cm-abas" id="cm-vista" style="margin-bottom:16px">' +
    [['dashboard', 'Dashboard'], ['participantes', 'Participantes']].map(function (o) {
      return '<button type="button" data-v="' + o[0] + '"' +
        (CM_VISTA === o[0] ? ' class="on"' : '') + '>' + o[1] + '</button>';
    }).join('') +
    (CM_VISTA === 'painel'
      ? '<button type="button" data-v="painel" class="on">' +
        esc((CM && CM.participante && CM.participante.nome) || 'Painel') + '</button>'
      : '') +
    '</div>';
}

function cmFiltroPeriodo() {
  const faixas = [['tudo', 'Tudo'], ['hoje', 'Hoje'], ['semana', 'Esta semana'],
    ['mes', 'Este mês'], ['personalizado', 'Período…']];
  return '<select id="cm-faixa" aria-label="Período">' +
    faixas.map(function (f) {
      return '<option value="' + f[0] + '"' + (CM_FAIXA === f[0] ? ' selected' : '') + '>' + f[1] + '</option>';
    }).join('') + '</select>' +
    (CM_FAIXA === 'personalizado'
      ? '<input type="date" id="cm-de" value="' + esc(CM_DE) + '" aria-label="De">' +
        '<input type="date" id="cm-ate" value="' + esc(CM_ATE) + '" aria-label="Até">'
      : '');
}

function cmMiolo() {
  if (!CM) return '';
  if (CM.vista === 'painel') return cmPainel();
  if (CM.vista === 'participantes') return cmParticipantes();
  return cmDashboard();
}

/* ---------------- dashboard ---------------- */
function cmDashboard() {
  const t = CM.total || {};
  const vazio = !(CM.por_sdr || []).length;

  const I = {
    leads: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3.8 6.6h16.4M6.6 11.4h10.8M9.4 16.2h5.2"/></svg>',
    agenda: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3.8" y="5.6" width="16.4" height="13.8" rx="2"/><path d="M3.8 9.8h16.4M8.6 3.6v3.4M15.4 3.6v3.4"/></svg>',
    veio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="8.4"/><path d="m8.4 12.3 2.4 2.4 4.8-5.4"/></svg>',
    faltou: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="8.4"/><path d="m9.2 9.2 5.6 5.6M14.8 9.2l-5.6 5.6"/></svg>',
    estrela: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m12 4.4 2.3 4.8 5.2.7-3.8 3.7.9 5.2-4.6-2.5-4.6 2.5.9-5.2L4.5 9.9l5.2-.7z"/></svg>'
  };
  // Zero nao ganha cor. Um "0" verde em Qualificados parece elogio,
  // e um "0" laranja em Nao compareceram parece alerta — quando e
  // justamente o melhor numero possivel ali. Cor so quando ha o que
  // mostrar.
  const kpi = function (rot, valor, pe, ico, classe) {
    return '<div class="op-kpi ' + (valor ? (classe || '') : '') + '">' +
      '<div class="rot">' + rot + ico + '</div>' +
      '<div class="num" data-ate="' + (valor || 0) + '">0</div>' +
      '<div class="pe">' + pe + '</div></div>';
  };

  return '<div class="op-kpis" style="grid-template-columns:repeat(auto-fit,minmax(172px,1fr))">' +
      kpi('Total de Leads', t.leads, 'cadastrados na simulação', I.leads, '') +
      kpi('Agendados', t.agendados, 'com reunião marcada', I.agenda, 'agenda') +
      kpi('Compareceram', t.compareceram, 'reunião aconteceu', I.veio, 'bom') +
      kpi('Não compareceram', t.nao_compareceram, 'marcaram e faltaram', I.faltou, 'atencao') +
      kpi('Qualificados', t.qualificados, 'com perfil para avançar', I.estrela, 'bom') +
    '</div>' +

    '<div class="card" style="padding:0;overflow:hidden">' +
      '<div class="cm-sec">' +
        '<div><h3>Desempenho por SDR</h3>' +
        '<div class="small muted">Clique no nome para abrir a carteira dele.</div></div>' +
        (CM.sdrs && CM.sdrs.length > 1 ? cmFiltroSdr() : '') +
      '</div>' +
      (vazio
        ? '<div class="cm-nada">' +
            '<div style="font-size:15px;font-weight:600;margin-bottom:6px">Nenhum SDR na simulação ainda</div>' +
            '<div class="small muted">Use <strong>+ Novo Participante</strong> para começar.</div></div>'
        : '<div style="overflow-x:auto"><table class="tbl cm-tab" style="min-width:680px"><thead><tr>' +
            '<th style="padding-left:18px">SDR</th><th>Leads</th><th>Agendados</th>' +
            '<th>Compareceram</th><th>Não compareceram</th><th>Qualificados</th></tr></thead><tbody>' +
          CM.por_sdr.map(function (s) {
            return '<tr>' +
              '<td style="padding-left:18px"><button type="button" class="cm-abrir cm-link" data-id="' + esc(s.id) + '">' +
                esc(s.nome) + '</button></td>' +
              '<td class="cm-n">' + s.leads + '</td>' +
              '<td class="cm-n">' + s.agendados + '</td>' +
              cmCel(s.compareceram, 'cm-bom') +
              cmCel(s.nao_compareceram, 'cm-ruim') +
              cmCel(s.qualificados, 'cm-bom') +
            '</tr>';
          }).join('') +
          '</tbody></table></div>') +
    '</div>' +

    ((CM.closers || []).length
      ? '<div class="small muted" style="margin-top:12px">' +
        '<strong>' + CM.closers.length + ' Closer(s)</strong> na simulação — ' +
        esc(CM.closers.map(function (x) { return x.nome; }).join(', ')) +
        '. Os números acima são de prospecção, então não misturam as duas funções.</div>'
      : '');
}

/* mesma regra da tela de cima: zero fica sem cor */
function cmCel(n, classe) {
  return '<td class="cm-n ' + (n ? classe : 'cm-zero') + '">' + (n || 0) + '</td>';
}

function cmFiltroSdr() {
  return '<select id="cm-sdr" aria-label="SDR" style="height:36px;font-size:13.5px;width:auto;min-width:150px">' +
    '<option value="">Todos os SDRs</option>' +
    (CM.sdrs || []).map(function (s) {
      return '<option value="' + esc(s.id) + '"' + (CM_SDR === s.id ? ' selected' : '') + '>' + esc(s.nome) + '</option>';
    }).join('') + '</select>';
}

/* ---------------- participantes ---------------- */
function cmParticipantes() {
  const lista = CM.participantes || [];
  if (!lista.length) {
    return '<div class="card" style="text-align:center;padding:48px 24px">' +
      '<div style="font-size:15.5px;font-weight:600;margin-bottom:6px">Nenhum participante ainda</div>' +
      '<div class="small muted" style="max-width:420px;margin:0 auto;line-height:1.6">' +
      'Use <strong>+ Novo Participante</strong> para colocar alguém na simulação. ' +
      'O acesso continua sendo o do painel — aqui só se diz quem joga e em que posição.</div></div>';
  }
  return '<div class="cm-grade">' +
    lista.map(function (p) {
      const n = p.numeros || {};
      return '<div class="cm-cartao">' +
        '<div class="cm-cartao-topo">' +
          '<span class="cm-ini">' + esc(cmIniciais(p.nome)) + '</span>' +
          '<div style="min-width:0">' +
            '<div class="cm-nome">' + esc(p.nome) + '</div>' +
            '<span class="op-pino ' + (p.funcao === 'sdr' ? 'agendada' : 'ativo') + '">' +
              esc(p.funcao_nome) + '</span>' +
          '</div>' +
        '</div>' +
        (p.funcao === 'sdr'
          ? '<div class="cm-mini">' +
              cmMini('Leads', n.leads) + cmMini('Agend.', n.agendados) +
              cmMini('Vieram', n.compareceram) + cmMini('Qualif.', n.qualificados) +
            '</div>'
          : '<div class="small muted" style="margin:12px 0 2px;line-height:1.5">' +
            'Perfil de fechamento. Os indicadores de prospecção são dos SDRs.</div>') +
        '<div class="cm-cartao-pe">' +
          '<button type="button" class="btn btn-sm btn-ghost cm-abrir" data-id="' + esc(p.id) + '">Abrir painel</button>' +
          (CM.gerente
            ? '<button type="button" class="btn btn-sm btn-ghost cm-editar-part" data-id="' + esc(p.id) + '">Editar</button>'
            : '') +
        '</div>' +
      '</div>';
    }).join('') + '</div>';
}

function cmMini(rot, n) {
  return '<div><b>' + (n || 0) + '</b><span>' + rot + '</span></div>';
}
function cmIniciais(nome) {
  const p = String(nome || '').trim().split(/\s+/).filter(Boolean);
  if (!p.length) return '?';
  if (p.length === 1) return p[0].slice(0, 2).toUpperCase();
  return (p[0][0] + p[p.length - 1][0]).toUpperCase();
}

/* ---------------- painel de um participante ---------------- */
function cmPainel() {
  const p = CM.participante || {};
  const n = CM.numeros || {};
  const eSdr = p.funcao === 'sdr';

  return '<div class="cm-perfil">' +
      '<span class="cm-ini grande">' + esc(cmIniciais(p.nome)) + '</span>' +
      '<div style="min-width:0;flex:1">' +
        '<h2 style="margin:0;font-size:20px;letter-spacing:-.022em">' + esc(p.nome) + '</h2>' +
        '<div class="small muted" style="margin-top:3px">Função: <strong>' + esc(p.funcao_nome) + '</strong></div>' +
      '</div>' +
      (eSdr && CM.posso_mexer
        ? '<button class="btn btn-sm" id="cm-novo-lead">+ Novo Lead</button>' : '') +
    '</div>' +

    (eSdr
      ? '<div class="op-kpis" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">' +
          cmKpiSimples('Leads', n.leads, '') +
          cmKpiSimples('Agendados', n.agendados, 'agenda') +
          cmKpiSimples('Compareceram', n.compareceram, 'bom') +
          cmKpiSimples('Não compareceram', n.nao_compareceram, 'atencao') +
          cmKpiSimples('Qualificados', n.qualificados, 'bom') +
        '</div>' + cmListaLeads()
      : '<div class="card" style="text-align:center;padding:44px 24px">' +
        '<div style="font-size:15px;font-weight:600;margin-bottom:6px">Perfil de Closer</div>' +
        '<div class="small muted" style="max-width:440px;margin:0 auto;line-height:1.6">' +
        'O perfil está criado e o acesso à simulação, liberado. A simulação de hoje é de ' +
        'prospecção — quem cadastra lead é o SDR.</div></div>');
}

function cmKpiSimples(rot, valor, classe) {
  return '<div class="op-kpi ' + (valor ? classe : '') + '">' +
    '<div class="rot">' + rot + '</div>' +
    '<div class="num" data-ate="' + (valor || 0) + '">0</div></div>';
}

/* ---------------- a fila de leads ---------------- */
function cmLeadsFiltrados() {
  let l = CM.leads || [];
  const b = (CM_BUSCA || '').trim().toLowerCase();
  if (b) {
    l = l.filter(function (x) {
      return (x.nome || '').toLowerCase().indexOf(b) >= 0
        || (x.contato || '').toLowerCase().indexOf(b) >= 0
        || (x.nicho || '').toLowerCase().indexOf(b) >= 0
        || (x.cidade || '').toLowerCase().indexOf(b) >= 0;
    });
  }
  if (CM_F_COMP) l = l.filter(function (x) { return x.comparecimento === CM_F_COMP; });
  if (CM_F_QUAL) l = l.filter(function (x) { return x.qualificacao === CM_F_QUAL; });
  return l;
}

function cmListaLeads() {
  const todos = CM.leads || [];
  if (!todos.length) {
    return '<div class="card" style="text-align:center;padding:44px 24px">' +
      '<div style="font-size:15px;font-weight:600;margin-bottom:6px">Nenhum lead nesta simulação</div>' +
      '<div class="small muted">' +
      (CM.posso_mexer ? 'Use <strong>+ Novo Lead</strong> para cadastrar o primeiro.'
                      : 'Este SDR ainda não cadastrou leads no período.') + '</div></div>';
  }
  const lista = cmLeadsFiltrados();

  return '<div class="cm-sec-fora">' +
      '<h3 style="margin:0">Meus Leads</h3>' +
      '<div class="op-filtros" style="margin-left:auto">' +
        buscaHtml('cm-busca', 'Buscar pelo nome…', CM_BUSCA) +
        '<select id="cm-f-comp" aria-label="Comparecimento"><option value="">Todo comparecimento</option>' +
          (CM.comparecimento || []).map(function (k) {
            return '<option value="' + k + '"' + (CM_F_COMP === k ? ' selected' : '') + '>' +
              esc(CM.comparecimento_nome[k]) + '</option>';
          }).join('') + '</select>' +
        '<select id="cm-f-qual" aria-label="Qualificação"><option value="">Toda qualificação</option>' +
          (CM.qualificacao || []).map(function (k) {
            return '<option value="' + k + '"' + (CM_F_QUAL === k ? ' selected' : '') + '>' +
              esc(CM.qualificacao_nome[k]) + '</option>';
          }).join('') + '</select>' +
      '</div>' +
      '<span class="small muted" id="cm-conta">' + cmFrase(lista.length) + '</span>' +
    '</div>' +

    '<div class="card" style="padding:0;overflow:hidden"><div style="overflow-x:auto">' +
      '<table class="tbl cm-tab" style="min-width:1080px"><thead><tr>' +
        '<th style="padding-left:18px">Lead</th><th>Contato</th><th>Cidade</th><th>CNPJ</th>' +
        '<th>Nicho</th><th>Origem</th><th>Agendamento</th><th>Comparecimento</th>' +
        '<th>Qualificação</th><th></th>' +
      '</tr></thead><tbody id="cm-corpo">' + cmLinhas(lista) + '</tbody></table>' +
    '</div></div>';
}

function cmFrase(n) { return n + (n === 1 ? ' lead' : ' leads'); }

function cmLinhas(lista) {
  if (!lista.length) {
    return '<tr><td colspan="10" style="padding:26px" class="muted">Nenhum lead com esses filtros.</td></tr>';
  }
  const mexe = CM.posso_mexer;
  return lista.map(function (l) {
    return '<tr data-lead="' + esc(l.id) + '">' +
      '<td style="padding-left:18px;font-weight:600">' + esc(l.nome) + '</td>' +
      '<td class="small cm-fone">' + (l.contato ? esc(l.contato) : '<span class="muted">—</span>') + '</td>' +
      '<td class="small">' + (l.cidade ? esc(l.cidade) : '<span class="muted">—</span>') + '</td>' +
      '<td class="small" style="white-space:nowrap">' +
        (l.cnpj_bonito ? esc(l.cnpj_bonito) : '<span class="muted">—</span>') + '</td>' +
      '<td class="small">' + (l.nicho ? esc(l.nicho) : '<span class="muted">—</span>') + '</td>' +
      '<td class="small" style="white-space:nowrap">' + esc(l.sdr) + ' — SDR</td>' +
      '<td class="small" style="white-space:nowrap">' +
        (l.agendado ? esc(cmQuando(l.agendado_em)) : '<span class="muted">Sem reunião</span>') + '</td>' +
      '<td>' + cmSeletor('comp', l, mexe) + '</td>' +
      '<td>' + cmSeletor('qual', l, mexe) + '</td>' +
      '<td style="text-align:right;padding-right:14px;white-space:nowrap">' +
        (mexe
          ? '<button class="btn btn-sm btn-ghost cm-editar-lead" data-id="' + esc(l.id) + '">Editar</button>'
          : '') + '</td>' +
    '</tr>';
  }).join('');
}

/* A etiqueta É o seletor: clicou, escolheu, salvou. Abrir a ficha
   inteira para trocar uma palavra seria caminho longo demais para
   a coisa que mais se faz nesta tela. */
function cmSeletor(qual, l, mexe) {
  const comp = qual === 'comp';
  const valor = comp ? l.comparecimento : l.qualificacao;
  const classe = comp ? cmClasseComp(valor) : cmClasseQual(valor);
  const nome = comp ? l.comparecimento_nome : l.qualificacao_nome;

  if (!mexe || (comp && !l.agendado)) {
    return '<span class="op-pino ' + classe + '">' + esc(comp && !l.agendado ? 'Sem reunião' : nome) + '</span>';
  }
  const opcoes = comp
    ? [['aguardando', 'Aguardando'], ['compareceu', 'Compareceu'], ['nao_compareceu', 'Não compareceu']]
    : [['pendente', 'Pendente'], ['sim', 'Qualificado'], ['nao', 'Não qualificado']];

  return '<span class="cm-pino-sel op-pino ' + classe + '">' +
    '<select class="cm-troca" data-campo="' + (comp ? 'comparecimento' : 'qualificacao') + '" ' +
      'data-id="' + esc(l.id) + '" aria-label="' + (comp ? 'Comparecimento' : 'Qualificação') + '">' +
      opcoes.map(function (o) {
        return '<option value="' + o[0] + '"' + (valor === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') +
    '</select><span class="cm-pino-txt">' + esc(cmCurto(qual, valor)) + '</span></span>';
}

function cmCurto(qual, v) {
  if (qual === 'comp') {
    return { aguardando: 'Aguardando', compareceu: 'Compareceu', nao_compareceu: 'Não compareceu' }[v] || v;
  }
  return { pendente: 'Pendente', sim: 'Qualificado', nao: 'Não qualificado' }[v] || v;
}
function cmClasseComp(v) {
  if (v === 'compareceu') return 'ativo';
  if (v === 'nao_compareceu') return 'flopado';
  return 'cancelado';
}
function cmClasseQual(v) {
  if (v === 'sim') return 'ativo';
  if (v === 'nao') return 'flopado';
  return 'cancelado';
}

/* ---------------- ligações ---------------- */
function cmLiga() {
  const b = function (id) { return document.getElementById(id); };

  document.querySelectorAll('#cm-vista button').forEach(function (bt) {
    bt.addEventListener('click', function () {
      if (CM_VISTA === bt.dataset.v) return;
      CM_VISTA = bt.dataset.v;
      if (CM_VISTA !== 'painel') CM_QUEM = null;
      CM = null;
      carregaSimulacoes();
    });
  });

  const faixa = b('cm-faixa');
  if (faixa) faixa.addEventListener('change', function () {
    CM_FAIXA = this.value;
    if (CM_FAIXA !== 'personalizado') { cmRemonta(); return; }
    // o período personalizado precisa dos dois campos na tela antes
    const hoje = (CM && CM.hoje) || new Date().toISOString().slice(0, 10);
    if (!CM_DE) CM_DE = hoje.slice(0, 8) + '01';
    if (!CM_ATE) CM_ATE = hoje;
    cmDesenha();
  });
  ['cm-de', 'cm-ate'].forEach(function (id) {
    const el = b(id);
    if (!el) return;
    el.addEventListener('change', function () {
      if (id === 'cm-de') CM_DE = this.value; else CM_ATE = this.value;
      if (CM_DE && CM_ATE) cmRemonta();
    });
  });

  const novo = b('cm-novo-part');
  if (novo) novo.addEventListener('click', function () { cmFichaParticipante(null); });
}

function cmLigaMiolo() {
  const b = function (id) { return document.getElementById(id); };

  document.querySelectorAll('#painel-cmsimulacoes .cm-abrir').forEach(function (x) {
    x.addEventListener('click', function () {
      CM_VISTA = 'painel'; CM_QUEM = x.dataset.id;
      CM_BUSCA = ''; CM_F_COMP = ''; CM_F_QUAL = '';
      CM = null;
      carregaSimulacoes();
    });
  });

  document.querySelectorAll('#painel-cmsimulacoes .cm-editar-part').forEach(function (x) {
    x.addEventListener('click', function (ev) {
      ev.stopPropagation();
      const p = (CM.participantes || []).filter(function (y) { return y.id === x.dataset.id; })[0];
      cmFichaParticipante(p || null);
    });
  });

  const sdr = b('cm-sdr');
  if (sdr) sdr.addEventListener('change', function () { CM_SDR = this.value; cmRemonta(); });

  const novoLead = b('cm-novo-lead');
  if (novoLead) novoLead.addEventListener('click', function () { cmFichaLead(null); });

  document.querySelectorAll('#painel-cmsimulacoes .cm-editar-lead').forEach(function (x) {
    x.addEventListener('click', function () {
      const l = (CM.leads || []).filter(function (y) { return y.id === x.dataset.id; })[0];
      cmFichaLead(l || null);
    });
  });

  // filtros da fila: tudo já está na memória, então filtra na tecla
  if (b('cm-busca')) {
    ligaBusca('cm-busca', function (t) { CM_BUSCA = t; cmPintaFila(); }, 0);
  }
  ['cm-f-comp', 'cm-f-qual'].forEach(function (id) {
    const el = b(id);
    if (!el) return;
    el.addEventListener('change', function () {
      if (id === 'cm-f-comp') CM_F_COMP = this.value; else CM_F_QUAL = this.value;
      cmPintaFila();
    });
  });

  cmLigaTrocas();
}

/* Repinta só o corpo da tabela: o cursor não sai do campo de busca. */
function cmPintaFila() {
  const corpo = document.getElementById('cm-corpo');
  if (!corpo) return;
  const lista = cmLeadsFiltrados();
  corpo.innerHTML = cmLinhas(lista);
  const conta = document.getElementById('cm-conta');
  if (conta) conta.textContent = cmFrase(lista.length);
  cmLigaTrocas();
}

function cmLigaTrocas() {
  document.querySelectorAll('#painel-cmsimulacoes .cm-troca').forEach(function (sel) {
    sel.addEventListener('change', async function () {
      const id = sel.dataset.id, campo = sel.dataset.campo, valor = sel.value;
      const antes = (CM.leads || []).filter(function (l) { return l.id === id; })[0];
      const anterior = antes ? antes[campo] : null;
      const pino = sel.closest('.cm-pino-sel');
      pino.classList.add('salvando');
      try {
        const corpo = { id: id };
        corpo[campo] = valor;
        const r = await apiCm('cm_lead_campo', { body: corpo });
        // o servidor manda: a linha passa a ser o que ele devolveu
        const i = (CM.leads || []).findIndex(function (l) { return l.id === id; });
        if (i >= 0) CM.leads[i] = r.lead;
        cmRecontaCabecalho();
        cmPintaFila();
        toast('Atualizado');
      } catch (e) {
        if (antes) antes[campo] = anterior;
        sel.value = anterior;
        pino.classList.remove('salvando');
        toast(e.message, true);
      }
    });
  });
}

/* Os cinco números do topo acompanham a mudança, sem ir ao servidor:
   a conta é a mesma que o servidor faz, sobre os mesmos leads. */
function cmRecontaCabecalho() {
  const l = CM.leads || [];
  const n = { leads: l.length, agendados: 0, compareceram: 0, nao_compareceram: 0, qualificados: 0 };
  l.forEach(function (x) {
    if (x.agendado) n.agendados++;
    if (x.comparecimento === 'compareceu') n.compareceram++;
    if (x.comparecimento === 'nao_compareceu') n.nao_compareceram++;
    if (x.qualificacao === 'sim') n.qualificados++;
  });
  CM.numeros = n;
  const nums = document.querySelectorAll('#painel-cmsimulacoes .op-kpi .num');
  const vals = [n.leads, n.agendados, n.compareceram, n.nao_compareceram, n.qualificados];
  nums.forEach(function (el, i) { if (vals[i] !== undefined) el.textContent = vals[i]; });
}

/* ---------------- ficha do participante ---------------- */
async function cmFichaParticipante(p) {
  const novo = !p;
  document.getElementById('g-nome').textContent = novo ? 'Novo participante' : (p.nome || 'Participante');
  document.getElementById('g-sub').textContent = novo
    ? 'Quem entra na simulação, e em que posição.'
    : 'Edite o nome, a função ou a conta de acesso.';

  document.getElementById('g-corpo').innerHTML = '<div class="spinner"></div>';
  document.getElementById('gaveta').style.display = 'flex';

  let contas = [];
  try { contas = (await apiCm('cm_usuarios')).usuarios || []; } catch (e) { /* segue sem a lista */ }

  document.getElementById('g-corpo').innerHTML =
    '<div class="field"><label for="cmp-nome">Nome do participante</label>' +
      '<input id="cmp-nome" maxlength="80" value="' + esc(novo ? '' : (p.nome || '')) + '" placeholder="João"></div>' +

    '<div class="field" style="margin-top:14px"><label for="cmp-funcao">Função comercial</label>' +
      '<select id="cmp-funcao">' +
        '<option value="sdr"' + (novo || p.funcao === 'sdr' ? ' selected' : '') + '>SDR — prospecção e agendamento</option>' +
        '<option value="closer"' + (!novo && p.funcao === 'closer' ? ' selected' : '') + '>Closer — fechamento</option>' +
      '</select></div>' +

    '<div class="field" style="margin-top:14px"><label for="cmp-user">Usuário vinculado</label>' +
      '<span class="hint">A conta com que a pessoa entra no painel. É por ela que o sistema sabe ' +
        'de quem é cada lead. Para criar uma conta nova, use <strong>RH → Usuários</strong>: ' +
        'o acesso é um só no sistema inteiro.</span>' +
      '<select id="cmp-user"><option value="">Sem conta vinculada (só aparece no painel)</option>' +
        contas.map(function (c) {
          const meu = !novo && p.user_id === c.id;
          const bloqueado = c.ja_participa && !meu;
          return '<option value="' + esc(c.id) + '"' + (meu ? ' selected' : '') +
            (bloqueado ? ' disabled' : '') + '>' +
            esc(c.nome) + ' · ' + esc(c.papel_nome) +
            (bloqueado ? ' — já é ' + esc(c.ja_participa) : '') + '</option>';
        }).join('') +
      '</select></div>' +

    '<div class="field" style="margin-top:14px"><label for="cmp-obs">Observação</label>' +
      '<textarea id="cmp-obs" maxlength="500" style="min-height:70px" ' +
      'placeholder="Opcional.">' + esc(novo ? '' : (p.observacao || '')) + '</textarea></div>' +

    '<div id="cmp-saida"></div>' +

    '<div class="row row-wrap" style="gap:10px;margin-top:22px">' +
      '<button class="btn" id="cmp-salvar">' + (novo ? 'Cadastrar participante' : 'Salvar') + '</button>' +
      '<button class="btn btn-ghost" id="cmp-fechar">Cancelar</button>' +
      (novo ? '' : '<span style="flex:1"></span>' +
        '<button class="btn btn-danger btn-sm" id="cmp-tirar">Tirar da simulação</button>') +
    '</div>';

  document.getElementById('cmp-fechar').addEventListener('click', fechaGaveta);
  document.getElementById('cmp-salvar').addEventListener('click', async function () {
    const corpo = {
      id: novo ? null : p.id,
      nome: document.getElementById('cmp-nome').value,
      funcao: document.getElementById('cmp-funcao').value,
      user_id: document.getElementById('cmp-user').value || null,
      observacao: document.getElementById('cmp-obs').value
    };
    if (!corpo.nome.trim()) { toast('Escreva o nome', true); return; }
    this.disabled = true; this.innerHTML = '<span class="spinner"></span> Salvando…';
    try {
      await apiCm('cm_participante_salvar', { body: corpo });
      toast(novo ? 'Participante cadastrado' : 'Participante salvo');
      fechaGaveta();
      CM_VISTA = 'participantes'; CM_QUEM = null; CM = null;
      carregaSimulacoes();
    } catch (e) {
      document.getElementById('cmp-saida').innerHTML =
        '<div class="alert alert-erro" style="margin-top:14px">' + esc(e.message) + '</div>';
      this.disabled = false; this.textContent = novo ? 'Cadastrar participante' : 'Salvar';
    }
  });

  const tirar = document.getElementById('cmp-tirar');
  if (tirar) tirar.addEventListener('click', function () {
    spConfirma('Tirar da simulação?',
      '<strong>' + esc(p.nome) + '</strong> sai da lista. Os leads que ele cadastrou continuam ' +
      'guardados — a simulação não perde o histórico.',
      async function () {
        try {
          await apiCm('cm_participante_excluir', { body: { id: p.id } });
          toast('Participante removido da simulação');
          fechaGaveta();
          CM_VISTA = 'participantes'; CM_QUEM = null; CM = null;
          carregaSimulacoes();
        } catch (e) { toast(e.message, true); }
      }, 'Tirar');
  });
}

/* ---------------- ficha do lead ---------------- */
function cmFichaLead(l) {
  const novo = !l;
  const p = CM.participante || {};

  document.getElementById('g-nome').textContent = novo ? 'Novo lead' : (l.nome || 'Lead');
  document.getElementById('g-sub').textContent = 'Simulação de ' + (p.nome || '') + ' — SDR';

  document.getElementById('g-corpo').innerHTML =
    '<div class="field"><label for="cml-nome">Nome do lead</label>' +
      '<input id="cml-nome" maxlength="160" value="' + esc(novo ? '' : (l.nome || '')) + '" ' +
      'placeholder="Empresa ABC ou João da Silva"></div>' +

    '<div class="grid grid-2" style="margin-top:14px">' +
      '<div class="field"><label for="cml-contato">Contato</label>' +
        '<span class="hint">Telefone ou WhatsApp.</span>' +
        '<input id="cml-contato" maxlength="40" value="' + esc(novo ? '' : (l.contato || '')) + '" ' +
        'placeholder="(13) 99999-9999"></div>' +
      '<div class="field"><label for="cml-cidade">Cidade</label>' +
        '<input id="cml-cidade" maxlength="80" value="' + esc(novo ? '' : (l.cidade || '')) + '" ' +
        'placeholder="Praia Grande"></div>' +
    '</div>' +

    '<div class="grid grid-2" style="margin-top:4px">' +
      '<div class="field"><label for="cml-cnpj">CNPJ</label>' +
        '<span class="hint">Opcional. Se preencher, tem que ser um CNPJ de verdade.</span>' +
        '<input id="cml-cnpj" inputmode="numeric" maxlength="18" ' +
        'value="' + esc(novo ? '' : (l.cnpj_bonito || '')) + '" placeholder="00.000.000/0000-00"></div>' +
      '<div class="field"><label for="cml-nicho">Nicho</label>' +
        '<span class="hint">Escreva qualquer um; a lista é só atalho.</span>' +
        '<input id="cml-nicho" maxlength="80" list="cml-nichos" ' +
        'value="' + esc(novo ? '' : (l.nicho || '')) + '" placeholder="Advocacia">' +
        '<datalist id="cml-nichos">' +
          ['Advocacia', 'Imobiliária', 'Estética', 'Odontologia', 'Academia',
           'Restaurante', 'Educação', 'Saúde', 'Varejo', 'Serviços']
            .map(function (n) { return '<option value="' + n + '">'; }).join('') +
        '</datalist></div>' +
    '</div>' +

    '<div class="field" style="margin-top:4px"><label>Origem</label>' +
      '<div class="cm-origem">' +
        '<span class="cm-ini pequeno">' + esc(cmIniciais(p.nome)) + '</span>' +
        '<div><strong>' + esc(p.nome) + ' — SDR</strong>' +
        '<div class="small muted">A origem é a carteira em que você está. Não dá para digitar ' +
        'outro nome aqui — é assim que o lead nunca cai no SDR errado.</div></div>' +
      '</div></div>' +

    '<hr class="sep">' +

    '<div class="field"><label for="cml-agendado">Lead agendado?</label>' +
      '<select id="cml-agendado">' +
        '<option value="nao"' + (novo || !l.agendado ? ' selected' : '') + '>Não</option>' +
        '<option value="sim"' + (!novo && l.agendado ? ' selected' : '') + '>Sim</option>' +
      '</select></div>' +

    '<div class="grid grid-2" id="cml-quando" style="margin-top:14px' +
      (novo || !l.agendado ? ';display:none' : '') + '">' +
      '<div class="field"><label for="cml-data">Data da reunião</label>' +
        '<input type="date" id="cml-data" value="' + esc(novo ? '' : cmDataValor(l.agendado_em)) + '"></div>' +
      '<div class="field"><label for="cml-hora">Horário</label>' +
        '<input type="time" id="cml-hora" value="' + esc(novo ? '' : cmHoraValor(l.agendado_em)) + '"></div>' +
    '</div>' +

    '<div class="field" style="margin-top:4px" id="cml-comp-campo"' +
      (novo || !l.agendado ? ' hidden' : '') + '><label for="cml-comp">Comparecimento</label>' +
      '<select id="cml-comp">' +
        ['aguardando|Aguardando reunião', 'compareceu|Compareceu', 'nao_compareceu|Não compareceu']
          .map(function (o) {
            const v = o.split('|');
            return '<option value="' + v[0] + '"' +
              (!novo && l.comparecimento === v[0] ? ' selected' : '') + '>' + v[1] + '</option>';
          }).join('') +
      '</select></div>' +

    '<hr class="sep">' +

    '<div class="field"><label for="cml-obs">Observações de qualificação</label>' +
      '<span class="hint">O que você descobriu na conversa. Este texto é para gente ler — ' +
        'quem conta o indicador é o campo abaixo.</span>' +
      '<textarea id="cml-obs" maxlength="4000" style="min-height:130px" ' +
      'placeholder="Tem interesse no serviço. Tem orçamento. Precisa falar com o sócio antes de decidir.">' +
      esc(novo ? '' : (l.observacoes || '')) + '</textarea></div>' +

    '<div class="field" style="margin-top:4px"><label for="cml-qual">Lead qualificado?</label>' +
      '<select id="cml-qual">' +
        ['pendente|Pendente de avaliação', 'sim|Sim', 'nao|Não'].map(function (o) {
          const v = o.split('|');
          return '<option value="' + v[0] + '"' +
            (!novo && l.qualificacao === v[0] ? ' selected' : '') + '>' + v[1] + '</option>';
        }).join('') +
      '</select></div>' +

    '<div id="cml-saida"></div>' +

    '<div class="row row-wrap" style="gap:10px;margin-top:22px">' +
      '<button class="btn" id="cml-salvar">' + (novo ? 'Criar Novo Lead' : 'Salvar lead') + '</button>' +
      '<button class="btn btn-ghost" id="cml-fechar">Cancelar</button>' +
      (novo ? '' : '<span style="flex:1"></span>' +
        '<button class="btn btn-danger btn-sm" id="cml-excluir">Excluir</button>') +
    '</div>';

  document.getElementById('gaveta').style.display = 'flex';

  // a máscara do CNPJ, enquanto digita
  const cnpj = document.getElementById('cml-cnpj');
  cnpj.addEventListener('input', function () {
    const n = this.value.replace(/\D/g, '').slice(0, 14);
    let saida = n;
    if (n.length > 2) saida = n.slice(0, 2) + '.' + n.slice(2);
    if (n.length > 5) saida = n.slice(0, 2) + '.' + n.slice(2, 5) + '.' + n.slice(5);
    if (n.length > 8) saida = n.slice(0, 2) + '.' + n.slice(2, 5) + '.' + n.slice(5, 8) + '/' + n.slice(8);
    if (n.length > 12) saida = n.slice(0, 2) + '.' + n.slice(2, 5) + '.' + n.slice(5, 8) + '/' + n.slice(8, 12) + '-' + n.slice(12);
    this.value = saida;
  });

  // marcou reunião? então aparecem a data, a hora e o comparecimento
  const agendado = document.getElementById('cml-agendado');
  agendado.addEventListener('change', function () {
    const sim = this.value === 'sim';
    document.getElementById('cml-quando').style.display = sim ? '' : 'none';
    document.getElementById('cml-comp-campo').hidden = !sim;
    if (sim && !document.getElementById('cml-data').value) {
      document.getElementById('cml-data').value = new Date().toISOString().slice(0, 10);
    }
  });

  document.getElementById('cml-fechar').addEventListener('click', fechaGaveta);

  document.getElementById('cml-salvar').addEventListener('click', async function () {
    const sim = document.getElementById('cml-agendado').value === 'sim';
    const corpo = {
      id: novo ? null : l.id,
      participante_id: p.id,
      nome: document.getElementById('cml-nome').value,
      contato: document.getElementById('cml-contato').value,
      cidade: document.getElementById('cml-cidade').value,
      cnpj: document.getElementById('cml-cnpj').value,
      nicho: document.getElementById('cml-nicho').value,
      agendado: sim,
      agendado_data: sim ? document.getElementById('cml-data').value : '',
      agendado_hora: sim ? document.getElementById('cml-hora').value : '',
      comparecimento: sim ? document.getElementById('cml-comp').value : 'aguardando',
      observacoes: document.getElementById('cml-obs').value,
      qualificacao: document.getElementById('cml-qual').value
    };
    if (!corpo.nome.trim()) { toast('Escreva o nome do lead', true); return; }

    this.disabled = true; this.innerHTML = '<span class="spinner"></span> Salvando…';
    try {
      await apiCm('cm_lead_salvar', { body: corpo });
      toast(novo ? 'Lead cadastrado' : 'Lead salvo');
      fechaGaveta();
      cmRemonta();                        // só o miolo; a tela não recarrega
    } catch (e) {
      document.getElementById('cml-saida').innerHTML =
        '<div class="alert alert-erro" style="margin-top:14px">' + esc(e.message) + '</div>';
      this.disabled = false; this.textContent = novo ? 'Criar Novo Lead' : 'Salvar lead';
    }
  });

  const ex = document.getElementById('cml-excluir');
  if (ex) ex.addEventListener('click', function () {
    spConfirma('Excluir o lead?',
      '<strong>' + esc(l.nome) + '</strong> sai da simulação e dos indicadores.',
      async function () {
        try {
          await apiCm('cm_lead_excluir', { body: { id: l.id } });
          toast('Lead excluído');
          fechaGaveta();
          cmRemonta();
        } catch (e) { toast(e.message, true); }
      }, 'Excluir');
  });
}

/* ============================================================
   LEADS · AGENDA · ATENDIMENTO

   O menu foi pedido com os quatro itens, e o módulo funcional
   desta entrega é o de Simulações. Estas três telas dizem a
   verdade sobre isso, em vez de mostrar um gráfico vazio que
   finge ser um produto.
   ============================================================ */
function cmEmBreve(titulo, texto, atalho) {
  return '<div class="card op-entra" style="text-align:center;padding:52px 26px">' +
    '<div style="font-size:16px;font-weight:600;margin-bottom:8px">' + titulo + '</div>' +
    '<div class="small muted" style="max-width:470px;margin:0 auto;line-height:1.65">' + texto + '</div>' +
    (atalho ? '<div style="margin-top:20px">' + atalho + '</div>' : '') +
    '</div>';
}

function carregaCmLeads() {
  document.getElementById('painel-cmleads').innerHTML = cmEmBreve(
    'Leads comerciais',
    'Aqui vai ficar a carteira de leads de verdade do comercial. Ela ainda não existe — ' +
    'e os leads de <strong>Simulações</strong> são de treino, então não entram aqui ' +
    'nem por acidente: são tabelas separadas.',
    '<button class="btn btn-sm btn-ghost" onclick="document.querySelector(\'#abas button[data-aba=&quot;cmsimulacoes&quot;]\').click()">Ir para Simulações</button>'
  );
}

function carregaCmAgenda() {
  document.getElementById('painel-cmagenda').innerHTML = cmEmBreve(
    'Agenda comercial',
    'As reuniões de prospecção vão morar aqui. Não é a <strong>Agenda da Operação</strong>, ' +
    'que é das reuniões com clientes que já são da casa — essa continua no menu Operação, ' +
    'funcionando igual. São duas agendas diferentes de propósito.',
    ''
  );
}

function carregaCmAtendimento() {
  document.getElementById('painel-cmatendimento').innerHTML = cmEmBreve(
    'Atendimento',
    'O acompanhamento das conversas em andamento vai ficar aqui. Por enquanto, quem conversa ' +
    'com quem chega pelo site é a <strong>Aurea</strong>, no menu Automação.',
    ''
  );
}
