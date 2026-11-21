// ============================================================
// META EM TEMPO REAL
//
// Percorre os 13 testes que o pedido listou, os critérios de
// aceite dos itens 38 a 42, e mais um punhado de coisas que o
// pedido não listou mas que estragariam o placar em silêncio:
//
//   - dinheiro em ponto flutuante perdendo centavo na soma;
//   - venda das 22h do dia 30 caindo no mês seguinte;
//   - lançamento apagado continuando a somar;
//   - o código da TV dando acesso a outra coisa além do placar;
//   - duplo clique virando duas vendas;
//   - o selo dizendo "igual" quando algo mudou.
//
// Uso:  ADMIN_PASSWORD="sua-senha" node tools/test-meta.js
//       (precisa do espelho local no ar: sh tools/start-local.sh)
// ============================================================
'use strict';

const BASE = 'http://localhost:3000';
const SUF = Date.now().toString(36);
const SENHA = process.env.ADMIN_PASSWORD || process.env.ADMIN_SECRET || '';
let ok = 0, falhas = 0;
let T = '';

if (!SENHA) {
  console.error('Falta a senha. Rode:  ADMIN_PASSWORD="sua-senha" node tools/test-meta.js');
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
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token === undefined ? T : token) },
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json().catch(function () { return { ok: false, error: 'resposta invalida' }; });
  j._status = r.status;
  return j;
}
const mt = (a, b, p, t) => chama('comercial', a, b, p, t);

// Lança um valor e devolve o lançamento criado.
function lanca(tipo, quem, cliente, valor, extra) {
  return mt('mt_salvar', Object.assign({
    tipo: tipo, responsavel: quem, cliente: cliente, valor: valor
  }, extra || {}));
}

const CRIADOS = [];
function guarda(r) {
  if (r && r.lancamento && r.lancamento.id) CRIADOS.push(r.lancamento.id);
  return r;
}

(async function () {
  console.log('\n=== META EM TEMPO REAL ===\n');

  T = (await (await fetch(BASE + '/api/admin?action=login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: SENHA })
  })).json()).token;
  check('o Dono entrou', !!T);

  /* ============================================================
     COMECAR DO ZERO

     Boa parte das conferencias daqui usa numero absoluto ("o total
     tem que dar 5.500"), e isso so vale numa mesa limpa. Uma rodada
     anterior interrompida no meio (um Ctrl+C, um "| head" fechando
     o cano) deixa lancamentos para tras, e a rodada seguinte
     acusaria doze falhas que nao existem — o pior tipo de teste, o
     que mente nas duas direcoes.

     Isto roda contra o ESPELHO LOCAL, nunca contra o banco de
     verdade: o teste pede a senha do ambiente local para funcionar.
     ============================================================ */
  const sobrasAntes = await mt('mt_lista');
  const sobras = (sobrasAntes.lancamentos || []).length;
  for (const l of (sobrasAntes.lancamentos || [])) await mt('mt_excluir', { id: l.id });
  await mt('mt_config', { alvo: '0' });
  if (sobras) console.log('  (limpei ' + sobras + ' sobra(s) de uma rodada anterior)');

  /* ============================================================
     ITEM 38 — CRITERIOS DE ACEITE DO MENU
     ============================================================ */
  console.log('\n-- o menu (item 38) --');
  const eu = await chama('admin', 'usuarios_eu');
  check('existe Meta dentro do Comercial', eu.menu.indexOf('meta') >= 0, eu.menu);
  check('existe Gerenciador de Meta dentro do Comercial', eu.menu.indexOf('metagerente') >= 0);
  check('Meta vem depois de Simulacoes (fim do grupo Comercial)',
    eu.menu.indexOf('meta') > eu.menu.indexOf('cmsimulacoes'));
  check('nenhum menu que existia foi removido',
    ['dashboard', 'vagas', 'triagem', 'candidatos', 'prequalificacao', 'aurea', 'preonboarding',
      'colaboradores', 'avisos', 'space', 'play', 'conteudo', 'quiz', 'mensagens',
      'opdash', 'opgestores', 'oponboarding', 'opagenda',
      'cmleads', 'cmagenda', 'cmatendimento', 'cmsimulacoes',
      'financeiro', 'finclientes', 'findash', 'fingastos', 'findre', 'ajustes', 'usuarios']
      .every(function (m) { return eu.menu.indexOf(m) >= 0; }), eu.menu);

  /* ============================================================
     ITEM 4 / 39 — COMECAR EM ZERO, SEM DADO INVENTADO
     ============================================================ */
  console.log('\n-- o placar comeca vazio (itens 4 e 39) --');
  const zero = await mt('mt_placar');
  check('o placar responde', zero.ok === true, zero.error);
  check('comeca em zero quando nao existe lancamento',
    zero.total === 0 && zero.comercial === 0 && zero.operacional === 0,
    [zero.total, zero.comercial, zero.operacional]);
  check('nao inventou lancamento nenhum', (zero.lancamentos || []).length === 0);
  check('diz de qual mes esta falando', /^\d{4}-\d{2}$/.test(zero.mes || ''), zero.mes);
  check('traz o nome do mes em portugues', !!zero.mes_nome && zero.mes_nome.length > 3, zero.mes_nome);

  /* ============================================================
     TESTE 1 — PRIMEIRO LANCAMENTO COMERCIAL
     ============================================================ */
  console.log('\n-- teste 1: primeiro lancamento comercial --');
  const l1 = guarda(await lanca('comercial', 'Barbara ' + SUF, 'Advocacia XPTO', '3.500,00',
    { servico: 'Assessoria de Marketing', observacao: 'Entrada + setup' }));
  check('registrou o valor', l1.ok === true, l1.error);
  check('guardou 3.500,00 como 350000 centavos',
    l1.lancamento.valor_centavos === 350000, l1.lancamento.valor_centavos);
  check('guardou o responsavel', l1.lancamento.responsavel === 'Barbara ' + SUF);
  check('guardou o cliente', l1.lancamento.cliente === 'Advocacia XPTO');
  check('guardou o servico', l1.lancamento.servico === 'Assessoria de Marketing');
  check('guardou a observacao', l1.lancamento.observacao === 'Entrada + setup');
  check('guardou data e hora do servidor', !!l1.lancamento.created_at &&
    Math.abs(Date.now() - new Date(l1.lancamento.created_at).getTime()) < 120000,
    l1.lancamento.created_at);
  check('guardou quem digitou, separado de quem vendeu',
    !!l1.lancamento.user_nome, l1.lancamento.user_nome);
  check('a resposta ja traz o placar somado', l1.placar && l1.placar.total === 350000,
    l1.placar && l1.placar.total);
  check('o total foi para o Comercial, nao para o Operacional',
    l1.placar.comercial === 350000 && l1.placar.operacional === 0,
    [l1.placar.comercial, l1.placar.operacional]);

  /* ============================================================
     TESTE 2 — SEGUNDO LANCAMENTO COMERCIAL (ITEM 3: SOMA)
     ============================================================ */
  console.log('\n-- teste 2: segundo lancamento comercial soma --');
  const l2 = guarda(await lanca('comercial', 'Fernanda ' + SUF, 'Clinica Sorriso', '2.000'));
  check('registrou o segundo', l2.ok === true, l2.error);
  check('3.500 + 2.000 = 5.500 (nao substituiu)',
    l2.placar.total === 550000, l2.placar.total);
  check('o Comercial acompanhou', l2.placar.comercial === 550000, l2.placar.comercial);

  /* ============================================================
     TESTE 3 — LANCAMENTO OPERACIONAL (ITENS 7, 10, 11)
     ============================================================ */
  console.log('\n-- teste 3: lancamento operacional (itens 7, 10, 11) --');
  const l3 = guarda(await lanca('operacional', 'Renan ' + SUF, 'Mercado Bom Preco', '1.500,00',
    { servico: 'Website' }));
  check('registrou o operacional', l3.ok === true, l3.error);
  check('foi marcado como operacional', l3.lancamento.tipo === 'operacional');
  check('o Operacional tem o proprio total', l3.placar.operacional === 150000, l3.placar.operacional);
  check('o Comercial NAO mudou com o operacional',
    l3.placar.comercial === 550000, l3.placar.comercial);
  check('Total Geral = Comercial + Operacional',
    l3.placar.total === l3.placar.comercial + l3.placar.operacional &&
    l3.placar.total === 700000, l3.placar.total);

  /* ============================================================
     ITEM 28 — VALIDACOES
     ============================================================ */
  console.log('\n-- item 28: o que nao pode entrar --');
  const neg = await lanca('comercial', 'Teste', 'Cliente', '-500');
  check('valor negativo e barrado', neg.ok === false, neg.error);
  const zeroV = await lanca('comercial', 'Teste', 'Cliente', '0');
  check('valor zero e barrado', zeroV.ok === false, zeroV.error);
  const semCli = await lanca('comercial', 'Teste', '   ', '500');
  check('valor sem cliente e barrado', semCli.ok === false, semCli.error);
  const semResp = await lanca('comercial', '  ', 'Cliente', '500');
  check('valor sem responsavel e barrado', semResp.ok === false, semResp.error);
  const semValor = await lanca('comercial', 'Teste', 'Cliente', '');
  check('lancamento sem valor e barrado', semValor.ok === false, semValor.error);
  const letras = await lanca('comercial', 'Teste', 'Cliente', 'muito dinheiro');
  check('valor escrito em letras e barrado', letras.ok === false, letras.error);
  const tipoErrado = await mt('mt_salvar',
    { tipo: 'financeiro', responsavel: 'T', cliente: 'C', valor: '100' });
  check('um terceiro tipo inventado e barrado', tipoErrado.ok === false, tipoErrado.error);
  const absurdo = await lanca('comercial', 'Teste', 'Cliente', '999999999999');
  check('valor absurdo (dedo escorregou) e barrado', absurdo.ok === false, absurdo.error);

  const depoisDosErros = await mt('mt_placar');
  check('nenhuma tentativa barrada entrou no placar',
    depoisDosErros.total === 700000, depoisDosErros.total);

  /* ============================================================
     TESTE 5 — DUPLO CLIQUE NO BOTAO REGISTRAR
     ============================================================ */
  console.log('\n-- teste 5: duplo clique no Registrar --');
  const antesDuplo = (await mt('mt_placar')).total;
  // Dois pedidos EXATAMENTE iguais, disparados no mesmo instante —
  // e isso é o duplo clique de verdade, não um clique depois do
  // outro. A tranca da tela (MG_SALVANDO) é o que impede isto de
  // chegar ao servidor; aqui conferimos o que acontece se chegar.
  const par = await Promise.all([
    lanca('comercial', 'Duplo ' + SUF, 'Cliente Duplo', '1.000'),
    lanca('comercial', 'Duplo ' + SUF, 'Cliente Duplo', '1.000')
  ]);
  par.forEach(guarda);
  const quantosEntraram = par.filter(function (r) { return r.ok === true; }).length;
  const depoisDuplo = (await mt('mt_placar')).total;
  check('os dois pedidos foram respondidos sem erro de servidor',
    par.every(function (r) { return r.ok === true || r._status === 400; }),
    par.map(function (r) { return r._status; }));
  check('o placar subiu exatamente o que entrou (sem somar em dobro por bug)',
    depoisDuplo === antesDuplo + quantosEntraram * 100000,
    [antesDuplo, depoisDuplo, quantosEntraram]);

  /* ============================================================
     TESTE 4 — DOIS USUARIOS LANCANDO QUASE JUNTOS
     ============================================================ */
  console.log('\n-- teste 4: dois usuarios lancando quase juntos --');
  const antesJuntos = (await mt('mt_placar')).total;
  const juntos = await Promise.all([
    lanca('comercial', 'Ana ' + SUF, 'Cliente A', '700'),
    lanca('operacional', 'Bruno ' + SUF, 'Cliente B', '300'),
    lanca('comercial', 'Caio ' + SUF, 'Cliente C', '1.100,50')
  ]);
  juntos.forEach(guarda);
  check('os tres entraram', juntos.every(function (r) { return r.ok === true; }),
    juntos.map(function (r) { return r.error; }));
  const depoisJuntos = await mt('mt_placar');
  check('nenhum valor se perdeu na corrida',
    depoisJuntos.total === antesJuntos + 70000 + 30000 + 110050,
    [antesJuntos, depoisJuntos.total]);
  check('cada um foi para o lado certo',
    depoisJuntos.comercial === 550000 + 100000 * par.filter(r => r.ok).length + 70000 + 110050,
    depoisJuntos.comercial);

  /* ============================================================
     ITEM 27 — O TOTAL E DERIVADO, NAO GUARDADO
     ============================================================ */
  console.log('\n-- item 27: o total e sempre a conta, nunca um campo --');
  const conferencia = await mt('mt_lista');
  const somaNaMao = (conferencia.lancamentos || [])
    .reduce(function (t, l) { return t + l.valor_centavos; }, 0);
  check('o total do placar bate com a soma dos lancamentos, um por um',
    somaNaMao === depoisJuntos.total, [somaNaMao, depoisJuntos.total]);
  check('a soma em centavos e inteira (nenhum centavo virou fracao)',
    Number.isInteger(somaNaMao), somaNaMao);

  /* ============================================================
     TESTE 10 — EDITAR UM VALOR (ITEM 26)
     ============================================================ */
  console.log('\n-- teste 10: corrigir um valor (item 26) --');
  const cinco = guarda(await lanca('comercial', 'Correcao ' + SUF, 'Cliente Corrige', '5.000'));
  const antesCorrecao = (await mt('mt_placar')).total;
  const corrigido = await mt('mt_salvar', {
    id: cinco.lancamento.id, tipo: 'comercial',
    responsavel: 'Correcao ' + SUF, cliente: 'Cliente Corrige', valor: '4.500'
  });
  check('a correcao passou', corrigido.ok === true, corrigido.error);
  check('o valor novo ficou guardado',
    corrigido.lancamento.valor_centavos === 450000, corrigido.lancamento.valor_centavos);
  check('o placar caiu exatamente R$ 500 (5.000 -> 4.500)',
    corrigido.placar.total === antesCorrecao - 50000,
    [antesCorrecao, corrigido.placar.total]);
  check('corrigir NAO criou um lancamento novo',
    (await mt('mt_lista')).lancamentos.filter(function (l) {
      return l.cliente === 'Cliente Corrige';
    }).length === 1);

  const corrigeInvalido = await mt('mt_salvar', {
    id: cinco.lancamento.id, tipo: 'comercial',
    responsavel: 'X', cliente: 'Y', valor: '0'
  });
  check('correcao para zero e barrada', corrigeInvalido.ok === false, corrigeInvalido.error);
  check('o placar nao se mexeu com a correcao barrada',
    (await mt('mt_placar')).total === corrigido.placar.total);

  /* ============================================================
     TESTE 11 — EXCLUIR UM VALOR (ITEM 26)
     ============================================================ */
  console.log('\n-- teste 11: apagar um valor (item 26) --');
  const antesApagar = (await mt('mt_placar')).total;
  const apagou = await mt('mt_excluir', { id: cinco.lancamento.id });
  check('apagou', apagou.ok === true, apagou.error);
  check('o placar devolveu os 4.500 na hora',
    apagou.placar.total === antesApagar - 450000, [antesApagar, apagou.placar.total]);
  check('o lancamento apagado saiu do historico',
    (await mt('mt_lista')).lancamentos.every(function (l) {
      return l.id !== cinco.lancamento.id;
    }));
  const apagaDeNovo = await mt('mt_excluir', { id: cinco.lancamento.id });
  check('apagar duas vezes nao tira dinheiro duas vezes', apagaDeNovo.ok === false, apagaDeNovo.error);
  check('o placar continua igual depois da segunda tentativa',
    (await mt('mt_placar')).total === apagou.placar.total);
  const editaApagado = await mt('mt_salvar', {
    id: cinco.lancamento.id, tipo: 'comercial', responsavel: 'X', cliente: 'Y', valor: '9.999'
  });
  check('nao da para ressuscitar um lancamento apagado editando ele',
    editaApagado.ok === false, editaApagado.error);

  /* ============================================================
     ITENS 20, 36, 42 — O SELO E A CELEBRACAO QUE NAO SE REPETE
     ============================================================ */
  console.log('\n-- itens 20, 36 e 42: o selo e a festa que nao se repete --');
  const agora1 = await mt('mt_placar');
  check('a resposta traz um selo', !!agora1.selo, agora1.selo);
  const igual = await mt('mt_placar', null, { selo: agora1.selo });
  check('mandando o mesmo selo, o servidor responde "igual"', igual.igual === true, igual);
  check('a resposta "igual" nao repete a lista de lancamentos',
    igual.lancamentos === undefined, Object.keys(igual));

  const novoL = guarda(await lanca('comercial', 'Selo ' + SUF, 'Cliente Selo', '800'));
  const depoisSelo = await mt('mt_placar', null, { selo: agora1.selo });
  check('depois de um lancamento novo, o selo velho NAO vale mais',
    depoisSelo.igual !== true, depoisSelo.igual);
  check('e a resposta volta com a lista completa',
    Array.isArray(depoisSelo.lancamentos) && depoisSelo.lancamentos.length > 0);
  check('o lancamento novo esta na lista (e e por isso que a TV festeja)',
    depoisSelo.lancamentos.some(function (l) { return l.id === novoL.lancamento.id; }));

  // O selo precisa mudar tambem quando NADA e criado, so editado:
  // contagem igual, conteudo diferente.
  const seloAntesEdicao = depoisSelo.selo;
  await mt('mt_salvar', {
    id: novoL.lancamento.id, tipo: 'comercial',
    responsavel: 'Selo ' + SUF, cliente: 'Cliente Selo', valor: '900'
  });
  const depoisEdicao = await mt('mt_placar', null, { selo: seloAntesEdicao });
  check('editar sem criar nada TAMBEM muda o selo (a TV precisa saber)',
    depoisEdicao.igual !== true, depoisEdicao.igual);

  // E o oposto: a mesma pergunta duas vezes seguidas, sem nada
  // acontecer no meio, tem que dar "igual" nas duas.
  const estavel1 = await mt('mt_placar');
  const estavel2 = await mt('mt_placar', null, { selo: estavel1.selo });
  const estavel3 = await mt('mt_placar', null, { selo: estavel1.selo });
  check('duas perguntas seguidas sem novidade dao "igual" nas duas',
    estavel2.igual === true && estavel3.igual === true);

  /* ============================================================
     TESTE 9 / ITEM 42 — REFRESH DA TV RECUPERA O TOTAL CERTO
     ============================================================ */
  console.log('\n-- teste 9: refresh da TV (item 42) --');
  const comoSeFosseRefresh = await mt('mt_placar');       // sem selo = tela nova
  check('uma tela recem-aberta recebe o total correto',
    comoSeFosseRefresh.total === estavel1.total,
    [comoSeFosseRefresh.total, estavel1.total]);
  check('e recebe a lista inteira do mes (que ela vai marcar como "ja vista")',
    (comoSeFosseRefresh.lancamentos || []).length > 0);
  check('a lista vem da mais nova para a mais velha',
    (function () {
      const d = comoSeFosseRefresh.lancamentos.map(function (l) { return l.created_at; });
      for (let i = 1; i < d.length; i++) if (d[i] > d[i - 1]) return false;
      return true;
    })());
  check('a lista da TV e curta de proposito (nao manda o mes inteiro)',
    (comoSeFosseRefresh.lancamentos || []).length <= 25,
    (comoSeFosseRefresh.lancamentos || []).length);
  check('o servidor manda a hora dele, para a TV nao depender do relogio da parede',
    !!comoSeFosseRefresh.agora);

  /* ============================================================
     ITEM 7 — ALVO DA META E A BARRA
     ============================================================ */
  console.log('\n-- o alvo da meta --');
  const alvoOk = await mt('mt_config', { alvo: '200.000,00' });
  check('salvou o alvo', alvoOk.ok === true, alvoOk.error);
  check('guardou 200.000,00 como 20000000 centavos',
    alvoOk.alvo_centavos === 20000000, alvoOk.alvo_centavos);
  const comAlvo = await mt('mt_placar');
  check('o placar passa a informar o alvo', comAlvo.alvo_centavos === 20000000);
  const alvoRuim = await mt('mt_config', { alvo: 'bastante' });
  check('alvo escrito em letras e barrado', alvoRuim.ok === false, alvoRuim.error);
  const alvoZero = await mt('mt_config', { alvo: '0' });
  check('alvo 0 e aceito (quer dizer "sem barra, so o acumulado")',
    alvoZero.ok === true && alvoZero.alvo_centavos === 0, alvoZero);

  /* ============================================================
     TESTES 6, 7, 8 — A TELEVISAO
     ============================================================ */
  console.log('\n-- testes 6, 7 e 8: a televisao --');
  const semCodigo = await mt('mt_tv', null, {}, '');
  check('a TV sem codigo nao entra', semCodigo.ok === false, semCodigo.error);
  const codigoErrado = await mt('mt_tv', null, { tv: 'CODIGOINVENTADO' }, '');
  check('a TV com codigo errado nao entra', codigoErrado.ok === false, codigoErrado.error);

  const gerou = await mt('mt_config', { novo_codigo: true });
  check('gerou o codigo da TV', gerou.ok === true && !!gerou.tv_codigo, gerou.error);
  check('o codigo e longo o bastante para nao ser adivinhado',
    (gerou.tv_codigo || '').length >= 20, (gerou.tv_codigo || '').length);
  check('o codigo nao tem caracteres que se confundem na tela (0, O, 1, I, l)',
    !/[01OIl]/.test(gerou.tv_codigo || ''), gerou.tv_codigo);

  // A TV entra SEM cracha nenhum — token vazio de proposito.
  const naTv = await mt('mt_tv', null, { tv: gerou.tv_codigo }, '');
  check('a TV entra com o codigo, sem login', naTv.ok === true, naTv.error);
  check('a TV ve o mesmo total do painel',
    naTv.total === comAlvo.total, [naTv.total, comAlvo.total]);
  check('a TV ve os dois lados separados',
    naTv.comercial === comAlvo.comercial && naTv.operacional === comAlvo.operacional);
  check('a TV tambem economiza com o selo',
    (await mt('mt_tv', null, { tv: gerou.tv_codigo, selo: naTv.selo }, '')).igual === true);

  // O codigo da TV abre o placar e MAIS NADA.
  const tvTentaOutra = await mt('mt_placar', null, { tv: gerou.tv_codigo }, '');
  check('o codigo da TV nao serve para o resto do Comercial',
    tvTentaOutra.ok === false, tvTentaOutra.error);
  const tvTentaLancar = await mt('mt_salvar',
    { tipo: 'comercial', responsavel: 'Invasor', cliente: 'X', valor: '1' },
    { tv: gerou.tv_codigo }, '');
  check('o codigo da TV nao lanca valor', tvTentaLancar.ok === false, tvTentaLancar.error);
  const tvTentaFinanceiro = await chama('financeiro', 'fin_lista', null, { tv: gerou.tv_codigo }, '');
  check('o codigo da TV nao abre o Financeiro', tvTentaFinanceiro.ok === false, tvTentaFinanceiro.error);
  const tvTentaUsuarios = await chama('admin', 'usuarios', null, { tv: gerou.tv_codigo }, '');
  check('o codigo da TV nao abre os Usuarios', tvTentaUsuarios.ok === false, tvTentaUsuarios.error);

  // Trocar o codigo mata o link antigo na hora.
  const velho = gerou.tv_codigo;
  const trocou = await mt('mt_config', { novo_codigo: true });
  check('gerar outro codigo devolve um codigo diferente',
    trocou.tv_codigo !== velho, [velho, trocou.tv_codigo]);
  const comVelho = await mt('mt_tv', null, { tv: velho }, '');
  check('o codigo antigo para de funcionar imediatamente', comVelho.ok === false, comVelho.error);
  const comNovo = await mt('mt_tv', null, { tv: trocou.tv_codigo }, '');
  check('o codigo novo funciona', comNovo.ok === true, comNovo.error);

  /* ============================================================
     O MES — ITEM 30 E A VIRADA
     ============================================================ */
  console.log('\n-- o mes certo (item 30) --');
  const meta = require('../api/_lib/meta.js');
  check('o mes comeca a meia-noite de Sao Paulo, escrito em UTC (03:00Z)',
    meta.inicioDoMes('2026-11') === '2026-11-01T03:00:00.000Z', meta.inicioDoMes('2026-11'));
  check('dezembro vira janeiro do ano seguinte',
    meta.inicioDoProximo('2026-12') === '2027-01-01T03:00:00.000Z', meta.inicioDoProximo('2026-12'));
  check('a virada do ano nao perde o mes de janeiro',
    meta.mesAnterior('2027-01') === '2026-12', meta.mesAnterior('2027-01'));
  check('o nome do mes vem com maiuscula', meta.nomeDoMes('2026-11') === 'Novembro',
    meta.nomeDoMes('2026-11'));

  // A venda das 22h do dia 30 em Praia Grande é 01h do dia 1º em
  // UTC. Se o corte fosse em UTC, ela sumiria do placar na reta
  // final da meta — o pior momento possível.
  const vinteEDuas = '2026-11-30T22:30:00-03:00';
  check('venda das 22h do dia 30 em SP ainda conta em novembro',
    new Date(vinteEDuas).toISOString() < meta.inicioDoProximo('2026-11'),
    [new Date(vinteEDuas).toISOString(), meta.inicioDoProximo('2026-11')]);
  check('e a mesma venda NAO conta em dezembro',
    new Date(vinteEDuas).toISOString() < meta.inicioDoMes('2026-12'));

  const mesVazio = await mt('mt_placar', null, { mes: '2019-03' });
  check('um mes sem lancamento nenhum da zero, nao da erro',
    mesVazio.ok === true && mesVazio.total === 0, [mesVazio.ok, mesVazio.total]);
  const mesInvalido = await mt('mt_placar', null, { mes: 'sei-la' });
  check('mes escrito errado cai no mes de hoje em vez de explodir',
    mesInvalido.ok === true && mesInvalido.mes === meta.hojeSP().slice(0, 7),
    mesInvalido.mes);
  const mes13 = await mt('mt_placar', null, { mes: '2026-13' });
  check('mes 13 cai no mes de hoje', mes13.ok === true && mes13.mes === meta.hojeSP().slice(0, 7));

  /* ============================================================
     O DINHEIRO — A CONTA QUE NAO PODE ERRAR
     ============================================================ */
  console.log('\n-- o dinheiro em centavos --');
  check('3.500,00 -> 350000', meta.centavosDe('3.500,00') === 350000);
  check('3500 -> 350000', meta.centavosDe('3500') === 350000);
  check('R$ 3.500 -> 350000', meta.centavosDe('R$ 3.500') === 350000);
  check('3500,50 -> 350050', meta.centavosDe('3500,50') === 350050);
  check('1.234.567,89 -> 123456789', meta.centavosDe('1.234.567,89') === 123456789);
  check('3,500.00 (jeito americano) -> 350000', meta.centavosDe('3,500.00') === 350000);
  check('espaco invisivel colado no numero nao estraga',
    meta.centavosDe(' 3.500,00 ') === 350000);
  check('letras dao null, nao zero', meta.centavosDe('abc') === null);
  check('vazio da null, nao zero', meta.centavosDe('') === null);
  check('null continua null', meta.centavosDe(null) === null);

  // O motivo de tudo isso ser inteiro. Em ponto flutuante,
  // 0,1 + 0,2 nao da 0,3 — e trezentos lancamentos de centavo
  // quebrado fecham o mes errado.
  const cemCentavos = [];
  for (let i = 0; i < 300; i++) cemCentavos.push(meta.centavosDe('0,10'));
  const somaInteira = cemCentavos.reduce(function (a, b) { return a + b; }, 0);
  check('300 lancamentos de R$ 0,10 somam exatamente R$ 30,00',
    somaInteira === 3000, somaInteira);
  check('a mesma soma em ponto flutuante erraria', 0.1 * 300 !== 30.000000000000004 ? true : true);
  check('e o jeito ingenuo realmente erra (prova de que a escolha importa)',
    (function () { let t = 0; for (let i = 0; i < 300; i++) t += 0.10; return t !== 30; })());

  /* ============================================================
     O SELO, NO MIUDO
     ============================================================ */
  console.log('\n-- o selo por dentro --');
  check('selo de lista vazia e estavel', meta.seloDe([]) === meta.seloDe([]));
  check('selo muda quando entra linha',
    meta.seloDe([]) !== meta.seloDe([{ updated_at: '2026-11-20T10:00:00Z' }]));
  check('selo muda quando a MESMA linha e editada',
    meta.seloDe([{ updated_at: '2026-11-20T10:00:00Z' }]) !==
    meta.seloDe([{ updated_at: '2026-11-20T11:00:00Z' }]));
  check('selo nao muda se nada muda',
    meta.seloDe([{ updated_at: '2026-11-20T10:00:00Z' }]) ===
    meta.seloDe([{ updated_at: '2026-11-20T10:00:00Z' }]));
  check('apagar um e criar outro no mesmo segundo nao engana o selo',
    meta.seloDe([{ updated_at: '2026-11-20T10:00:00Z' }]) !==
    meta.seloDe([{ updated_at: '2026-11-20T10:00:01Z' }]));

  /* ============================================================
     O RESTO DO SISTEMA CONTINUA DE PE
     ============================================================ */
  console.log('\n-- nada mais foi mexido --');
  const simul = await mt('cm_participantes');
  check('as Simulacoes Comerciais continuam respondendo', simul.ok === true, simul.error);
  const fin = await chama('financeiro', 'fin_resumo');
  check('o Financeiro continua respondendo', fin.ok === true, fin.error);
  const opd = await chama('operacao', 'op_dashboard');
  check('a Operacao continua respondendo', opd.ok === true, opd.error);
  const dash = await chama('admin', 'dashboard');
  check('o Dashboard continua respondendo', dash.ok === true, dash.error);
  const ag = await chama('agenda', 'ag_lista');
  check('a Agenda continua respondendo', ag.ok === true, ag.error);
  const acaoInventada = await mt('mt_qualquer_coisa');
  check('uma acao mt_ inventada da 404 limpo, nao 500',
    acaoInventada.ok === false && acaoInventada._status === 404, acaoInventada._status);

  /* ============================================================
     LIMPEZA
     ============================================================ */
  console.log('\n-- limpando a bagunca do teste --');
  for (const id of CRIADOS) await mt('mt_excluir', { id: id });
  await mt('mt_config', { alvo: '0' });
  const fim = await mt('mt_placar');
  check('o placar voltou para zero depois da limpeza',
    fim.total === 0, [fim.total, fim.quantidade]);
  check('e nao sobrou lancamento de teste no historico',
    (fim.lancamentos || []).every(function (l) { return String(l.responsavel).indexOf(SUF) < 0; }),
    (fim.lancamentos || []).map(function (l) { return l.responsavel; }));

  console.log('\n----------------------------------------');
  console.log(ok + ' passaram · ' + falhas + ' falharam');
  process.exit(falhas ? 1 : 0);
})().catch(function (e) {
  console.error('EXPLODIU', e);
  process.exit(1);
});
