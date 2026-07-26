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

const SESSION_HOURS = 12;

const CONJUNTOS = {
  welcome: { email: 'welcome_email_senha', whatsapp: 'welcome_whatsapp', sms: 'welcome_sms' },
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
  u.setBaseFromReq(req);
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
      return u.ok(res, {
        configurada: send.evoPronta(),
        instancias: instancias,
        sobrando: sobrando,
        escolhida: escolhida,
        estado: estado,
        webhook_url: u.appUrl() + '/api/webhook?k=' + webhook.chaveWebhook()
      });
    }

    // pede um QR novo (o QR da Evolution vence em menos de 1 minuto)
    if (action === 'wa_qr') {
      const nome = params.instance || (await getSetting('whatsapp', {})).instance;
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
      const nome = params.instance || (await getSetting('whatsapp', {})).instance;
      if (!nome) return u.fail(res, 400, 'Nenhuma instância escolhida.');
      const r = await send.waEstado(nome);
      return r.ok ? u.ok(res, r) : u.fail(res, 400, r.error);
    }

    if (action === 'wa_webhook') {
      const body = await u.readBody(req);
      const nome = body.instance || (await getSetting('whatsapp', {})).instance;
      if (!nome) return u.fail(res, 400, 'Nenhuma instância escolhida.');
      const r = await send.waWebhook(nome, u.appUrl() + '/api/webhook?k=' + webhook.chaveWebhook());
      return r.ok ? u.ok(res, {}) : u.fail(res, 400, r.error);
    }

    if (action === 'wa_desconectar') {
      const body = await u.readBody(req);
      const nome = body.instance || (await getSetting('whatsapp', {})).instance;
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

      const links = cand ? u.candidateLinks(cand) : { link_disc: u.appUrl() + '/disc?t=TESTE' };
      const r1 = await send.sendWhatsApp({ to: telefone, text: 'Teste 1 de 2 (texto simples, sem link).', instance: nome });
      passos.push({ passo: 'Envio sem link', ok: r1.status === 'enviado', detalhe: r1.error || 'enviado' });

      const r2 = await send.sendWhatsApp({ to: telefone, text: 'Teste 2 de 2 (com link). ' + links.link_disc, instance: nome });
      passos.push({ passo: 'Envio com link', ok: r2.status === 'enviado', detalhe: r2.error || 'enviado' });

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
