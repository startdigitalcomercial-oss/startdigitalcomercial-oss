// ============================================================
// Teste do modulo OPERACAO — carteira por gestor e dashboard.
// Uso:  ADMIN_PASSWORD="sua-senha" node tools/test-operacao.js
// Precisa do espelho local no ar (sh tools/start-local.sh).
//
// Mora num arquivo proprio de proposito: o test-novo.js ja passou
// dos 140 KB e virou um bloco que nao cabe mais em lugar nenhum.
// Suite nova, arquivo novo.
// ============================================================
'use strict';

const BASE = 'http://localhost:3000';
const SUF = Date.now().toString(36);
const SENHA = process.env.ADMIN_PASSWORD || process.env.ADMIN_SECRET || '';
let ok = 0, falhas = 0;
let T = '';

if (!SENHA) {
  console.error('Falta a senha. Rode:  ADMIN_PASSWORD="sua-senha" node tools/test-operacao.js');
  process.exit(1);
}

function check(nome, cond, extra) {
  if (cond) { ok++; console.log('  ok   ' + nome); }
  else {
    falhas++;
    console.log('  FALHA ' + nome + (extra !== undefined ? '  \\u2192 ' + JSON.stringify(extra) : ''));
  }
}

(async function () {
  console.log('\\nOPERACAO — carteira por gestor e dashboard');

  T = (await (await fetch(BASE + '/api/admin?action=login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: SENHA })
  })).json()).token;
  check('entrou no painel', !!T);
  if (!T) { console.log('\\n0 passaram \\u00b7 1 falharam'); process.exit(1); }

  async function op(action, body, query) {
    const qs = new URLSearchParams(Object.assign({ action: action }, query || {}));
    return (await fetch(BASE + '/api/operacao?' + qs, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + T },
      body: body ? JSON.stringify(body) : undefined
    })).json();
  }

  const hoje = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  const MES = Number(hoje.slice(5, 7)), ANO = Number(hoje.slice(0, 4));
  const ordem = ANO * 12 + (MES - 1);
  const ANT = { mes: ((ordem - 1) % 12) + 1, ano: Math.floor((ordem - 1) / 12) };
  const diaUmDoMesPassado = ANT.ano + '-' + String(ANT.mes).padStart(2, '0') + '-01';

  // ---- 1) os gestores ----
  const gs = await op('op_gestores');
  check('a operacao lista os gestores', gs.ok && gs.gestores.length >= 7, gs.error);
  check('os 7 gestores do documento estao la',
    ['Rafael', 'Bruno', 'Júnior', 'Renan', 'Igor', 'William', 'Gabriel']
      .every(function (n) { return gs.gestores.some(function (g) { return g.nome === n; }); }),
    gs.gestores.map(function (g) { return g.nome; }));
  check('cada gestor ja vem com os numeros da carteira',
    gs.gestores.every(function (g) { return typeof g.clientes === 'number' && typeof g.ativos === 'number'; }));
  check('gestor repetido nao entra',
    !(await op('op_gestor_salvar', { nome: 'Rafael' })).ok);
  check('gestor sem nome nao entra', !(await op('op_gestor_salvar', { nome: '  ' })).ok);

  const RAFA = gs.gestores.filter(function (g) { return g.nome === 'Rafael'; })[0].id;
  const BRUNO = gs.gestores.filter(function (g) { return g.nome === 'Bruno'; })[0].id;

  // ---- 2) cadastrar cliente ----
  const c1 = await op('op_cliente_salvar', {
    nome: 'Clinica ' + SUF, gestor_id: RAFA, categoria: 'Odontologia',
    fase: 'onboarding', status: 'ativo', satisfacao: 'satisfeito',
    entrou_em: diaUmDoMesPassado
  });
  check('cadastra cliente na carteira do gestor', c1.ok, c1.error);
  check('cliente sem gestor nao entra',
    !(await op('op_cliente_salvar', { nome: 'X ' + SUF })).ok);
  check('cliente sem nome nao entra',
    !(await op('op_cliente_salvar', { nome: ' ', gestor_id: RAFA })).ok);
  check('fase inventada vira onboarding',
    (await op('op_cliente_salvar', { nome: 'Fase ' + SUF, gestor_id: RAFA, fase: 'voando' }))
      .cliente.fase === 'onboarding');
  check('status inventado vira ativo',
    (await op('op_cliente_salvar', { nome: 'Sit ' + SUF, gestor_id: RAFA, status: 'sei-la' }))
      .cliente.status === 'ativo');
  check('satisfacao em branco fica NAO INFORMADO, nao vira satisfeito',
    (await op('op_cliente_salvar', { nome: 'Sem ' + SUF, gestor_id: RAFA })).cliente.satisfacao === null);

  // ---- 3) o dashboard reflete na hora ----
  let d = await op('op_dashboard');
  check('o dashboard responde', d.ok, d.error);
  check('o total conta os clientes cadastrados', d.kpis.total >= 4, d.kpis);
  check('a rosca soma o mesmo que o total',
    d.por_gestor.reduce(function (a, g) { return a + g.clientes; }, 0) + d.sem_gestor === d.kpis.total,
    { rosca: d.por_gestor.map(function (g) { return g.nome + ':' + g.clientes; }), total: d.kpis.total });
  check('as fases somam o mesmo que o total',
    d.fases.reduce(function (a, f) { return a + f.clientes; }, 0) === d.kpis.total, d.fases);
  check('a satisfacao soma o mesmo que o total',
    d.satisfacao.reduce(function (a, x) { return a + x.clientes; }, 0) === d.kpis.total, d.satisfacao);
  check('quem nao foi classificado aparece como nao informado',
    d.satisfacao.filter(function (x) { return x.chave === 'nao_informado'; })[0].clientes >= 1);

  // ---- 4) mexer muda o dashboard ----
  const antesEstrategia = d.fases.filter(function (f) { return f.chave === 'estrategia'; })[0].clientes;
  await op('op_cliente_salvar', {
    id: c1.cliente.id, nome: c1.cliente.nome, gestor_id: RAFA,
    fase: 'estrategia', status: 'ativo', satisfacao: 'satisfeito'
  });
  d = await op('op_dashboard');
  check('mudar a fase move o cliente no grafico',
    d.fases.filter(function (f) { return f.chave === 'estrategia'; })[0].clientes === antesEstrategia + 1);

  const antesRafa = d.por_gestor.filter(function (g) { return g.id === RAFA; })[0].clientes;
  await op('op_cliente_salvar', {
    id: c1.cliente.id, nome: c1.cliente.nome, gestor_id: BRUNO, fase: 'estrategia', status: 'ativo'
  });
  d = await op('op_dashboard');
  check('TRANSFERIR tira do gestor antigo',
    d.por_gestor.filter(function (g) { return g.id === RAFA; })[0].clientes === antesRafa - 1);
  check('e poe no novo',
    d.por_gestor.filter(function (g) { return g.id === BRUNO; })[0].clientes >= 1);
  // devolve
  await op('op_cliente_salvar', {
    id: c1.cliente.id, nome: c1.cliente.nome, gestor_id: RAFA, fase: 'estrategia', status: 'ativo'
  });

  // ---- 5) O HISTORICO: mexer hoje nao reescreve o mes passado ----
  {
    const mesPassadoAntes = await op('op_dashboard', null, { mes: ANT.mes, ano: ANT.ano });
    const ativosAntes = mesPassadoAntes.kpis.ativos;
    check('o cliente que entrou no mes passado aparece la', ativosAntes >= 1, ativosAntes);

    await op('op_cliente_salvar', {
      id: c1.cliente.id, nome: c1.cliente.nome, gestor_id: RAFA,
      fase: 'estrategia', status: 'suspenso'
    });

    const agora = await op('op_dashboard');
    check('suspender aparece no mes de HOJE', agora.kpis.suspensos >= 1, agora.kpis);

    const mesPassadoDepois = await op('op_dashboard', null, { mes: ANT.mes, ano: ANT.ano });
    check('SUSPENDER HOJE NAO MUDA O MES PASSADO',
      mesPassadoDepois.kpis.ativos === ativosAntes && mesPassadoDepois.kpis.suspensos === mesPassadoAntes.kpis.suspensos,
      { antes: mesPassadoAntes.kpis, depois: mesPassadoDepois.kpis });

    // devolve para ativo
    await op('op_cliente_salvar', {
      id: c1.cliente.id, nome: c1.cliente.nome, gestor_id: RAFA, fase: 'estrategia', status: 'ativo'
    });
  }

  // ---- 6) quem entrou depois nao conta antes ----
  {
    const novo = await op('op_cliente_salvar', {
      nome: 'Entrou hoje ' + SUF, gestor_id: RAFA, status: 'ativo', entrou_em: hoje
    });
    check('cliente novo entra na carteira de hoje', novo.ok, novo.error);
    const velho = await op('op_dashboard', null, { mes: 1, ano: 2020 });
    check('quem entrou hoje NAO aparece em janeiro de 2020', velho.kpis.total === 0, velho.kpis);
  }

  // ---- 7) renovacao e cancelamento ----
  {
    const r1 = await op('op_movimentar', { id: c1.cliente.id, tipo: 'renovacao' });
    check('registra uma renovacao', r1.ok, r1.error);
    await op('op_movimentar', { id: c1.cliente.id, tipo: 'renovacao' });

    const dm = await op('op_dashboard');
    check('RENOVAR DUAS VEZES conta UM cliente renovado', dm.kpis.renovados === 1, dm.kpis.renovados);
    check('renovar nao muda o gestor nem a fase',
      dm.por_gestor.filter(function (g) { return g.id === RAFA; })[0].clientes >= 1 &&
      dm.fases.filter(function (f) { return f.chave === 'estrategia'; })[0].clientes >= 1);
    check('renovar nao soma no total de clientes',
      dm.kpis.total === (await op('op_dashboard')).kpis.total);

    check('movimentacao inventada e recusada',
      !(await op('op_movimentar', { id: c1.cliente.id, tipo: 'explodir' })).ok);

    const alvo = (await op('op_carteira', null, { gestor_id: RAFA })).clientes
      .filter(function (x) { return /Sem /.test(x.nome); })[0];
    const can = await op('op_movimentar', { id: alvo.id, tipo: 'cancelamento' });
    check('registra um cancelamento', can.ok, can.error);

    const dc = await op('op_dashboard');
    check('o cancelamento conta no periodo', dc.kpis.cancelados === 1, dc.kpis.cancelados);
    check('cancelado SAI da carteira ativa',
      dc.kpis.total === dm.kpis.total - 1, { antes: dm.kpis.total, depois: dc.kpis.total });
    check('cancelado NAO entra na contagem das fases',
      dc.fases.reduce(function (a, f) { return a + f.clientes; }, 0) === dc.kpis.total, dc.fases);
    check('mas aparece como saida', dc.saidas >= 1, dc.saidas);

    const outroMes = await op('op_dashboard', null, { mes: 1, ano: 2020 });
    check('a movimentacao so conta no periodo em que aconteceu',
      outroMes.kpis.renovados === 0 && outroMes.kpis.cancelados === 0, outroMes.kpis);
  }

  // ---- 8) filtros ----
  {
    check('filtro por semana responde', (await op('op_dashboard', null, { semana: '1', semana_atras: '0' })).ok);
    check('semana passada tambem', (await op('op_dashboard', null, { semana: '1', semana_atras: '1' })).ok);
    const pers = await op('op_dashboard', null, { de: '2020-01-01', ate: '2020-12-31' });
    check('periodo personalizado responde', pers.ok && pers.periodo.tipo === 'personalizado', pers.periodo);
    check('datas invertidas sao acertadas sozinhas',
      (await op('op_dashboard', null, { de: '2026-03-10', ate: '2026-01-05' })).periodo.de === '2026-01-05');

    const soRafa = await op('op_dashboard', null, { gestor_id: RAFA });
    const todos = await op('op_dashboard');
    check('o filtro por gestor diminui a carteira',
      soRafa.kpis.total <= todos.kpis.total && soRafa.kpis.total >= 1,
      { rafa: soRafa.kpis.total, todos: todos.kpis.total });
    check('e a rosca filtrada so mostra quem tem cliente',
      soRafa.por_gestor.every(function (g) { return g.clientes > 0; }), soRafa.por_gestor);
  }

  // ---- 9) a carteira do gestor ----
  {
    const cart = await op('op_carteira', null, { gestor_id: RAFA });
    check('a carteira do gestor abre', cart.ok && cart.clientes.length >= 1, cart.error);
    check('cada linha traz nome, categoria, satisfacao, fase e situacao',
      cart.clientes.every(function (c) {
        return c.nome && 'categoria' in c && c.satisfacao_nome && c.fase_nome && c.status_nome;
      }));
    check('a carteira oferece os clientes do Financeiro para escolher',
      Array.isArray(cart.disponiveis), cart.disponiveis && cart.disponiveis.length);

    const hist = await op('op_cliente_historico', null, { id: c1.cliente.id });
    check('o historico do cliente guarda o que aconteceu', hist.ok && hist.eventos.length >= 3, hist.eventos && hist.eventos.length);
    check('e o historico diz o que foi cada mudanca',
      hist.eventos.every(function (e) { return !!e.titulo; }));

    const rafaAntes = (await op('op_dashboard')).por_gestor
      .filter(function (g) { return g.id === RAFA; })[0].clientes;
    const some = await op('op_cliente_excluir', { id: c1.cliente.id });
    check('da para tirar um cliente da carteira', some.ok, some.error);
    const rafaDepois = (await op('op_dashboard')).por_gestor
      .filter(function (g) { return g.id === RAFA; })[0].clientes;
    check('e ele some do dashboard na hora', rafaDepois === rafaAntes - 1,
      { antes: rafaAntes, depois: rafaDepois });
  }

  // ---- 10) a tranca ----
  {
    const perms = require('../api/_lib/perms.js');
    check('dono ve a operacao', perms.permite('dono', 'op_dashboard') === true);
    check('rh ve a operacao', perms.permite('rh', 'op_dashboard') === true);
    check('leitura NAO cadastra cliente', perms.permite('leitura', 'op_cliente_salvar') === false);
    check('leitura NAO movimenta contrato', perms.permite('leitura', 'op_movimentar') === false);
    check('o menu do dono tem a operacao', perms.menuDoPapel('dono').indexOf('opdash') >= 0);
    check('o menu de leitura nao tem', perms.menuDoPapel('leitura').indexOf('opdash') < 0);
  }

  // ---- 11) as funcoes puras do periodo ----
  {
    const opmod = require('../api/operacao.js');
    check('mes curto fecha no ultimo dia', opmod.periodoDe({ mes: 2, ano: 2027 }).ate === '2027-02-28');
    check('ano bissexto fecha no dia 29', opmod.periodoDe({ mes: 2, ano: 2028 }).ate === '2028-02-29');
    const sem = opmod.periodoDe({ semana: '1', semana_atras: 0 });
    check('a semana vai de segunda a domingo (7 dias)',
      (new Date(sem.ate) - new Date(sem.de)) / 86400000 === 6, sem);
    const vazio = opmod.situacaoEm({ status: 'ativo', fase: 'onboarding' }, [], '2026-01-01');
    check('sem evento nenhum vale o que esta gravado', vazio.status === 'ativo' && vazio.fase === 'onboarding');
    const comEvento = opmod.situacaoEm({ status: 'ativo', fase: 'onboarding' },
      [{ tipo: 'status', para: 'suspenso', quando: '2026-05-10T10:00:00Z' }], '2026-03-01');
    check('evento DEPOIS da data pedida e ignorado', comEvento.status === 'ativo', comEvento);
    const comEvento2 = opmod.situacaoEm({ status: 'ativo', fase: 'onboarding' },
      [{ tipo: 'status', para: 'suspenso', quando: '2026-05-10T10:00:00Z' }], '2026-06-01');
    check('evento ANTES da data pedida vale', comEvento2.status === 'suspenso', comEvento2);
  }

  console.log('\\n----------------------------------------');
  console.log(ok + ' passaram \\u00b7 ' + falhas + ' falharam');
  process.exit(falhas ? 1 : 0);
})().catch(function (e) { console.error('EXPLODIU:', e); process.exit(1); });
