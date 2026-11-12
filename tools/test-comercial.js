// ============================================================
// MODULO COMERCIAL — SIMULACOES
//
// Este teste percorre os 22 itens de validacao do pedido, mais as
// coisas que o pedido nao listou mas que quebrariam feio:
//   - um SDR tentando mexer na carteira de outro SDR;
//   - um lead sendo atribuido ao SDR errado pelo navegador;
//   - os indicadores contando "aguardando" como falta;
//   - a simulacao encostando no CRM de verdade.
//
// Uso:  ADMIN_PASSWORD="sua-senha" node tools/test-comercial.js
//       (precisa do espelho local no ar: sh tools/start-local.sh)
// ============================================================
'use strict';

const BASE = 'http://localhost:3000';
const SUF = Date.now().toString(36);
const SENHA = process.env.ADMIN_PASSWORD || process.env.ADMIN_SECRET || '';
let ok = 0, falhas = 0;
let T = '';                      // cracha do Dono

if (!SENHA) {
  console.error('Falta a senha. Rode:  ADMIN_PASSWORD="sua-senha" node tools/test-comercial.js');
  process.exit(1);
}

function check(nome, cond, extra) {
  if (cond) { ok++; console.log('  ok   ' + nome); }
  else {
    falhas++;
    console.log('  FALHA ' + nome + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
  }
}

async function chama(rota, action, body, params, token) {
  const qs = new URLSearchParams(Object.assign({ action: action }, params || {}));
  const r = await fetch(BASE + '/api/' + rota + '?' + qs, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token || T) },
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json().catch(function () { return { ok: false, error: 'resposta invalida' }; });
  j._status = r.status;
  return j;
}
const cm = (a, b, p, t) => chama('comercial', a, b, p, t);

function hoje() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

(async function () {
  console.log('\n=== MODULO COMERCIAL — SIMULACOES ===\n');

  T = (await (await fetch(BASE + '/api/admin?action=login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: SENHA })
  })).json()).token;
  check('o Dono entrou', !!T);

  // ---------------------------------------------------------------
  console.log('\n-- o menu --');
  const eu = await chama('admin', 'usuarios_eu');
  check('o Dono enxerga o grupo Comercial no menu',
    eu.menu.indexOf('cmsimulacoes') >= 0, eu.menu);
  const ordem = ['cmleads', 'cmagenda', 'cmatendimento', 'cmsimulacoes']
    .map(function (x) { return eu.menu.indexOf(x); });
  check('os quatro submenus estao na ordem pedida',
    ordem.every(function (v, i) { return v >= 0 && (i === 0 || v > ordem[i - 1]); }), ordem);
  check('os menus que ja existiam continuam todos la',
    ['dashboard', 'opdash', 'opgestores', 'oponboarding', 'opagenda',
     'financeiro', 'findash', 'usuarios', 'ajustes', 'colaboradores', 'play', 'space']
      .every(function (m) { return eu.menu.indexOf(m) >= 0; }));
  check('o Dono e reconhecido como gerente da simulacao', eu.comercial.gerente === true);

  // ---------------------------------------------------------------
  console.log('\n-- cadastro de participantes --');
  const joao = await cm('cm_participante_salvar', { nome: 'Joao ' + SUF, funcao: 'sdr' });
  check('cadastrou o Joao como SDR', joao.ok === true, joao.error);
  const pedro = await cm('cm_participante_salvar', { nome: 'Pedro ' + SUF, funcao: 'sdr' });
  check('cadastrou o Pedro como SDR', pedro.ok === true, pedro.error);
  const maria = await cm('cm_participante_salvar', { nome: 'Maria ' + SUF, funcao: 'closer' });
  check('cadastrou a Maria como Closer', maria.ok === true, maria.error);
  check('o sistema guarda a funcao de cada um',
    joao.participante.funcao === 'sdr' && maria.participante.funcao === 'closer',
    [joao.participante.funcao, maria.participante.funcao]);

  const semNome = await cm('cm_participante_salvar', { nome: '   ', funcao: 'sdr' });
  check('participante sem nome e recusado', semNome.ok === false, semNome.error);

  const JOAO = joao.participante.id, PEDRO = pedro.participante.id, MARIA = maria.participante.id;

  // ---------------------------------------------------------------
  console.log('\n-- vinculo com uma conta do painel --');
  const contas = await cm('cm_usuarios');
  check('a lista de contas vem da tabela de usuarios que ja existia', contas.ok === true, contas.error);
  const inventada = await cm('cm_participante_salvar',
    { nome: 'Fantasma ' + SUF, funcao: 'sdr', user_id: '00000000-0000-4000-8000-000000000000' });
  check('nao da para vincular a uma conta que nao existe', inventada.ok === false, inventada.error);

  // Cria DUAS contas de verdade, pela tela de Usuarios que ja existia —
  // nao por dentro do modulo Comercial. A conta nasce trancada e a
  // pessoa escolhe a senha pelo link do convite; o teste segue esse
  // mesmo caminho, para exercitar o fluxo de verdade.
  const contaJoao = await chama('admin', 'usuario_salvar',
    { name: 'Joao SDR ' + SUF, email: 'joao.' + SUF + '@teste.local', role: 'leitura' });
  const contaPedro = await chama('admin', 'usuario_salvar',
    { name: 'Pedro SDR ' + SUF, email: 'pedro.' + SUF + '@teste.local', role: 'leitura' });
  check('as contas foram criadas pelo cadastro de usuarios que ja existia',
    contaJoao.ok === true && contaPedro.ok === true, [contaJoao.error, contaPedro.error]);

  const UJOAO = (contaJoao.usuario || {}).id, UPEDRO = (contaPedro.usuario || {}).id;
  const tokenDoConvite = function (c) {
    const m = String((c.convite || {}).link || '').match(/[?&]t=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  };
  const senhaJoao = 'simulacao-' + SUF, senhaPedro = 'simulacao2-' + SUF;
  const criouJoao = await chama('admin', 'convite_senha',
    { t: tokenDoConvite(contaJoao), password: senhaJoao });
  const criouPedro = await chama('admin', 'convite_senha',
    { t: tokenDoConvite(contaPedro), password: senhaPedro });
  check('cada um criou a propria senha pelo link do convite',
    criouJoao.ok === true && criouPedro.ok === true, [criouJoao.error, criouPedro.error]);

  await cm('cm_participante_salvar', { id: JOAO, nome: 'Joao ' + SUF, funcao: 'sdr', user_id: UJOAO });
  await cm('cm_participante_salvar', { id: PEDRO, nome: 'Pedro ' + SUF, funcao: 'sdr', user_id: UPEDRO });

  const duplicado = await cm('cm_participante_salvar',
    { nome: 'Joao de novo ' + SUF, funcao: 'sdr', user_id: UJOAO });
  check('a mesma conta nao vira dois participantes', duplicado.ok === false, duplicado.error);

  // ---------------------------------------------------------------
  console.log('\n-- o SDR entra com a propria conta --');
  const entraJoao = await (await fetch(BASE + '/api/admin?action=login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'joao.' + SUF + '@teste.local', password: senhaJoao })
  })).json();
  const TJOAO = entraJoao.token;
  check('o Joao entrou com a conta dele', !!TJOAO, entraJoao.error);

  const entraPedro = await (await fetch(BASE + '/api/admin?action=login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'pedro.' + SUF + '@teste.local', password: senhaPedro })
  })).json();
  const TPEDRO = entraPedro.token;
  check('o Pedro entrou com a conta dele', !!TPEDRO, entraPedro.error);

  const euJoao = await chama('admin', 'usuarios_eu', null, null, TJOAO);
  check('o Joao e reconhecido como participante',
    euJoao.comercial && euJoao.comercial.participante &&
    euJoao.comercial.participante.id === JOAO, euJoao.comercial);
  check('e NAO como gerente', euJoao.comercial.gerente === false);

  // ---------------------------------------------------------------
  console.log('\n-- cadastro de leads --');
  const lead1 = await cm('cm_lead_salvar', {
    nome: 'Empresa ABC ' + SUF, contato: '(13) 99999-0001', cidade: 'Praia Grande',
    cnpj: '33.000.167/0001-01', nicho: 'Advocacia',
    agendado: true, agendado_data: hoje(), agendado_hora: '10:00',
    observacoes: 'Tem interesse e orcamento.', qualificacao: 'sim'
  }, null, TJOAO);
  check('o Joao cadastrou um lead', lead1.ok === true, lead1.error);
  check('todos os campos do formulario foram salvos',
    lead1.lead && lead1.lead.contato === '(13) 99999-0001' && lead1.lead.cidade === 'Praia Grande'
      && lead1.lead.nicho === 'Advocacia' && lead1.lead.observacoes === 'Tem interesse e orcamento.',
    lead1.lead);
  check('o CNPJ foi guardado so com numeros e volta formatado',
    lead1.lead.cnpj === '33000167000101' && lead1.lead.cnpj_bonito === '33.000.167/0001-01',
    [lead1.lead.cnpj, lead1.lead.cnpj_bonito]);
  check('a ORIGEM e o proprio Joao, sem ele ter digitado nada',
    lead1.lead.participante_id === JOAO && /Joao/.test(lead1.lead.sdr), lead1.lead.sdr);

  const cnpjRuim = await cm('cm_lead_salvar',
    { nome: 'CNPJ torto', cnpj: '11.111.111/1111-11' }, null, TJOAO);
  check('CNPJ invalido e recusado', cnpjRuim.ok === false, cnpjRuim.error);
  const semCnpj = await cm('cm_lead_salvar', { nome: 'Sem CNPJ ' + SUF }, null, TJOAO);
  check('mas CNPJ em branco passa (o campo e opcional)', semCnpj.ok === true, semCnpj.error);

  const semData = await cm('cm_lead_salvar',
    { nome: 'Agendado sem data', agendado: true }, null, TJOAO);
  check('agendar sem data e recusado', semData.ok === false, semData.error);

  // ---------------------------------------------------------------
  console.log('\n-- a tranca: um SDR nao mexe na carteira do outro --');
  const invasao = await cm('cm_lead_salvar',
    { nome: 'Lead roubado', participante_id: PEDRO }, null, TJOAO);
  check('o Joao mandando participante_id do Pedro NAO cai na carteira do Pedro',
    invasao.ok === true && invasao.lead.participante_id === JOAO,
    invasao.ok ? invasao.lead.participante_id : invasao.error);

  const espiar = await cm('cm_painel', null, { id: PEDRO }, TJOAO);
  check('o Joao nao abre o painel do Pedro', espiar.ok === false && espiar._status === 403, espiar.error);

  const leadDoPedro = await cm('cm_lead_salvar', { nome: 'Lead do Pedro ' + SUF }, null, TPEDRO);
  check('o Pedro cadastrou um lead dele', leadDoPedro.ok === true, leadDoPedro.error);
  const mexerNoOutro = await cm('cm_lead_campo',
    { id: leadDoPedro.lead.id, qualificacao: 'nao' }, null, TJOAO);
  check('o Joao nao edita o lead do Pedro',
    mexerNoOutro.ok === false && mexerNoOutro._status === 403, mexerNoOutro.error);
  const apagarDoOutro = await cm('cm_lead_excluir', { id: leadDoPedro.lead.id }, null, TJOAO);
  check('o Joao nao apaga o lead do Pedro',
    apagarDoOutro.ok === false && apagarDoOutro._status === 403, apagarDoOutro.error);

  const cadastrarParticipante = await cm('cm_participante_salvar',
    { nome: 'Nao pode ' + SUF, funcao: 'sdr' }, null, TJOAO);
  check('o Joao nao cadastra participante',
    cadastrarParticipante.ok === false && cadastrarParticipante._status === 403,
    cadastrarParticipante.error);

  const dashJoao = await cm('cm_dashboard', null, null, TJOAO);
  check('o dashboard do Joao mostra so o Joao',
    dashJoao.ok === true && dashJoao.por_sdr.length === 1 && dashJoao.por_sdr[0].id === JOAO,
    dashJoao.ok ? dashJoao.por_sdr.map(function (x) { return x.nome; }) : dashJoao.error);

  // ---------------------------------------------------------------
  console.log('\n-- comparecimento e qualificacao --');
  const semReuniao = await cm('cm_lead_campo',
    { id: semCnpj.lead.id, comparecimento: 'compareceu' }, null, TJOAO);
  check('nao da para marcar comparecimento em lead sem reuniao',
    semReuniao.ok === false, semReuniao.error);

  const marcou = await cm('cm_lead_campo',
    { id: lead1.lead.id, comparecimento: 'nao_compareceu' }, null, TJOAO);
  check('da para atualizar o comparecimento de quem tem reuniao',
    marcou.ok === true && marcou.lead.comparecimento === 'nao_compareceu', marcou.error);
  const requal = await cm('cm_lead_campo',
    { id: lead1.lead.id, qualificacao: 'nao' }, null, TJOAO);
  check('da para mudar a qualificacao',
    requal.ok === true && requal.lead.qualificacao === 'nao', requal.error);

  // ---------------------------------------------------------------
  console.log('\n-- os cinco indicadores --');
  // carteira conhecida do Joao: monta do zero
  const paraContar = [
    { nome: 'A ' + SUF, agendado: true, data: hoje(), hora: '09:00', comp: 'compareceu', qual: 'sim' },
    { nome: 'B ' + SUF, agendado: true, data: hoje(), hora: '10:00', comp: 'compareceu', qual: 'nao' },
    { nome: 'C ' + SUF, agendado: true, data: hoje(), hora: '11:00', comp: 'nao_compareceu', qual: 'pendente' },
    { nome: 'D ' + SUF, agendado: true, data: hoje(), hora: '12:00', comp: 'aguardando', qual: 'sim' },
    { nome: 'E ' + SUF, agendado: false, comp: 'aguardando', qual: 'pendente' }
  ];
  // limpa o que o Joao ja tinha, para a conta ser exata
  const antes = await cm('cm_painel', null, { id: JOAO });
  for (const l of antes.leads) await cm('cm_lead_excluir', { id: l.id });
  for (const x of paraContar) {
    await cm('cm_lead_salvar', {
      nome: x.nome, agendado: x.agendado, agendado_data: x.data || '', agendado_hora: x.hora || '',
      comparecimento: x.comp, qualificacao: x.qual
    }, null, TJOAO);
  }
  const painel = await cm('cm_painel', null, { id: JOAO });
  const n = painel.numeros;
  check('Total de Leads = 5', n.leads === 5, n);
  check('Agendados = 4 (o sem reuniao nao conta)', n.agendados === 4, n);
  check('Compareceram = 2', n.compareceram === 2, n);
  check('Nao compareceram = 1 — "aguardando" NAO e falta', n.nao_compareceram === 1, n);
  check('Qualificados = 2 (so os marcados "sim")', n.qualificados === 2, n);

  const dash = await cm('cm_dashboard');
  const linhaJoao = dash.por_sdr.filter(function (x) { return x.id === JOAO; })[0];
  check('o dashboard geral mostra os mesmos numeros do painel',
    linhaJoao && linhaJoao.leads === 5 && linhaJoao.agendados === 4
      && linhaJoao.compareceram === 2 && linhaJoao.qualificados === 2, linhaJoao);
  check('o dashboard lista os SDRs sozinho, sem ninguem mexer em codigo',
    dash.por_sdr.filter(function (x) { return x.id === JOAO || x.id === PEDRO; }).length === 2,
    dash.por_sdr.map(function (x) { return x.nome; }));
  check('o Closer NAO entra na conta dos SDRs',
    dash.por_sdr.every(function (x) { return x.id !== MARIA; }) &&
    dash.closers.some(function (x) { return x.id === MARIA; }));

  // ---------------------------------------------------------------
  console.log('\n-- filtros --');
  const soJoao = await cm('cm_dashboard', null, { participante_id: JOAO });
  check('filtrar por um SDR deixa so ele', soJoao.por_sdr.length === 1, soJoao.por_sdr.length);
  check('e os KPIs acompanham o filtro', soJoao.total.leads === 5, soJoao.total);

  const deHoje = await cm('cm_dashboard', null, { faixa: 'hoje' });
  check('o filtro "Hoje" pega os leads de hoje', deHoje.total.leads >= 5, deHoje.total);
  const anoPassado = await cm('cm_dashboard', null, { de: '2020-01-01', ate: '2020-12-31' });
  check('um periodo antigo nao traz os leads de hoje', anoPassado.total.leads === 0, anoPassado.total);
  check('o periodo personalizado volta com o rotulo certo',
    anoPassado.periodo.tipo === 'personalizado', anoPassado.periodo);

  // ---------------------------------------------------------------
  console.log('\n-- os dados ficam guardados --');
  const denovo = await cm('cm_painel', null, { id: JOAO });
  check('os leads continuam la numa consulta nova', denovo.leads.length === 5, denovo.leads.length);
  check('e vem do mais novo para o mais velho',
    denovo.leads.every(function (l, i) {
      return i === 0 || l.criado_em <= denovo.leads[i - 1].criado_em;
    }), denovo.leads.map(function (l) { return l.criado_em; }));

  // ---------------------------------------------------------------
  console.log('\n-- a simulacao NAO encosta no CRM de verdade --');
  const clientesAntes = await chama('financeiro', 'fc_lista');
  const opAntes = await chama('operacao', 'op_gestores');
  const candAntes = await chama('admin', 'candidates_list');
  await cm('cm_lead_salvar', {
    nome: 'Cliente que nao existe ' + SUF, cnpj: '33.000.167/0001-01',
    contato: '(13) 90000-0000', cidade: 'Santos', nicho: 'Imobiliaria'
  }, null, TJOAO);
  const clientesDepois = await chama('financeiro', 'fc_lista');
  const opDepois = await chama('operacao', 'op_gestores');
  const candDepois = await chama('admin', 'candidates_list');
  check('nenhum cliente novo apareceu no Financeiro',
    (clientesDepois.clientes || []).length === (clientesAntes.clientes || []).length,
    [(clientesAntes.clientes || []).length, (clientesDepois.clientes || []).length]);
  check('nenhum cliente novo apareceu na carteira da Operacao',
    JSON.stringify((opDepois.gestores || []).map(function (g) { return g.clientes; })) ===
    JSON.stringify((opAntes.gestores || []).map(function (g) { return g.clientes; })));
  check('nenhum candidato novo apareceu no RH',
    (candDepois.candidates || []).length === (candAntes.candidates || []).length);

  // ---------------------------------------------------------------
  console.log('\n-- o resto do sistema continua de pe --');
  const painelOp = await chama('operacao', 'op_dashboard');
  check('o Dashboard Operacional responde igual', painelOp.ok === true, painelOp.error);
  const ob = await chama('operacao', 'ob_lista');
  check('o Onboarding responde igual', ob.ok === true, ob.error);
  const ag = await chama('agenda', 'ag_lista');
  check('a Agenda Operacional responde igual', ag.ok === true, ag.error);
  const fin = await chama('financeiro', 'fin_lista');
  check('o Financeiro responde igual', fin.ok === true, fin.error);
  const us = await chama('admin', 'usuarios');
  check('a tela de Usuarios responde igual', us.ok === true, us.error);

  // ---------------------------------------------------------------
  console.log('\n-- limpeza --');
  const meus = await cm('cm_painel', null, { id: JOAO });
  for (const l of meus.leads) await cm('cm_lead_excluir', { id: l.id });
  const dele = await cm('cm_painel', null, { id: PEDRO });
  for (const l of dele.leads) await cm('cm_lead_excluir', { id: l.id });
  for (const id of [JOAO, PEDRO, MARIA]) await cm('cm_participante_excluir', { id: id });
  for (const uid of [UJOAO, UPEDRO]) await chama('admin', 'usuario_excluir', { id: uid });
  const contasDepois = await chama('admin', 'usuarios');
  check('as contas de teste sairam do painel',
    (contasDepois.usuarios || []).every(function (x) { return String(x.email || '').indexOf(SUF) < 0; }));
  const sobrou = await cm('cm_participantes');
  check('a simulacao do teste foi limpa',
    (sobrou.participantes || []).every(function (p) { return p.nome.indexOf(SUF) < 0; }),
    (sobrou.participantes || []).map(function (p) { return p.nome; }));

  console.log('\n----------------------------------------');
  console.log(ok + ' passaram · ' + falhas + ' falharam');
  process.exit(falhas ? 1 : 0);
})().catch(function (e) {
  console.error('EXPLODIU', e);
  process.exit(1);
});
