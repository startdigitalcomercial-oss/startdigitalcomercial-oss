// ============================================================
// Teste do ONBOARDING e da AGENDA.
// Uso:  ADMIN_PASSWORD="sua-senha" node tools/test-onboarding-agenda.js
// Precisa do espelho local no ar (sh tools/start-local.sh).
// ============================================================
'use strict';

const BASE = 'http://localhost:3000';
const SUF = Date.now().toString(36);
const SENHA = process.env.ADMIN_PASSWORD || process.env.ADMIN_SECRET || '';
let ok = 0, falhas = 0;
let T = '';

if (!SENHA) {
  console.error('Falta a senha. Rode:  ADMIN_PASSWORD="sua-senha" node tools/test-onboarding-agenda.js');
  process.exit(1);
}

function check(nome, cond, extra) {
  if (cond) { ok++; console.log('  ok   ' + nome); }
  else {
    falhas++;
    console.log('  FALHA ' + nome + (extra !== undefined ? '  \u2192 ' + JSON.stringify(extra) : ''));
  }
}

function hojeSP() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}
function maisDias(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

(async function () {
  console.log('\nONBOARDING e AGENDA');

  T = (await (await fetch(BASE + '/api/admin?action=login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: SENHA })
  })).json()).token;
  check('entrou no painel', !!T);
  if (!T) { console.log('\n0 passaram \u00b7 1 falharam'); process.exit(1); }

  async function op(action, body, query) {
    const qs = new URLSearchParams(Object.assign({ action: action }, query || {}));
    return (await fetch(BASE + '/api/operacao?' + qs, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + T },
      body: body ? JSON.stringify(body) : undefined
    })).json();
  }
  async function ag(action, body, query) {
    const qs = new URLSearchParams(Object.assign({ action: action }, query || {}));
    return (await fetch(BASE + '/api/agenda?' + qs, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + T },
      body: body ? JSON.stringify(body) : undefined
    })).json();
  }

  const HOJE = hojeSP();

  // dois clientes de teste, na carteira de um gestor
  const gestores = (await op('op_gestores')).gestores;
  const G1 = gestores[0].id, G2 = gestores[1].id;
  const c1 = (await op('op_cliente_salvar', { nome: 'Onb Um ' + SUF, gestor_id: G1 })).cliente;
  const c2 = (await op('op_cliente_salvar', { nome: 'Onb Dois ' + SUF, gestor_id: G1 })).cliente;
  const c3 = (await op('op_cliente_salvar', { nome: 'Onb Tres ' + SUF, gestor_id: G2 })).cliente;

  // ============================================================
  console.log('\n1) ONBOARDING');
  // ============================================================
  const base = await op('ob_lista');
  check('a lista de onboarding responde', base.ok, base.error);
  check('traz as 6 colunas com os nomes do documento',
    (base.colunas || []).map(function (c) { return c.nome; }).join('|') ===
    'Em andamento|Atrasados|Concluídos no mês|Em dia|A vencer em 7 dias|A iniciar',
    (base.colunas || []).map(function (c) { return c.nome; }));
  check('oferece os clientes da Gestão para escolher',
    (base.disponiveis || []).some(function (d) { return d.id === c1.id; }));

  // ---- criar ----
  const o1 = await op('ob_salvar', {
    cliente_id: c1.id, gestor_id: G1,
    inicio_previsto: HOJE, prazo: maisDias(HOJE, 30), iniciar: true
  });
  check('cria um onboarding ja iniciado', o1.ok && o1.onboarding.situacao === 'em_andamento', o1.error);
  check('e guarda a data de inicio', o1.onboarding.iniciado_em === HOJE, o1.onboarding.iniciado_em);

  const o2 = await op('ob_salvar', { cliente_id: c2.id, gestor_id: G1, prazo: maisDias(HOJE, 60) });
  check('cria um onboarding guardado para comecar depois',
    o2.ok && o2.onboarding.situacao === 'a_iniciar', o2.error);

  check('sem cliente nao cria', !(await op('ob_salvar', { gestor_id: G1 })).ok);
  check('sem gestor nao cria', !(await op('ob_salvar', { cliente_id: c3.id })).ok);
  check('o MESMO cliente nao tem dois onboardings abertos',
    !(await op('ob_salvar', { cliente_id: c1.id, gestor_id: G1 })).ok);
  check('e o cliente ocupado some da lista de escolha',
    !((await op('ob_lista')).disponiveis || []).some(function (d) { return d.id === c1.id; }));

  // ---- as colunas ----
  {
    const l = await op('ob_lista');
    const meu = function (id) { return l.onboardings.filter(function (x) { return x.id === id; })[0]; };
    check('prazo longe = coluna "Em dia"', meu(o1.onboarding.id).coluna === 'em_dia', meu(o1.onboarding.id).coluna);
    check('nao iniciado = coluna "A iniciar"', meu(o2.onboarding.id).coluna === 'a_iniciar');

    // CADA CARD EM UMA COLUNA SO — a regra que o documento exige
    const contagem = {};
    l.onboardings.forEach(function (o) { contagem[o.id] = (contagem[o.id] || 0) + 1; });
    check('NENHUM card aparece em duas colunas',
      Object.keys(contagem).every(function (k) { return contagem[k] === 1; }));
    check('e todo card tem exatamente uma coluna',
      l.onboardings.every(function (o) { return !!o.coluna; }));
  }

  // ---- prazo vencido vira atrasado, sozinho ----
  {
    await op('ob_salvar', { id: o1.onboarding.id, cliente_id: c1.id, gestor_id: G1,
      prazo: maisDias(HOJE, -3) });
    const l = await op('ob_lista');
    const meu = l.onboardings.filter(function (x) { return x.id === o1.onboarding.id; })[0];
    check('PRAZO VENCIDO cai em "Atrasados" sem ninguem mexer', meu.coluna === 'atrasados', meu.coluna);
    check('e a situacao continua "em andamento" (atraso nao e status)',
      meu.situacao === 'em_andamento', meu.situacao);
    check('a tela recebe o aviso de atrasado', meu.atrasado === true);

    await op('ob_salvar', { id: o1.onboarding.id, cliente_id: c1.id, gestor_id: G1,
      prazo: maisDias(HOJE, 4) });
    const l2 = await op('ob_lista');
    check('prazo em 4 dias cai em "A vencer em 7 dias"',
      l2.onboardings.filter(function (x) { return x.id === o1.onboarding.id; })[0].coluna === 'a_vencer');
  }

  // ---- mover ----
  check('inicia um onboarding guardado',
    (await op('ob_mover', { id: o2.onboarding.id, situacao: 'em_andamento' })).onboarding.iniciado_em === HOJE);
  const concl = await op('ob_mover', { id: o2.onboarding.id, situacao: 'concluido' });
  check('conclui e guarda a data', concl.ok && concl.onboarding.concluido_em === HOJE, concl.error);
  check('concluido no mes aparece na coluna do mes',
    (await op('ob_lista')).onboardings
      .filter(function (x) { return x.id === o2.onboarding.id; })[0].coluna === 'concluidos_mes');
  check('num mes antigo, ele NAO aparece como concluido daquele mes',
    (await op('ob_lista', null, { mes: 1, ano: 2020 })).onboardings
      .filter(function (x) { return x.id === o2.onboarding.id; })[0].coluna === 'fora_do_mes');
  check('concluir libera o cliente para um onboarding novo',
    ((await op('ob_lista')).disponiveis || []).some(function (d) { return d.id === c2.id; }));
  check('situacao inventada e recusada',
    !(await op('ob_mover', { id: o2.onboarding.id, situacao: 'voando' })).ok);
  check('reabrir volta para em andamento',
    (await op('ob_mover', { id: o2.onboarding.id, situacao: 'em_andamento' })).onboarding.concluido_em === null);

  // ============================================================
  console.log('\n2) AGENDA');
  // ============================================================
  const a0 = await ag('ag_lista');
  check('a agenda responde', a0.ok, a0.error);
  check('vem com os quatro indicadores',
    a0.kpis && ['hoje', 'agendadas', 'realizadas', 'atrasadas']
      .every(function (k) { return typeof a0.kpis[k] === 'number'; }), a0.kpis);
  check('o Google aparece como NAO configurado (e e verdade)',
    a0.google.configurado === false && a0.google.conectado === false, a0.google);
  check('e o endereco de retorno do Google ja esta pronto',
    /\/api\/agenda\?action=google_callback$/.test(a0.google.redirect_uri || ''), a0.google.redirect_uri);

  const antesHoje = a0.kpis.hoje, antesAg = a0.kpis.agendadas;

  // ---- criar ----
  const r1 = await ag('ag_salvar', {
    titulo: 'Alinhamento ' + SUF, cliente_id: c1.id, gestor_id: G1,
    inicio: HOJE + 'T15:00:00-03:00', fim: HOJE + 'T16:00:00-03:00', link: 'https://meet.google.com/x'
  });
  check('marca uma reuniao', r1.ok, r1.error);
  check('sem titulo nao marca', !(await ag('ag_salvar', { titulo: ' ', inicio: HOJE + 'T10:00:00-03:00' })).ok);
  check('sem data nao marca', !(await ag('ag_salvar', { titulo: 'x' })).ok);
  check('data impossivel nao marca',
    !(await ag('ag_salvar', { titulo: 'x', inicio: 'nao-e-data' })).ok);
  check('fim antes do inicio nao marca',
    !(await ag('ag_salvar', { titulo: 'x', inicio: HOJE + 'T15:00:00-03:00', fim: HOJE + 'T14:00:00-03:00' })).ok);

  let a1 = await ag('ag_lista');
  check('a reuniao de hoje conta no indicador de hoje', a1.kpis.hoje === antesHoje + 1, a1.kpis);
  check('e tambem em agendadas', a1.kpis.agendadas === antesAg + 1);
  const naTela = a1.reunioes.filter(function (x) { return x.id === r1.reuniao.id; })[0];
  check('a reuniao traz cliente, gestor e horario',
    naTela && naTela.cliente && naTela.gestor && /\d\d:\d\d/.test(naTela.hora), naTela);
  check('e vem com o link', naTela.link === 'https://meet.google.com/x');

  // ---- ATRASADA x NAO REALIZADA ----
  {
    const passado = await ag('ag_salvar', {
      titulo: 'Ja passou ' + SUF, gestor_id: G1,
      inicio: maisDias(HOJE, -2) + 'T10:00:00-03:00', fim: maisDias(HOJE, -2) + 'T11:00:00-03:00'
    });
    const l = await ag('ag_lista', null, { de: maisDias(HOJE, -10), ate: HOJE });
    const velha = l.reunioes.filter(function (x) { return x.id === passado.reuniao.id; })[0];
    check('reuniao de ontem sem resposta conta como ATRASADA', velha.atrasada === true, velha);
    check('e o status continua "agendada"', velha.status === 'agendada');

    await ag('ag_status', { id: passado.reuniao.id, status: 'nao_realizada' });
    const l2 = await ag('ag_lista', null, { de: maisDias(HOJE, -10), ate: HOJE });
    const depois = l2.reunioes.filter(function (x) { return x.id === passado.reuniao.id; })[0];
    check('marcar NAO REALIZADA tira ela das atrasadas', depois.atrasada === false, depois);
    check('e guarda quando e quem respondeu', !!depois.resolvido_em && !!depois.resolvido_por, depois);
    check('"nao realizada" nao vira "cancelada"', depois.status === 'nao_realizada');
  }

  // ---- realizada muda os indicadores ----
  {
    const antes = (await ag('ag_lista')).kpis;
    await ag('ag_status', { id: r1.reuniao.id, status: 'realizada' });
    const depois = (await ag('ag_lista')).kpis;
    check('marcar REALIZADA sobe o indicador de realizadas',
      depois.realizadas === antes.realizadas + 1, { antes: antes, depois: depois });
    check('e tira das agendadas', depois.agendadas === antes.agendadas - 1);

    await ag('ag_status', { id: r1.reuniao.id, status: 'agendada' });
    const volta = (await ag('ag_lista')).reunioes.filter(function (x) { return x.id === r1.reuniao.id; })[0];
    check('voltar para agendada limpa a resposta', volta.resolvido_em === null, volta.resolvido_em);
    check('status inventado e recusado',
      !(await ag('ag_status', { id: r1.reuniao.id, status: 'talvez' })).ok);
  }

  // ---- filtros ----
  {
    const r2 = await ag('ag_salvar', {
      titulo: 'Do outro gestor ' + SUF, gestor_id: G2, cliente_id: c3.id,
      inicio: HOJE + 'T17:00:00-03:00'
    });
    const todos = await ag('ag_lista');
    const soG1 = await ag('ag_lista', null, { gestor_id: G1 });
    check('o filtro por gestor diminui a lista',
      soG1.reunioes.length < todos.reunioes.length && soG1.reunioes.length >= 1,
      { todos: todos.reunioes.length, g1: soG1.reunioes.length });
    check('e os indicadores acompanham o filtro', soG1.kpis.hoje <= todos.kpis.hoje);
    check('o filtro por gestor nao traz reuniao de outro',
      soG1.reunioes.every(function (x) { return x.gestor_id === G1; }));

    const soAgendadas = await ag('ag_lista', null, { status: 'agendada' });
    check('o filtro por situacao funciona',
      soAgendadas.reunioes.every(function (x) { return x.status === 'agendada'; }));

    const outroMes = await ag('ag_lista', null, { de: '2020-01-01', ate: '2020-01-31' });
    check('periodo antigo volta vazio', outroMes.reunioes.length === 0, outroMes.reunioes.length);
    check('e com os indicadores zerados',
      outroMes.kpis.hoje === 0 && outroMes.kpis.agendadas === 0, outroMes.kpis);

    check('da para excluir uma reuniao do sistema',
      (await ag('ag_excluir', { id: r2.reuniao.id })).ok);
  }

  // ---- Google: honesto sobre o que nao da ----
  {
    const st = await ag('ag_google_status');
    check('o status do Google diz o que falta configurar',
      st.ok && st.configurado === false && (st.precisa || []).length >= 4, st);
    check('conectar sem credencial e RECUSADO, nao fingido',
      !(await ag('ag_google_ligar')).ok);
    check('sincronizar sem credencial tambem',
      !(await ag('ag_google_sync', {})).ok);
  }

  // ---- as funcoes puras ----
  {
    const amod = require('../api/agenda.js');
    const agora = new Date().toISOString();
    check('atrasada = agendada + hora passou',
      amod.estaAtrasada({ status: 'agendada', inicio: '2020-01-01T10:00:00Z' }, agora) === true);
    check('realizada nunca e atrasada',
      amod.estaAtrasada({ status: 'realizada', inicio: '2020-01-01T10:00:00Z' }, agora) === false);
    check('nao realizada nunca e atrasada',
      amod.estaAtrasada({ status: 'nao_realizada', inicio: '2020-01-01T10:00:00Z' }, agora) === false);
    check('cancelada nunca e atrasada',
      amod.estaAtrasada({ status: 'cancelada', inicio: '2020-01-01T10:00:00Z' }, agora) === false);
    check('reuniao futura nao e atrasada',
      amod.estaAtrasada({ status: 'agendada', inicio: '2099-01-01T10:00:00Z' }, agora) === false);
    check('o fim e que manda, quando existe',
      amod.estaAtrasada({ status: 'agendada', inicio: '2020-01-01T10:00:00Z', fim: '2099-01-01T11:00:00Z' }, agora) === false);
    check('mes curto fecha no ultimo dia', amod.periodo({ mes: 2, ano: 2027 }).ate === '2027-02-28');
    check('datas invertidas sao acertadas',
      amod.periodo({ de: '2026-05-20', ate: '2026-05-02' }).de === '2026-05-02');
    check('sem credencial, googleConfigurado e false', amod.googleConfigurado() === false);
  }

  // ---- a tranca ----
  {
    const perms = require('../api/_lib/perms.js');
    check('dono ve a agenda', perms.permite('dono', 'ag_lista') === true);
    check('leitura NAO marca reuniao', perms.permite('leitura', 'ag_salvar') === false);
    check('leitura NAO muda status', perms.permite('leitura', 'ag_status') === false);
    check('so quem mexe em ajustes liga o Google',
      perms.permite('dono', 'ag_google_ligar') === true &&
      perms.permite('avaliador', 'ag_google_ligar') === false);
    check('o menu do dono tem Onboarding e Agenda',
      perms.menuDoPapel('dono').indexOf('oponboarding') >= 0 &&
      perms.menuDoPapel('dono').indexOf('opagenda') >= 0);
    check('sem cracha a agenda nao abre',
      !(await (await fetch(BASE + '/api/agenda?action=ag_lista')).json()).ok);
  }

  // ---- limpeza ----
  for (const c of [c1, c2, c3]) await op('op_cliente_excluir', { id: c.id });

  console.log('\n----------------------------------------');
  console.log(ok + ' passaram \u00b7 ' + falhas + ' falharam');
  process.exit(falhas ? 1 : 0);
})().catch(function (e) { console.error('EXPLODIU:', e); process.exit(1); });
