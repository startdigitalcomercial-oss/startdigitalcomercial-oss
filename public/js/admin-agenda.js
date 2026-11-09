/* ============================================================
   AGENDA OPERACIONAL — reuniões dos gestores com os clientes.

   Três jeitos de olhar o mesmo período: Mês, Semana e Dia. Os
   quatro indicadores saem da MESMA lista que o calendário mostra —
   se o cartão diz 5 e a tela mostra 3, alguém está mentindo.

   Atrasada não é um status: é a hora que passou sem ninguém dizer
   o que aconteceu. Quem disse "não realizada" já respondeu, e por
   isso sai das pendências.
   ============================================================ */

let AG = null;
let AG_VISTA = 'mes';                 // mes | semana | dia
let AG_REF = null;                    // a data de referência (YYYY-MM-DD)
let AG_GESTOR = '', AG_STATUS = '';

const AG_SEM = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const AG_MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

async function apiAg(action, opts) {
  opts = opts || {};
  const qs = new URLSearchParams(Object.assign({ action: action }, opts.params || {}));
  const res = await fetch('/api/agenda?' + qs.toString(), {
    method: opts.body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json().catch(function () { return { ok: false, error: 'resposta invalida' }; });
  if (res.status === 401) { sair(); throw new Error('sessao expirada'); }
  if (!data.ok) throw new Error(data.error || 'erro');
  return data;
}

/* ---------------- contas de data, sem biblioteca ---------------- */
function agDia(iso, mais) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + (mais || 0));
  return d.toISOString().slice(0, 10);
}
function agDiaSemana(iso) { return new Date(iso + 'T12:00:00Z').getUTCDay(); }
function agBr(iso) {
  const p = String(iso).slice(0, 10).split('-');
  return p.length === 3 ? p[2] + '/' + p[1] : iso;
}

// A janela que a vista pede. O servidor recebe {de, ate} e devolve
// só o que cabe ali.
function agJanela() {
  const ref = AG_REF;
  if (AG_VISTA === 'dia') return { de: ref, ate: ref };
  if (AG_VISTA === 'semana') {
    const dom = agDia(ref, -agDiaSemana(ref));
    return { de: dom, ate: agDia(dom, 6) };
  }
  const ano = Number(ref.slice(0, 4)), mes = Number(ref.slice(5, 7));
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return {
    de: ano + '-' + String(mes).padStart(2, '0') + '-01',
    ate: ano + '-' + String(mes).padStart(2, '0') + '-' + String(ultimo).padStart(2, '0')
  };
}

function agTitulo() {
  const j = agJanela();
  if (AG_VISTA === 'dia') {
    return AG_SEM[agDiaSemana(AG_REF)] + ', ' + agBr(AG_REF) + '/' + AG_REF.slice(0, 4);
  }
  if (AG_VISTA === 'semana') return agBr(j.de) + ' a ' + agBr(j.ate) + '/' + j.ate.slice(0, 4);
  return AG_MESES[Number(AG_REF.slice(5, 7)) - 1] + ' ' + AG_REF.slice(0, 4);
}

function agAnda(passo) {
  if (AG_VISTA === 'dia') AG_REF = agDia(AG_REF, passo);
  else if (AG_VISTA === 'semana') AG_REF = agDia(AG_REF, passo * 7);
  else {
    const ano = Number(AG_REF.slice(0, 4)), mes = Number(AG_REF.slice(5, 7));
    const o = ano * 12 + (mes - 1) + passo;
    const novo = { mes: (o % 12) + 1, ano: Math.floor(o / 12) };
    AG_REF = novo.ano + '-' + String(novo.mes).padStart(2, '0') + '-01';
  }
  agRemonta();
}

/* ---------------- carregar ----------------

   Buscar o período é ida ao servidor, não tem jeito: os dados de
   novembro não estavam na memória quando a pessoa pediu dezembro.

   O que MUDOU foi o que acontece enquanto isso. Antes a tela
   inteira era apagada e desenhada de novo — filtros, indicadores,
   calendário, o bloco do Google, tudo. Parecia um F5 a cada clique
   na seta, e o foco do teclado se perdia junto.

   Agora o casco fica onde está. O calendário velho continua à
   vista, só que apagadinho, e é trocado quando a resposta chega.
   Trocar de mês virou um piscar de olhos em vez de uma reconstrução.
   ---------------------------------------------------------------- */
async function agBusca() {
  if (!AG_REF) {
    const inicial = await apiAg('ag_lista');
    AG_REF = inicial.hoje;
    AG = inicial;
  }
  const j = agJanela();
  const p = { de: j.de, ate: j.ate };
  if (AG_GESTOR) p.gestor_id = AG_GESTOR;
  if (AG_STATUS) p.status = AG_STATUS;
  AG = await apiAg('ag_lista', { params: p });
}

async function carregaAgenda() {
  const alvo = document.getElementById('painel-opagenda');
  if (!AG) alvo.innerHTML = '<div class="spinner"></div>';
  try {
    await agBusca();
    desenhaAgenda();
  } catch (e) {
    alvo.innerHTML = '<div class="alert alert-erro">' + esc(e.message) + '</div>';
  }
}

/* Troca só o calendário e os números. O resto da tela não se mexe. */
let AG_VOANDO = false;
async function agRemonta() {
  if (AG_VOANDO) return;                 // dois cliques rápidos na seta não brigam
  const miolo = document.getElementById('ag-miolo');
  if (!miolo) { carregaAgenda(); return; }

  AG_VOANDO = true;
  miolo.classList.add('ag-esperando');
  // o título responde na hora, antes mesmo de os dados virem
  const tit = document.getElementById('ag-titulo');
  if (tit) tit.textContent = agTitulo();

  try {
    await agBusca();
    miolo.innerHTML = AG_VISTA === 'mes' ? agComoMes() : agComoAgenda();
    if (tit) tit.textContent = agTitulo();
    agAtualizaKpis();
    agLigaMiolo();
  } catch (e) {
    toast(e.message, true);
  }
  miolo.classList.remove('ag-esperando');
  AG_VOANDO = false;
}

/* Os quatro números no topo acompanham o período, sem redesenhar
   os cartões: só o texto de dentro muda. */
function agAtualizaKpis() {
  const k = (AG && AG.kpis) || {};
  const nums = document.querySelectorAll('#painel-opagenda .op-kpi .num');
  const valores = [k.hoje, k.agendadas, k.realizadas, k.atrasadas];
  nums.forEach(function (el, i) {
    if (valores[i] === undefined) return;
    el.dataset.ate = valores[i];
    el.textContent = valores[i];
  });
}

function desenhaAgenda() {
  const k = AG.kpis;
  const g = AG.google || {};

  const cartao = function (rot, valor, pe, ico, classe) {
    return '<div class="op-kpi ' + (classe || '') + '">' +
      '<div class="rot">' + rot + ico + '</div>' +
      '<div class="num" data-ate="' + valor + '">0</div>' +
      '<div class="pe">' + pe + '</div></div>';
  };
  const I = {
    hoje: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3.8" y="5.6" width="16.4" height="13.8" rx="2"/><path d="M3.8 9.8h16.4M8.6 3.6v3.4M15.4 3.6v3.4"/></svg>',
    agenda: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="8.4"/><path d="M12 7.4V12l3 1.8"/></svg>',
    feito: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="8.4"/><path d="m8.4 12.3 2.4 2.4 4.8-5.4"/></svg>',
    atraso: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="8.4"/><path d="M12 7.6v4.8M12 15.8v.2"/></svg>'
  };

  document.getElementById('painel-opagenda').innerHTML =
    '<div class="op">' +

    '<div class="op-cab op-entra">' +
      '<div><div class="small muted">Reuniões dos gestores com os clientes, num lugar só.</div></div>' +
      '<div class="op-filtros">' +
        '<select id="ag-gestor" aria-label="Gestor"><option value="">Todos os gestores</option>' +
          (AG.gestores || []).map(function (x) {
            return '<option value="' + esc(x.id) + '"' + (AG_GESTOR === x.id ? ' selected' : '') + '>' +
              esc(x.nome) + '</option>';
          }).join('') + '</select>' +
        '<select id="ag-status" aria-label="Situação"><option value="">Todas as situações</option>' +
          (AG.status || []).map(function (s) {
            return '<option value="' + s + '"' + (AG_STATUS === s ? ' selected' : '') + '>' +
              esc(AG.status_nome[s]) + '</option>';
          }).join('') + '</select>' +
        '<button class="btn btn-sm" id="ag-nova">+ Reunião</button>' +
      '</div>' +
    '</div>' +

    // ---------- os quatro indicadores ----------
    '<div class="op-kpis op-entra" style="animation-delay:60ms;grid-template-columns:repeat(auto-fit,minmax(176px,1fr))">' +
      cartao('Reuniões para hoje', k.hoje, 'na data de hoje', I.hoje, '') +
      cartao('Agendadas', k.agendadas, 'ainda sem resposta', I.agenda, 'agenda') +
      cartao('Realizadas', k.realizadas, 'aconteceram no período', I.feito, 'bom') +
      cartao('Atrasadas', k.atrasadas, 'a hora passou e ninguém respondeu', I.atraso, 'atencao') +
    '</div>' +

    // ---------- navegação do calendário ----------
    '<div class="ag-barra op-entra" style="animation-delay:120ms">' +
      '<div class="row" style="gap:6px;align-items:center">' +
        '<button class="btn btn-sm btn-ghost ag-seta" id="ag-antes" aria-label="Mês anterior">' +
          '<svg class="ico" width="16" height="16" viewBox="0 0 24 24"><path d="m14 6-6 6 6 6"/></svg></button>' +
        '<button class="btn btn-sm btn-ghost" id="ag-hoje">Hoje</button>' +
        '<button class="btn btn-sm btn-ghost ag-seta" id="ag-depois" aria-label="Próximo mês">' +
          '<svg class="ico" width="16" height="16" viewBox="0 0 24 24"><path d="m10 6 6 6-6 6"/></svg></button>' +
        '<strong id="ag-titulo" class="ag-titulo">' + esc(agTitulo()) + '</strong>' +
      '</div>' +
      '<div class="fd2-filtro" id="ag-vista">' +
        ['mes|Mês', 'semana|Semana', 'dia|Dia'].map(function (o) {
          const p = o.split('|');
          return '<button type="button" data-v="' + p[0] + '"' +
            (AG_VISTA === p[0] ? ' class="on"' : '') + '>' + p[1] + '</button>';
        }).join('') +
      '</div>' +
    '</div>' +

    '<div class="op-entra" id="ag-miolo" style="animation-delay:160ms">' +
      (AG_VISTA === 'mes' ? agComoMes() : agComoAgenda()) + '</div>' +

    // ---------- Google ----------
    '<div class="card op-entra" style="margin-top:14px;animation-delay:220ms">' +
      '<div class="row row-wrap" style="justify-content:space-between;align-items:flex-start;gap:12px">' +
        '<div style="min-width:0">' +
          '<h3 style="margin:0 0 3px;font-size:15.5px">Google Calendar</h3>' +
          '<div class="small muted">' + agGoogleRecado(g) + '</div>' +
        '</div>' +
        '<div class="row row-wrap" style="gap:8px">' + agGoogleBotoes(g) + '</div>' +
      '</div>' +
      (g.configurado ? '' :
        '<div class="alert alert-info small" style="margin:14px 0 0">' +
          '<strong>O que falta para ligar:</strong><ol style="margin:8px 0 0 18px;line-height:1.8">' +
          '<li>Criar um projeto em <code>console.cloud.google.com</code></li>' +
          '<li>Ativar a API <strong>Google Calendar</strong> (não é a do Gmail)</li>' +
          '<li>Criar uma credencial OAuth 2.0 do tipo “Aplicativo da Web”</li>' +
          '<li>Em “URIs de redirecionamento autorizados”, colar:<br>' +
            '<code style="word-break:break-all">' + esc(g.redirect_uri || '') + '</code></li>' +
          '<li>Criar <code>GOOGLE_CLIENT_ID</code> e <code>GOOGLE_CLIENT_SECRET</code> na Vercel ' +
            'e fazer <strong>Redeploy</strong></li>' +
          '</ol></div>') +
    '</div>' +

    '</div>';

  opAnima('painel-opagenda');
  ligaAgenda();
}

function agGoogleRecado(g) {
  if (!g.configurado) return 'Ainda não configurado nesta instalação — veja abaixo o que falta.';
  if (!g.conectado) return 'Conecte a sua conta Google para ver as reuniões do seu calendário aqui.';
  return 'Conectado' + (g.email ? ' como ' + esc(g.email) : '') +
    (g.ultimo_sync ? ' · última sincronização ' + dataBr(g.ultimo_sync) : '');
}

function agGoogleBotoes(g) {
  if (!g.configurado) return '<span class="tag">não configurado</span>';
  if (!g.conectado) return '<button class="btn btn-sm" id="ag-g-ligar">Conectar Google Calendar</button>';
  return '<button class="btn btn-sm" id="ag-g-sync">Sincronizar período</button>' +
    '<button class="btn btn-sm btn-ghost" id="ag-g-sair">Desconectar</button>';
}

/* ---------------- vista de mês ---------------- */
function agComoMes() {
  const j = agJanela();
  const primeiro = j.de;
  const comeca = agDia(primeiro, -agDiaSemana(primeiro));
  const porDia = {};
  (AG.reunioes || []).forEach(function (r) { (porDia[r.dia] || (porDia[r.dia] = [])).push(r); });

  let celulas = '';
  for (let i = 0; i < 42; i++) {
    const d = agDia(comeca, i);
    if (i >= 35 && d > j.ate) break;
    const fora = d < j.de || d > j.ate;
    const itens = porDia[d] || [];
    celulas += '<div class="ag-cel' + (fora ? ' fora' : '') + (d === AG.hoje ? ' hoje' : '') + '" data-dia="' + d + '">' +
      '<div class="ag-num-linha"><div class="ag-num">' + Number(d.slice(8, 10)) + '</div></div>' +
      itens.slice(0, 3).map(function (r) {
        return '<button type="button" class="ag-chip ' + agClasse(r) + ' ag-abrir" data-id="' + esc(r.id) + '" ' +
          'title="' + esc(r.hora + ' · ' + r.titulo) + '">' +
          '<span class="ag-h">' + esc(r.hora.split(' ')[0]) + '</span>' +
          '<span>' + esc(r.titulo) + '</span></button>';
      }).join('') +
      (itens.length > 3 ? '<button type="button" class="ag-mais" data-dia="' + d + '">+' +
        (itens.length - 3) + '</button>' : '') +
    '</div>';
  }

  return '<div class="card" style="padding:0;overflow:hidden">' +
    '<div class="ag-sem">' + AG_SEM.map(function (s) { return '<div>' + s + '</div>'; }).join('') + '</div>' +
    '<div class="ag-mes">' + celulas + '</div></div>';
}

/* ---------------- semana e dia: lista por dia ---------------- */
function agComoAgenda() {
  const j = agJanela();
  const dias = [];
  for (let d = j.de; d <= j.ate; d = agDia(d, 1)) dias.push(d);

  const porDia = {};
  (AG.reunioes || []).forEach(function (r) { (porDia[r.dia] || (porDia[r.dia] = [])).push(r); });

  const temAlgo = (AG.reunioes || []).length > 0;
  if (!temAlgo) {
    return '<div class="card" style="text-align:center;padding:44px 24px">' +
      '<div style="font-size:15px;font-weight:600;margin-bottom:6px">Nenhuma reunião neste período</div>' +
      '<div class="small muted">Use <strong>+ Reunião</strong> para marcar a primeira.</div></div>';
  }

  return '<div class="card" style="padding:0;overflow:hidden">' +
    dias.map(function (d) {
      const itens = porDia[d] || [];
      if (!itens.length && AG_VISTA === 'semana') return '';
      return '<div class="ag-dia' + (d === AG.hoje ? ' hoje' : '') + '">' +
        '<div class="ag-dia-cab">' + AG_SEM[agDiaSemana(d)] + ', ' + agBr(d) +
          (d === AG.hoje ? ' <span class="tag">hoje</span>' : '') +
          '<b>' + itens.length + '</b></div>' +
        (itens.length ? itens.map(agLinha).join('')
          : '<div class="small muted" style="padding:10px 18px 16px">Nada marcado.</div>') +
      '</div>';
    }).join('') + '</div>';
}

function agLinha(r) {
  return '<button type="button" class="ag-linha ag-abrir" data-id="' + esc(r.id) + '">' +
    '<span class="ag-hora">' + esc(r.hora) + '</span>' +
    '<span class="ag-corpo">' +
      '<span class="ag-tit">' + esc(r.titulo) + '</span>' +
      '<span class="small muted">' +
        (r.cliente ? esc(r.cliente) + ' · ' : '') + esc(r.gestor) +
        (r.origem === 'google' ? ' · <span class="tag">Google</span>' : '') +
      '</span>' +
    '</span>' +
    agPino(r) +
  '</button>';
}

function agClasse(r) {
  if (r.status === 'realizada') return 'feita';
  if (r.status === 'nao_realizada') return 'nao';
  if (r.status === 'cancelada') return 'cancelada';
  return r.atrasada ? 'atrasada' : 'agendada';
}
function agPino(r) {
  if (r.status === 'realizada') return '<span class="op-pino ativo">Realizada</span>';
  if (r.status === 'nao_realizada') return '<span class="op-pino flopado">Não realizada</span>';
  if (r.status === 'cancelada') return '<span class="op-pino cancelado">Cancelada</span>';
  if (r.atrasada) return '<span class="op-pino suspenso">Atrasada</span>';
  return '<span class="op-pino agendada">Agendada</span>';
}

/* As ligações que vivem DENTRO do calendário. Ficam separadas
   porque o miolo é trocado sozinho quando se muda de mês, e os
   cliques precisam ser religados nos elementos novos. */
function agLigaMiolo() {
  document.querySelectorAll('#painel-opagenda .ag-abrir').forEach(function (x) {
    x.addEventListener('click', function (ev) { ev.stopPropagation(); abreReuniao(x.dataset.id); });
  });
  document.querySelectorAll('#painel-opagenda .ag-mais').forEach(function (x) {
    x.addEventListener('click', function () {
      AG_VISTA = 'dia'; AG_REF = x.dataset.dia;
      document.querySelectorAll('#ag-vista button').forEach(function (bt) {
        bt.classList.toggle('on', bt.dataset.v === 'dia');
      });
      agRemonta();
    });
  });
  document.querySelectorAll('#painel-opagenda .ag-cel').forEach(function (c) {
    c.addEventListener('dblclick', function () { abreReuniao(null, c.dataset.dia); });
  });
}

/* ---------------- ligações ---------------- */
function ligaAgenda() {
  const b = function (id) { return document.getElementById(id); };

  b('ag-antes').addEventListener('click', function () { agAnda(-1); });
  b('ag-depois').addEventListener('click', function () { agAnda(1); });
  b('ag-hoje').addEventListener('click', function () { AG_REF = AG.hoje; agRemonta(); });
  document.querySelectorAll('#ag-vista button').forEach(function (bt) {
    bt.addEventListener('click', function () {
      if (AG_VISTA === bt.dataset.v) return;
      AG_VISTA = bt.dataset.v;
      // o botão acende na hora; os dados chegam depois
      document.querySelectorAll('#ag-vista button').forEach(function (x) {
        x.classList.toggle('on', x === bt);
      });
      agRemonta();
    });
  });
  b('ag-gestor').addEventListener('change', function () { AG_GESTOR = this.value; agRemonta(); });
  b('ag-status').addEventListener('change', function () { AG_STATUS = this.value; agRemonta(); });
  b('ag-nova').addEventListener('click', function () { abreReuniao(null); });

  agLigaMiolo();

  const gl = b('ag-g-ligar');
  if (gl) gl.addEventListener('click', async function () {
    this.disabled = true;
    try {
      const r = await apiAg('ag_google_ligar');
      location.href = r.url;
    } catch (e) { toast(e.message, true); this.disabled = false; }
  });
  const gs = b('ag-g-sync');
  if (gs) gs.addEventListener('click', async function () {
    this.disabled = true; this.innerHTML = '<span class="spinner"></span> Sincronizando…';
    try {
      const j = agJanela();
      const r = await apiAg('ag_google_sync', { body: { de: j.de, ate: j.ate } });
      toast(r.novos + ' nova(s) · ' + r.atualizados + ' atualizada(s)');
      carregaAgenda();                   // o cartão do Google também muda
    } catch (e) {
      toast(e.message, true);
      this.disabled = false; this.textContent = 'Sincronizar período';
    }
  });
  const gx = b('ag-g-sair');
  if (gx) gx.addEventListener('click', function () {
    spConfirma('Desconectar o Google?',
      'As reuniões já importadas continuam aqui. Novas sincronizações param até você conectar de novo.',
      async function () {
        try {
          await apiAg('ag_google_desligar', { body: {} });
          toast('Google desconectado');
          carregaAgenda();
        } catch (e) { toast(e.message, true); }
      }, 'Desconectar');
  });
}

/* ---------------- a ficha da reunião ---------------- */
function agParaInput(iso) {
  if (!iso) return '';
  // datetime-local quer a hora LOCAL de quem olha, sem fuso no fim
  const d = new Date(iso);
  const p = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).format(d);
  return p.replace(' ', 'T').slice(0, 16);
}
function agDeInput(valor) {
  // o que a pessoa digitou é horário de São Paulo
  return valor ? valor + ':00-03:00' : '';
}

function abreReuniao(id, diaSugerido) {
  const novo = !id;
  const r = novo ? {} : ((AG.reunioes || []).filter(function (x) { return x.id === id; })[0] || {});
  const doGoogle = r.origem === 'google';

  document.getElementById('g-nome').textContent = novo ? 'Nova reunião' : (r.titulo || 'Reunião');
  document.getElementById('g-sub').textContent = novo
    ? 'Fica ligada ao cliente e ao gestor da Gestão.'
    : (r.hora || '') + (doGoogle ? ' · veio do Google Calendar' : '');

  const base = diaSugerido || (AG_VISTA === 'dia' ? AG_REF : AG.hoje);

  document.getElementById('g-corpo').innerHTML =
    '<div class="field"><label for="ag-f-tit">Título</label>' +
      '<input id="ag-f-tit" maxlength="160" value="' + esc(r.titulo || '') + '"></div>' +

    '<div class="row row-wrap" style="gap:14px">' +
      '<div class="field" style="flex:1;min-width:160px"><label for="ag-f-cliente">Cliente</label>' +
        '<select id="ag-f-cliente"><option value="">— sem cliente —</option>' +
          (AG.clientes || []).map(function (c) {
            return '<option value="' + esc(c.id) + '" data-g="' + esc(c.gestor_id || '') + '"' +
              (r.cliente_id === c.id ? ' selected' : '') + '>' + esc(c.nome) + '</option>';
          }).join('') + '</select></div>' +
      '<div class="field" style="flex:1;min-width:160px"><label for="ag-f-gestor">Gestor</label>' +
        '<select id="ag-f-gestor"><option value="">— sem gestor —</option>' +
          (AG.gestores || []).map(function (g) {
            return '<option value="' + esc(g.id) + '"' + (r.gestor_id === g.id ? ' selected' : '') + '>' +
              esc(g.nome) + '</option>';
          }).join('') + '</select></div>' +
    '</div>' +

    '<div class="row row-wrap" style="gap:14px">' +
      '<div class="field" style="flex:1;min-width:180px"><label for="ag-f-inicio">Início</label>' +
        '<input type="datetime-local" id="ag-f-inicio" value="' +
          esc(novo ? base + 'T09:00' : agParaInput(r.inicio)) + '"></div>' +
      '<div class="field" style="flex:1;min-width:180px"><label for="ag-f-fim">Fim</label>' +
        '<input type="datetime-local" id="ag-f-fim" value="' +
          esc(novo ? base + 'T10:00' : agParaInput(r.fim)) + '"></div>' +
    '</div>' +

    '<div class="field"><label for="ag-f-link">Link da reunião</label>' +
      '<span class="hint">Meet, Zoom, o que vocês usarem.</span>' +
      '<input id="ag-f-link" maxlength="400" value="' + esc(r.link || '') + '"></div>' +

    '<div class="field"><label for="ag-f-obs">Observação</label>' +
      '<input id="ag-f-obs" maxlength="500" value="' + esc(r.observacao || '') + '"></div>' +

    (novo ? '' :
      '<hr class="sep">' +
      '<div class="small muted" style="margin-bottom:10px">Esta reunião aconteceu?</div>' +
      '<div class="row row-wrap" style="gap:10px">' +
        '<button class="btn btn-sm" id="ag-f-feita">✓ Realizada</button>' +
        '<button class="btn btn-sm btn-ghost" id="ag-f-nao" style="color:var(--red)">✕ Não realizada</button>' +
        (r.status !== 'cancelada' ? '<button class="btn btn-sm btn-ghost" id="ag-f-cancelar">Cancelar reunião</button>' : '') +
        (r.status !== 'agendada' ? '<button class="btn btn-sm btn-ghost" id="ag-f-voltar">Voltar para agendada</button>' : '') +
      '</div>' +
      (r.resolvido_em
        ? '<div class="small muted" style="margin-top:10px">' + esc(r.status_nome) + ' em ' +
          dataBr(r.resolvido_em) + (r.resolvido_por ? ' por ' + esc(r.resolvido_por) : '') + '.</div>'
        : (r.atrasada
          ? '<div class="small" style="margin-top:10px;color:var(--orange)">A hora já passou e ninguém respondeu — ' +
            'por isso ela conta como <strong>atrasada</strong>.</div>' : ''))) +

    '<div class="row row-wrap" style="gap:12px;margin-top:20px">' +
      '<button class="btn" id="ag-f-salvar">' + (novo ? 'Marcar reunião' : 'Salvar') + '</button>' +
      (novo || doGoogle ? '' :
        '<button class="btn btn-sm btn-ghost" id="ag-f-excluir" style="color:var(--red)">Excluir</button>') +
    '</div>' +
    (doGoogle
      ? '<div class="small muted" style="margin-top:12px">Este evento veio do Google Calendar. ' +
        'O que você mudar aqui vale no sistema; o evento no Google continua como está.</div>' : '') +
    '<div id="ag-f-saida"></div>';

  document.getElementById('fundo').style.display = 'block';
  document.getElementById('gaveta').style.display = 'flex';

  const selC = document.getElementById('ag-f-cliente');
  selC.addEventListener('change', function () {
    const g = this.options[this.selectedIndex].dataset.g;
    if (g && !document.getElementById('ag-f-gestor').value) {
      document.getElementById('ag-f-gestor').value = g;
    }
  });

  document.getElementById('ag-f-salvar').addEventListener('click', async function () {
    const corpo = {
      id: novo ? undefined : r.id,
      titulo: document.getElementById('ag-f-tit').value,
      cliente_id: selC.value || null,
      gestor_id: document.getElementById('ag-f-gestor').value || null,
      inicio: agDeInput(document.getElementById('ag-f-inicio').value),
      fim: agDeInput(document.getElementById('ag-f-fim').value),
      link: document.getElementById('ag-f-link').value,
      observacao: document.getElementById('ag-f-obs').value
    };
    if (!corpo.titulo.trim()) return toast('Escreva o título', true);
    this.disabled = true; this.innerHTML = '<span class="spinner"></span> Salvando…';
    try {
      const out = await apiAg('ag_salvar', { body: corpo });
      toast(out.aviso || (novo ? 'Reunião marcada' : 'Reunião salva'));
      fechaGaveta();
      agRemonta();                       // só o calendário se repinta
    } catch (e) {
      document.getElementById('ag-f-saida').innerHTML =
        '<div class="alert alert-erro" style="margin-top:14px">' + esc(e.message) + '</div>';
      this.disabled = false; this.textContent = novo ? 'Marcar reunião' : 'Salvar';
    }
  });

  if (!novo) {
    const marca = async function (status, recado) {
      try {
        const out = await apiAg('ag_status', { body: { id: r.id, status: status } });
        toast(out.aviso || recado);
        fechaGaveta();
        agRemonta();
      } catch (e) { toast(e.message, true); }
    };
    const liga = function (id, status, recado) {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', function () { marca(status, recado); });
    };
    liga('ag-f-feita', 'realizada', 'Marcada como realizada');
    liga('ag-f-nao', 'nao_realizada', 'Marcada como não realizada');
    liga('ag-f-cancelar', 'cancelada', 'Reunião cancelada');
    liga('ag-f-voltar', 'agendada', 'Voltou para agendada');

    const ex = document.getElementById('ag-f-excluir');
    if (ex) ex.addEventListener('click', function () {
      spConfirma('Excluir a reunião?', '<strong>' + esc(r.titulo) + '</strong> sai da agenda de vez.',
        async function () {
          try {
            await apiAg('ag_excluir', { body: { id: r.id } });
            toast('Reunião excluída');
            fechaGaveta();
            agRemonta();
          } catch (e) { toast(e.message, true); }
        }, 'Excluir');
    });
  }
}
