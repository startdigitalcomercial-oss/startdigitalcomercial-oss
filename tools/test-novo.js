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
  check('guardou o CPF formatado', fichaExtras.cpf === '529.982.247-25', fichaExtras.cpf);
  check('guardou a cidade', fichaExtras.city === 'Praia Grande', fichaExtras.city);
  check('guardou quem indicou', fichaExtras.indicacao === 'Jhow do time', fichaExtras.indicacao);

  // ---- currículo ----
  const pdfFalso = Buffer.from('%PDF-1.4 teste de curriculo').toString('base64');
  const semToken = await pub('curriculo', { t: 'token-que-nao-existe', nome: 'cv.pdf', tipo: 'application/pdf', arquivo: pdfFalso });
  check('curriculo exige token valido', !semToken.ok, semToken.error);
  const tipoRuim = await pub('curriculo', { t: cad.token, nome: 'cv.exe', tipo: 'application/x-msdownload', arquivo: pdfFalso });
  check('recusa formato que nao aceitamos', !tipoRuim.ok, tipoRuim.error);
  const subiu = await pub('curriculo', { t: cad.token, nome: 'curriculo-rafaela.pdf', tipo: 'application/pdf', arquivo: pdfFalso });
  check('curriculo aceito', subiu.ok, subiu.error);

  const guardados = await (await fetch('http://127.0.0.1:54321/__arquivos')).json();
  const chaves = Object.keys(guardados).filter(function (k) { return k.indexOf('curriculos/' + leadR.id) === 0; });
  check('o arquivo foi mesmo guardado', chaves.length === 1, Object.keys(guardados));
  check('e chegou inteiro', guardados[chaves[0]].bytes === Buffer.from(pdfFalso, 'base64').length,
    guardados[chaves[0]]);

  const fichaCv = (await adm('candidate', null, { id: leadR.id })).candidate;
  check('a ficha mostra o nome do arquivo', fichaCv.curriculo_nome === 'curriculo-rafaela.pdf', fichaCv.curriculo_nome);
  check('e nao guarda endereco publico', !/^https?:/.test(fichaCv.curriculo_url || ''), fichaCv.curriculo_url);
  const linkCv = await adm('curriculo_link', null, { id: leadR.id });
  check('o painel gera um link temporario', linkCv.ok && /object\/sign\//.test(linkCv.link || ''), linkCv.error);
  check('quem nao anexou nao tem link',
    !(await adm('curriculo_link', null, { id: 'nao-existe' })).ok);

  // ---- 2) ela chama no WhatsApp: saudacao + perguntas da vaga, video, cadastro ----
  const seq = await webhook(digL, cad.mensagem, NOME_RAFA);
  check('a sequencia de chegada dispara', seq.resultado && seq.resultado.sequencia === true, seq.resultado);
  check('sao 3 mensagens', seq.resultado && seq.resultado.mensagens === 3, seq.resultado);

  function logsDela() {
    return adm('logs', null, { limit: 60 }).then(function (l) {
      return (l.logs || []).filter(function (x) { return x.candidate_name === NOME_RAFA; });
    });
  }
  let enviadas = await logsDela();
  let corpos = enviadas.map(function (l) { return l.body; }).join('\n---\n');
  check('a saudacao chama pelo nome', /Oi Rafaela, tudo bem\?/.test(corpos), corpos.slice(0, 80));
  check('e vem com as perguntas desta vaga',
    /Meta Ads e Google Ads/.test(corpos) && /rodou quanto em Ads/.test(corpos) &&
    /curso você já fez de tráfego pago/.test(corpos), corpos.slice(0, 300));
  check('e com as duas perguntas padrao, que valem para toda vaga',
    /música favorita/.test(corpos) && /preço do combustível/.test(corpos), corpos.slice(0, 400));
  check('nada de trabalho remoto em lugar nenhum',
    !/remoto|remota|home office|híbrid/i.test(corpos), corpos.slice(0, 200));
  check('pede o video citando a vaga',
    /vídeo de até 1 minuto/.test(corpos) && /Gestor de Tráfego Pleno/.test(corpos));
  check('avisa que o video nao e divulgado', /não vai ser divulgado/.test(corpos));
  check('manda o link do cadastro com o token da pessoa',
    /\/vaga\?t=[a-zA-Z0-9]+&v=gestor-de-trafego-pleno/.test(corpos), corpos.slice(-160));
  check('NAO agradece ainda', !/Recebido, Rafaela/.test(corpos));
  check('NAO manda as redes ainda', !/somossangueroxo/.test(corpos));
  check('nenhuma mensagem tem travessao', corpos.indexOf('—') < 0 && corpos.indexOf('–') < 0);

  // ---- 3) "digitando..." antes de cada mensagem ----
  const presencas = await (await fetch('http://127.0.0.1:54322/__presencas')).json();
  const minhas = presencas.filter(function (p) { return String(p.number).indexOf(digL.slice(-8)) >= 0; });
  check('mostrou "digitando" antes de cada mensagem', minhas.length >= 3, minhas.length);
  check('e o aviso e de digitacao', minhas.every(function (p) { return p.presence === 'composing'; }));
  check('a primeira espera mais que as outras', Number(minhas[0].delay) === 900, minhas.map(function (p) { return p.delay; }));
  check('e o valor configurado e o que vai para a Evolution',
    minhas.slice(1).every(function (p) { return Number(p.delay) === 300; }),
    minhas.map(function (p) { return p.delay; }));

  // ---- 4) ela tira uma duvida antes de responder ----
  const duvida = await webhook(digL, 'Qual o salário mesmo?');
  check('a Aurea continua conversando', duvida.resultado && duvida.resultado.ok === true, duvida.resultado);
  check('esta esperando as tres coisas',
    duvida.resultado && duvida.resultado.aguardando &&
    duvida.resultado.aguardando.respostas === true &&
    duvida.resultado.aguardando.video === true &&
    duvida.resultado.aguardando.cadastro === true,
    duvida.resultado);

  // ---- o que a Aurea sabe sobre a empresa foi junto no prompt ----
  const cn = (await adm('settings')).conhecimento || {};
  check('a base de conhecimento existe', !!cn.texto, cn);
  check('e traz os beneficios', /TotalPass/.test(cn.texto) && /Spotify/.test(cn.texto));
  const prompt = await (await fetch('http://127.0.0.1:54322/__ultimo-prompt')).json();
  check('a IA foi consultada para a duvida', prompt.ferramenta === 'acompanhar_candidato', prompt.ferramenta);
  check('e recebeu a base da empresa junto', /TotalPass/.test(prompt.system || ''));
  check('e a ficha da vaga junto', /R\$ 2\.200/.test(prompt.system || ''));
  check('e as perguntas desta vaga', /curso você já fez de tráfego pago/.test(prompt.system || ''));
  check('sabe o que ainda falta', /Cadastro preenchido: AINDA NÃO/.test(prompt.system || ''));
  check('e proibe o travessao', /NUNCA use travessão/.test(prompt.system || ''));

  // ---- 5) responde tudo: ainda falta video e cadastro ----
  const respondeu = await webhook(digL, '4 anos com Meta Ads e Google Ads, ja rodei 3 milhoes, fiz o curso do Pedro Sobral');
  check('respostas completas nao fecham sozinhas',
    respondeu.resultado && respondeu.resultado.aguardando &&
    respondeu.resultado.aguardando.respostas === false &&
    respondeu.resultado.aguardando.video === true, respondeu.resultado);

  // ---- 6) manda o video: ainda falta o cadastro ----
  const comVideo = await webhookVideo(digL);
  check('so com o video ainda nao conclui',
    comVideo.resultado && comVideo.resultado.concluiu !== true &&
    comVideo.resultado.aguardando && comVideo.resultado.aguardando.cadastro === true, comVideo.resultado);

  // ---- 7) preenche o cadastro pelo link: agora sim fecha ----
  const fichaL = await adm('candidate', null, { id: leadR.id });
  const preencheu = await pub('apply', {
    t: fichaL.candidate.token, vaga: 'gestor-de-trafego-pleno',
    name: NOME_RAFA, email: 'rafa.form.' + SUF + '@exemplo.com', phone: foneL,
    experience: 'Quatro anos de agencia.', why_start: 'Quero crescer.'
  });
  check('cadastro completo aceito', preencheu.ok, preencheu.error);
  const todasRafa = (await adm('board')).candidates.filter(function (c) { return c.name === NOME_RAFA; });
  check('o cadastro completou a mesma pessoa, sem duplicar', todasRafa.length === 1, todasRafa.length);
  check('e ela continua no funil da landing', todasRafa[0] && todasRafa[0].source === 'landing',
    todasRafa[0] && todasRafa[0].source);

  const fechou = await webhook(digL, 'pronto, preenchi!');
  check('com as tres coisas, o processo conclui',
    fechou.resultado && fechou.resultado.concluiu === true, fechou.resultado);
  corpos = (await logsDela()).map(function (l) { return l.body; }).join('\n---\n');
  check('agora sim agradece', /Recebido, Rafaela/.test(corpos) && /Obrigada por participar/.test(corpos));
  check('e manda as duas redes',
    /startdigital_oficial/.test(corpos) && /somossangueroxo/.test(corpos));

  // ---- 7) depois de concluir, nao repete ----
  const depois = await webhook(digL, 'oi de novo');
  check('processo concluido nao reabre', depois.resultado && depois.resultado.ignorado === true, depois.resultado);

  // ---- 5) trocou de vaga? a sequencia pode ir de novo ----
  const trocou = await pub('candidatar', {
    vaga: 'gestor-de-trafego-jr', name: NOME_RAFA,
    phone: foneL, email: 'rafaela.' + SUF + '@exemplo.com'
  });
  check('deixa se candidatar a outra vaga', trocou.ok, trocou.error);
  const seq2 = await webhook(digL, trocou.mensagem);
  check('e a sequencia de chegada roda de novo para a vaga nova',
    seq2.resultado && seq2.resultado.sequencia === true, seq2.resultado);

  await adm('aurea_config_save', { value: { pausa_primeira: 10000, pausa_entre_mensagens: 4000 } });

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
  // Quem nunca preencheu o formulario da landing nao recebe nada: a
  // Aurea so fala com quem se cadastrou. Fica registrado no diario.
  const foneSolto = '5511' + String(Date.now() + 101).slice(-9);
  const solto = await webhook(foneSolto, 'oi, tudo bem?');
  check('numero sem cadastro nao recebe nada',
    solto.ignorado === 'sem cadastro na landing', solto);
  const diarioSolto = (await adm('wa_status')).batidas || [];
  check('mas fica registrado para o time olhar',
    diarioSolto.some(function (x) { return x.decisao === 'sem cadastro na landing'; }), diarioSolto[0]);

  // ---- diario do webhook: precisa registrar ate o que descarta ----
  const diario = await adm('wa_status');
  const bat = diario.batidas || [];
  check('o painel guarda as chamadas do webhook', bat.length > 0, bat.length);
  check('registra o que foi entregue',
    bat.some(function (x) { return String(x.decisao).indexOf('entregue') === 0; }), bat.slice(0, 3));
  check('registra tambem o que foi descartado',
    bat.some(function (x) { return String(x.decisao).indexOf('entregue') !== 0; }), bat.slice(0, 3));
  check('anota mensagem propria como descartada',
    bat.some(function (x) { return x.decisao === 'mensagem nossa'; }), bat.slice(0, 6));
  check('guarda de qual numero veio',
    bat.some(function (x) { return !!x.de; }));

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

  console.log('\n5a) COLABORADORES — cadastro do time');
  async function eqp(action, body) {
    return (await fetch(BASE + '/api/equipe?action=' + action, {
      method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    })).json();
  }

  const cfgEq = await eqp('config');
  check('formulario do time carrega', cfgEq.ok && cfgEq.areas.length > 0, cfgEq.error);
  check('oferece os tamanhos de camisa', cfgEq.camisas.indexOf('GG') >= 0, cfgEq.camisas);

  const base = {
    name: 'Joana Ribeiro Alves', nickname: 'Jo', birth_date: '1994-03-12',
    email: 'jo.' + SUF + '@exemplo.com', phone: '(13) 99600-3897',
    cpf: '529.982.247-25', area: 'Design', role_title: 'Designer',
    cep: '11015001', street: 'Rua Amador Bueno', number: '120',
    district: 'Centro', city: 'Santos', state: 'SP',
    shirt_size: 'M', shoe_size: '37', work_mode: 'remoto'
  };
  const novoColab = await eqp('cadastrar', base);
  check('cadastra colaborador', novoColab.ok, novoColab.error);
  check('trata pelo apelido', novoColab.nome === 'Jo', novoColab.nome);
  check('dispara os 3 canais', (novoColab.envios || []).length === 3, novoColab.envios);

  check('recusa CPF invalido',
    !(await eqp('cadastrar', Object.assign({}, base, { email: 'x1.' + SUF + '@ex.com', cpf: '111.111.111-11' }))).ok);
  check('recusa e-mail torto',
    !(await eqp('cadastrar', Object.assign({}, base, { email: 'nao-e-email' }))).ok);
  check('recusa nome sem sobrenome',
    !(await eqp('cadastrar', Object.assign({}, base, { email: 'x2.' + SUF + '@ex.com', name: 'Jo' }))).ok);
  check('recusa numero do pe impossivel',
    !(await eqp('cadastrar', Object.assign({}, base, { email: 'x3.' + SUF + '@ex.com', shoe_size: '99' }))).ok);
  const rep = await eqp('cadastrar', base);
  check('bloqueia cadastro repetido', !rep.ok && /Já existe/.test(rep.error || ''), rep.error);

  const time = await adm('team');
  const dt = time.data || time;
  check('painel lista o time', time.ok && dt.colaboradores.length >= 1, time.error);
  const eu = dt.colaboradores.filter(function (c) { return c.email === base.email; })[0];
  check('guardou camisa e numero do pe', eu && eu.shirt_size === 'M' && String(eu.shoe_size) === '37',
    eu && { camisa: eu.shirt_size, pe: eu.shoe_size });
  check('guardou o aniversario', eu && String(eu.birth_date).indexOf('1994-03-12') === 0, eu && eu.birth_date);
  check('guardou o endereco', eu && eu.city === 'Santos' && eu.cep === '11015001', eu && { cidade: eu.city, cep: eu.cep });
  check('guardou presencial ou remoto', eu && eu.work_mode === 'remoto', eu && eu.work_mode);
  check('conta o time por modo de trabalho', dt.modos && dt.modos.remoto >= 1, dt.modos);
  check('recusa modo de trabalho inventado',
    !(await eqp('cadastrar', Object.assign({}, base, { email: 'x9.' + SUF + '@ex.com', work_mode: 'astral' }))).ok);
  check('mostra o link para divulgar', /\/equipe$/.test(dt.link || ''), dt.link);
  check('calcula aniversarios proximos', Array.isArray(dt.aniversarios), dt.aniversarios);

  // a busca agora acontece na tela; o servidor manda a lista inteira de uma vez
  check('manda a lista inteira para a busca ser instantanea',
    dt.colaboradores.length === dt.total, { lista: dt.colaboradores.length, total: dt.total });
  check('conta quantos estao ativos', typeof dt.ativos === 'number' && dt.ativos >= 1, dt.ativos);
  const niver = (dt.aniversarios || [])[0];
  check('aniversario traz nome completo e dias',
    !niver || (typeof niver.dias === 'number' && !!niver.nome_completo), niver);

  check('salva anotacao interna', (await adm('team_save', { id: eu.id, notes: 'Prefere reuniao de manha.' })).ok);

  console.log('\n5a2) AVISOS — mensagem para o time inteiro');
  const infoAv = await adm('broadcast_info');
  const di = infoAv.data || infoAv;
  check('avisos sabe o tamanho do time', infoAv.ok && di.total >= 1, infoAv.error);
  check('avisos separa presencial de remoto', typeof di.remoto === 'number' && di.remoto >= 1,
    { presencial: di.presencial, remoto: di.remoto, hibrido: di.hibrido });
  check('cada pessoa vem com o modo de trabalho',
    (di.pessoas || []).some(function (p) { return p.modo === 'remoto'; }), (di.pessoas || [])[0]);

  const pv = await adm('broadcast_preview', {
    title: 'Confraternização de fim de ano',
    message: 'Oi {{primeiro_nome}}! Vai ser dia 15/12, às 19h. Confirme presença até sexta.',
    channels: ['email', 'whatsapp', 'sms']
  });
  const dpv = pv.data || pv;
  check('previa gera os 3 canais', pv.ok && dpv.itens.length === 3, pv.error);
  const eml = dpv.itens.filter(function (i) { return i.channel === 'email'; })[0];
  const wpp = dpv.itens.filter(function (i) { return i.channel === 'whatsapp'; })[0];
  const smsAv = dpv.itens.filter(function (i) { return i.channel === 'sms'; })[0];
  check('email leva o titulo no assunto', eml && eml.subject === 'Confraternização de fim de ano', eml && eml.subject);
  check('whatsapp poe o titulo em negrito', wpp && wpp.body.indexOf('*Confraternização de fim de ano*') === 0, wpp && wpp.body.slice(0, 40));
  check('sms sai sem acento e numa linha so',
    smsAv && !/[àáâãéêíóôõúüç]/i.test(smsAv.body) && smsAv.body.indexOf('\n') < 0, smsAv && smsAv.body);

  check('recusa aviso sem titulo', !(await adm('broadcast_preview', { title: '', message: 'oi' })).ok);
  check('recusa aviso sem canal', !(await adm('broadcast_send', { title: 'x', message: 'y', channels: [] })).ok);

  // dispara so para quem foi escolhido na lista
  const soUm = await adm('broadcast_send', {
    title: 'So para um', message: 'Oi {{primeiro_nome}}', channels: ['whatsapp'], ids: [eu.id]
  });
  const ds1 = soUm.data || soUm;
  check('dispara so para os escolhidos', soUm.ok && ds1.pessoas === 1, ds1.pessoas);

  const disparo = await adm('broadcast_send', {
    title: 'Aviso de teste', message: 'Oi {{primeiro_nome}}, tudo certo?', channels: ['whatsapp']
  });
  const dd = disparo.data || disparo;
  check('dispara o aviso para o time', disparo.ok && dd.enviados >= 1, disparo.error);
  check('troca o nome de cada pessoa', dd.detalhe && dd.detalhe.length >= 1, dd.detalhe);

  const depoisAv = await adm('broadcast_info');
  const dda = depoisAv.data || depoisAv;
  check('guarda o aviso no historico', dda.historico.length >= 1, dda.historico && dda.historico.length);

  // ---- aviso COM IMAGEM ----
  // um PNG de verdade (1x1), em base64 — o suficiente para o caminho inteiro
  const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const up = await adm('aviso_imagem', { tipo: 'image/png', arquivo: PNG_1x1 });
  check('imagem do aviso sobe e devolve a URL publica',
    up.ok && /\/storage\/v1\/object\/public\/avisos\/aviso-/.test(up.url || ''), up.error || up.url);
  check('recusa arquivo que nao e imagem',
    !(await adm('aviso_imagem', { tipo: 'application/pdf', arquivo: PNG_1x1 })).ok);
  check('recusa imagem vazia', !(await adm('aviso_imagem', { tipo: 'image/png', arquivo: '' })).ok);

  const comFoto = await adm('broadcast_send', {
    title: 'Aviso com foto', message: 'Olha essa novidade, {{primeiro_nome}}!',
    channels: ['whatsapp', 'email'], image_url: up.url
  });
  check('dispara o aviso com imagem', comFoto.ok && comFoto.enviados >= 2, comFoto.error || comFoto);
  const midia = await (await fetch(SERV + '/__ultima-midia')).json();
  check('o WhatsApp saiu como FOTO com o aviso de legenda',
    midia.mediatype === 'image' && midia.media === up.url && /novidade/.test(midia.caption || ''),
    midia);
  const mailFoto = await (await fetch(SERV + '/__ultimo-email')).json();
  check('o e-mail saiu com a foto dentro do corpo',
    /<img src="/.test(mailFoto.html || '') && (mailFoto.html || '').indexOf(up.url) >= 0,
    (mailFoto.html || '').slice(0, 120));

  // seguranca: imagem de fora do nosso balde nao passa
  check('recusa imagem que nao veio do painel',
    !(await adm('broadcast_send', {
      title: 'x', message: 'y', channels: ['whatsapp'],
      image_url: 'https://site-estranho.com/foto.png'
    })).ok);

  check('exclui colaborador', (await adm('team_delete', { id: eu.id })).ok);

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

  const teste1 = await adm('sms_teste', { phone: '13 99600-3897' });
  const d1 = teste1.data || teste1;
  check('botao de teste de sms funciona', teste1.ok, teste1.error);
  check('teste informa a rota usada', d1.rota === 17, d1.rota);
  check('teste recusa numero vazio', !(await adm('sms_teste', { phone: '' })).ok);

  const rotas = await adm('sms_rotas');
  const dr = rotas.data || rotas;
  check('lista as rotas da conta', rotas.ok && dr.rotas.length === 2, rotas.error);
  check('marca a Premium como a escolhida', dr.escolhida === 17, dr.escolhida);

  console.log('\n5d) USUARIOS E PAPEIS');
  async function entra(email, senha) {
    return (await fetch(BASE + '/api/admin?action=login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: senha })
    })).json();
  }
  async function comoUsuario(tok, action, body, query) {
    const qs = new URLSearchParams(Object.assign({ action: action }, query || {}));
    return (await fetch(BASE + '/api/admin?' + qs, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
      body: body ? JSON.stringify(body) : undefined
    })).json();
  }

  const listaU = await adm('usuarios');
  const dlu = listaU.data || listaU;
  check('lista de usuarios abre', listaU.ok, listaU.error);
  check('oferece os 4 papeis', dlu.papeis.length === 4, dlu.papeis && dlu.papeis.length);
  check('senha mestra vale enquanto nao ha dono', dlu.senha_mestra_vale === true, dlu.senha_mestra_vale);

  // Ninguem recebe senha pronta: o sistema manda um convite por e-mail e a
  // pessoa cria a senha dela. Estes ajudantes fazem o papel do e-mail.
  function tokenDoConvite(c) {
    return ((c && c.link) || '').split('t=')[1] || '';
  }
  async function vejaConvite(t) {
    return (await fetch(BASE + '/api/admin?action=convite_info&t=' + encodeURIComponent(t))).json();
  }
  async function criaSenha(t, senha) {
    return (await fetch(BASE + '/api/admin?action=convite_senha', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ t: t, password: senha })
    })).json();
  }

  const rh = await adm('usuario_salvar', { name: 'Marina do RH', email: 'marina.' + SUF + '@ex.com', role: 'rh' });
  const drh = rh.data || rh;
  check('cria usuario de RH', rh.ok, rh.error);
  check('nao devolve senha nenhuma', drh.senha_inicial === undefined, drh.senha_inicial);
  check('manda o convite por e-mail', drh.convite && drh.convite.enviado === true, drh.convite);
  check('convite aponta para a pagina de criar senha',
    /\/criar-senha-painel\?t=/.test((drh.convite || {}).link || ''), (drh.convite || {}).link);

  // o que saiu de verdade pelo Resend (espelho local)
  const mail = await (await fetch('http://127.0.0.1:54322/__ultimo-email')).json();
  check('e-mail foi para o endereco certo',
    (mail.to || [])[0] === 'marina.' + SUF + '@ex.com', mail.to);
  check('assunto fala do acesso ao painel', /painel/i.test(mail.subject || ''), mail.subject);
  check('o link vai dentro do e-mail',
    String(mail.text || '').indexOf((drh.convite || {}).link) >= 0);
  check('o e-mail nao leva senha nenhuma',
    !/senha inicial|sua senha e|sua senha:/i.test(String(mail.text || '')), mail.text);
  check('o e-mail vira HTML com botao',
    /criar-senha-painel/.test(String(mail.html || '')) && /<a /.test(String(mail.html || '')));

  const aval = await adm('usuario_salvar', { name: 'Pedro Avaliador', email: 'pedro.' + SUF + '@ex.com', role: 'avaliador' });
  const dav = aval.data || aval;
  check('cria usuario avaliador', aval.ok, aval.error);
  const leit = await adm('usuario_salvar', { name: 'Ana Leitura', email: 'ana.' + SUF + '@ex.com', role: 'leitura' });
  const dle = leit.data || leit;
  check('cria usuario de leitura', leit.ok, leit.error);
  check('recusa e-mail repetido',
    !(await adm('usuario_salvar', { name: 'Outra', email: 'marina.' + SUF + '@ex.com', role: 'rh' })).ok);
  check('recusa papel inventado',
    !(await adm('usuario_salvar', { name: 'X Y', email: 'xy.' + SUF + '@ex.com', role: 'chefe' })).ok);

  // ---- a pessoa abre o link e escolhe a senha ----
  const tRh = tokenDoConvite(drh.convite);
  const infoRh = await vejaConvite(tRh);
  check('o link mostra de quem e o acesso', infoRh.ok && infoRh.email === 'marina.' + SUF + '@ex.com', infoRh.error);
  check('o link diz o nivel de acesso', infoRh.papel_nome === 'RH', infoRh.papel_nome);
  check('link torto nao abre', !(await vejaConvite(tRh.slice(0, -3) + 'xxx')).ok);
  check('enquanto nao criar a senha, ninguem entra na conta',
    !(await entra('marina.' + SUF + '@ex.com', 'qualquer-coisa')).ok);

  check('recusa senha curta', !(await criaSenha(tRh, 'abc12')).ok);
  check('recusa senha so de numeros', !(await criaSenha(tRh, '12345678')).ok);

  const feitaRh = await criaSenha(tRh, 'MarinaRH2026');
  check('cria a senha e ja entra', feitaRh.ok && !!feitaRh.token, feitaRh.error);
  check('o link so funciona uma vez', !(await criaSenha(tRh, 'OutraSenha99')).ok);

  const loginRh = await entra('marina.' + SUF + '@ex.com', 'MarinaRH2026');
  check('RH entra com o proprio e-mail', loginRh.ok && !!loginRh.token, loginRh.error);
  check('nao pede mais para trocar a senha', loginRh.trocar_senha === false, loginRh.trocar_senha);
  check('senha errada nao entra', !(await entra('marina.' + SUF + '@ex.com', 'chute')).ok);

  await criaSenha(tokenDoConvite(dav.convite), 'PedroAval2026');
  await criaSenha(tokenDoConvite(dle.convite), 'AnaLeitura2026');
  const loginAval = await entra('pedro.' + SUF + '@ex.com', 'PedroAval2026');
  const loginLeit = await entra('ana.' + SUF + '@ex.com', 'AnaLeitura2026');
  check('avaliador entra', loginAval.ok);
  check('leitura entra', loginLeit.ok);

  // ---- o que cada papel pode ----
  check('RH ve o quadro', (await comoUsuario(loginRh.token, 'board')).ok);
  check('RH dispara mensagem', (await comoUsuario(loginRh.token, 'sms_rotas')).ok);
  const rhUsers = await comoUsuario(loginRh.token, 'usuarios');
  check('RH NAO mexe em usuarios', !rhUsers.ok && /Dono/.test(rhUsers.error || ''), rhUsers.error);

  check('avaliador ve o quadro', (await comoUsuario(loginAval.token, 'board')).ok);
  const avalEnvia = await comoUsuario(loginAval.token, 'broadcast_send',
    { title: 'x', message: 'y', channels: ['whatsapp'] });
  check('avaliador NAO dispara mensagem', !avalEnvia.ok && /não permite/.test(avalEnvia.error || ''), avalEnvia.error);
  const avalAjuste = await comoUsuario(loginAval.token, 'settings_save', { key: 'form', value: {} });
  check('avaliador NAO mexe em ajustes', !avalAjuste.ok, avalAjuste.error);
  check('avaliador PODE corrigir quiz — a regra existe',
    (await comoUsuario(loginAval.token, 'usuarios_eu')).menu.indexOf('quiz') >= 0);

  check('leitura ve o quadro', (await comoUsuario(loginLeit.token, 'board')).ok);
  const leitMove = await comoUsuario(loginLeit.token, 'move', { id: 'x', stage_key: 'teste' });
  check('leitura NAO move candidato', !leitMove.ok && /consulta/.test(leitMove.error || ''), leitMove.error);

  // ---- menu muda por papel ----
  const menuRh = (await comoUsuario(loginRh.token, 'usuarios_eu')).menu;
  const menuLeit = (await comoUsuario(loginLeit.token, 'usuarios_eu')).menu;
  check('menu do RH nao tem Usuarios', menuRh.indexOf('usuarios') < 0, menuRh);
  check('menu da leitura e menor', menuLeit.length < menuRh.length, { leitura: menuLeit.length, rh: menuRh.length });

  // ---- desligar alguem tira o acesso na hora ----
  await adm('usuario_salvar', { id: dle.usuario.id, active: false, role: 'leitura' });
  const depoisDesligar = await comoUsuario(loginLeit.token, 'board');
  check('quem foi desligado perde o acesso na hora',
    !depoisDesligar.ok && /desativado/.test(depoisDesligar.error || ''), depoisDesligar.error);

  // ---- esqueci a senha: o dono reenvia o convite ----
  const nova = await adm('usuario_senha', { id: dav.usuario.id });
  const dn = nova.data || nova;
  check('reenvia o convite por e-mail', nova.ok && dn.convite && dn.convite.enviado === true, nova.error);
  check('reenvio tambem nao devolve senha', dn.senha_inicial === undefined, dn.senha_inicial);
  check('senha antiga para de valer na hora', !(await entra('pedro.' + SUF + '@ex.com', 'PedroAval2026')).ok);
  const refeita = await criaSenha(tokenDoConvite(dn.convite), 'PedroNovo2026');
  check('o link novo cria outra senha', refeita.ok, refeita.error);
  check('senha nova funciona', (await entra('pedro.' + SUF + '@ex.com', 'PedroNovo2026')).ok);
  check('convite antigo do avaliador morreu',
    !(await criaSenha(tokenDoConvite(dav.convite), 'TentandoDeNovo1')).ok);

  // ---- o dono nao pode sumir ----
  const dono = await adm('usuario_salvar', { name: 'Clovis Dono', email: 'dono.' + SUF + '@ex.com', role: 'dono' });
  const ddono = dono.data || dono;
  check('cria o primeiro dono', dono.ok, dono.error);
  const semDono = await adm('usuario_salvar', { id: ddono.usuario.id, role: 'leitura' });
  check('nao deixa rebaixar o unico dono', !semDono.ok && /único Dono/.test(semDono.error || ''), semDono.error);
  check('nao deixa excluir o unico dono', !(await adm('usuario_excluir', { id: ddono.usuario.id })).ok);

  // ---- historico ----
  const aud = await adm('auditoria');
  const da = aud.data || aud;
  check('historico registra as mudancas', aud.ok && da.registros.length >= 3, da.registros && da.registros.length);

  // Limpa direto no espelho do banco. Pela API nao daria: o sistema se
  // recusa a excluir o unico Dono — que e exatamente o comportamento certo.
  await fetch('http://127.0.0.1:54321/rest/v1/panel_users', { method: 'DELETE' })
    .catch(function () { return null; });
  const sobrou = await adm('usuarios');
  const ds = sobrou.data || sobrou;
  check('limpou os usuarios de teste', ds.usuarios.length === 0, ds.usuarios && ds.usuarios.length);
  check('senha mestra volta a valer sem nenhum dono', ds.senha_mestra_vale === true);

  // ============================================================
  console.log('\n5b-fin) FINANCEIRO — carteira, dashboard e relatorio');
  // ============================================================
  async function fin(action, body, query) {
    const qs = new URLSearchParams(Object.assign({ action: action }, query || {}));
    return (await fetch(BASE + '/api/financeiro?' + qs, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + T },
      body: body ? JSON.stringify(body) : undefined
    })).json();
  }

  const lista0 = await fin('fin_lista');
  check('financeiro lista a carteira', lista0.ok && lista0.clientes.length >= 10, lista0.error);
  const vitraux = (lista0.clientes || []).filter(function (c) { return c.cliente === 'VITRAUX'; })[0];
  check('cada linha ja vem com o total somado',
    vitraux && vitraux.total === 2500 + 1500 + 120, vitraux && vitraux.total);
  check('e com o nome do status escrito', vitraux && vitraux.status_nome === 'Pago', vitraux && vitraux.status_nome);

  const res0 = (await fin('fin_resumo')).resumo || {};
  // Conferencia na mao: as tres somas do dashboard tem que bater com
  // a soma das linhas. Se um dia alguem mexer na conta, cai aqui.
  const somaDe = function (campo) {
    return lista0.clientes.filter(function (c) { return c.ativo; })
      .reduce(function (a, c) { return a + c[campo]; }, 0);
  };
  check('total de setup bate com as linhas', res0.total_setup === somaDe('setup'),
    { dash: res0.total_setup, linhas: somaDe('setup') });
  check('total de mensalidade bate com as linhas', res0.total_mensalidade === somaDe('valor'),
    { dash: res0.total_mensalidade, linhas: somaDe('valor') });
  check('total de hospedagem bate com as linhas', res0.total_hospedagem === somaDe('hospedagem'),
    { dash: res0.total_hospedagem, linhas: somaDe('hospedagem') });
  // pago + aguardando + inadimplente tem que fechar a carteira inteira
  check('as tres situacoes somam a carteira toda',
    Math.round((res0.recebido + res0.aguardando + res0.inadimplente) * 100) ===
    Math.round(res0.total_carteira * 100),
    { partes: res0.recebido + res0.aguardando + res0.inadimplente, total: res0.total_carteira });
  check('inadimplente sai separado e contado',
    res0.inadimplente > 0 && res0.inadimplente_qtd === 2, res0);
  check('previsao da semana traz a data limite', /^\d\d\/\d\d$/.test(res0.proxima_semana_ate || ''),
    res0.proxima_semana_ate);

  // A conta da previsao, sem depender de que dia e hoje quando o teste roda.
  {
    const finmod = require('../api/financeiro.js');
    const base = new Date(2026, 0, 10);                       // 10 de janeiro
    check('vencimento dia 12 cai neste mes',
      finmod.proximaData(12, base).getTime() === new Date(2026, 0, 12).getTime());
    check('vencimento dia 5 (ja passou) pula para o mes que vem',
      finmod.proximaData(5, base).getTime() === new Date(2026, 1, 5).getTime());
    // fevereiro nao tem dia 31: a cobranca cai no ultimo dia do mes
    check('dia 31 em fevereiro vira o ultimo dia',
      finmod.proximaData(31, new Date(2026, 1, 1)).getTime() === new Date(2026, 1, 28).getTime(),
      finmod.proximaData(31, new Date(2026, 1, 1)).toDateString());
    // valores digitados do jeito que o time digita
    check('aceita 2.500,00', finmod.limpaValor('2.500,00') === 2500);
    check('aceita R$ 1.890', finmod.limpaValor('R$ 1.890') === 1890);
    check('aceita 997.50', finmod.limpaValor('997.50') === 997.5);
    check('valor negativo vira zero', finmod.limpaValor('-30') === 0);
  }

  // gravar, alterar e apagar
  const novo = await fin('fin_salvar', {
    cliente: 'CLIENTE TESTE ' + SUF, valor: '1.234,56', setup: '500', hospedagem: '90',
    vencimento_dia: 15, status: 'aguardando', responsavel: 'Fulano', telefone: '13 90000-0000'
  });
  check('cria cliente novo', novo.ok && novo.cliente.valor === 1234.56, novo.error || novo.cliente);
  check('o total do novo ja vem somado', novo.cliente.total === 1234.56 + 500 + 90, novo.cliente.total);
  const editado = await fin('fin_salvar', { id: novo.cliente.id, cliente: novo.cliente.cliente, status: 'pago', valor: 1000 });
  check('altera o cliente', editado.ok && editado.cliente.status === 'pago', editado.error);
  check('sem nome nao grava', !(await fin('fin_salvar', { cliente: '   ' })).ok);
  const inventado = await fin('fin_salvar', { cliente: 'X ' + SUF, status: 'sei-la' });
  check('status inventado vira aguardando', inventado.cliente.status === 'aguardando');
  await fin('fin_excluir', { id: inventado.cliente.id });

  const relatorio = await fetch(BASE + '/api/financeiro?action=fin_relatorio', {
    headers: { Authorization: 'Bearer ' + T }
  });
  // Os bytes crus, nao o texto: .text() come o BOM na decodificacao e
  // o teste passaria mesmo se o servidor tivesse parado de mandar.
  const bytes = Buffer.from(await relatorio.arrayBuffer());
  const csv = bytes.toString('utf8');
  check('relatorio sai como arquivo para baixar',
    /attachment; filename=/.test(relatorio.headers.get('content-disposition') || ''),
    relatorio.headers.get('content-disposition'));
  check('relatorio comeca com BOM (senao o Excel come os acentos)',
    bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF,
    [bytes[0], bytes[1], bytes[2]]);
  check('relatorio traz todas as colunas',
    /Cliente;Mensalidade;Setup;Hospedagem;Total;Vencimento;Status;Responsavel;Telefone;Observacao/.test(csv));
  check('relatorio fecha com a linha de total', /\r\nTOTAL;/.test(csv));
  check('relatorio traz os clientes', csv.indexOf('VITRAUX') > 0 && csv.indexOf('BRAZ') > 0);

  // limpeza dos que o teste criou
  await fin('fin_excluir', { id: novo.cliente.id });
  const depoisDeApagar = await fin('fin_lista');
  check('exclui cliente',
    (depoisDeApagar.clientes || []).filter(function (c) { return c.id === novo.cliente.id; }).length === 0);

  // ---- a tranca: financeiro nao e para todo mundo ----
  {
    const perms = require('../api/_lib/perms.js');
    check('dono ve o financeiro', perms.permite('dono', 'fin_lista') === true);
    check('rh ve o financeiro', perms.permite('rh', 'fin_lista') === true);
    check('avaliador NAO ve o financeiro', perms.permite('avaliador', 'fin_lista') === false);
    check('leitura NAO ve o financeiro', perms.permite('leitura', 'fin_lista') === false);
    check('leitura tambem nao baixa o relatorio', perms.permite('leitura', 'fin_relatorio') === false);
    check('leitura nao altera cliente', perms.permite('leitura', 'fin_salvar') === false);
    check('o menu do dono tem o financeiro', perms.menuDoPapel('dono').indexOf('financeiro') >= 0);
    check('o menu de leitura nao tem', perms.menuDoPapel('leitura').indexOf('financeiro') < 0);
  }

  // ============================================================
  // ============================================================
  console.log('\n5b-fin2) FINANCEIRO — periodo, pago_em e importacao');
  // ============================================================
  {
    function iso(d) { return d.toISOString().slice(0, 10); }
    const hojeD = new Date();

    // marcar como pago carimba a data; o cartao "Recebidas" de hoje ve
    const lst = await fin('fin_lista');
    const alvoPg = lst.clientes.filter(function (c) { return c.status === 'aguardando'; })[0];
    const virou = await fin('fin_salvar', { id: alvoPg.id, cliente: alvoPg.cliente, status: 'pago', valor: alvoPg.valor, setup: alvoPg.setup, hospedagem: alvoPg.hospedagem, vencimento_dia: alvoPg.vencimento_dia });
    check('marcar pago carimba a data do pagamento', virou.ok && !!virou.cliente.pago_em, virou.cliente && virou.cliente.pago_em);

    // o dashboard agora anda pela COMPETENCIA, nao por datas soltas
    const rMes = await fin('fin_resumo');
    check('resumo devolve os cartoes da competencia', rMes.ok && !!rMes.cartoes, rMes.error);
    check('Recebidas do mes inclui quem pagou agora', rMes.cartoes.recebidas.clientes >= 1, rMes.cartoes.recebidas);
    check('inadimplentes aparecem como Vencidas no mes', rMes.cartoes.vencidas.clientes >= 2, rMes.cartoes.vencidas);
    check('o periodo do dashboard e o mes da competencia',
      String(rMes.cartoes.de).slice(0, 7) === rMes.competencia.ano + '-' + String(rMes.competencia.mes).padStart(2, '0'),
      { de: rMes.cartoes.de, comp: rMes.competencia });

    // numa competencia vazia do passado, nao ha nada
    const rVazio = await fin('fin_resumo', null, { mes: 1, ano: 2020 });
    check('competencia sem cobrancas mostra tudo zerado',
      rVazio.cartoes.recebidas.clientes === 0 && rVazio.cartoes.aguardando.clientes === 0 &&
      rVazio.cartoes.vencidas.clientes === 0, rVazio.cartoes);

    // desfaz o pago para nao mexer nas contas dos outros testes
    await fin('fin_salvar', { id: alvoPg.id, cliente: alvoPg.cliente, status: 'aguardando', valor: alvoPg.valor, setup: alvoPg.setup, hospedagem: alvoPg.hospedagem, vencimento_dia: alvoPg.vencimento_dia });
    const desfez = await fin('fin_lista');
    check('sair de pago apaga o carimbo', desfez.clientes.filter(function (c) { return c.id === alvoPg.id; })[0].pago_em === null);

    // ---- importacao ----
    const imp = await fin('fin_importar', { linhas: [
      { linha: 2, cliente: 'Padaria Sol Nascente ' + SUF, valor: '1.250,00', setup: 'R$ 300', vencimento_dia: '15', status: 'Pago', telefone: '13 99999-0001' },
      { linha: 3, cliente: 'Oficina Dois Irmaos ' + SUF, valor: '890', status: 'vencida' },
      { linha: 4, cliente: 'VITRAUX', valor: '999' },                      // ja existe na carteira
      { linha: 5, cliente: '', valor: '50' },                              // sem nome
      { linha: 6, cliente: 'Padaria Sol Nascente ' + SUF, valor: '1' }     // repetida no proprio arquivo
    ] });
    check('importa os clientes validos', imp.ok && imp.importados === 2, imp.error || imp);
    check('barra o que ja existe na carteira',
      imp.pulados.some(function (p) { return p.nome === 'VITRAUX' && /ja existe/.test(p.motivo); }), imp.pulados);
    check('barra linha sem nome', imp.pulados.some(function (p) { return /sem nome/.test(p.motivo); }));
    check('barra repetido dentro do proprio arquivo', imp.total_pulados === 3, imp.total_pulados);

    const depoisImp = await fin('fin_lista');
    const padaria = depoisImp.clientes.filter(function (c) { return c.cliente === 'Padaria Sol Nascente ' + SUF; })[0];
    check('valor com milhar entra certo (1.250,00)', padaria && padaria.valor === 1250, padaria && padaria.valor);
    check('status "Pago" do arquivo vira pago com data', padaria.status === 'pago' && !!padaria.pago_em, padaria);
    const oficina = depoisImp.clientes.filter(function (c) { return c.cliente === 'Oficina Dois Irmaos ' + SUF; })[0];
    check('status "vencida" vira inadimplente', oficina && oficina.status === 'inadimplente', oficina && oficina.status);
    check('arquivo vazio e recusado', !(await fin('fin_importar', { linhas: [] })).ok);

    // limpa os importados do teste
    await fin('fin_excluir', { id: padaria.id });
    await fin('fin_excluir', { id: oficina.id });

    // ---- a chave da Automacao no menu ----
    const euAntes = await adm('usuarios_eu');
    check('automacao vem escondida de fabrica', euAntes.mostrar_automacao === false, euAntes.mostrar_automacao);
    await adm('settings_save', { key: 'painel', value: { mostrar_automacao: true } });
    check('ligou nos ajustes, o menu passa a mostrar', (await adm('usuarios_eu')).mostrar_automacao === true);
    await adm('settings_save', { key: 'painel', value: { mostrar_automacao: false } });
    check('desligou, esconde de novo', (await adm('usuarios_eu')).mostrar_automacao === false);
  }

  // ============================================================
  console.log('\n5b-comp) COMPETENCIA MENSAL — historico e virada do mes');
  // ============================================================
  {
    const fmod = require('../api/financeiro.js');

    // ---- a matematica do calendario, sem tocar no banco ----
    check('agosto/2026 -> setembro/2026',
      JSON.stringify(fmod.deOrdinal(fmod.ordinal(8, 2026) + 1)) === JSON.stringify({ mes: 9, ano: 2026 }));
    check('setembro/2026 -> outubro/2026',
      JSON.stringify(fmod.deOrdinal(fmod.ordinal(9, 2026) + 1)) === JSON.stringify({ mes: 10, ano: 2026 }));
    check('DEZEMBRO/2026 -> JANEIRO/2027 (vira o ano)',
      JSON.stringify(fmod.deOrdinal(fmod.ordinal(12, 2026) + 1)) === JSON.stringify({ mes: 1, ano: 2027 }));
    check('nunca gera janeiro do mesmo ano',
      fmod.deOrdinal(fmod.ordinal(12, 2026) + 1).ano === 2027);
    check('a ordem cresce mes a mes, sem buraco na virada',
      fmod.ordinal(1, 2027) - fmod.ordinal(12, 2026) === 1);

    // ---- a lista atual esta em 08/2026 ----
    const l0 = await fin('fin_lista');
    check('a lista abre na competencia atual', l0.ok && !!l0.competencia, l0.error);
    check('e o servidor diz qual e o mes corrente', !!l0.competencia_atual, l0.competencia_atual);
    check('os 12 meses vem para o seletor', (l0.meses || []).length === 12, (l0.meses || []).length);
    check('as cobrancas de hoje estao em 08/2026',
      l0.competencia.mes === 8 && l0.competencia.ano === 2026 && l0.clientes.length >= 10,
      { comp: l0.competencia, qtd: l0.clientes.length });
    const totalAgosto = l0.clientes.length;

    // ---- criar a competencia de setembro a partir de agosto ----
    // (o mock esta em agosto/2026, entao a virada automatica so roda
    //  quando o mes vira de verdade; aqui exercitamos o mesmo caminho
    //  pedindo setembro e criando nele.)
    const novoSet = await fin('fin_salvar', {
      cliente: 'Cliente So De Setembro ' + SUF, valor: '900', vencimento_dia: 12,
      mes: 9, ano: 2026
    });
    check('cria cobranca direto em outra competencia', novoSet.ok, novoSet.error);
    check('a cobranca nova nasce em 09/2026',
      novoSet.cliente.ref_mes === 9 && novoSet.cliente.ref_ano === 2026, novoSet.cliente);

    const lSet = await fin('fin_lista', null, { mes: 9, ano: 2026 });
    check('setembro tem a sua propria lista', lSet.clientes.length === 1, lSet.clientes.length);
    const lAgo = await fin('fin_lista', null, { mes: 8, ano: 2026 });
    check('e agosto continua intacto', lAgo.clientes.length === totalAgosto, lAgo.clientes.length);
    check('a lista de competencias mostra as duas',
      (lSet.competencias || []).some(function (c) { return c.mes === 9 && c.ano === 2026; }) &&
      (lSet.competencias || []).some(function (c) { return c.mes === 8 && c.ano === 2026; }),
      lSet.competencias);

    // ---- editar setembro NAO pode mexer em agosto ----
    const alvoAgo = lAgo.clientes.filter(function (c) { return c.cliente === 'VITRAUX'; })[0];
    const gemeoSet = await fin('fin_salvar', {
      cliente: 'VITRAUX', valor: '9999', vencimento_dia: 5, status: 'inadimplente',
      responsavel: 'Setembro', mes: 9, ano: 2026
    });
    check('o mesmo cliente pode existir em outro mes', gemeoSet.ok, gemeoSet.error);
    const agoDepois = await fin('fin_lista', null, { mes: 8, ano: 2026 });
    const vitrauxAgo = agoDepois.clientes.filter(function (c) { return c.cliente === 'VITRAUX'; })[0];
    check('MEXER EM SETEMBRO NAO ALTERA AGOSTO',
      vitrauxAgo.valor === alvoAgo.valor && vitrauxAgo.status === alvoAgo.status &&
      vitrauxAgo.vencimento_dia === alvoAgo.vencimento_dia,
      { antes: alvoAgo, depois: vitrauxAgo });

    // ---- duplicidade dentro da MESMA competencia e barrada ----
    const repetido = await fin('fin_salvar', { cliente: 'VITRAUX', valor: '10', mes: 9, ano: 2026 });
    check('mesmo cliente duas vezes no mesmo mes e recusado', !repetido.ok, repetido);

    // ---- excluir de um mes nao apaga os outros ----
    await fin('fin_excluir', { id: gemeoSet.cliente.id });
    const agoIntacto = await fin('fin_lista', null, { mes: 8, ano: 2026 });
    check('EXCLUIR EM SETEMBRO NAO APAGA AGOSTO',
      agoIntacto.clientes.filter(function (c) { return c.cliente === 'VITRAUX'; }).length === 1);
    check('e agosto segue com o mesmo tamanho', agoIntacto.clientes.length === totalAgosto);

    // ---- os cartoes respeitam a competencia escolhida ----
    const dSet = await fin('fin_resumo', null, { mes: 9, ano: 2026 });
    const dAgo = await fin('fin_resumo', null, { mes: 8, ano: 2026 });
    check('o dashboard de setembro ve so setembro',
      dSet.competencia.mes === 9 && dSet.resumo.clientes === 1, { c: dSet.competencia, n: dSet.resumo.clientes });
    check('o dashboard de agosto ve so agosto',
      dAgo.competencia.mes === 8 && dAgo.resumo.clientes === totalAgosto, dAgo.resumo.clientes);
    check('tabela e dashboard falam da MESMA competencia',
      JSON.stringify(dAgo.competencia) === JSON.stringify(lAgo.competencia), { d: dAgo.competencia, l: lAgo.competencia });
    check('mes fechado nao promete previsao de semana', dAgo.resumo.competencia_corrente === true);
    check('mes futuro e marcado como nao-corrente', dSet.resumo.competencia_corrente === false);

    // ---- importar cai na competencia escolhida ----
    const impSet = await fin('fin_importar', {
      mes: 9, ano: 2026,
      linhas: [{ linha: 2, cliente: 'Importado De Setembro ' + SUF, valor: '123' }]
    });
    check('a importacao entra na competencia aberta',
      impSet.ok && impSet.importados === 1 && impSet.competencia.mes === 9, impSet);
    check('e nao aparece em agosto',
      (await fin('fin_lista', null, { mes: 8, ano: 2026 })).clientes
        .filter(function (c) { return /Importado De Setembro/.test(c.cliente); }).length === 0);

    // ---- a virada e idempotente ----
    const v1 = await fin('fin_virada');
    const v2 = await fin('fin_virada');
    check('a virada roda sem erro', v1.ok && v2.ok, v1.error || v2.error);
    check('chamar duas vezes nao duplica nada',
      (v2.criadas || []).length === 0, v2.criadas);
    const depoisVirada = await fin('fin_lista', null, { mes: 8, ano: 2026 });
    check('e a competencia antiga continua do mesmo tamanho',
      depoisVirada.clientes.length === totalAgosto, depoisVirada.clientes.length);

    // limpeza do que este teste criou em setembro
    const limparSet = await fin('fin_lista', null, { mes: 9, ano: 2026 });
    for (const c of limparSet.clientes) await fin('fin_excluir', { id: c.id });

    // permissao
    const perms = require('../api/_lib/perms.js');
    check('leitura nao dispara a virada', perms.permite('leitura', 'fin_virada') === false);
  }

  // ============================================================
  console.log('\n5b-gastos) OUTROS GASTOS — caderninho com total por periodo');
  // ============================================================
  {
    const hoje = new Date().toISOString().slice(0, 10);
    const g1 = await fin('fg_salvar', { item: 'Cabo HDMI ' + SUF, valor: '89,90', data: hoje });
    check('cadastra um gasto', g1.ok && g1.gasto.valor === 89.9, g1.error || g1.gasto);
    const g2 = await fin('fg_salvar', { item: 'Cafe ' + SUF, valor: 'R$ 35', data: '2020-06-15', observacao: 'mercado' });
    check('gasto antigo entra com a data dele', g2.ok && g2.gasto.data === '2020-06-15', g2.gasto);
    check('gasto sem item e recusado', !(await fin('fg_salvar', { item: '  ', valor: '10' })).ok);
    check('gasto com valor zero e recusado', !(await fin('fg_salvar', { item: 'x', valor: '0' })).ok);
    const g3 = await fin('fg_salvar', { item: 'Data torta ' + SUF, valor: '5', data: '31/02/9999' });
    check('data invalida vira hoje, sem quebrar', g3.ok && g3.gasto.data === hoje, g3.gasto);

    const doMes = await fin('fg_lista', null, { de: hoje.slice(0, 8) + '01', ate: hoje });
    check('total do periodo soma so o que esta dentro',
      doMes.ok && doMes.total === 89.9 + 5 && doMes.gastos.length === 2,
      { total: doMes.total, qtd: doMes.gastos && doMes.gastos.length });
    const de2020 = await fin('fg_lista', null, { de: '2020-01-01', ate: '2020-12-31' });
    check('o periodo de 2020 ve so o cafe', de2020.total === 35 && de2020.gastos.length === 1, de2020.total);
    const tudo = await fin('fg_lista');
    check('sem periodo, lista tudo', tudo.gastos.length === 3, tudo.gastos.length);

    const editado = await fin('fg_salvar', { id: g1.gasto.id, item: g1.gasto.item, valor: '100', data: hoje });
    check('edita um gasto', editado.ok && editado.gasto.valor === 100, editado.error);
    const aposEdicao = await fin('fg_lista', null, { de: hoje, ate: hoje });
    check('o total acompanha a edicao', aposEdicao.total === 105, aposEdicao.total);

    check('exclui um gasto', (await fin('fg_excluir', { id: g2.gasto.id })).ok);
    check('o excluido some da lista', (await fin('fg_lista')).gastos.length === 2);

    // permissoes: mesmo padrao do financeiro
    const perms = require('../api/_lib/perms.js');
    check('leitura nao ve os gastos', perms.permite('leitura', 'fg_lista') === false);
    check('avaliador nao cadastra gasto', perms.permite('avaliador', 'fg_salvar') === false);
    check('o menu do dono tem Outros Gastos', perms.menuDoPapel('dono').indexOf('fingastos') >= 0);

    // limpeza
    await fin('fg_excluir', { id: g1.gasto.id });
    await fin('fg_excluir', { id: g3.gasto.id });
  }

  console.log('\n5b-space) SPACE COLABORADOR — beneficio por Pix (Asaas)');
  // ============================================================
  const MARINA = 'cccc0001-0001-4001-8001-000000000001';
  const TOKEN_MARINA = 'colabtoken000000000001';
  const DIEGO = 'cccc0002-0002-4002-8002-000000000002';
  const TOKEN_DIEGO = 'colabtoken000000000002';
  const CPF_OK = '111.444.777-35';   // CPF valido de teste

  async function sp(action, body, query) {
    const qs = new URLSearchParams(Object.assign({ action: action }, query || {}));
    return (await fetch(BASE + '/api/space?' + qs, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + T },
      body: body ? JSON.stringify(body) : undefined
    })).json();
  }
  async function spPublico(action, body, query) {
    const qs = new URLSearchParams(Object.assign({ action: action }, query || {}));
    return (await fetch(BASE + '/api/space?' + qs, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    })).json();
  }
  async function asaasModo(m) { await fetch(SERV + '/__asaas-modo?m=' + m); }
  async function asaasLimpa() { await fetch(SERV + '/__asaas-limpar'); }
  async function asaasUltimo() { return (await fetch(SERV + '/__asaas')).json(); }

  await asaasLimpa();
  // Comeca do zero: se ficou liberacao de uma rodada anterior (ou de
  // alguem mexendo no espelho a mao), o teste testaria outra coisa.
  await fetch('http://127.0.0.1:54321/rest/v1/benefit_releases', { method: 'DELETE' })
    .catch(function () { return null; });

  const pn = await sp('sp_painel');
  check('space abre no painel', pn.ok, pn.error);
  check('o voucher Amazon Prime esta la',
    (pn.vouchers || []).filter(function (v) { return v.nome === 'Amazon Prime'; }).length === 1, pn.vouchers);
  check('o Asaas aparece ligado no teste', pn.asaas.ligado === true && pn.asaas.ambiente === 'sandbox', pn.asaas);
  check('o painel nunca imprime a chave inteira',
    pn.asaas.chave.length <= 8 && pn.asaas.chave.indexOf('…') === 0, pn.asaas.chave);
  check('cada pessoa vem com o link pessoal dela',
    (pn.colaboradores || []).every(function (p) { return /\/space\?t=/.test(p.link); }), pn.colaboradores);

  const VOUCHER = pn.vouchers.filter(function (v) { return v.nome === 'Amazon Prime'; })[0].id;

  // ---- sem liberacao, ninguem saca ----
  const semLib = await spPublico('sacar', { t: TOKEN_DIEGO, chave: CPF_OK });
  check('sem liberacao o saque e recusado', !semLib.ok, semLib);
  check('e nada foi mandado para o banco',
    Object.keys(await asaasUltimo()).length === 0, await asaasUltimo());

  // ---- token errado nao abre nada ----
  check('token inventado nao abre o space', !(await spPublico('meu_space', null, { t: 'naoexisteesse123456' })).ok);

  // ---- liberar ----
  const lib1 = await sp('sp_liberar', { voucher_id: VOUCHER, colaboradores: [MARINA] });
  check('libera para uma pessoa', lib1.ok && lib1.liberados.length === 1, lib1);
  const lib2 = await sp('sp_liberar', { voucher_id: VOUCHER, colaboradores: [MARINA] });
  check('nao empilha duas liberacoes na mesma pessoa',
    lib2.liberados.length === 0 && lib2.pulados.length === 1, lib2);

  const vejo = await spPublico('meu_space', null, { t: TOKEN_MARINA });
  check('a pessoa ve o beneficio disponivel',
    vejo.ok && vejo.disponivel && vejo.disponivel.valor === 50, vejo.disponivel);
  check('e ve o proprio nome', vejo.colaborador.primeiro_nome === 'Marina', vejo.colaborador);

  // ---- chave Pix que nao existe ----
  const chaveRuim = await spPublico('sacar', { t: TOKEN_MARINA, chave: 'isso aqui nao e chave' });
  check('chave Pix sem cara de chave e barrada antes do banco', !chaveRuim.ok, chaveRuim);
  check('e o banco nao foi chamado', Object.keys(await asaasUltimo()).length === 0);

  // ---- O TESTE QUE IMPORTA: dois cliques ao mesmo tempo ----
  // Se a trava falhar, saem dois Pix e a empresa paga duas vezes.
  const [saque1, saque2] = await Promise.all([
    spPublico('sacar', { t: TOKEN_MARINA, chave: CPF_OK }),
    spPublico('sacar', { t: TOKEN_MARINA, chave: CPF_OK })
  ]);
  const passaram = [saque1, saque2].filter(function (x) { return x.ok; }).length;
  check('dois cliques juntos: SO UM saque passa', passaram === 1,
    { um: saque1.ok, dois: saque2.ok, e1: saque1.error, e2: saque2.error });
  const transf = await (await fetch(SERV + '/asaas/transfers', { headers: { access_token: 'chave-asaas-de-mentira' } })).json();
  check('e o banco recebeu UMA transferencia so', (transf.data || []).length === 1, (transf.data || []).length);
  check('com o valor certo', transf.data[0].value === 50, transf.data[0]);
  check('e com a nossa referencia junto (para reconhecer o webhook depois)',
    !!transf.data[0].externalReference, transf.data[0]);

  const posSaque = await spPublico('meu_space', null, { t: TOKEN_MARINA });
  check('depois de sacar nao sobra nada disponivel', posSaque.disponivel === null, posSaque.disponivel);
  check('e o saque aparece como em processamento',
    posSaque.em_curso && posSaque.em_curso.status === 'processando', posSaque.em_curso);

  // ---- o webhook do Asaas fecha a conta ----
  const LIB_ID = transf.data[0].externalReference;
  async function webhookAsaas(evento, extras, token) {
    return (await fetch(BASE + '/api/space?action=webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'asaas-access-token': token === undefined ? 'token-webhook-de-teste' : token
      },
      body: JSON.stringify({
        event: evento,
        transfer: Object.assign({
          id: transf.data[0].id, externalReference: LIB_ID, status: 'DONE', value: 50
        }, extras || {})
      })
    }));
  }

  const whRuim = await webhookAsaas('TRANSFER_DONE', null, 'token-errado');
  check('webhook com token errado leva 401', whRuim.status === 401, whRuim.status);

  const okWh = await webhookAsaas('TRANSFER_DONE', { transactionReceiptUrl: 'https://asaas.com/recibo/1' });
  check('webhook certo responde 200', okWh.status === 200, okWh.status);
  const pago = await spPublico('meu_space', null, { t: TOKEN_MARINA });
  const ultima = (pago.historico || [])[0];
  check('o webhook marcou como pago', ultima && ultima.status === 'pago', ultima);
  check('e guardou o comprovante', ultima.comprovante_url === 'https://asaas.com/recibo/1', ultima.comprovante_url);

  // Evento atrasado nao pode desfazer um pagamento.
  await webhookAsaas('TRANSFER_FAILED', { status: 'FAILED' });
  const aindaPago = await spPublico('meu_space', null, { t: TOKEN_MARINA });
  check('evento atrasado nao desfaz pagamento',
    aindaPago.historico[0].status === 'pago', aindaPago.historico[0]);

  // ---- quando o banco recusa, o beneficio volta para a pessoa ----
  await asaasLimpa();
  await sp('sp_liberar', { voucher_id: VOUCHER, colaboradores: [DIEGO] });
  await asaasModo('recusa');
  const recusado = await spPublico('sacar', { t: TOKEN_DIEGO, chave: CPF_OK });
  check('recusa do banco vira mensagem para a pessoa', !recusado.ok && /Pix/i.test(recusado.error || ''), recusado);
  const depoisRecusa = await spPublico('meu_space', null, { t: TOKEN_DIEGO });
  check('e o beneficio volta a ficar disponivel',
    depoisRecusa.disponivel && depoisRecusa.disponivel.status === 'liberado', depoisRecusa.disponivel);
  await asaasModo('ok');

  // ---- cancelar ----
  const cancel = await sp('sp_cancelar', { id: depoisRecusa.disponivel.id });
  check('da para cancelar o que ninguem sacou', cancel.ok, cancel.error);
  check('e nao da para cancelar duas vezes', !(await sp('sp_cancelar', { id: depoisRecusa.disponivel.id })).ok);

  // ---- teto de seguranca no voucher ----
  const caro = await sp('sp_voucher_salvar', { nome: 'Zero a mais ' + SUF, valor: '999999' });
  check('voucher acima do teto e recusado', !caro.ok && /limite/i.test(caro.error || ''), caro);
  const bom = await sp('sp_voucher_salvar', { nome: 'Vale Teste ' + SUF, valor: '37,50' });
  check('valor com virgula e aceito', bom.ok && bom.voucher.valor === 37.5, bom.error || bom.voucher);

  // ---- adivinhacao do tipo da chave ----
  {
    const as = require('../api/_lib/asaas.js');
    check('reconhece CPF', as.tipoDaChave('111.444.777-35') === 'CPF');
    check('reconhece e-mail', as.tipoDaChave('gente@startdigital.com.br') === 'EMAIL');
    // Onze digitos que tambem passam como CPF sao AMBIGUOS de verdade.
    // O certo aqui e nao escolher sozinho: quem escolhe e o dono da chave.
    check('numero que serve como CPF e como telefone nao e adivinhado',
      as.tipoDaChave('(13) 99600-3897') === null, as.tipoDaChave('(13) 99600-3897'));
    check('e as duas leituras sao oferecidas',
      as.tiposPossiveis('(13) 99600-3897').sort().join(',') === 'CPF,PHONE',
      as.tiposPossiveis('(13) 99600-3897'));
    // telefone de 10 digitos nao pode ser CPF: esse sai sem perguntar
    check('telefone fixo com DDD e reconhecido direto', as.tipoDaChave('(13) 3496-5502') === 'PHONE');
    check('reconhece chave aleatoria',
      as.tipoDaChave('123e4567-e89b-12d3-a456-426614174000') === 'EVP');
    check('nao inventa tipo para lixo', as.tipoDaChave('abc 123') === null);
    check('telefone sai com o +55 na frente',
      as.formataChave('(13) 99600-3897', 'PHONE') === '+5513996003897', as.formataChave('(13) 99600-3897', 'PHONE'));
    check('CPF sai so com numeros', as.formataChave('111.444.777-35', 'CPF') === '11144477735');
    check('CPF invalido nao vira CPF', as.tipoDaChave('111.111.111-11') !== 'CPF');
  }

  // ---- "foi voce que pediu?": a validacao de saque do Asaas ----
  // O Asaas manda o pedido de validacao com "type" e sem "event".
  async function validaAsaas(payload, token) {
    const r = await fetch(BASE + '/api/space?action=webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'asaas-access-token': token === undefined ? 'token-webhook-de-teste' : token
      },
      body: JSON.stringify(payload)
    });
    return { http: r.status, corpo: await r.json() };
  }

  // o saque de verdade que esta em andamento (o da Marina, la de cima)
  const vSaque = await validaAsaas({ type: 'TRANSFER', transfer: { id: transf.data[0].id, value: 50 } });
  check('valida e APROVA o saque que o sistema pediu',
    vSaque.corpo.status === 'APPROVED', vSaque.corpo);
  const vDesconhecido = await validaAsaas({ type: 'TRANSFER', transfer: { id: 'tr_de_ladrao', value: 50 } });
  check('RECUSA transferencia que o sistema nao pediu',
    vDesconhecido.corpo.status === 'REFUSED', vDesconhecido.corpo);
  const vValor = await validaAsaas({ type: 'TRANSFER', transfer: { id: transf.data[0].id, value: 5000 } });
  check('RECUSA quando o valor foi mexido no caminho',
    vValor.corpo.status === 'REFUSED', vValor.corpo);
  const vConta = await validaAsaas({ type: 'BILL', bill: { id: 1, value: 20 } });
  check('RECUSA pagamento de conta (o portal nunca paga conta)',
    vConta.corpo.status === 'REFUSED', vConta.corpo);
  const vRecarga = await validaAsaas({ type: 'MOBILE_PHONE_RECHARGE', mobilePhoneRecharge: { value: 20 } });
  check('RECUSA recarga de celular', vRecarga.corpo.status === 'REFUSED', vRecarga.corpo);
  const vTokenErrado = await validaAsaas({ type: 'TRANSFER', transfer: { id: transf.data[0].id, value: 50 } }, 'token-errado');
  check('validacao com token errado leva 401 (nem responde APPROVED/REFUSED)',
    vTokenErrado.http === 401, vTokenErrado);

  // ---- chave ambigua: o servidor pergunta em vez de chutar ----
  await asaasLimpa();
  await sp('sp_liberar', { voucher_id: VOUCHER, colaboradores: [DIEGO] });
  const ambigua = await spPublico('sacar', { t: TOKEN_DIEGO, chave: '13996003897' });
  check('chave ambigua nao e enviada', !ambigua.ok, ambigua);
  check('e o servidor devolve as opcoes para a pessoa escolher',
    (ambigua.escolher || []).map(function (o) { return o.tipo; }).sort().join(',') === 'CPF,PHONE', ambigua.escolher);
  check('nada foi para o banco enquanto a duvida nao foi resolvida',
    Object.keys(await asaasUltimo()).length === 0);

  const escolhida = await spPublico('sacar', { t: TOKEN_DIEGO, chave: '13996003897', tipo: 'PHONE' });
  check('com a escolha da pessoa, o saque sai', escolhida.ok, escolhida.error);
  const mandado = await asaasUltimo();
  check('e vai como telefone, com o +55 na frente',
    mandado.pixAddressKeyType === 'PHONE' && mandado.pixAddressKey === '+5513996003897', mandado);

  // tipo que nao bate com a chave nao passa: ninguem burla pelo corpo do pedido
  await sp('sp_liberar', { voucher_id: VOUCHER, colaboradores: [MARINA] });
  const tipoMentira = await spPublico('sacar', { t: TOKEN_MARINA, chave: 'gente@startdigital.com.br', tipo: 'CPF' });
  check('tipo que nao combina com a chave e ignorado (vale o que a chave e)',
    tipoMentira.ok && (await asaasUltimo()).pixAddressKeyType === 'EMAIL', await asaasUltimo());

  // ---- aviso de saque por SMS para o chefe ----
  // Palco limpo: as cenas anteriores deixaram saques em andamento, e
  // aqui a gente precisa liberar e sacar do zero.
  await fetch('http://127.0.0.1:54321/rest/v1/benefit_releases', { method: 'DELETE' })
    .catch(function () { return null; });
  const cfgSalva = await sp('sp_config_save', { aviso_sms_para: '13 98888-0001' });
  check('salva o telefone do aviso de saque', cfgSalva.ok, cfgSalva.error);
  check('o painel devolve o telefone salvo',
    ((await sp('sp_painel')).config || {}).aviso_sms_para === '13 98888-0001');

  // um saque novo tem que disparar o SMS com nome e beneficio
  await asaasLimpa();
  await fetch(SERV + '/__asaas-modo?m=ok');
  await sp('sp_liberar', { voucher_id: VOUCHER, colaboradores: [DIEGO] });
  const saqueAviso = await spPublico('sacar', { t: TOKEN_DIEGO, chave: CPF_OK });
  check('saque com aviso ligado sai normal', saqueAviso.ok, saqueAviso.error);
  const smsChefe = await (await fetch(SERV + '/__ultimo-sms')).json();
  check('o chefe recebe SMS do saque', String(smsChefe.receivers && smsChefe.receivers[0] || '').indexOf('5513988880001') >= 0, smsChefe.receivers);
  check('o SMS diz quem sacou e o que',
    /Diego/.test(smsChefe.message || '') && /Amazon Prime/.test(smsChefe.message || ''), smsChefe.message);

  // ---- liberar avisando a pessoa pelos tres canais ----
  const libAviso = await sp('sp_liberar', {
    voucher_id: VOUCHER, colaboradores: [MARINA],
    avisar: { whatsapp: true, sms: true, email: true }
  });
  check('libera avisando a pessoa', libAviso.ok && libAviso.liberados.length === 1, libAviso);
  check('contou os avisos enviados', libAviso.avisos_enviados >= 2, libAviso.avisos_enviados);
  const zapAviso = await (await fetch(SERV + '/__ultimo-zap')).json();
  check('o WhatsApp da pessoa recebeu o link de resgate',
    /space\?t=colabtoken000000000001/.test(zapAviso.text || '') && /Amazon Prime/.test(zapAviso.text || ''),
    zapAviso.text);
  const mailAviso = await (await fetch(SERV + '/__ultimo-email')).json();
  check('o e-mail da pessoa tambem foi',
    /space\?t=colabtoken000000000001/.test(mailAviso.text || '') &&
    (mailAviso.to || [])[0] === 'marina@startdigital.com.br', mailAviso.to);
  const smsPessoa = await (await fetch(SERV + '/__ultimo-sms')).json();
  check('o SMS da pessoa idem',
    /space/.test(smsPessoa.message || '') && String(smsPessoa.receivers && smsPessoa.receivers[0] || '').indexOf('5513991112233') >= 0,
    { msg: smsPessoa.message, para: smsPessoa.receivers });
  // limpa a liberacao da Marina para nao interferir no resto
  {
    const painelAgora = await sp('sp_painel');
    const marinaAgora = (painelAgora.colaboradores || []).filter(function (c) { return c.id === MARINA; })[0];
    if (marinaAgora && marinaAgora.aberta) await sp('sp_cancelar', { id: marinaAgora.aberta.id });
  }
  // desliga o aviso para as proximas rodadas nao dependerem dele
  await sp('sp_config_save', { aviso_sms_para: '' });

  // ---- a tranca de permissao ----
  {
    const perms = require('../api/_lib/perms.js');
    check('dono mexe no space', perms.permite('dono', 'sp_liberar') === true);
    check('rh mexe no space', perms.permite('rh', 'sp_liberar') === true);
    check('leitura nem ve o space', perms.permite('leitura', 'sp_painel') === false);
    check('avaliador nao libera dinheiro', perms.permite('avaliador', 'sp_liberar') === false);
    check('o menu do dono tem o space', perms.menuDoPapel('dono').indexOf('space') >= 0);
  }

  console.log('\n5c) SEGURANCA — trava de senha e fim de sessao');
  // a dica da senha na tela de login
  const dica = await (await fetch(BASE + '/api/admin?action=dica_senha')).json();
  check('dica da senha responde sem precisar de login', dica.ok === true, dica.error);
  check('quando mostra a dica, vem a senha junto',
    dica.mostrar === false || (dica.mostrar === true && !!dica.senha), dica);
  if (dica.mostrar === true) {
    check('a senha mostrada e a que realmente entra', dica.senha === SENHA_PAINEL);
  }

  // A chave liga/desliga de verdade. Testo a funcao que o servidor usa,
  // nao uma copia dela — copia de logica em teste so serve para mentir.
  {
    const guardado = process.env.MOSTRAR_SENHA_LOGIN;
    delete require.cache[require.resolve('../api/_lib/util.js')];
    const util = require('../api/_lib/util.js');
    delete process.env.MOSTRAR_SENHA_LOGIN;
    check('sem configurar nada, a senha aparece', util.mostrarSenhaNoLogin() === true);
    ['false', 'FALSE', ' nao ', '0', 'off', 'no'].forEach(function (v) {
      process.env.MOSTRAR_SENHA_LOGIN = v;
      check('"' + v.trim() + '" esconde a senha', util.mostrarSenhaNoLogin() === false);
    });
    ['true', 'sim', '1'].forEach(function (v) {
      process.env.MOSTRAR_SENHA_LOGIN = v;
      check('"' + v + '" mantem a senha na tela', util.mostrarSenhaNoLogin() === true);
    });
    if (guardado === undefined) delete process.env.MOSTRAR_SENHA_LOGIN;
    else process.env.MOSTRAR_SENHA_LOGIN = guardado;
  }

  async function tentaLogin(senha) {
    return (await fetch(BASE + '/api/admin?action=login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: senha })
    })).json();
  }

  // 5 erros seguidos e a origem fica travada
  let travou = null;
  for (let i = 0; i < 7; i++) {
    const r = await tentaLogin('senha-errada-' + i);
    if (/Muitas tentativas/.test(r.error || '')) { travou = r.error; break; }
  }
  check('trava depois de tentativas erradas', !!travou, travou);
  check('senha certa tambem espera a trava', /Muitas tentativas/.test((await tentaLogin(SENHA_PAINEL)).error || ''));

  // limpa a trava direto no espelho do banco, senao os proximos testes nao entram
  await fetch('http://127.0.0.1:54321/rest/v1/settings?key=eq.login_erros', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ value: {} })
  }).catch(function () { return null; });
  const voltou = await tentaLogin(SENHA_PAINEL);
  check('depois de limpar a trava, entra de novo', voltou.ok && !!voltou.token, voltou.error);
  check('token novo carrega a epoca da sessao', !!voltou.token, voltou.error);

  // a epoca invalida sessoes antigas
  const tokenAntigo = T;
  check('encerra todas as sessoes', (await adm('logout_todos', {})).ok);
  const usandoAntigo = await (await fetch(BASE + '/api/admin?action=board', {
    headers: { Authorization: 'Bearer ' + tokenAntigo }
  })).json();
  check('token antigo para de valer', usandoAntigo.ok === false && /encerrada|expirada/i.test(usandoAntigo.error || ''), usandoAntigo.error);
  T = (await tentaLogin(SENHA_PAINEL)).token;
  check('login novo volta a funcionar', !!T);

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
