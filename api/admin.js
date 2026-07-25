// ============================================================
// API DO PAINEL — usada pelo time da StartDigital
// /api/admin?action=...   (todas exigem login, menos "login")
// ============================================================
'use strict';

const db = require('./_lib/db');
const u = require('./_lib/util');
const disc = require('./_lib/disc');
const send = require('./_lib/send');

const SESSION_HOURS = 12;

const CONJUNTOS = {
  welcome: { email: 'welcome_email', whatsapp: 'welcome_whatsapp', sms: 'welcome_sms' },
  disc_invite: { email: 'disc_invite_email', whatsapp: 'disc_invite_whatsapp', sms: 'disc_invite_sms' },
  quiz_invite: { email: 'quiz_invite_email', whatsapp: 'quiz_invite_whatsapp', sms: 'quiz_invite_sms' },
  reject: { email: 'reject_email' }
};

async function getSetting(key, fallback) {
  const row = await db.selectOne('settings', { key: 'eq.' + key, select: 'key,value' });
  return row ? row.value : fallback;
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
  const params = (req.query && Object.keys(req.query).length)
    ? req.query
    : Object.fromEntries(new URL(req.url, 'http://x').searchParams.entries());
  const action = params.action || '';

  try {
    // ---------------------------------------------------- LOGIN
    if (action === 'login') {
      if (req.method !== 'POST') return u.fail(res, 405, 'Metodo nao permitido');
      const body = await u.readBody(req);
      const senha = String(body.password || '');
      const esperada = process.env.ADMIN_PASSWORD || process.env.ADMIN_SECRET || '';
      if (!esperada) return u.fail(res, 500, 'ADMIN_PASSWORD nao configurada na Vercel.');
      if (!senha || !u.safeEqual(senha, esperada)) {
        return u.fail(res, 401, 'Senha incorreta.');
      }
      const token = u.signSession({ role: 'admin', exp: Date.now() + SESSION_HOURS * 3600 * 1000 });
      return u.ok(res, { token: token, expires_in_hours: SESSION_HOURS });
    }

    // ---------------------------------------------------- daqui pra baixo exige login
    const session = u.requireAdmin(req, res);
    if (!session) return;

    // ---------------------------------------------------- QUADRO (KANBAN)
    if (action === 'board') {
      const stages = await db.select('stages', { order: 'position.asc', select: '*' });
      const candidates = await db.select('candidates', {
        archived: 'eq.false', order: 'created_at.desc',
        select: 'id,name,email,phone,role_applied,stage_key,rating,city,state,member_access,created_at,updated_at'
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

      return u.ok(res, {
        candidate: cand,
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
        if (cand.stage_key !== 'contratado') patch.stage_key = 'aprovado';
        await db.update('candidates', patch, { id: 'eq.' + cand.id });
        if (cand.stage_key !== 'aprovado' && cand.stage_key !== 'contratado') {
          await db.insert('stage_history', {
            candidate_id: cand.id, from_stage: cand.stage_key, to_stage: 'aprovado',
            note: 'Boas-vindas enviadas e area de integracao liberada'
          });
        }
      }
      if ((body.set) === 'reject') {
        await db.update('candidates', { stage_key: 'reprovado', updated_at: new Date().toISOString() }, { id: 'eq.' + cand.id });
        await db.insert('stage_history', {
          candidate_id: cand.id, from_stage: cand.stage_key, to_stage: 'reprovado', note: 'Retorno negativo enviado'
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
      const instances = await send.listWhatsAppInstances();
      return u.ok(res, {
        company: company, form: form, whatsapp: whatsapp,
        wa_instances: instances, providers: send.providerStatus(), app_url: u.appUrl()
      });
    }

    if (action === 'settings_save') {
      const body = await u.readBody(req);
      if (!body.key) return u.fail(res, 400, 'Chave nao informada.');
      const row = await db.upsert('settings', { key: body.key, value: body.value || {} }, 'key');
      return u.ok(res, { setting: row });
    }

    return u.fail(res, 404, 'Acao desconhecida: ' + action);
  } catch (e) {
    console.error('[admin]', action, e);
    return u.fail(res, 500, e.message || 'Erro interno');
  }
};
