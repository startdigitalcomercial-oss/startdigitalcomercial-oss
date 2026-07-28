// Testes das funcionalidades novas: login do candidato, Aurea e importação.
// Uso: node tools/test-novo.js
'use strict';
const BASE = 'http://localhost:3000';
const SUF = Date.now().toString(36);
let T = '';
let falhas = 0, ok = 0;

function check(nome, cond, extra) {
  if (cond) { ok++; console.log('  ok   ' + nome); }
  else { falhas++; console.log('  FALHA ' + nome + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
async function pub(action, body, query) {
  const qs = new URLSearchParams(Object.assign({ action: action }, query || {}));
  return (await fetch(BASE + '/api/public?' + qs, {
    method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  })).json();
}
async function adm(action, body, query) {
  const qs = new URLSearchParams(Object.assign({ action: action }, query || {}));
  return (await fetch(BASE + '/api/admin?' + qs, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + T },
    body: body ? JSON.stringify(body) : undefined
  })).json();
}
async function comoCandidato(action, token, body, query) {
  const qs = new URLSearchParams(Object.assign({ action: action }, query || {}));
  return (await fetch(BASE + '/api/public?' + qs, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined
  })).json();
}
async function webhook(telefone, texto) {
  const k = (await adm('aurea')).webhook_url.split('k=')[1];
  return (await fetch(BASE + '/api/webhook?k=' + k, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'messages.upsert',
      data: {
        key: { remoteJid: telefone + '@s.whatsapp.net', fromMe: false, id: 'm' + Math.random() },
        message: { conversation: texto }
      }
    })
  })).json();
}

(async function () {
  const login = await (await fetch(BASE + '/api/admin?action=login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'Start-RH-ioZSqXbN' })
  })).json();
  T = login.token;

  console.log('\n1) DASHBOARD');
  const dash = await adm('dashboard');
  check('dashboard responde', dash.ok, dash.error);
  check('serie de 14 dias', dash.ok && dash.serie_novos.length === 14, dash.serie_novos && dash.serie_novos.length);
  check('funil com as 5 etapas', dash.ok && dash.funil.length === 5);
  check('indicadores presentes', dash.ok && typeof dash.indicadores.ativos === 'number');

  console.log('\n2) PRE-QUALIFICACAO');
  const pq = await adm('prequal');
  check('grupo padrao existe', pq.ok && pq.grupos.length >= 1, pq.grupos && pq.grupos.length);
  const grupo = pq.grupos[0];
  check('grupo tem 6 perguntas', grupo.questions.length === 6, grupo.questions.length);
  check('perguntas tem objetivo', grupo.questions.every(function (q) { return !!q.objective; }));

  const novoG = await adm('prequal_group_save', { name: 'Roteiro teste ' + SUF, active: true });
  check('cria roteiro', novoG.ok && !!novoG.grupo.id);
  const novaQ = await adm('prequal_question_save', {
    group_id: novoG.grupo.id, question: 'Voce dirige?', objective: 'Precisa de CNH.'
  });
  check('cria pergunta', novaQ.ok && novaQ.pergunta.position === 1, novaQ.pergunta && novaQ.pergunta.position);
  check('exclui pergunta', (await adm('prequal_question_delete', { id: novaQ.pergunta.id })).ok);
  check('exclui roteiro', (await adm('prequal_group_delete', { id: novoG.grupo.id })).ok);

  console.log('\n3) AUREA — configuracao');
  const a1 = await adm('aurea');
  check('aurea carrega', a1.ok, a1.error);
  check('mostra o endereco do webhook', a1.ok && /\/api\/webhook\?k=/.test(a1.webhook_url), a1.webhook_url);
  check('detecta a chave de IA', a1.tem_chave_ia === true);
  const teste = await adm('aurea_test');
  check('teste de conexao da IA', teste.ok && !!teste.resposta, teste.error || teste.resposta);
  check('salva configuracao', (await adm('aurea_config_save', { value: { hora_inicio: 9 } })).ok);
  check('configuracao persistiu', (await adm('aurea')).config.hora_inicio === 9);

  console.log('\n4) AUREA — conversa de ponta a ponta');
  const fone = '11 9' + String(Date.now()).slice(-8);
  const cand = await pub('apply', {
    name: 'Carlos Eduardo Aurea ' + SUF, email: 'carlos.' + SUF + '@exemplo.com',
    phone: fone, role_applied: 'Gestor de Tráfego',
    experience: 'Tres anos em agencia.', why_start: 'Quero crescer.'
  });
  check('candidato criado pelo formulario', cand.ok, cand.error);
  check('aurea puxou conversa sozinha', cand.aurea === true, cand.aurea);

  const soFone = fone.replace(/\D/g, '');
  const digitos = soFone.length <= 11 ? '55' + soFone : soFone;

  let sess = (await adm('aurea')).sessoes.find(function (s) { return s.candidato.indexOf(SUF) >= 0; });
  check('sessao criada em andamento', !!sess && sess.status === 'em_andamento', sess && sess.status);

  const respostas = [
    'Trabalhei 2 anos na agencia XPTO como gestor de trafego.',
    'Sim, meta ads e google ads principalmente.',
    'Tenho notebook proprio e fibra de 300 mega.',
    'Disponibilidade integral, posso comecar em 15 dias.',
    'Uns 3 mil reais.',
    'Acompanho a Start no instagram e gosto do jeito que voces comunicam.'
  ];
  for (const r of respostas) {
    await webhook(digitos, r);
  }

  const a2 = await adm('aurea');
  sess = a2.sessoes.find(function (s) { return s.candidato.indexOf(SUF) >= 0; });
  check('conversa foi concluida', sess && sess.status === 'concluida', sess && sess.status);
  check('capturou as 6 respostas', sess && sess.total_respostas === 6, sess && sess.total_respostas);
  check('gerou nota', sess && Number(sess.score) === 8, sess && sess.score);
  check('gerou recomendacao', sess && sess.recommendation === 'avancar', sess && sess.recommendation);

  const det = await adm('aurea_session', null, { id: sess.id });
  check('transcricao completa', det.ok && det.mensagens.length >= 14, det.mensagens && det.mensagens.length);
  check('alterna aurea e candidato', det.ok && det.mensagens.some(function (m) { return m.role === 'candidato'; })
    && det.mensagens.some(function (m) { return m.role === 'aurea'; }));
  check('resumo salvo', det.ok && !!det.sessao.summary);

  const fichaA = await adm('candidate', null, { id: cand.id });
  check('pre-qualificacao aparece na ficha', fichaA.ok && !!fichaA.prequal, fichaA.prequal);

  console.log('\n5) WEBHOOK — casos que deve ignorar');
  const k = a2.webhook_url.split('k=')[1];
  const semChave = await (await fetch(BASE + '/api/webhook?k=errada', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
  })).json();
  check('recusa chave errada', semChave.ok === false);
  const grupo2 = await (await fetch(BASE + '/api/webhook?k=' + k, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: 'messages.upsert', data: { key: { remoteJid: '123@g.us' }, message: { conversation: 'oi' } } })
  })).json();
  check('ignora mensagem de grupo', grupo2.ignorado === 'mensagem de grupo', grupo2);
  const nossa = await (await fetch(BASE + '/api/webhook?k=' + k, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: 'messages.upsert', data: { key: { remoteJid: '5511999@s.whatsapp.net', fromMe: true }, message: { conversation: 'oi' } } })
  })).json();
  check('ignora mensagem nossa', nossa.ignorado === 'mensagem nossa', nossa);
  const desconhecido = await webhook('5511000000000', 'oi');
  check('ignora numero nao cadastrado', desconhecido.ignorado === 'numero nao cadastrado', desconhecido);

  console.log('\n6) IMPORTAR LISTA');
  const imp = await adm('import_candidates', {
    source: 'Indeed', role: 'Social Media', iniciar_aurea: true, forcar: true,
    rows: [
      { name: 'Ana Paula Ribeiro ' + SUF, phone: '11 91111' + String(Date.now()).slice(-4), email: 'ana.' + SUF + '@ex.com' },
      { name: 'Bruno Costa ' + SUF, phone: '11 92222' + String(Date.now()).slice(-4) },
      { name: 'Xy', phone: '11 93333' + String(Date.now()).slice(-4) },
      { name: 'Telefone Ruim ' + SUF, phone: '123' }
    ]
  });
  check('importa os validos', imp.ok && imp.criados.length === 2, imp.criados && imp.criados.length);
  check('pula nome curto e telefone ruim', imp.pulados.length === 2, imp.pulados);
  check('aurea chamou os importados', imp.disparos.length === 2 && imp.disparos.every(function (d) { return d.ok; }), imp.disparos);

  const boardI = await adm('board');
  const importado = boardI.candidates.find(function (c) { return c.name.indexOf('Ana Paula') === 0; });
  check('importado entra em triagem', !!importado && importado.stage_key === 'triagem', importado && importado.stage_key);
  const fichaI = await adm('candidate', null, { id: importado.id });
  check('guarda a origem', fichaI.candidate.source_detail === 'Indeed', fichaI.candidate.source_detail);

  const dupImp = await adm('import_candidates', {
    source: 'Catho', rows: [{ name: 'Ana Paula Ribeiro ' + SUF, phone: '11 94444' + String(Date.now()).slice(-4), email: 'ana.' + SUF + '@ex.com' }]
  });
  check('nao duplica por e-mail', dupImp.criados.length === 0 && dupImp.pulados.length === 1, dupImp);

  console.log('\n7) LOGIN DO CANDIDATO');
  const emailLogin = 'login.' + SUF + '@exemplo.com';
  const c2 = await pub('apply', {
    name: 'Julia Ramos Login', email: emailLogin, phone: '11 95555' + String(Date.now()).slice(-4),
    role_applied: 'Designer', experience: 'x', why_start: 'y'
  });
  const f2 = await adm('candidate', null, { id: c2.id });
  const tk2 = f2.links.link_senha.split('t=')[1];

  const antes = await pub('conta_info', null, { t: tk2 });
  check('bloqueia criar senha antes de liberar', !antes.ok, antes.error);

  await adm('update_candidate', { id: c2.id, member_access: true });
  const info = await pub('conta_info', null, { t: tk2 });
  check('conta_info libera apos aprovacao', info.ok && info.email === emailLogin, info);
  check('marca que ainda nao tem senha', info.ja_tem_senha === false);

  const curta = await pub('conta_criar_senha', { t: tk2, password: '123' });
  check('recusa senha curta', !curta.ok, curta.error);

  const criada = await pub('conta_criar_senha', { t: tk2, password: 'minhasenha123' });
  check('cria a senha e devolve sessao', criada.ok && !!criada.token, criada.error);

  const errada = await pub('entrar', { email: emailLogin, password: 'errada' });
  check('login com senha errada falha', !errada.ok && errada.error.indexOf('incorretos') >= 0, errada.error);
  const certa = await pub('entrar', { email: emailLogin, password: 'minhasenha123' });
  check('login com senha certa funciona', certa.ok && !!certa.token, certa.error);

  const portalSessao = await comoCandidato('portal', certa.token);
  check('portal abre com a sessao, sem link', portalSessao.ok && portalSessao.modules.length >= 1, portalSessao.error);
  const portalSem = await pub('portal', null, {});
  check('portal fechado sem credencial', !portalSem.ok, portalSem.error);
  const portalToken = await pub('portal', null, { t: tk2 });
  check('link pessoal continua funcionando', portalToken.ok);

  const aula = portalSessao.modules[0].lessons[0];
  const marcou = await comoCandidato('lesson_done', certa.token, { lesson_id: aula.id, completed: true });
  check('marca aula pela sessao', marcou.ok, marcou.error);

  const info2 = await pub('conta_info', null, { t: tk2 });
  check('agora consta que tem senha', info2.ja_tem_senha === true);

  console.log('\n8) WHATSAPP — conexao por QR code');
  const st1 = await adm('wa_status');
  check('status do whatsapp responde', st1.ok && st1.configurada === true, st1.error);
  check('mostra o endereco do webhook', /\/api\/webhook\?k=/.test(st1.webhook_url || ''));

  const conn = await adm('wa_conectar', { instance: 'start-teste' });
  check('gera o QR code', conn.ok && !!conn.base64, conn.error);
  check('devolve codigo de pareamento', !!conn.pairingCode, conn.pairingCode);
  check('configura o webhook sozinho', conn.webhook_ok === true, conn.webhook_erro);

  const st2 = await adm('wa_status');
  check('guarda a instancia escolhida', st2.escolhida === 'start-teste', st2.escolhida);

  const e1 = await adm('wa_estado', null, { instance: 'start-teste' });
  check('le o estado da conexao', e1.ok && !!e1.estado, e1);
  const e2 = await adm('wa_estado', null, { instance: 'start-teste' });
  check('detecta quando conecta', e2.conectada === true, e2.estado);

  const nomeRuim = await adm('wa_conectar', { instance: 'nome invalido!' });
  check('recusa nome invalido', !nomeRuim.ok, nomeRuim.error);

  const testeWa = await adm('wa_teste', { phone: '11 98877-6655' });
  check('envia mensagem de teste', testeWa.ok, testeWa.error);
  const diag = await adm('wa_diagnostico', { phone: '13 99600-3897' });
  check('diagnostico roda', diag.ok, diag.error);
  const passos = (diag.data && diag.data.passos) || (diag.passos) || [];
  check('diagnostico tem 7 passos', passos.length === 7, 'passos: ' + passos.length);
  const pNum = passos.filter(function (p) { return p.passo === 'Número montado'; })[0];
  check('diagnostico monta 5513996003897', !!pNum && /5513996003897/.test(String(pNum.detalhe)), pNum && pNum.detalhe);
  const pLink = passos.filter(function (p) { return p.passo === 'Envio com link'; })[0];
  check('diagnostico envia com link', !!pLink && pLink.ok === true, pLink && pLink.detalhe);

  // Nono digito: numero antigo cadastrado no WhatsApp SEM o 9.
  // O sistema tem que perceber e mandar para o endereco certo.
  const diag9 = await adm('wa_diagnostico', { phone: '13 98855-9994' });
  const p9 = (diag9.data && diag9.data.passos) || diag9.passos || [];
  const pReal = p9.filter(function (p) { return p.passo === 'Endereço real no WhatsApp'; })[0];
  check('detecta endereco diferente do montado',
    !!pReal && /551388559994/.test(String(pReal.detalhe)) && /DIFERENTE/.test(String(pReal.detalhe)),
    pReal && pReal.detalhe);
  const pEnv = p9.filter(function (p) { return p.passo === 'Envio sem link'; })[0];
  check('envia para o endereco corrigido',
    !!pEnv && /551388559994/.test(String(pEnv.detalhe)),
    pEnv && pEnv.detalhe);
  const pEu = p9.filter(function (p) { return p.passo === 'Não é envio para si mesmo'; })[0];
  check('avisa se for envio para si mesmo', !!pEu && pEu.ok === true, pEu && pEu.detalhe);

  console.log('\n5b) SMS — Comtele (API v4 do painel novo)');
  const smsCand = await pub('apply', {
    name: 'Sms Teste ' + SUF, email: 'sms.' + SUF + '@exemplo.com',
    phone: '13 99600-3897', role_applied: 'Designer',
    experience: 'Teste de SMS.', why_start: 'Teste.'
  });
  const envioSms = await adm('send', {
    candidate_id: smsCand.id, set: 'welcome', channels: ['sms'], grant_access: false
  });
  const rSms = (envioSms.results || []).filter(function (x) { return x.channel === 'sms'; })[0];
  check('sms sai pela comtele', !!rSms && rSms.status === 'enviado', rSms && rSms.error);
  const capturado = await (await fetch('http://127.0.0.1:54322/__ultimo-sms')).json().catch(function () { return {}; });
  check('usa a rota Premium (17)', capturado.route === 17 || capturado.route === '17', capturado.route);
  check('numero vai com o 55 na frente', String(capturado.receivers && capturado.receivers[0]).indexOf('55') === 0,
    capturado.receivers);
  check('mensagem sem acento', !!capturado.message && !/[àáâãéêíóôõúç]/i.test(capturado.message), capturado.message);

  const qrNovo = await adm('wa_qr', {});
  check('pede QR novo (renovacao)', qrNovo.ok && !!(qrNovo.data || qrNovo).base64, qrNovo.error);

  const recriada = await adm('wa_recriar', { instance: 'start-rh' });
  check('recria instancia do zero', recriada.ok, recriada.error);

  const limpou = await adm('wa_limpar', {});
  const dl = limpou.data || limpou;
  check('apaga as instancias que sobraram', limpou.ok && Array.isArray(dl.apagadas), limpou.error);

  check('desconecta', (await adm('wa_desconectar', {})).ok);

  console.log('\n----------------------------------------');
  console.log(ok + ' passaram · ' + falhas + ' falharam');
  process.exit(falhas ? 1 : 0);
})().catch(function (e) { console.error('EXPLODIU:', e); process.exit(1); });
