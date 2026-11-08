// Testes das funcionalidades novas: login do candidato, Aurea e importação.
// Uso: node tools/test-novo.js
'use strict';
const BASE = 'http://localhost:3000';
const SERV = 'http://127.0.0.1:54322';   // espelho dos servicos de fora
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
async function webhook(telefone, texto, nome) {
  return webhookMsg(telefone, { conversation: texto }, nome);
}
async function webhookVideo(telefone, legenda) {
  return webhookMsg(telefone, { videoMessage: { mimetype: 'video/mp4', caption: legenda || '' } });
}
async function webhookMsg(telefone, message, nome) {
  const k = (await adm('aurea')).webhook_url.split('k=')[1];
  return (await fetch(BASE + '/api/webhook?k=' + k, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'messages.upsert',
      data: {
        key: { remoteJid: telefone + '@s.whatsapp.net', fromMe: false, id: 'm' + Math.random() },
        pushName: nome || undefined,
        message: message
      }
    })
  })).json();
}

// A senha do painel vem do ambiente — nunca fica escrita aqui dentro.
// Rode assim:  ADMIN_PASSWORD='sua-senha' node tools/test-novo.js
const SENHA_PAINEL = process.env.ADMIN_PASSWORD || process.env.ADMIN_SECRET || '';
if (!SENHA_PAINEL) {
  console.error('Falta a senha. Rode:  ADMIN_PASSWORD="sua-senha" node tools/test-novo.js');
  process.exit(1);
}

(async function () {

// O painel so aceita a senha mestra enquanto nao existir nenhum Dono
// cadastrado. Entao a bateria comeca com a lista de usuarios vazia —
// senao um usuario deixado por um teste anterior tranca tudo.
await fetch('http://127.0.0.1:54321/rest/v1/panel_users', { method: 'DELETE' })
  .catch(function () { return null; });
  const login = await (await fetch(BASE + '/api/admin?action=login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: SENHA_PAINEL })
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
  // O webhook e a orelha do sistema. O painel precisa CONFERIR o que a
  // Evolution guardou, nao so mandar configurar e torcer.
  // finge que alguem deixou o webhook apontando para o lugar errado
  await fetch('http://127.0.0.1:54322/webhook/set/qualquer', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ webhook: { url: 'https://endereco-errado.exemplo/api/webhook?k=abc' } })
  });
  const gan0 = await adm('wa_status');
  check('status do whatsapp confere o webhook', gan0.ok && !!gan0.webhook, gan0.error);
  check('flagra webhook apontando para outro lugar',
    gan0.webhook && gan0.webhook.confere === false && gan0.webhook.mesmo_endereco === false, gan0.webhook);
  check('mostra o endereco que deveria estar la', /\/api\/webhook\?k=/.test(gan0.webhook_url || ''));

  // e agora a chave errada, que e o que acontece quando o APP_SECRET muda
  await fetch('http://127.0.0.1:54322/webhook/set/qualquer', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ webhook: { url: (gan0.webhook_url || '').split('?')[0] + '?k=chave-velha' } })
  });
  const ganK = await adm('wa_status');
  check('flagra endereco certo com chave velha',
    ganK.webhook && ganK.webhook.mesmo_endereco === true && ganK.webhook.mesma_chave === false, ganK.webhook);

  check('configura o webhook', (await adm('wa_webhook', {})).ok);
  const gan1 = await adm('wa_status');
  check('depois de configurar, o webhook confere', gan1.webhook && gan1.webhook.confere === true, gan1.webhook);
  check('e ele ouve mensagem recebida', gan1.webhook && gan1.webhook.ouve_mensagens === true);
  check('o endereco guardado e o nosso', gan1.webhook && gan1.webhook.url === gan1.webhook_url,
    gan1.webhook && gan1.webhook.url);

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

  // ============================================================
  console.log('\n4b) LANDING → WHATSAPP → CADASTRO');
  // O funil novo: a pessoa ve a vaga na landing, aperta o botao, cai no
  // WhatsApp, a Aurea reconhece a vaga, faz o roteiro e manda o cadastro.

  // Uma rodada anterior pode ter deixado as pausas curtas. Volta ao padrao
  // antes de conferir, senao o teste depende do que sobrou de antes.
  await adm('aurea_config_save', { value: { pausa_primeira: 10000, pausa_entre_mensagens: 4000 } });
  const cfgPausa = (await adm('aurea')).config || {};
  check('o padrao e 10 segundos na primeira resposta', cfgPausa.pausa_primeira === 10000, cfgPausa.pausa_primeira);
  check('e 4 segundos nas seguintes', cfgPausa.pausa_entre_mensagens === 4000, cfgPausa.pausa_entre_mensagens);

  // para a bateria nao levar 1 minuto de espera de verdade, encurtamos as
  // pausas aqui. O que importa e que o valor configurado chegue na Evolution.
  await adm('aurea_config_save', {
    value: {
      atende_desconhecido: true, enviar_link_cadastro: 'aprovados',
      pausa_primeira: 900, pausa_entre_mensagens: 300
    }
  });

  // trocar a conexao do WhatsApp tem que trocar o botao da landing junto
  const stz = await adm('wa_status');
  check('painel enxerga o numero conectado', !!stz.numero_conectado, stz.numero_conectado);
  const landDepois = (await adm('settings')).landing || {};
  check('o numero da landing acompanha o WhatsApp conectado',
    landDepois.whatsapp === stz.numero_conectado, { landing: landDepois.whatsapp, conectado: stz.numero_conectado });

  const pub1 = await pub('vagas');
  check('landing lista as vagas', pub1.ok && pub1.vagas.length === 3, pub1.error);
  check('landing devolve os filtros por area', pub1.areas.indexOf('Tráfego Pago') >= 0, pub1.areas);
  const vagaPleno = pub1.vagas.filter(function (v) { return v.slug === 'gestor-de-trafego-pleno'; })[0];
  check('vaga tem salario', vagaPleno && vagaPleno.salary === 'R$ 2.200 + Comissões', vagaPleno && vagaPleno.salary);
  // O botao TEM que levar para o numero conectado na Evolution — nao para
  // um numero digitado a mao, que pode ficar velho quando trocam a conexao.
  const zapConectado = (await adm('wa_status')).numero_conectado;
  check('botao leva para o numero conectado na Evolution',
    vagaPleno.link_whatsapp.indexOf('https://wa.me/' + zapConectado + '?text=') === 0,
    { link: vagaPleno.link_whatsapp, conectado: zapConectado });
  check('mensagem do botao cita a vaga',
    decodeURIComponent(vagaPleno.link_whatsapp.split('text=')[1]).indexOf('Gestor de Tráfego Pleno') >= 0);
  check('landing nao vaza o roteiro de perguntas', vagaPleno.prequal_group_id === undefined);
  check('vaga sozinha pelo apelido', (await pub('vaga', null, { slug: 'gestor-de-trafego-jr' })).ok);
  check('apelido que nao existe da 404', !(await pub('vaga', null, { slug: 'nao-existe' })).ok);

  // ------------------------------------------------------------
  // A CHAVE: esta vaga vai pro WhatsApp ou termina no site?
  // ------------------------------------------------------------
  const vagaSemZap = pub1.vagas.filter(function (v) { return v.slug === 'assistente-administrativo'; })[0];
  check('vaga marcada como "termina no site" diz isso na landing',
    vagaSemZap && vagaSemZap.usa_whatsapp === false, vagaSemZap && vagaSemZap.usa_whatsapp);
  // O botao TEM que vir vazio. Se vier preenchido, a landing desenha um
  // botao de WhatsApp numa vaga que nao deveria ter nenhum.
  check('vaga sem WhatsApp nao devolve link de WhatsApp',
    vagaSemZap.link_whatsapp === '', vagaSemZap.link_whatsapp);
  check('vaga de WhatsApp continua marcada como tal', vagaPleno.usa_whatsapp === true);

  const foneAdm = '11 9' + String(Date.now() + 31).slice(-8);
  const digAdm = '55' + foneAdm.replace(/\D/g, '');
  const cadSemZap = await pub('candidatar', {
    vaga: 'assistente-administrativo', name: 'Bruna Alves ' + SUF,
    phone: foneAdm, email: 'bruna.adm.' + SUF + '@exemplo.com',
    cidade: 'Praia Grande', experiencia: 'Rotinas administrativas'
  });
  check('cadastro na vaga sem WhatsApp e aceito', cadSemZap.ok, cadSemZap.error);
  check('a resposta avisa que nao vai pro WhatsApp', cadSemZap.usa_whatsapp === false, cadSemZap);
  check('e nao manda link nem frase de WhatsApp',
    cadSemZap.link_whatsapp === '' && cadSemZap.mensagem === '', cadSemZap);

  // Se a pessoa chamar assim mesmo, a Aurea responde — mas NAO dispara a
  // sequencia de video e pre-qualificacao, que e o que a chave desliga.
  const zapSemZap = await webhook(digAdm, 'Oi, me candidatei na vaga', 'Bruna Alves ' + SUF);
  check('vaga sem WhatsApp nao dispara a sequencia da landing',
    zapSemZap.resultado && zapSemZap.resultado.sequencia !== true, zapSemZap.resultado);

  // ============================================================
  // O funil de verdade: formulario na landing -> WhatsApp -> sequencia
  // ============================================================
  const NOME_RAFA = 'Rafaela Souza ' + SUF;
  const foneL = '11 9' + String(Date.now() + 7).slice(-8);
  const digL = '55' + foneL.replace(/\D/g, '');

  // sem cadastro, a Aurea nao fala com ninguem
  const semCad = await webhook(digL, 'Olá! quero a vaga', NOME_RAFA);
  check('sem cadastro na landing, a Aurea nao responde',
    semCad.ignorado === 'sem cadastro na landing', semCad);

  // ---- 1) a pessoa preenche o formulario da landing ----
  // ---- os campos extras que ESTA vaga pede ----
  const vagaCampos = (pub1.vagas.filter(function (v) { return v.slug === 'gestor-de-trafego-pleno'; })[0] || {}).campos || [];
  check('a landing sabe quais campos a vaga pede', vagaCampos.length === 5, vagaCampos.length);
  check('e diz o tipo de cada um',
    vagaCampos.filter(function (c) { return c.chave === 'cpf'; })[0].tipo === 'cpf' &&
    vagaCampos.filter(function (c) { return c.chave === 'curriculo'; })[0].tipo === 'arquivo',
    vagaCampos.map(function (c) { return c.chave + ':' + c.tipo; }));
  check('indicacao e opcional, o resto nao',
    vagaCampos.filter(function (c) { return c.chave === 'indicacao'; })[0].obrigatorio === false &&
    vagaCampos.filter(function (c) { return c.chave === 'cidade'; })[0].obrigatorio === true);
  const vagaJr = pub1.vagas.filter(function (v) { return v.slug === 'gestor-de-trafego-jr'; })[0];
  check('vaga sem campos extras nao pede nada a mais', (vagaJr.campos || []).length === 0, vagaJr.campos);

  const baseCad = { vaga: 'gestor-de-trafego-pleno', name: NOME_RAFA, phone: foneL, email: 'rafaela.' + SUF + '@exemplo.com' };
  check('recusa quando falta um campo obrigatorio da vaga',
    !(await pub('candidatar', baseCad)).ok);
  check('recusa CPF invalido',
    !(await pub('candidatar', Object.assign({}, baseCad, {
      pretensao: 'R$ 3.000', cpf: '111.111.111-11', cidade: 'Praia Grande'
    }))).ok);

  const cad = await pub('candidatar', Object.assign({}, baseCad, {
    pretensao: 'R$ 3.000', cpf: '529.982.247-25', cidade: 'Praia Grande', indicacao: 'Jhow do time'
  }));
  check('cadastro da landing aceito', cad.ok, cad.error);
  check('devolve o token para anexar o curriculo', !!cad.token, cad.token);
  check('e avisa que esta vaga pede curriculo', cad.pede_curriculo === true, cad.pede_curriculo);
  check('devolve o primeiro nome', cad.nome === 'Rafaela', cad.nome);
  check('a mensagem do botao leva o titulo da vaga',
    (cad.mensagem || '').indexOf('(Gestor de Tráfego Pleno)') >= 0, cad.mensagem);
  check('e o link abre o whatsapp conectado',
    (cad.link_whatsapp || '').indexOf('https://wa.me/' + zapConectado + '?text=') === 0,
    { link: cad.link_whatsapp, conectado: zapConectado });

  check('recusa nome sem sobrenome',
    !(await pub('candidatar', { vaga: 'gestor-de-trafego-pleno', name: 'Ana', phone: foneL, email: 'a@b.com' })).ok);
  check('recusa e-mail torto',
    !(await pub('candidatar', { vaga: 'gestor-de-trafego-pleno', name: 'Ana Paula', phone: foneL, email: 'nao-e-email' })).ok);
  check('recusa vaga que nao existe',
    !(await pub('candidatar', { vaga: 'inventada', name: 'Ana Paula', phone: foneL, email: 'a@b.com' })).ok);

  const leadR = (await adm('board')).candidates.filter(function (c) { return c.name === NOME_RAFA; })[0];
  check('cadastro entrou no sistema', !!leadR, leadR);
  check('marcado como vindo da landing', leadR && leadR.source === 'landing', leadR && leadR.source);
  check('ja nasce ligado a vaga', leadR && !!leadR.job_id);

  const fichaExtras = (await adm('candidate', null, { id: leadR.id })).candidate;
  check('guardou a pretensao', fichaExtras.salary_expectation === 'R$ 3.000', fichaExtras.salary_expectation);
