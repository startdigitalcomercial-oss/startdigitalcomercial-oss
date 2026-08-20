// ============================================================
// API DO PAINEL — usada pelo time da StartDigital
// /api/admin?action=...   (todas exigem login, menos "login")
// ============================================================
'use strict';

const db = require('./_lib/db');
const u = require('./_lib/util');
const disc = require('./_lib/disc');
const send = require('./_lib/send');
const aurea = require('./_lib/aurea');
const webhook = require('./webhook');
const perms = require('./_lib/perms');
const vagas = require('./_lib/vagas');
const campos = require('./_lib/campos');
const porta = require('./_lib/porta');

const SESSION_HOURS = 12;

const CONJUNTOS = {
  welcome: { email: 'welcome_email_senha', whatsapp: 'welcome_whatsapp', sms: 'welcome_sms' },
  disc_invite: { email: 'disc_invite_email', whatsapp: 'disc_invite_whatsapp', sms: 'disc_invite_sms' },
  quiz_invite: { email: 'quiz_invite_email', whatsapp: 'quiz_invite_whatsapp', sms: 'quiz_invite_sms' },
  reject: { email: 'reject_email' }
};

// Um aviso vira tres textos diferentes: cada canal tem o seu jeito.
// E-mail leva o titulo no assunto. WhatsApp poe o titulo em negrito.
// SMS nao tem titulo separado nem acento, e tem que caber no credito.
function montaAviso(titulo, texto, canais) {
  const quer = (canais && canais.length) ? canais : ['email', 'whatsapp', 'sms'];
  const itens = [];

  if (quer.indexOf('email') >= 0) {
    itens.push({ channel: 'email', subject: titulo, body: texto });
  }
  if (quer.indexOf('whatsapp') >= 0) {
    itens.push({ channel: 'whatsapp', subject: null, body: '*' + titulo + '*\n\n' + texto });
  }
  if (quer.indexOf('sms') >= 0) {
    const cru = (titulo + ': ' + texto)
      .replace(/\s*\n+\s*/g, ' ')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^\x00-\x7F]/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    itens.push({ channel: 'sms', subject: null, body: cru.slice(0, 320) });
  }
  return itens;
}

// ============================================================
// TRAVA CONTRA TENTATIVA DE ADIVINHAR A SENHA
// Depois de 5 erros da mesma origem, espera 15 minutos.
// Fica no banco (e nao na memoria) porque cada requisicao da Vercel
// pode rodar numa maquina diferente — memoria nao serviria.
// ============================================================
const MAX_ERROS = 5;
const CASTIGO_MIN = 15;

// Identifica de onde veio a tentativa, sem guardar o IP inteiro:
// so um resumo embaralhado, que serve para contar e nao identifica ninguem.
function quemPede(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'desconhecido')
    .split(',')[0].trim();
  return require('crypto').createHmac('sha256', process.env.APP_SECRET || 'sem-segredo')
    .update('login:' + ip).digest('hex').slice(0, 24);
}

async function travaLogin(chave) {
  const reg = await getSetting('login_erros', {});
  const dados = reg[chave];
  if (!dados) return { bloqueado: false };
  const passou = (Date.now() - dados.ultimo) / 60000;
  if (passou >= CASTIGO_MIN) return { bloqueado: false };
  if (dados.erros < MAX_ERROS) return { bloqueado: false };
  return { bloqueado: true, espere_min: Math.max(1, Math.ceil(CASTIGO_MIN - passou)) };
}

async function registraErroLogin(chave) {
  const reg = await getSetting('login_erros', {}) || {};
  const agora = Date.now();
  // limpa o que ja venceu, para o registro nao crescer para sempre
  Object.keys(reg).forEach(function (k) {
    if (!reg[k] || (agora - reg[k].ultimo) / 60000 > CASTIGO_MIN * 4) delete reg[k];
  });
  const atual = reg[chave] || { erros: 0 };
  reg[chave] = { erros: atual.erros + 1, ultimo: agora };
  await db.upsert('settings', { key: 'login_erros', value: reg }, 'key');
}

async function limpaErrosLogin(chave) {
  const reg = await getSetting('login_erros', {}) || {};
  if (!reg[chave]) return;
  delete reg[chave];
  await db.upsert('settings', { key: 'login_erros', value: reg }, 'key');
}

// "Epoca" da sessao: um numero que, ao mudar, invalida todos os tokens antigos.
async function epocaSessao() {
  const s = await getSetting('session_epoch', null);
  if (s && s.valor) return s.valor;
  const valor = Date.now();
  await db.upsert('settings', { key: 'session_epoch', value: { valor: valor } }, 'key');
  return valor;
}

async function getSetting(key, fallback) {
  const row = await db.selectOne('settings', { key: 'eq.' + key, select: 'key,value' });
  return row ? row.value : fallback;
}

// ============================================================
// USUARIOS DO PAINEL
// Cada pessoa entra com o proprio e-mail e senha, e tem um papel.
// ============================================================

// Enquanto nao existir NENHUM usuario ativo, a senha mestra
// (ADMIN_PASSWORD) entra como Dono — senao ninguem conseguiria
// criar o primeiro. Depois do primeiro Dono, ela deixa de valer,
// a nao ser que SENHA_MESTRA_SEMPRE esteja ligada na Vercel.
async function usuariosAtivos() {
  return await db.select('panel_users', { active: 'is.true', select: '*', order: 'name.asc' });
}

async function senhaMestraVale(ativos) {
  if (String(process.env.SENHA_MESTRA_SEMPRE || '').toLowerCase() === 'true') return true;
  return !ativos.some(function (x) { return x.role === 'dono'; });
}

function usuarioLimpo(x) {
  return {
    id: x.id, name: x.name, email: x.email, role: x.role,
    role_nome: perms.NOMES[x.role] || x.role,
    active: x.active, must_change: x.must_change,
    tem_senha: !!x.password_hash,
    last_login_at: x.last_login_at, created_at: x.created_at
  };
}

// Guarda no historico quem fez o que. So grava o que muda alguma coisa.
async function anota(sessao, acao, alvo, detalhe) {
  try {
    await db.insert('audit_log', {
      user_id: sessao && sessao.uid ? sessao.uid : null,
      user_name: (sessao && sessao.nome) || 'senha mestra',
      user_email: (sessao && sessao.email) || '',
      action: acao,
      target: alvo || null,
      detail: detalhe || {}
    });
  } catch (e) { console.error('[auditoria]', e.message); }
}

// ------------------------------------------------------------
// CONVITE POR E-MAIL
// Ninguem recebe senha pronta. Quem entra no painel recebe um
// e-mail com um link e escolhe a propria senha por la.
//
// O link nao precisa de tabela nova: ele e assinado com o segredo
// do sistema e carrega dentro (1) quem e a pessoa, (2) um pedaco
// da senha atual dela e (3) a validade. Assim que a pessoa cria a
// senha, aquele pedaco muda — e o link velho morre sozinho.
// ------------------------------------------------------------
const CONVITE_HORAS = 72;

// Uma senha aleatoria que ninguem sabe. Serve so para deixar a conta
// fechada enquanto a pessoa nao criar a dela pelo link do e-mail.
function senhaTrancada() {
  return u.hashPassword(require('crypto').randomBytes(24).toString('hex'));
}

function conviteToken(pessoa) {
  return u.signSession({
    role: 'convite_painel',
    uid: pessoa.id,
    pw: String(pessoa.password_hash || '').slice(0, 16),
    exp: Date.now() + CONVITE_HORAS * 3600 * 1000
  });
}

function conviteLink(pessoa) {
  return u.appUrl() + '/criar-senha-painel?t=' + conviteToken(pessoa);
}

async function conviteValido(t) {
  const s = u.verifySession(t);
  if (!s || s.role !== 'convite_painel' || !s.uid) {
    return { erro: 'Este link não vale mais. Peça ao Dono do painel para enviar um convite novo.' };
  }
  const pessoa = await db.selectOne('panel_users', { id: 'eq.' + s.uid, select: '*' });
  if (!pessoa) return { erro: 'Este acesso não existe mais no painel.' };
  if (pessoa.active === false) return { erro: 'Este acesso está desativado. Fale com o Dono do painel.' };
  if (String(pessoa.password_hash || '').slice(0, 16) !== s.pw) {
    return { erro: 'Este link já foi usado. Se precisar trocar a senha, peça um convite novo ao Dono do painel.' };
  }
  return { pessoa: pessoa };
}

function escapaSimples(s) { return u.escapeHtml(s); }

// Monta e dispara o e-mail do convite. Nunca derruba a criacao do
// usuario: se o e-mail falhar, devolve o erro e o link para o Dono
// copiar e mandar na mao.
async function enviaConvite(pessoa, tipo) {
  const link = conviteLink(pessoa);
  const empresa = await getSetting('company', {});
  const nomeEmpresa = (empresa && empresa.name) || 'StartDigital';
  const primeiro = u.firstName(pessoa.name) || pessoa.name;
  const papelNome = perms.NOMES[pessoa.role] || pessoa.role;

  const assunto = tipo === 'reset'
    ? 'Crie uma senha nova para o painel da ' + nomeEmpresa
    : 'Seu acesso ao painel da ' + nomeEmpresa;

  const texto = tipo === 'reset'
    ? ('Olá, ' + primeiro + '!\n\n' +
       'Pediram uma senha nova para o seu acesso ao painel da ' + nomeEmpresa + '. ' +
       'Clique no botão abaixo e escolha a senha que você quiser.\n\n' +
       link + '\n\n' +
       'SEU ACESSO\n' +
       'E-mail: ' + pessoa.email + '\n' +
       'Nível: ' + papelNome + '\n\n' +
       'O link vale por ' + CONVITE_HORAS + ' horas e só funciona uma vez. ' +
       'Sua senha antiga já parou de valer.\n\n' +
       'Se não foi você que pediu, avise o responsável pelo painel.\n\n' +
       'Equipe ' + nomeEmpresa)
    : ('Olá, ' + primeiro + '!\n\n' +
       'Você acaba de ganhar acesso ao painel da ' + nomeEmpresa + '. ' +
       'Clique no botão abaixo para escolher a sua senha — quem cria é você, ninguém mais vê.\n\n' +
       link + '\n\n' +
       'SEU ACESSO\n' +
       'E-mail: ' + pessoa.email + '\n' +
       'Nível: ' + papelNome + '\n\n' +
       'O link vale por ' + CONVITE_HORAS + ' horas e só funciona uma vez. ' +
       'Depois de criar a senha, é com ela e com o seu e-mail que você entra.\n\n' +
       'Equipe ' + nomeEmpresa);

  // Este e-mail nao e de candidato: o topo e o rodape mudam.
  const html = u.textToEmailHtml(texto, assunto, {
    etiqueta: 'Painel interno',
    rodape: 'Mensagem automática do painel interno da ' + escapaSimples(nomeEmpresa) + '.<br>' +
      'Se você não esperava este e-mail, ignore — sem clicar no link ele não vira nada.'
  });

  try {
    const r = await send.sendEmail({ to: pessoa.email, subject: assunto, text: texto, html: html });
    const deuCerto = r && (r.status === 'enviado' || r.status === 'sent');
    return { enviado: !!deuCerto, erro: deuCerto ? null : (r && r.error) || 'não foi possível enviar', link: link };
  } catch (e) {
    return { enviado: false, erro: e.message, link: link };
  }
}

async function renderSet(candidate, setName, channels) {
  const company = await getSetting('company', {});
  const vars = u.templateVars(candidate, company);
  const map = CONJUNTOS[setName] || {};
  const wanted = (channels && channels.length) ? channels : Object.keys(map);
  const items = [];
  for (const ch of wanted) {
    const key = map[ch];
    if (!key) continue;
    const tpl = await db.selectOne('message_templates', { key: 'eq.' + key, select: '*' });
    if (!tpl) continue;
    items.push({
      channel: ch,
      template_key: key,
      subject: tpl.subject ? u.renderTemplate(tpl.subject, vars) : null,
      body: u.renderTemplate(tpl.body, vars)
    });
  }
  return items;
}

module.exports = async function handler(req, res) {
  u.setBaseFromReq(req);
  const params = (req.query && Object.keys(req.query).length)
    ? req.query
    : Object.fromEntries(new URL(req.url, 'http://x').searchParams.entries());
  const action = params.action || '';

  try {
    // Mostra a senha na tela de login. Durante a fase de testes isso vem
    // LIGADO de fabrica — nao depende de configurar nada na Vercel.
    // Para DESLIGAR: crie a variavel MOSTRAR_SENHA_LOGIN com o valor
    // false (ou nao, ou 0) e faca Redeploy.
    if (action === 'dica_senha') {
      // "primeiro_acesso" avisa a tela de login que ainda nao existe nenhum
      // Dono cadastrado — nessa fase a entrada e so com a senha mestra, com o
      // campo de e-mail vazio. Isso vai sempre, mesmo com a dica desligada.
      let primeiro = false;
      try { primeiro = await senhaMestraVale(await usuariosAtivos()); } catch (e) { }
      if (!u.mostrarSenhaNoLogin()) return u.ok(res, { mostrar: false, primeiro_acesso: primeiro });
      return u.ok(res, {
        mostrar: true,
        primeiro_acesso: primeiro,
        senha: process.env.ADMIN_PASSWORD || process.env.ADMIN_SECRET || ''
      });
    }

    // ------------------------------------------ CONVITE (sem login)
    // A pessoa clicou no link do e-mail. Estas duas rotas sao publicas
    // de proposito — quem manda e a assinatura do link, nao a sessao.
    if (action === 'convite_info') {
      const v = await conviteValido(String(params.t || ''));
      if (v.erro) return u.fail(res, 400, v.erro);
      return u.ok(res, {
        nome: v.pessoa.name,
        primeiro_nome: u.firstName(v.pessoa.name),
        email: v.pessoa.email,
        papel_nome: perms.NOMES[v.pessoa.role] || v.pessoa.role
      });
    }

    if (action === 'convite_senha') {
      if (req.method !== 'POST') return u.fail(res, 405, 'Metodo nao permitido');
      const body = await u.readBody(req);
      const v = await conviteValido(String(body.t || ''));
      if (v.erro) return u.fail(res, 400, v.erro);

      const nova = String(body.password || '');
      if (nova.length < 8) return u.fail(res, 400, 'A senha precisa ter pelo menos 8 caracteres.');
      if (/^\d+$/.test(nova)) return u.fail(res, 400, 'Não use só números. Misture letras.');

      const cifra = u.hashPassword(nova);
      const pessoa = await db.update('panel_users', {
        password_hash: cifra.hash, password_salt: cifra.salt,
        must_change: false, last_login_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, { id: 'eq.' + v.pessoa.id });

      const sessao = {
        role: 'admin', papel: v.pessoa.role, uid: v.pessoa.id,
        nome: v.pessoa.name, email: v.pessoa.email,
        epoca: await epocaSessao(),
        exp: Date.now() + SESSION_HOURS * 3600 * 1000
      };
      await anota(sessao, 'senha_criada', v.pessoa.email, {});
      return u.ok(res, {
        token: u.signSession(sessao),
        usuario: usuarioLimpo(pessoa || v.pessoa),
        menu: perms.menuDoPapel(v.pessoa.role)
      });
    }

    // ---------------------------------------------------- LOGIN
    if (action === 'login') {
      if (req.method !== 'POST') return u.fail(res, 405, 'Metodo nao permitido');
      const body = await u.readBody(req);
      const senha = String(body.password || '');
      const esperada = process.env.ADMIN_PASSWORD || process.env.ADMIN_SECRET || '';
      if (!esperada) return u.fail(res, 500, 'ADMIN_PASSWORD nao configurada na Vercel.');

      const deOnde = quemPede(req);
      const trava = await travaLogin(deOnde);
      if (trava.bloqueado) {
        return u.fail(res, 429, 'Muitas tentativas erradas. Espere ' + trava.espere_min +
          ' minuto(s) antes de tentar de novo.');
      }

      const email = String(body.email || '').trim().toLowerCase();
      const ativos = await usuariosAtivos();

      // ---- entrada por e-mail e senha (o jeito normal) ----
      if (email) {
        const pessoa = ativos.filter(function (x) { return String(x.email).toLowerCase() === email; })[0];
        const bate = pessoa && pessoa.password_hash &&
          u.checkPassword(senha, pessoa.password_hash, pessoa.password_salt);
        if (!bate) {
          await registraErroLogin(deOnde);
          return u.fail(res, 401, 'E-mail ou senha incorretos.');
        }
        await limpaErrosLogin(deOnde);
        await db.update('panel_users', { last_login_at: new Date().toISOString() }, { id: 'eq.' + pessoa.id });

        const sessao = {
          role: 'admin', papel: pessoa.role, uid: pessoa.id,
          nome: pessoa.name, email: pessoa.email,
          epoca: await epocaSessao(),
          exp: Date.now() + SESSION_HOURS * 3600 * 1000
        };
        await anota(sessao, 'entrou', null, {});
        return u.ok(res, {
          token: u.signSession(sessao),
          expires_in_hours: SESSION_HOURS,
          usuario: usuarioLimpo(pessoa),
          menu: perms.menuDoPapel(pessoa.role),
          trocar_senha: pessoa.must_change === true
        });
      }

      // ---- senha mestra (so enquanto nao houver um Dono) ----
      if (!(await senhaMestraVale(ativos))) {
        return u.fail(res, 401, 'Agora cada pessoa entra com o próprio e-mail e senha. ' +
          'Peça o seu acesso ao Dono do painel.');
      }
      if (!senha || !u.safeEqual(senha, esperada)) {
        await registraErroLogin(deOnde);
        return u.fail(res, 401, 'Senha incorreta.');
      }
      await limpaErrosLogin(deOnde);

      const sessao = {
        role: 'admin', papel: 'dono', uid: null,
        nome: 'Senha mestra', email: '', mestra: true,
        epoca: await epocaSessao(),
        exp: Date.now() + SESSION_HOURS * 3600 * 1000
      };
      return u.ok(res, {
        token: u.signSession(sessao),
        expires_in_hours: SESSION_HOURS,
        usuario: { name: 'Senha mestra', role: 'dono', role_nome: 'Dono' },
        menu: perms.menuDoPapel('dono'),
        mestra: true,
        aviso: ativos.length
          ? null
          : 'Você entrou com a senha mestra. Crie o seu usuário em Usuários — depois disso a senha mestra deixa de valer.'
      });
    }

    // Desliga TODAS as sessoes abertas, inclusive a de quem clicou.
    // Serve para quando alguem sai do time ou uma senha vaza.
    if (action === 'logout_todos') {
      const antes = await u.requireAdmin(req, res);
      if (!antes) return;
      await db.upsert('settings', { key: 'session_epoch', value: { valor: Date.now() } }, 'key');
      return u.ok(res, { aviso: 'Todas as sessoes foram encerradas. Todo mundo precisa entrar de novo.' });
    }

    // ---------------------------------------------------- daqui pra baixo exige login
    // A porta confere crachá, sessão encerrada, acesso desativado e
    // permissão do papel. Mora em _lib/porta.js e é a mesma do financeiro.
    const entrada = await porta.abrir(req, res, action);
    if (!entrada) return;
    const session = entrada.session;
    const papel = entrada.papel;

    // quem sou eu (a tela usa para montar o menu e mostrar o nome)
    if (action === 'usuarios_eu') {
      return u.ok(res, {
        usuario: {
          nome: session.nome || 'Senha mestra',
          email: session.email || '',
          papel: papel,
          papel_nome: perms.NOMES[papel] || papel,
          mestra: !!session.mestra
        },
        menu: perms.menuDoPapel(papel)
      });
    }

    // ---------------------------------------------------- QUADRO (KANBAN)
    if (action === 'board') {
      const stages = await db.select('stages', { order: 'position.asc', select: '*' });
      const candidates = await db.select('candidates', {
        archived: 'eq.false', order: 'created_at.desc',
        select: 'id,name,email,phone,role_applied,stage_key,rating,city,state,member_access,source,source_detail,job_id,created_at,updated_at'
      });
      const discRows = await db.select('disc_results', { select: 'candidate_id,primary_profile,secondary_profile' });
      const attempts = await db.select('quiz_attempts', {
        finished_at: 'not.is.null', select: 'candidate_id,percent,passed,integrity_flags'
      });
      const discBy = {}; discRows.forEach(function (r) { discBy[r.candidate_id] = r; });
      const attBy = {}; attempts.forEach(function (a) { attBy[a.candidate_id] = a; });

      const enriched = candidates.map(function (c) {
        const d = discBy[c.id];
        const a = attBy[c.id];
        return Object.assign({}, c, {
          disc: d ? (d.primary_profile + (d.secondary_profile ? '/' + d.secondary_profile : '')) : null,
          quiz_percent: a ? a.percent : null,
          quiz_passed: a ? a.passed : null,
          quiz_flags: a && a.integrity_flags ? a.integrity_flags.length : 0
        });
      });
      const arquivados = await db.count('candidates', { archived: 'eq.true' });
      return u.ok(res, {
        stages: stages, candidates: enriched, archived_count: arquivados,
        providers: send.providerStatus(), app_url: u.appUrl()
      });
    }

    // ---------------------------------------------------- LISTA DE ARQUIVADOS
    if (action === 'archived') {
      const rows = await db.select('candidates', {
        archived: 'eq.true', order: 'updated_at.desc',
        select: 'id,name,email,phone,role_applied,stage_key,created_at'
      });
      return u.ok(res, { candidates: rows });
    }

    // ---------------------------------------------------- FICHA DO CANDIDATO
    // Link temporário do currículo. O balde é privado: o link vale 10
    // minutos e some. Nunca guardamos endereço público de documento.
    if (action === 'curriculo_link') {
      const cand = await db.selectOne('candidates', {
        id: 'eq.' + (params.id || ''), select: 'id,name,curriculo_url,curriculo_nome'
      });
      if (!cand || !cand.curriculo_url) return u.fail(res, 404, 'Este candidato nao anexou curriculo.');
      const link = await db.linkTemporario('curriculos', cand.curriculo_url, 600);
      if (!link) return u.fail(res, 500, 'Nao consegui abrir o arquivo agora.');
      await anota(session, 'curriculo_aberto', cand.name, {});
      return u.ok(res, { link: link, nome: cand.curriculo_nome || 'curriculo' });
    }

    if (action === 'candidate') {
      const cand = await db.selectOne('candidates', { id: 'eq.' + params.id, select: '*' });
      if (!cand) return u.fail(res, 404, 'Candidato nao encontrado.');

      const discRow = await db.selectOne('disc_results', { candidate_id: 'eq.' + cand.id, select: '*' });
      let discDetail = null;
      if (discRow) {
        const questions = await db.select('disc_questions', { active: 'eq.true', order: 'position.asc', select: 'position,words' });
        discDetail = Object.assign({}, discRow, { computed: disc.score(discRow.answers || {}, questions) });
      }

      const attempts = await db.select('quiz_attempts', {
        candidate_id: 'eq.' + cand.id, order: 'started_at.desc', select: '*'
      });
      let quizQuestions = [];
      if (attempts.length && attempts[0].quiz_id) {
        quizQuestions = await db.select('quiz_questions', {
          quiz_id: 'eq.' + attempts[0].quiz_id, order: 'position.asc', select: '*'
        });
      }
      const history = await db.select('stage_history', {
        candidate_id: 'eq.' + cand.id, order: 'created_at.desc', select: '*', limit: 100
      });
      const logs = await db.select('message_logs', {
        candidate_id: 'eq.' + cand.id, order: 'created_at.desc', select: '*', limit: 60
      });

      const prequal = await db.selectOne('prequal_sessions', {
        candidate_id: 'eq.' + cand.id, order: 'started_at.desc', select: '*'
      });
      let prequalMsgs = [];
      if (prequal) {
        prequalMsgs = await db.select('prequal_messages', {
          session_id: 'eq.' + prequal.id, order: 'created_at.asc', select: '*', limit: 200
        });
      }

      return u.ok(res, {
        candidate: cand,
        prequal: prequal,
        prequal_messages: prequalMsgs,
        links: u.candidateLinks(cand),
        disc: discDetail,
        disc_profiles: disc.PROFILES,
        attempts: attempts,
        quiz_questions: quizQuestions,
        history: history,
        logs: logs
      });
    }

    // ---------------------------------------------------- MOVER ETAPA
    if (action === 'move') {
      const body = await u.readBody(req);
      const cand = await db.selectOne('candidates', { id: 'eq.' + body.id, select: 'id,stage_key,name' });
      if (!cand) return u.fail(res, 404, 'Candidato nao encontrado.');
      const stage = await db.selectOne('stages', { key: 'eq.' + body.stage_key, select: '*' });
      if (!stage) return u.fail(res, 400, 'Etapa invalida.');
      if (cand.stage_key === stage.key) return u.ok(res, { unchanged: true });

      await db.update('candidates', {
        stage_key: stage.key, updated_at: new Date().toISOString()
      }, { id: 'eq.' + cand.id });
      await db.insert('stage_history', {
        candidate_id: cand.id, from_stage: cand.stage_key, to_stage: stage.key,
        note: body.note || null
      });
      return u.ok(res, {});
    }

    // ---------------------------------------------------- ATUALIZAR CANDIDATO
    if (action === 'update_candidate') {
      const body = await u.readBody(req);
      const permitidos = ['rating', 'notes', 'member_access', 'archived', 'role_applied', 'name', 'email', 'phone', 'city', 'state'];
      const patch = { updated_at: new Date().toISOString() };
      permitidos.forEach(function (k) { if (body[k] !== undefined) patch[k] = body[k]; });
      const row = await db.update('candidates', patch, { id: 'eq.' + body.id });
      if (!row) return u.fail(res, 404, 'Candidato nao encontrado.');
      if (body.archived === true) {
        await db.insert('stage_history', { candidate_id: row.id, from_stage: row.stage_key, to_stage: row.stage_key, note: 'Arquivado' });
      }
      if (body.member_access !== undefined) {
        await db.insert('stage_history', {
          candidate_id: row.id, from_stage: row.stage_key, to_stage: row.stage_key,
          note: body.member_access ? 'Area de integracao liberada' : 'Area de integracao bloqueada'
        });
      }
      return u.ok(res, { candidate: row });
    }

    if (action === 'delete_candidate') {
      const body = await u.readBody(req);
      await db.remove('candidates', { id: 'eq.' + body.id });
      return u.ok(res, {});
    }

    // ---------------------------------------------------- CORRECAO MANUAL DO QUIZ
    if (action === 'grade_attempt') {
      const body = await u.readBody(req);
      const patch = {};
      if (body.percent !== undefined) patch.percent = body.percent;
      if (body.passed !== undefined) patch.passed = body.passed;
      const row = await db.update('quiz_attempts', patch, { id: 'eq.' + body.attempt_id });
      if (!row) return u.fail(res, 404, 'Tentativa nao encontrada.');
      return u.ok(res, { attempt: row });
    }

    // ---------------------------------------------------- MODULOS E AULAS
    if (action === 'content') {
      const modules = await db.select('modules', { order: 'position.asc', select: '*' });
      const lessons = await db.select('lessons', { order: 'position.asc', select: '*' });
      const tree = modules.map(function (m) {
        return Object.assign({}, m, {
          lessons: lessons.filter(function (l) { return l.module_id === m.id; })
        });
      });
      return u.ok(res, { modules: tree });
    }

    if (action === 'module_save') {
      const body = await u.readBody(req);
      const patch = {};
      ['title', 'description', 'position', 'published'].forEach(function (k) {
        if (body[k] !== undefined) patch[k] = body[k];
      });
      if (!patch.title && !body.id) return u.fail(res, 400, 'Informe o titulo do modulo.');
      let row;
      if (body.id) row = await db.update('modules', patch, { id: 'eq.' + body.id });
      else {
        if (patch.position === undefined) {
          const total = await db.count('modules', {});
          patch.position = total + 1;
        }
        row = await db.insert('modules', patch);
      }
      return u.ok(res, { module: row });
    }

    // nova ordem dos modulos: recebe a lista de ids na ordem que o time arrastou
    if (action === 'module_reorder') {
      const body = await u.readBody(req);
      const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : [];
      if (!ids.length) return u.fail(res, 400, 'Nenhum módulo na lista.');
      for (let i = 0; i < ids.length; i++) {
        await db.update('modules', { position: i + 1 }, { id: 'eq.' + ids[i] });
      }
      return u.ok(res, { ordem: ids });
    }

    if (action === 'module_delete') {
      const body = await u.readBody(req);
      await db.remove('modules', { id: 'eq.' + body.id });
      return u.ok(res, {});
    }

    if (action === 'lesson_save') {
      const body = await u.readBody(req);
      const patch = {};
      ['module_id', 'title', 'description', 'video_url', 'duration', 'materials', 'position', 'published'].forEach(function (k) {
        if (body[k] !== undefined) patch[k] = body[k];
      });
      let row;
      if (body.id) row = await db.update('lessons', patch, { id: 'eq.' + body.id });
      else {
        if (!patch.module_id) return u.fail(res, 400, 'Informe o modulo da aula.');
        if (!patch.title) return u.fail(res, 400, 'Informe o titulo da aula.');
        if (patch.position === undefined) {
          const total = await db.count('lessons', { module_id: 'eq.' + patch.module_id });
          patch.position = total + 1;
        }
        row = await db.insert('lessons', patch);
      }
      return u.ok(res, { lesson: row });
    }

    if (action === 'lesson_delete') {
      const body = await u.readBody(req);
      await db.remove('lessons', { id: 'eq.' + body.id });
      return u.ok(res, {});
    }

    // ---------------------------------------------------- TEMPLATES
    if (action === 'templates') {
      const rows = await db.select('message_templates', { order: 'id.asc', select: '*' });
      return u.ok(res, { templates: rows });
    }

    if (action === 'template_save') {
      const body = await u.readBody(req);
      if (!body.key) return u.fail(res, 400, 'Template nao informado.');
      const patch = { updated_at: new Date().toISOString() };
      if (body.subject !== undefined) patch.subject = body.subject;
      if (body.body !== undefined) patch.body = body.body;
      if (body.name !== undefined) patch.name = body.name;
      const row = await db.update('message_templates', patch, { key: 'eq.' + body.key });
      if (!row) return u.fail(res, 404, 'Template nao encontrado.');
      return u.ok(res, { template: row });
    }

    // ---------------------------------------------------- QUIZ (edicao)
    if (action === 'quiz_admin') {
      const quizzes = await db.select('quizzes', { order: 'created_at.asc', select: '*' });
      const questions = await db.select('quiz_questions', { order: 'position.asc', select: '*' });
      const tree = quizzes.map(function (qz) {
        return Object.assign({}, qz, {
          questions: questions.filter(function (q) { return q.quiz_id === qz.id; })
        });
      });
      return u.ok(res, { quizzes: tree });
    }

    if (action === 'quiz_save') {
      const body = await u.readBody(req);
      const patch = {};
      ['title', 'description', 'time_limit_min', 'pass_score', 'active'].forEach(function (k) {
        if (body[k] !== undefined) patch[k] = body[k];
      });
      let row;
      if (body.id) row = await db.update('quizzes', patch, { id: 'eq.' + body.id });
      else row = await db.insert('quizzes', patch);
      return u.ok(res, { quiz: row });
    }

    if (action === 'question_save') {
      const body = await u.readBody(req);
      const patch = {};
      ['quiz_id', 'position', 'kind', 'prompt', 'options', 'correct', 'points'].forEach(function (k) {
        if (body[k] !== undefined) patch[k] = body[k];
      });
      let row;
      if (body.id) row = await db.update('quiz_questions', patch, { id: 'eq.' + body.id });
      else {
        if (!patch.quiz_id) return u.fail(res, 400, 'Quiz nao informado.');
        if (patch.position === undefined) {
          const total = await db.count('quiz_questions', { quiz_id: 'eq.' + patch.quiz_id });
          patch.position = total + 1;
        }
        row = await db.insert('quiz_questions', patch);
      }
      return u.ok(res, { question: row });
    }

    if (action === 'question_delete') {
      const body = await u.readBody(req);
      await db.remove('quiz_questions', { id: 'eq.' + body.id });
      return u.ok(res, {});
    }

    // ---------------------------------------------------- DISC (edicao)
    if (action === 'disc_admin') {
      const rows = await db.select('disc_questions', { order: 'position.asc', select: '*' });
      return u.ok(res, { questions: rows });
    }

    if (action === 'disc_question_save') {
      const body = await u.readBody(req);
      const patch = {};
      ['position', 'words', 'active'].forEach(function (k) { if (body[k] !== undefined) patch[k] = body[k]; });
      let row;
      if (body.id) row = await db.update('disc_questions', patch, { id: 'eq.' + body.id });
      else row = await db.insert('disc_questions', patch);
      return u.ok(res, { question: row });
    }

    // ---------------------------------------------------- MENSAGENS
    if (action === 'preview') {
      const body = await u.readBody(req);
      const cand = await db.selectOne('candidates', { id: 'eq.' + body.candidate_id, select: '*' });
      if (!cand) return u.fail(res, 404, 'Candidato nao encontrado.');
      const items = await renderSet(cand, body.set || 'welcome', body.channels || []);
      return u.ok(res, {
        items: items,
        candidate: { id: cand.id, name: cand.name, email: cand.email, phone: cand.phone },
        links: u.candidateLinks(cand),
        providers: send.providerStatus()
      });
    }

    if (action === 'send') {
      const body = await u.readBody(req);
      const cand = await db.selectOne('candidates', { id: 'eq.' + body.candidate_id, select: '*' });
      if (!cand) return u.fail(res, 404, 'Candidato nao encontrado.');

      let items = Array.isArray(body.items) && body.items.length
        ? body.items
        : await renderSet(cand, body.set || 'welcome', body.channels || []);
      if (!items.length) return u.fail(res, 400, 'Nenhuma mensagem para enviar.');

      const waInstance = (await getSetting('whatsapp', {}) || {}).instance || process.env.EVOLUTION_INSTANCE;
      const resultados = [];

      for (const item of items) {
        let r;
        if (item.channel === 'email') {
          r = await send.sendEmail({ to: cand.email, subject: item.subject || '(sem assunto)', text: item.body });
        } else if (item.channel === 'whatsapp') {
          r = await send.sendWhatsApp({ to: cand.phone, text: item.body, instance: waInstance });
        } else if (item.channel === 'sms') {
          r = await send.sendSms({ to: cand.phone, text: item.body });
        } else {
          r = { status: 'erro', provider: 'nenhum', error: 'Canal desconhecido' };
        }
        await db.insert('message_logs', {
          candidate_id: cand.id, channel: item.channel,
          to_address: item.channel === 'email' ? cand.email : cand.phone,
          subject: item.subject || null, body: item.body,
          status: r.status, provider: r.provider, error: r.error || null
        });
        resultados.push({ channel: item.channel, status: r.status, error: r.error || null });
      }

      // O conjunto de boas-vindas libera a area de integracao
      if ((body.set || 'welcome') === 'welcome' && body.grant_access !== false) {
        const patch = { member_access: true, updated_at: new Date().toISOString() };
        if (cand.stage_key !== 'concluido') patch.stage_key = 'concluido';
        await db.update('candidates', patch, { id: 'eq.' + cand.id });
        if (cand.stage_key !== 'concluido') {
          await db.insert('stage_history', {
            candidate_id: cand.id, from_stage: cand.stage_key, to_stage: 'concluido',
            note: 'Boas-vindas enviadas e area de integracao liberada'
          });
        }
      }
      if ((body.set) === 'reject') {
        await db.update('candidates', { stage_key: 'nao_seguiu', updated_at: new Date().toISOString() }, { id: 'eq.' + cand.id });
        await db.insert('stage_history', {
          candidate_id: cand.id, from_stage: cand.stage_key, to_stage: 'nao_seguiu', note: 'Retorno negativo enviado'
        });
      }

      return u.ok(res, { results: resultados });
    }

    if (action === 'logs') {
      const rows = await db.select('message_logs', { order: 'created_at.desc', select: '*', limit: params.limit || 120 });
      const cands = await db.select('candidates', { select: 'id,name' });
      const nameBy = {}; cands.forEach(function (c) { nameBy[c.id] = c.name; });
      return u.ok(res, {
        logs: rows.map(function (l) { return Object.assign({}, l, { candidate_name: nameBy[l.candidate_id] || '—' }); })
      });
    }

    // ---------------------------------------------------- AJUSTES
    if (action === 'settings') {
      const company = await getSetting('company', {});
      const form = await getSetting('form', {});
      const whatsapp = await getSetting('whatsapp', {});
      const landing = await getSetting('landing', {});
      const conhecimento = await getSetting('conhecimento', {});
      const instances = await send.listWhatsAppInstances();
      return u.ok(res, {
        company: company, form: form, whatsapp: whatsapp, landing: landing,
        conhecimento: conhecimento,
        wa_instances: instances, providers: send.providerStatus(), app_url: u.appUrl()
      });
    }

    if (action === 'settings_save') {
      const body = await u.readBody(req);
      if (!body.key) return u.fail(res, 400, 'Chave nao informada.');
      const row = await db.upsert('settings', { key: body.key, value: body.value || {} }, 'key');
      return u.ok(res, { setting: row });
    }

    // ==========================================================
    // DASHBOARD
    // ==========================================================
    if (action === 'dashboard') {
      const stages = await db.select('stages', { order: 'position.asc', select: '*' });
      const cands = await db.select('candidates', {
        archived: 'eq.false', select: 'id,stage_key,source,source_detail,created_at,member_access'
      });
      const sessoes = await db.select('prequal_sessions', { select: 'status,score,recommendation,started_at' });

      const hoje = new Date();
      const diaISO = function (d) { return d.toISOString().slice(0, 10); };
      const dias = [];
      for (let i = 13; i >= 0; i--) {
        const d = new Date(hoje.getTime() - i * 86400000);
        dias.push({ dia: diaISO(d), total: 0 });
      }
      const porDia = {}; dias.forEach(function (d) { porDia[d.dia] = d; });
      cands.forEach(function (c) {
        const k = String(c.created_at || '').slice(0, 10);
        if (porDia[k]) porDia[k].total += 1;
      });

      const funil = stages.map(function (st) {
        return {
          key: st.key, nome: st.name, cor: st.color,
          total: cands.filter(function (c) { return c.stage_key === st.key; }).length
        };
      });

      const origens = {};
      cands.forEach(function (c) {
        const o = c.source_detail || c.source || 'Formulário do site';
        origens[o] = (origens[o] || 0) + 1;
      });
      const listaOrigens = Object.keys(origens).map(function (k) { return { nome: k, total: origens[k] }; })
        .sort(function (a, b) { return b.total - a.total; }).slice(0, 6);

      const ultimos7 = cands.filter(function (c) {
        return new Date(c.created_at).getTime() > hoje.getTime() - 7 * 86400000;
      }).length;
      const anteriores7 = cands.filter(function (c) {
        const t = new Date(c.created_at).getTime();
        return t <= hoje.getTime() - 7 * 86400000 && t > hoje.getTime() - 14 * 86400000;
      }).length;

      const concluidas = sessoes.filter(function (x) { return x.status === 'concluida'; });
      const notas = concluidas.filter(function (x) { return x.score !== null && x.score !== undefined; });
      const media = notas.length
        ? Math.round((notas.reduce(function (t, x) { return t + Number(x.score); }, 0) / notas.length) * 10) / 10
        : null;

      return u.ok(res, {
        indicadores: {
          ativos: cands.length,
          novos_7d: ultimos7,
          variacao_7d: anteriores7 ? Math.round(((ultimos7 - anteriores7) / anteriores7) * 100) : null,
          concluidos: cands.filter(function (c) { return c.stage_key === 'concluido'; }).length,
          prequal_em_andamento: sessoes.filter(function (x) { return x.status === 'em_andamento'; }).length,
          prequal_concluidas: concluidas.length,
          prequal_nota_media: media,
          prequal_recomendados: concluidas.filter(function (x) { return x.recommendation === 'avancar'; }).length
        },
        serie_novos: dias,
        funil: funil,
        origens: listaOrigens
      });
    }

    // ==========================================================
    // VAGAS — o que aparece na landing page
    // ==========================================================
    if (action === 'vagas') {
      const lista = await vagas.todas();
      const grupos = await db.select('prequal_groups', { order: 'name.asc', select: 'id,name,is_default' });
      const landing = await getSetting('landing', {});
      // quantos candidatos cada vaga ja trouxe
      const cands = await db.select('candidates', { archived: 'eq.false', select: 'job_id' });
      const porVaga = {};
      cands.forEach(function (c) { if (c.job_id) porVaga[c.job_id] = (porVaga[c.job_id] || 0) + 1; });

      return u.ok(res, {
        vagas: lista.map(function (v) {
          return Object.assign({}, v, {
            candidatos: porVaga[v.id] || 0,
            texto_botao: vagas.textoDoBotao(v),
            link_publico: u.appUrl() + '/vagas#' + v.slug
          });
        }),
        grupos: grupos,
        landing: landing,
        modos: vagas.MODOS,
        catalogo_campos: campos.CATALOGO.map(function (c) {
          return { chave: c.chave, rotulo: c.rotulo, dica: c.dica, tipo: c.tipo };
        }),
        campos_fixos: campos.FIXOS
      });
    }

    if (action === 'vaga_salvar') {
      const body = await u.readBody(req);
      const titulo = String(body.title || '').trim();

      const patch = {};
      ['summary', 'description', 'salary', 'employment_type', 'location', 'schedule',
       'area', 'seniority', 'whatsapp_message', 'wa_perguntas'].forEach(function (k) {
        if (body[k] !== undefined) patch[k] = String(body[k] || '').trim() || null;
      });
      ['requirements', 'responsibilities', 'benefits'].forEach(function (k) {
        if (body[k] !== undefined) patch[k] = vagas.paraLista(body[k]);
      });
      if (body.work_mode !== undefined) {
        const m = String(body.work_mode || '');
        patch.work_mode = vagas.MODOS.indexOf(m) >= 0 ? m : null;
      }
      if (body.prequal_group_id !== undefined) {
        patch.prequal_group_id = body.prequal_group_id || null;
      }
      if (body.campos_form !== undefined) {
        patch.campos_form = campos.normaliza(body.campos_form);
      }
      if (body.usa_whatsapp !== undefined) patch.usa_whatsapp = !!body.usa_whatsapp;
      if (body.active !== undefined) patch.active = !!body.active;
      if (body.featured !== undefined) patch.featured = !!body.featured;
      if (body.position !== undefined) patch.position = Number(body.position) || 1;

      let row;
      if (body.id) {
        const antiga = await vagas.porId(body.id);
        if (!antiga) return u.fail(res, 404, 'Vaga nao encontrada.');
        if (titulo && titulo !== antiga.title) {
          patch.title = titulo;
          patch.slug = await vagas.apelidoLivre(titulo, antiga.id);
        }
        patch.updated_at = new Date().toISOString();
        row = await db.update('jobs', patch, { id: 'eq.' + body.id });
        await anota(session, 'vaga_alterada', titulo || antiga.title, {});
      } else {
        if (titulo.length < 3) return u.fail(res, 400, 'Escreva o titulo da vaga.');
        patch.title = titulo;
        patch.slug = await vagas.apelidoLivre(titulo, null);
        if (patch.position === undefined) {
          patch.position = (await db.count('jobs', {})) + 1;
        }
        row = await db.insert('jobs', patch);
        await anota(session, 'vaga_criada', titulo, {});
      }
      return u.ok(res, { vaga: row });
    }

    if (action === 'vaga_excluir') {
      const body = await u.readBody(req);
      const alvo = await vagas.porId(body.id);
      if (!alvo) return u.fail(res, 404, 'Vaga nao encontrada.');
      await db.remove('jobs', { id: 'eq.' + alvo.id });
      await anota(session, 'vaga_excluida', alvo.title, {});
      return u.ok(res, {});
    }

    if (action === 'vaga_ordem') {
      const body = await u.readBody(req);
      const ids = Array.isArray(body.ids) ? body.ids : [];
      for (let i = 0; i < ids.length; i++) {
        await db.update('jobs', { position: i + 1 }, { id: 'eq.' + ids[i] });
      }
      return u.ok(res, {});
    }

    // ==========================================================
    // PRÉ-QUALIFICAÇÃO (grupos e perguntas)
    // ==========================================================
    if (action === 'prequal') {
      const grupos = await db.select('prequal_groups', { order: 'created_at.asc', select: '*' });
      const perguntas = await db.select('prequal_questions', { order: 'position.asc', select: '*' });
      return u.ok(res, {
        grupos: grupos.map(function (g) {
          return Object.assign({}, g, {
            questions: perguntas.filter(function (q) { return q.group_id === g.id; })
          });
        })
      });
    }

    if (action === 'prequal_group_save') {
      const body = await u.readBody(req);
      const patch = {};
      ['name', 'description', 'role_target', 'active', 'is_default', 'auto_on_apply',
       'opening_message', 'closing_message'].forEach(function (k) {
        if (body[k] !== undefined) patch[k] = body[k];
      });
      if (patch.is_default === true) {
        await db.update('prequal_groups', { is_default: false }, { is_default: 'eq.true' });
      }
      let row;
      if (body.id) row = await db.update('prequal_groups', patch, { id: 'eq.' + body.id });
      else {
        if (!patch.name) return u.fail(res, 400, 'Dê um nome ao grupo.');
        row = await db.insert('prequal_groups', patch);
      }
      return u.ok(res, { grupo: row });
    }

    if (action === 'prequal_group_delete') {
      const body = await u.readBody(req);
      await db.remove('prequal_groups', { id: 'eq.' + body.id });
      return u.ok(res, {});
    }

    if (action === 'prequal_question_save') {
      const body = await u.readBody(req);
      const patch = {};
      ['group_id', 'position', 'question', 'objective', 'required', 'weight'].forEach(function (k) {
        if (body[k] !== undefined) patch[k] = body[k];
      });
      let row;
      if (body.id) row = await db.update('prequal_questions', patch, { id: 'eq.' + body.id });
      else {
        if (!patch.group_id) return u.fail(res, 400, 'Grupo nao informado.');
        if (!patch.question) return u.fail(res, 400, 'Escreva a pergunta.');
        if (patch.position === undefined) {
          patch.position = (await db.count('prequal_questions', { group_id: 'eq.' + patch.group_id })) + 1;
        }
        row = await db.insert('prequal_questions', patch);
      }
      return u.ok(res, { pergunta: row });
    }

    if (action === 'prequal_question_delete') {
      const body = await u.readBody(req);
      await db.remove('prequal_questions', { id: 'eq.' + body.id });
      return u.ok(res, {});
    }

    // ==========================================================
    // AUREA
    // ==========================================================
    if (action === 'aurea') {
      const cfg = await aurea.config();
      const sessoes = await db.select('prequal_sessions', {
        order: 'started_at.desc', select: '*', limit: 60
      });
      const cands = await db.select('candidates', { select: 'id,name,phone,role_applied,stage_key' });
      const nomeDe = {}; cands.forEach(function (c) { nomeDe[c.id] = c; });
      const grupos = await db.select('prequal_groups', { select: 'id,name' });
      const nomeGrupo = {}; grupos.forEach(function (g) { nomeGrupo[g.id] = g.name; });

      return u.ok(res, {
        config: cfg,
        webhook_url: u.appUrl() + '/api/webhook?k=' + webhook.chaveWebhook(),
        tem_chave_ia: !!process.env.ANTHROPIC_API_KEY,
        providers: send.providerStatus(),
        sessoes: sessoes.map(function (s2) {
          const c = nomeDe[s2.candidate_id] || {};
          return Object.assign({}, s2, {
            candidato: c.name || '—', telefone: c.phone || '',
            vaga: c.role_applied || '', grupo: nomeGrupo[s2.group_id] || '—',
            total_respostas: Array.isArray(s2.answers) ? s2.answers.length : 0
          });
        })
      });
    }

    if (action === 'aurea_config_save') {
      const body = await u.readBody(req);
      const atual = await aurea.config();
      const novo = Object.assign({}, atual, body.value || {});
      await db.upsert('settings', { key: 'aurea', value: novo }, 'key');
      return u.ok(res, { config: novo });
    }

    if (action === 'aurea_test') {
      try {
        const r = await aurea.testar();
        return u.ok(res, r);
      } catch (e) {
        return u.fail(res, 400, e.message);
      }
    }

    if (action === 'aurea_start') {
      const body = await u.readBody(req);
      const ids = Array.isArray(body.candidate_ids) ? body.candidate_ids
        : (body.candidate_id ? [body.candidate_id] : []);
      if (!ids.length) return u.fail(res, 400, 'Nenhum candidato selecionado.');

      const resultados = [];
      for (const id of ids) {
        const cand = await db.selectOne('candidates', { id: 'eq.' + id, select: '*' });
        if (!cand) { resultados.push({ id: id, ok: false, error: 'Candidato nao encontrado' }); continue; }
        const r = await aurea.iniciar(cand, body.group_id, { forcar: !!body.forcar, reiniciar: !!body.reiniciar });
        resultados.push(Object.assign({ id: id, nome: cand.name }, r));
      }
      return u.ok(res, { resultados: resultados });
    }

    if (action === 'aurea_session') {
      const s2 = await db.selectOne('prequal_sessions', { id: 'eq.' + params.id, select: '*' });
      if (!s2) return u.fail(res, 404, 'Conversa nao encontrada.');
      const msgs = await db.select('prequal_messages', {
        session_id: 'eq.' + s2.id, order: 'created_at.asc', select: '*', limit: 300
      });
      const cand = await db.selectOne('candidates', { id: 'eq.' + s2.candidate_id, select: 'id,name,phone,role_applied' });
      return u.ok(res, { sessao: s2, mensagens: msgs, candidato: cand });
    }

    // ==========================================================
    // IMPORTAR LISTA (Indeed, LinkedIn, Catho...)
    // ==========================================================
    if (action === 'import_candidates') {
      const body = await u.readBody(req);
      const linhas = Array.isArray(body.rows) ? body.rows : [];
      const origem = String(body.source || 'Importação').trim();
      if (!linhas.length) return u.fail(res, 400, 'Nenhuma linha para importar.');

      const criados = [], pulados = [];
      for (const l of linhas) {
        const nome = String(l.name || '').trim();
        const email = String(l.email || '').trim().toLowerCase();
        const fone = String(l.phone || '').trim();
        if (nome.length < 3) { pulados.push({ linha: l, motivo: 'nome muito curto' }); continue; }
        if (u.normalizePhone(fone).length < 12) { pulados.push({ linha: l, motivo: 'telefone invalido' }); continue; }

        if (email) {
          const dup = await db.selectOne('candidates', { email: 'eq.' + email, archived: 'eq.false', select: 'id' });
          if (dup) { pulados.push({ linha: l, motivo: 'e-mail ja cadastrado' }); continue; }
        }
        const tail = u.phoneTail(fone);
        if (tail) {
          const dupF = await db.selectOne('candidates', { phone_digits: 'like.*' + tail, archived: 'eq.false', select: 'id' });
          if (dupF) { pulados.push({ linha: l, motivo: 'telefone ja cadastrado' }); continue; }
        }

        const novo = await db.insert('candidates', {
          token: u.candidateToken(), name: nome,
          email: email || (u.normalizePhone(fone) + '@sem-email.local'),
          phone: fone, role_applied: l.role || body.role || null,
          city: l.city || null, source: 'importacao', source_detail: origem,
          stage_key: 'triagem'
        });
        await db.insert('stage_history', {
          candidate_id: novo.id, from_stage: null, to_stage: 'triagem',
          note: 'Importado de ' + origem
        });
        criados.push({ id: novo.id, nome: nome });
      }

      // dispara a Aurea para o lote, se pedido
      const disparos = [];
      if (body.iniciar_aurea && criados.length) {
        for (const c of criados) {
          const cand = await db.selectOne('candidates', { id: 'eq.' + c.id, select: '*' });
          const r = await aurea.iniciar(cand, body.group_id, { forcar: !!body.forcar });
          disparos.push(Object.assign({ nome: c.nome }, r));
        }
      }
      return u.ok(res, { criados: criados, pulados: pulados, disparos: disparos });
    }

    // ==========================================================
    // WHATSAPP — conectar por QR code
    // ==========================================================
    if (action === 'wa_status') {
      const instancias = await send.listWhatsAppInstances();
      const w = await getSetting('whatsapp', {});
      const escolhida = w.instance || process.env.EVOLUTION_INSTANCE || '';
      let estado = null;
      if (escolhida) estado = await send.waEstado(escolhida);
      const sobrando = instancias.filter(function (i) { return i.name !== escolhida; });

      // ---- o webhook: o que DEVERIA estar la x o que esta ----
      const esperado = u.appUrl() + '/api/webhook?k=' + webhook.chaveWebhook();
      let gancho = { ok: false, url: null, ligado: null, eventos: [], confere: false };
      if (escolhida) {
        const atual = await send.waWebhookAtual(escolhida);
        const mesmoEndereco = !!atual.url && atual.url.split('?')[0] === esperado.split('?')[0];
        const mesmaChave = !!atual.url && atual.url === esperado;
        gancho = {
          ok: atual.ok,
          erro: atual.error || null,
          url: atual.url,
          ligado: atual.ligado,
          eventos: atual.eventos,
          mesmo_endereco: mesmoEndereco,
          mesma_chave: mesmaChave,
          ouve_mensagens: !atual.eventos.length ||
            atual.eventos.some(function (e) { return String(e).toUpperCase().indexOf('MESSAGES_UPSERT') >= 0; }),
          confere: atual.ok && mesmaChave && atual.ligado !== false
        };
      }

      // ---- ja chegou alguma mensagem de fora? ----
      const ultimaEntrada = await db.selectOne('prequal_messages', {
        role: 'eq.candidato', order: 'created_at.desc', select: 'created_at'
      });

      // O numero da landing e o numero conectado na Evolution — sempre.
      // Guardamos aqui para a pagina publica nao precisar perguntar para
      // a Evolution a cada visita.
      const eu = instancias.filter(function (i) { return i.name === escolhida; })[0];
      const numeroConectado = (eu && eu.number) || '';
      if (numeroConectado) {
        const land = await getSetting('landing', {});
        if (land.whatsapp !== numeroConectado) {
          await db.upsert('settings', {
            key: 'landing', value: Object.assign({}, land, { whatsapp: numeroConectado })
          }, 'key');
        }
      }

      // as ultimas batidas do webhook, inclusive as descartadas
      const diario = await getSetting('webhook_log', {});

      return u.ok(res, {
        configurada: send.evoPronta(),
        instancias: instancias,
        sobrando: sobrando,
        escolhida: escolhida,
        estado: estado,
        webhook_url: esperado,
        webhook: gancho,
        ultima_recebida: ultimaEntrada ? ultimaEntrada.created_at : null,
        numero_conectado: numeroConectado,
        batidas: (diario && diario.itens) || []
      });
    }

    // pede um QR novo (o QR da Evolution vence em menos de 1 minuto)
    if (action === 'wa_qr') {
      const nome = params.instance || (await getSetting('whatsapp', {})).instance || process.env.EVOLUTION_INSTANCE || '';
      if (!nome) return u.fail(res, 400, 'Nenhuma instância escolhida.');
      const r = await send.waQrCode(nome);
      return r.ok ? u.ok(res, r) : u.fail(res, 400, r.error);
    }

    // apaga e cria de novo — resolve instância travada
    if (action === 'wa_recriar') {
      const body = await u.readBody(req);
      const nome = String(body.instance || (await getSetting('whatsapp', {})).instance || 'start-rh').trim();
      if (!/^[a-zA-Z0-9_-]{3,40}$/.test(nome)) {
        return u.fail(res, 400, 'Use só letras, números, hífen e underline no nome (3 a 40 caracteres).');
      }
      const r = await send.waRecriar(nome);
      if (!r.ok) return u.fail(res, 400, r.error);
      await db.upsert('settings', { key: 'whatsapp', value: { instance: nome } }, 'key');
      const wh = await send.waWebhook(nome, u.appUrl() + '/api/webhook?k=' + webhook.chaveWebhook());
      return u.ok(res, {
        base64: r.base64, pairingCode: r.pairingCode,
        webhook_ok: wh.ok, webhook_erro: wh.error || null
      });
    }

    // deixa só a instância que o sistema usa
    if (action === 'wa_limpar') {
      const nome = (await getSetting('whatsapp', {})).instance || process.env.EVOLUTION_INSTANCE || '';
      if (!nome) return u.fail(res, 400, 'Conecte uma instância primeiro.');
      const r = await send.waLimparOutras(nome);
      return r.ok ? u.ok(res, r) : u.fail(res, 400, r.error);
    }

    if (action === 'wa_conectar') {
      const body = await u.readBody(req);
      const nome = String(body.instance || '').trim();
      if (!nome) return u.fail(res, 400, 'Dê um nome para a instância.');
      if (!/^[a-zA-Z0-9_-]{3,40}$/.test(nome)) {
        return u.fail(res, 400, 'Use só letras, números, hífen e underline no nome (3 a 40 caracteres).');
      }

      const r = body.recriar ? await send.waQrCode(nome) : await send.waCriarInstancia(nome);
      if (!r.ok) return u.fail(res, 400, r.error);

      // guarda a escolha e já liga o webhook
      await db.upsert('settings', { key: 'whatsapp', value: { instance: nome } }, 'key');
      const wh = await send.waWebhook(nome, u.appUrl() + '/api/webhook?k=' + webhook.chaveWebhook());

      return u.ok(res, {
        base64: r.base64, pairingCode: r.pairingCode,
        ja_conectada: !!r.ja_conectada,
        webhook_ok: wh.ok, webhook_erro: wh.error || null
      });
    }

    if (action === 'wa_estado') {
      const nome = params.instance || (await getSetting('whatsapp', {})).instance || process.env.EVOLUTION_INSTANCE || '';
      if (!nome) return u.fail(res, 400, 'Nenhuma instância escolhida.');
      const r = await send.waEstado(nome);
      return r.ok ? u.ok(res, r) : u.fail(res, 400, r.error);
    }

    if (action === 'wa_webhook') {
      const body = await u.readBody(req);
      const nome = body.instance || (await getSetting('whatsapp', {})).instance || process.env.EVOLUTION_INSTANCE || '';
      if (!nome) return u.fail(res, 400, 'Nenhuma instância escolhida.');
      const r = await send.waWebhook(nome, u.appUrl() + '/api/webhook?k=' + webhook.chaveWebhook());
      return r.ok ? u.ok(res, {}) : u.fail(res, 400, r.error);
    }

    if (action === 'wa_desconectar') {
      const body = await u.readBody(req);
      const nome = body.instance || (await getSetting('whatsapp', {})).instance || process.env.EVOLUTION_INSTANCE || '';
      if (!nome) return u.fail(res, 400, 'Nenhuma instância escolhida.');
      const r = await send.waDesconectar(nome);
      return r.ok ? u.ok(res, {}) : u.fail(res, 400, r.error);
    }

    if (action === 'wa_teste') {
      const body = await u.readBody(req);
      const nome = (await getSetting('whatsapp', {})).instance || process.env.EVOLUTION_INSTANCE;
      const r = await send.sendWhatsApp({
        to: body.phone,
        text: body.text || 'Teste do sistema de RH da StartDigital. Se você recebeu isto, o WhatsApp está conectado.',
        instance: nome
      });
      await db.insert('message_logs', {
        candidate_id: null, channel: 'whatsapp', to_address: body.phone,
        subject: null, body: 'teste de conexao', status: r.status, provider: r.provider, error: r.error || null
      });
      return r.status === 'enviado' ? u.ok(res, r) : u.fail(res, 400, r.error || 'Não foi enviado.');
    }

    // ==========================================================
    // COLABORADORES (time interno)
    // ==========================================================
    if (action === 'team') {
      // A lista inteira vem de uma vez — a busca acontece na tela, sem ida e volta.
      const lista = await db.select('collaborators', { order: 'name.asc', select: '*', limit: '500' });

      // aniversariantes dos proximos 30 dias
      const hoje = new Date();
      const emBreve = lista.filter(function (c) { return !!c.birth_date; }).map(function (c) {
        const p = String(c.birth_date).split('-');
        let prox = new Date(Date.UTC(hoje.getUTCFullYear(), Number(p[1]) - 1, Number(p[2])));
        const inicioHoje = Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate());
        if (prox.getTime() < inicioHoje) prox = new Date(Date.UTC(hoje.getUTCFullYear() + 1, Number(p[1]) - 1, Number(p[2])));
        const dias = Math.round((prox.getTime() - inicioHoje) / 86400000);
        return {
          id: c.id, name: c.nickname || c.name, nome_completo: c.name,
          area: c.area || '', dia: p[2] + '/' + p[1], dias: dias
        };
      }).filter(function (x) { return x.dias <= 60; }).sort(function (a, b) { return a.dias - b.dias; });

      const camisas = {};
      lista.forEach(function (c) { if (c.shirt_size) camisas[c.shirt_size] = (camisas[c.shirt_size] || 0) + 1; });
      const modos = { presencial: 0, remoto: 0, hibrido: 0, sem: 0 };
      lista.forEach(function (c) {
        if (c.active === false) return;
        modos[c.work_mode || 'sem'] = (modos[c.work_mode || 'sem'] || 0) + 1;
      });

      return u.ok(res, {
        colaboradores: lista,
        total: lista.length,
        ativos: lista.filter(function (c) { return c.active !== false; }).length,
        aniversarios: emBreve,
        camisas: camisas,
        modos: modos,
        link: u.appUrl() + '/equipe'
      });
    }

    if (action === 'team_save') {
      const body = await u.readBody(req);
      const patch = {};
      ['name', 'nickname', 'birth_date', 'cpf', 'email', 'phone', 'role_title', 'area',
        'started_on', 'cep', 'street', 'number', 'complement', 'district', 'city', 'state',
        'shirt_size', 'shoe_size', 'work_mode', 'active', 'notes'].forEach(function (k) {
          if (body[k] !== undefined) patch[k] = body[k];
        });
      patch.updated_at = new Date().toISOString();
      if (!body.id) return u.fail(res, 400, 'Informe qual colaborador.');
      const row = await db.update('collaborators', patch, { id: 'eq.' + body.id });
      return u.ok(res, { colaborador: row });
    }

    if (action === 'team_delete') {
      const body = await u.readBody(req);
      await db.remove('collaborators', { id: 'eq.' + body.id });
      return u.ok(res, {});
    }

    // ==========================================================
    // USUARIOS DO PAINEL — so o Dono chega aqui
    // ==========================================================
    if (action === 'usuarios') {
      const lista = await db.select('panel_users', { order: 'name.asc', select: '*' });
      const ativos = lista.filter(function (x) { return x.active !== false; });
      return u.ok(res, {
        usuarios: lista.map(usuarioLimpo),
        papeis: perms.PAPEIS.map(function (p) {
          return { chave: p, nome: perms.NOMES[p], descricao: perms.DESCRICOES[p] };
        }),
        senha_mestra_vale: await senhaMestraVale(ativos),
        eu: session.email || null
      });
    }

    if (action === 'usuario_salvar') {
      const body = await u.readBody(req);
      const nome = String(body.name || '').trim();
      const email = String(body.email || '').trim().toLowerCase();
      const papelNovo = String(body.role || 'leitura');

      if (!perms.papelValido(papelNovo)) return u.fail(res, 400, 'Papel desconhecido.');

      // ---- editar quem ja existe ----
      if (body.id) {
        const alvo = await db.selectOne('panel_users', { id: 'eq.' + body.id, select: '*' });
        if (!alvo) return u.fail(res, 404, 'Usuário não encontrado.');

        // nao dá para tirar o ultimo Dono do ar
        if (alvo.role === 'dono' && (papelNovo !== 'dono' || body.active === false)) {
          const donos = await db.select('panel_users', { role: 'eq.dono', active: 'is.true', select: 'id' });
          if (donos.length <= 1) {
            return u.fail(res, 400, 'Este é o único Dono do painel. Promova outra pessoa antes de mudar este.');
          }
        }
        const patch = { updated_at: new Date().toISOString() };
        if (nome) patch.name = nome;
        if (perms.papelValido(papelNovo)) patch.role = papelNovo;
        if (body.active !== undefined) patch.active = !!body.active;
        const row = await db.update('panel_users', patch, { id: 'eq.' + body.id });
        await anota(session, 'usuario_alterado', alvo.email, { papel: patch.role, ativo: patch.active });
        return u.ok(res, { usuario: usuarioLimpo(row) });
      }

      // ---- criar novo ----
      if (!nome || nome.length < 2) return u.fail(res, 400, 'Escreva o nome da pessoa.');
      if (!u.isEmail(email)) return u.fail(res, 400, 'O e-mail não parece certo.');

      const jaTem = await db.selectOne('panel_users', { email: 'eq.' + email, select: 'id' });
      if (jaTem) return u.fail(res, 409, 'Já existe um usuário com este e-mail.');

      // A conta nasce trancada: ninguem sabe a senha, nem eu. A pessoa
      // recebe um e-mail com o link e escolhe a dela.
      const cifra = senhaTrancada();
      const novo = await db.insert('panel_users', {
        name: nome, email: email, role: papelNovo,
        password_hash: cifra.hash, password_salt: cifra.salt,
        must_change: true, active: true,
        created_by: session.email || 'senha mestra'
      });
      await anota(session, 'usuario_criado', email, { papel: papelNovo });

      const convite = await enviaConvite(novo, 'novo');
      await anota(session, convite.enviado ? 'convite_enviado' : 'convite_falhou', email, { erro: convite.erro });

      return u.ok(res, { usuario: usuarioLimpo(novo), convite: convite });
    }

    // Reenvia o convite: tranca a conta de novo (a senha atual para de
    // valer na hora) e manda outro link por e-mail.
    if (action === 'usuario_senha') {
      const body = await u.readBody(req);
      const alvo = await db.selectOne('panel_users', { id: 'eq.' + body.id, select: '*' });
      if (!alvo) return u.fail(res, 404, 'Usuário não encontrado.');
      const cifra = senhaTrancada();
      await db.update('panel_users', {
        password_hash: cifra.hash, password_salt: cifra.salt,
        must_change: true, updated_at: new Date().toISOString()
      }, { id: 'eq.' + alvo.id });
      await anota(session, 'senha_redefinida', alvo.email, {});

      const atualizado = Object.assign({}, alvo, { password_hash: cifra.hash, password_salt: cifra.salt });
      const convite = await enviaConvite(atualizado, 'reset');
      await anota(session, convite.enviado ? 'convite_enviado' : 'convite_falhou', alvo.email, { erro: convite.erro });
      return u.ok(res, { nome: alvo.name, email: alvo.email, convite: convite });
    }

    if (action === 'usuario_excluir') {
      const body = await u.readBody(req);
      const alvo = await db.selectOne('panel_users', { id: 'eq.' + body.id, select: '*' });
      if (!alvo) return u.fail(res, 404, 'Usuário não encontrado.');
      if (alvo.role === 'dono') {
        const donos = await db.select('panel_users', { role: 'eq.dono', active: 'is.true', select: 'id' });
        if (donos.length <= 1) return u.fail(res, 400, 'Não dá para excluir o único Dono do painel.');
      }
      await db.remove('panel_users', { id: 'eq.' + alvo.id });
      await anota(session, 'usuario_excluido', alvo.email, { papel: alvo.role });
      return u.ok(res, {});
    }

    if (action === 'auditoria') {
      const linhas = await db.select('audit_log', { order: 'created_at.desc', limit: '80', select: '*' });
      return u.ok(res, { registros: linhas });
    }

    // ==========================================================
    // AVISOS — uma mensagem para o time inteiro, nos canais escolhidos
    // ==========================================================
    if (action === 'broadcast_info') {
      const time = await db.select('collaborators', { active: 'is.true', order: 'name.asc', select: '*' });
      const historico = await db.select('broadcasts', { order: 'created_at.desc', limit: '15', select: '*' });
      return u.ok(res, {
        total: time.length,
        com_email: time.filter(function (c) { return !!c.email; }).length,
        com_telefone: time.filter(function (c) { return !!c.phone; }).length,
        pessoas: time.map(function (c) {
          return {
            id: c.id, nome: c.nickname || c.name, nome_completo: c.name,
            area: c.area || '', modo: c.work_mode || '',
            email: c.email, phone: c.phone
          };
        }),
        presencial: time.filter(function (c) { return c.work_mode === 'presencial'; }).length,
        remoto: time.filter(function (c) { return c.work_mode === 'remoto'; }).length,
        hibrido: time.filter(function (c) { return c.work_mode === 'hibrido'; }).length,
        sem_modo: time.filter(function (c) { return !c.work_mode; }).length,
        historico: historico,
        providers: send.providerStatus()
      });
    }

    // Monta o texto final de cada canal, sem enviar nada.
    if (action === 'broadcast_preview') {
      const body = await u.readBody(req);
      const titulo = String(body.title || '').trim();
      const texto = String(body.message || '').trim();
      if (!titulo) return u.fail(res, 400, 'Escreva um título para o aviso.');
      if (!texto) return u.fail(res, 400, 'Escreva a mensagem.');
      return u.ok(res, { itens: montaAviso(titulo, texto, body.channels || []) });
    }

    // A imagem do aviso sobe ANTES do envio, uma vez só, para um balde
    // público — e a mesma URL vai para todo mundo. Subir uma vez em vez
    // de anexar pessoa a pessoa: 30 colaboradores, 1 upload.
    if (action === 'aviso_imagem') {
      if (req.method !== 'POST') return u.fail(res, 405, 'Metodo nao permitido');
      const body = await u.readBody(req);

      const tipo = String(body.tipo || '');
      const permitidos = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
      if (!permitidos[tipo]) return u.fail(res, 400, 'Use uma imagem JPG, PNG, WebP ou GIF.');

      let bytes;
      try { bytes = Buffer.from(String(body.arquivo || ''), 'base64'); }
      catch (e) { return u.fail(res, 400, 'Nao consegui ler a imagem.'); }
      if (!bytes.length) return u.fail(res, 400, 'A imagem veio vazia.');
      if (bytes.length > 8 * 1024 * 1024) return u.fail(res, 400, 'A imagem passou de 8 MB.');

      const caminho = 'aviso-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + permitidos[tipo];
      await db.subirArquivo('avisos', caminho, bytes, tipo);
      return u.ok(res, { url: db.urlPublica('avisos', caminho) });
    }

    if (action === 'broadcast_send') {
      const body = await u.readBody(req);
      const titulo = String(body.title || '').trim();
      const texto = String(body.message || '').trim();
      const canais = (body.channels || []).filter(function (c) {
        return ['email', 'whatsapp', 'sms'].indexOf(c) >= 0;
      });
      if (!titulo) return u.fail(res, 400, 'Escreva um título para o aviso.');
      if (!texto) return u.fail(res, 400, 'Escreva a mensagem.');
      if (!canais.length) return u.fail(res, 400, 'Escolha pelo menos um canal.');

      // A imagem (opcional) já subiu pela acao aviso_imagem. So aceitamos
      // endereco do NOSSO balde de avisos — URL de fora poderia fazer o
      // sistema espalhar qualquer coisa em nome da Start.
      const imagem = String(body.image_url || '').trim();
      if (imagem && imagem.indexOf(db.urlPublica('avisos', '')) !== 0) {
        return u.fail(res, 400, 'Essa imagem nao veio do painel. Anexe de novo.');
      }

      let time = await db.select('collaborators', { active: 'is.true', order: 'name.asc', select: '*' });
      if (Array.isArray(body.ids) && body.ids.length) {
        time = time.filter(function (c) { return body.ids.indexOf(c.id) >= 0; });
      }
      if (!time.length) return u.fail(res, 400, 'Não há ninguém no time para receber.');

      const waInstance = (await getSetting('whatsapp', {}) || {}).instance || process.env.EVOLUTION_INSTANCE;
      const modelos = montaAviso(titulo, texto, canais);
      const porCanal = {};
      modelos.forEach(function (m) { porCanal[m.channel] = m; });

      let enviados = 0, falhas = 0;
      const detalhe = [];

      for (const pessoa of time) {
        const vars = {
          nome: pessoa.name,
          primeiro_nome: pessoa.nickname || u.firstName(pessoa.name),
          email: pessoa.email, telefone: pessoa.phone || '',
          cargo: pessoa.role_title || '', area: pessoa.area || '', cidade: pessoa.city || ''
        };
        for (const canal of canais) {
          const modelo = porCanal[canal];
          if (!modelo) continue;
          const corpo = u.renderTemplate(modelo.body, vars);
          const assunto = modelo.subject ? u.renderTemplate(modelo.subject, vars) : null;

          let r;
          if (canal === 'email') {
            if (!pessoa.email) { r = { status: 'erro', provider: 'nenhum', error: 'sem e-mail cadastrado' }; }
            else {
              // com imagem, o e-mail sai com a foto no corpo, acima do texto
              const html = imagem
                ? '<img src="' + imagem + '" alt="" style="max-width:100%;border-radius:12px;margin-bottom:16px">' +
                  u.textToEmailHtml(corpo, assunto)
                : undefined;
              r = await send.sendEmail({ to: pessoa.email, subject: assunto, text: corpo, html: html });
            }
          } else if (canal === 'whatsapp') {
            if (!pessoa.phone) { r = { status: 'erro', provider: 'nenhum', error: 'sem telefone cadastrado' }; }
            else if (imagem) {
              // a foto com o aviso inteiro de legenda — uma mensagem so
              r = await send.sendWhatsAppImagem({ to: pessoa.phone, url: imagem, caption: corpo, instance: waInstance });
            }
            else r = await send.sendWhatsApp({ to: pessoa.phone, text: corpo, instance: waInstance });
          } else {
            if (!pessoa.phone) { r = { status: 'erro', provider: 'nenhum', error: 'sem telefone cadastrado' }; }
            else r = await send.sendSms({ to: pessoa.phone, text: corpo });
          }

          if (r.status === 'enviado') enviados++; else falhas++;
          detalhe.push({
            pessoa: pessoa.nickname || pessoa.name, canal: canal,
            status: r.status, erro: r.error || null
          });

          await db.insert('message_logs', {
            candidate_id: null, channel: canal,
            to_address: canal === 'email' ? pessoa.email : pessoa.phone,
            subject: assunto, body: corpo,
            status: r.status, provider: r.provider, error: r.error || null
          });
        }
      }

      const registro = await db.insert('broadcasts', {
        title: titulo, body: texto, channels: canais,
        total: time.length, sent: enviados, failed: falhas,
        detail: { itens: detalhe.slice(0, 400), imagem: imagem || null }
      });

      return u.ok(res, {
        id: registro && registro.id, pessoas: time.length,
        enviados: enviados, falhas: falhas, detalhe: detalhe
      });
    }

    // Manda um SMS de teste para conferir a integracao com a Comtele.
    if (action === 'sms_teste') {
      const body = await u.readBody(req);
      const fone = String(body.phone || '').trim();
      if (!fone) return u.fail(res, 400, 'Coloque um número com DDD.');

      const texto = body.text || 'StartDigital: teste do sistema de RH. Se voce recebeu, o SMS esta funcionando.';
      const r = await send.sendSms({ to: fone, text: texto });

      await db.insert('message_logs', {
        candidate_id: null, channel: 'sms', to_address: fone,
        subject: null, body: 'teste de sms', status: r.status, provider: r.provider, error: r.error || null
      });

      if (r.status !== 'enviado') return u.fail(res, 400, r.error || 'Não foi enviado.');
      return u.ok(res, {
        numero: r.numero || null,
        rota: r.rota || null,
        rota_nome: r.rota_nome || null,
        provider: r.provider,
        caracteres: texto.length,
        creditos: Math.max(1, Math.ceil(texto.length <= 160 ? 1 : texto.length / 153))
      });
    }

    // O que a Comtele diz sobre a ENTREGA de cada SMS (nao so o envio).
    if (action === 'sms_entregas') {
      const r = await send.comteleEntregas({ dias: params.dias, limite: params.limite });
      if (!r.ok) return u.fail(res, 400, r.error);
      const saldo = await send.comteleSaldo();
      return u.ok(res, {
        desde: r.desde,
        mensagens: r.mensagens,
        saldo: saldo.ok ? saldo.saldo : null,
        saldo_erro: saldo.ok ? null : saldo.error
      });
    }

    // Lista as rotas de envio disponiveis na conta da Comtele.
    if (action === 'sms_rotas') {
      const r = await send.comteleRotas();
      if (!r.ok) return u.fail(res, 400, r.error);
      const escolhida = await send.comteleRotaEscolhida();
      return u.ok(res, { rotas: r.rotas, escolhida: escolhida.ok ? escolhida.id : null });
    }

    // Diagnostico completo do WhatsApp de um candidato:
    // numero normalizado -> existe no WhatsApp? -> consegue enviar com link?
    if (action === 'wa_diagnostico') {
      const body = await u.readBody(req);
      const nome = (await getSetting('whatsapp', {}) || {}).instance || process.env.EVOLUTION_INSTANCE;
      const passos = [];

      const estado = await send.waEstado(nome);
      passos.push({
        passo: 'Instância conectada',
        ok: !!estado.conectada,
        detalhe: estado.estado || estado.error || '—'
      });

      let telefone = body.phone || '';
      let cand = null;
      if (body.candidate_id) {
        cand = await db.selectOne('candidates', { id: 'eq.' + body.candidate_id, select: '*' });
        if (cand) telefone = cand.phone;
      }
      const numero = u.normalizePhone(telefone);
      passos.push({
        passo: 'Número montado',
        ok: numero.length >= 12,
        detalhe: (telefone || '—') + '  →  ' + (numero || '—')
      });

      const existe = await send.waNumeroExiste(telefone, nome);
      passos.push({
        passo: 'Número tem WhatsApp',
        ok: existe.ok && existe.existe === true,
        detalhe: existe.ok ? (existe.existe ? 'sim' : 'NÃO — esse número não tem WhatsApp') : (existe.error || 'não deu para checar')
      });

      // O endereco real da conta no WhatsApp. No Brasil ele as vezes vem SEM o
      // nono digito — e mandar para o numero errado faz a mensagem sumir.
      const jidDigitos = existe.jid ? String(existe.jid).split('@')[0].replace(/\D/g, '') : '';
      passos.push({
        passo: 'Endereço real no WhatsApp',
        ok: !!jidDigitos,
        detalhe: !jidDigitos
          ? 'não foi possível descobrir'
          : (jidDigitos === numero
              ? jidDigitos + ' (igual ao número montado)'
              : jidDigitos + '  ⚠️ DIFERENTE do montado (' + numero + ') — o sistema vai usar este')
      });

      // Quem esta conectado. Se for o mesmo numero do destino, a mensagem cai
      // na conversa "Mensagens para mim" e passa despercebida.
      const instancias = await send.listWhatsAppInstances();
      const minha = instancias.filter(function (i) { return i.name === nome; })[0] || {};
      const meuNumero = String(minha.number || '').replace(/\D/g, '');
      passos.push({
        passo: 'Não é envio para si mesmo',
        ok: !meuNumero || meuNumero.slice(-8) !== numero.slice(-8),
        detalhe: meuNumero
          ? (meuNumero.slice(-8) === numero.slice(-8)
              ? 'É O MESMO NÚMERO da instância — a mensagem cai em "Mensagens para mim"'
              : 'instância: ' + meuNumero)
          : 'número da instância desconhecido'
      });

      const links = cand ? u.candidateLinks(cand) : { link_disc: u.appUrl() + '/disc?t=TESTE' };
      const r1 = await send.sendWhatsApp({ to: telefone, text: 'Teste 1 de 2 (texto simples, sem link).', instance: nome });
      passos.push({
        passo: 'Envio sem link',
        ok: r1.status === 'enviado',
        detalhe: r1.error || ('enviado para ' + (r1.numero || '?') + (r1.estado ? ' · estado: ' + r1.estado : ''))
      });

      const r2 = await send.sendWhatsApp({ to: telefone, text: 'Teste 2 de 2 (com link). ' + links.link_disc, instance: nome });
      passos.push({
        passo: 'Envio com link',
        ok: r2.status === 'enviado',
        detalhe: r2.error || ('enviado para ' + (r2.numero || '?') + (r2.estado ? ' · estado: ' + r2.estado : ''))
      });

      await db.insert('message_logs', {
        candidate_id: cand ? cand.id : null, channel: 'whatsapp', to_address: telefone,
        subject: null, body: 'diagnostico', status: r2.status, provider: r2.provider, error: r2.error || null
      });

      return u.ok(res, { instancia: nome || null, passos: passos, link: links.link_disc, base: u.appUrl() });
    }

    return u.fail(res, 404, 'Acao desconhecida: ' + action);
  } catch (e) {
    console.error('[admin]', action, e);
    return u.fail(res, 500, e.message || 'Erro interno');
  }
};
