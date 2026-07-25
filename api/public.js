// ============================================================
// API PUBLICA — usada pelo candidato
// /api/public?action=...
// ============================================================
'use strict';

const db = require('./_lib/db');
const u = require('./_lib/util');
const disc = require('./_lib/disc');
const send = require('./_lib/send');

const CAMPOS_FORM = [
  'name', 'email', 'phone', 'cpf', 'birth_date', 'city', 'state', 'role_applied',
  'linkedin', 'instagram', 'salary_expectation', 'availability', 'has_computer',
  'internet_speed', 'experience', 'education', 'english_level', 'tools',
  'why_start', 'strengths', 'weaknesses'
];

async function getSetting(key, fallback) {
  const row = await db.selectOne('settings', { key: 'eq.' + key, select: 'key,value' });
  return row ? row.value : fallback;
}

async function candidateByToken(token) {
  if (!token) return null;
  return db.selectOne('candidates', { token: 'eq.' + token, select: '*' });
}

module.exports = async function handler(req, res) {
  const action = (req.query && req.query.action) ||
    new URL(req.url, 'http://x').searchParams.get('action') || '';
  const q = (req.query && Object.keys(req.query).length)
    ? req.query
    : Object.fromEntries(new URL(req.url, 'http://x').searchParams.entries());

  try {
    // ---------------------------------------------------- config do formulario
    if (action === 'config') {
      const form = await getSetting('form', {});
      const company = await getSetting('company', {});
      return u.ok(res, { form: form, company: company });
    }

    // ---------------------------------------------------- enviar candidatura
    if (action === 'apply') {
      if (req.method !== 'POST') return u.fail(res, 405, 'Metodo nao permitido');
      const body = await u.readBody(req);

      const form = await getSetting('form', {});
      if (form && form.open === false) {
        return u.fail(res, 403, 'As inscricoes estao encerradas neste momento.');
      }

      const nome = String(body.name || '').trim();
      const email = String(body.email || '').trim().toLowerCase();
      const phone = String(body.phone || '').trim();

      if (nome.length < 3) return u.fail(res, 400, 'Informe seu nome completo.');
      if (!u.isEmail(email)) return u.fail(res, 400, 'Informe um e-mail valido.');
      if (u.normalizePhone(phone).length < 12) return u.fail(res, 400, 'Informe um WhatsApp valido com DDD.');

      const existente = await db.selectOne('candidates', {
        email: 'eq.' + email, archived: 'eq.false', select: 'id,name,created_at'
      });
      if (existente) {
        return u.fail(res, 409, 'Ja recebemos uma candidatura com este e-mail. Se precisar atualizar alguma informacao, responda o e-mail de confirmacao que enviamos.');
      }

      const row = { token: u.candidateToken(), stage_key: 'inscrito', source: 'formulario' };
      CAMPOS_FORM.forEach(function (c) {
        if (body[c] !== undefined && body[c] !== null) {
          row[c] = c === 'email' ? email : String(body[c]).trim().slice(0, 4000);
        }
      });
      row.email = email;
      row.name = nome;
      row.phone = phone;
      if (body.extra && typeof body.extra === 'object') row.extra = body.extra;

      const cand = await db.insert('candidates', row);
      await db.insert('stage_history', {
        candidate_id: cand.id, from_stage: null, to_stage: 'inscrito',
        note: 'Formulario recebido'
      });

      // confirmacao automatica por e-mail (se o Resend estiver configurado)
      const company = await getSetting('company', {});
      const tpl = await db.selectOne('message_templates', { key: 'eq.application_received_email', select: '*' });
      if (tpl) {
        const vars = u.templateVars(cand, company);
        const subject = u.renderTemplate(tpl.subject, vars);
        const text = u.renderTemplate(tpl.body, vars);
        const r = await send.sendEmail({ to: cand.email, subject: subject, text: text });
        await db.insert('message_logs', {
          candidate_id: cand.id, channel: 'email', to_address: cand.email,
          subject: subject, body: text, status: r.status, provider: r.provider, error: r.error || null
        });
      }

      return u.ok(res, { message: 'Candidatura recebida com sucesso!', id: cand.id });
    }

    // ---------------------------------------------------- dados do candidato
    if (action === 'me') {
      const cand = await candidateByToken(q.t);
      if (!cand) return u.fail(res, 404, 'Link invalido ou expirado.');
      const discRow = await db.selectOne('disc_results', { candidate_id: 'eq.' + cand.id, select: 'id' });
      const attempt = await db.selectOne('quiz_attempts', {
        candidate_id: 'eq.' + cand.id, finished_at: 'not.is.null', select: 'id'
      });
      const stage = await db.selectOne('stages', { key: 'eq.' + cand.stage_key, select: '*' });
      return u.ok(res, {
        candidate: {
          name: cand.name, first_name: u.firstName(cand.name), email: cand.email,
          role_applied: cand.role_applied, stage_key: cand.stage_key,
          stage_name: stage ? stage.name : cand.stage_key,
          member_access: cand.member_access
        },
        disc_done: !!discRow,
        quiz_done: !!attempt
      });
    }

    // ---------------------------------------------------- DISC
    if (action === 'disc_questions') {
      const cand = await candidateByToken(q.t);
      if (!cand) return u.fail(res, 404, 'Link invalido ou expirado.');
      const existente = await db.selectOne('disc_results', { candidate_id: 'eq.' + cand.id, select: 'id,created_at' });
      const questions = await db.select('disc_questions', {
        active: 'eq.true', order: 'position.asc', select: 'position,words'
      });
      return u.ok(res, {
        candidate: { first_name: u.firstName(cand.name), name: cand.name },
        already_done: !!existente,
        questions: questions
      });
    }

    if (action === 'disc_submit') {
      if (req.method !== 'POST') return u.fail(res, 405, 'Metodo nao permitido');
      const body = await u.readBody(req);
      const cand = await candidateByToken(body.t);
      if (!cand) return u.fail(res, 404, 'Link invalido ou expirado.');

      const questions = await db.select('disc_questions', { active: 'eq.true', order: 'position.asc', select: 'position,words' });
      const answers = body.answers || {};
      const result = disc.score(answers, questions);
      if (result.answered < questions.length) {
        return u.fail(res, 400, 'Responda todos os ' + questions.length + ' grupos antes de enviar.');
      }

      await db.remove('disc_results', { candidate_id: 'eq.' + cand.id });
      await db.insert('disc_results', {
        candidate_id: cand.id,
        answers: answers,
        d_score: result.net.D, i_score: result.net.I, s_score: result.net.S, c_score: result.net.C,
        d_more: result.more.D, i_more: result.more.I, s_more: result.more.S, c_more: result.more.C,
        d_less: result.less.D, i_less: result.less.I, s_less: result.less.S, c_less: result.less.C,
        primary_profile: result.primary, secondary_profile: result.secondary,
        summary: result.summary
      });
      await db.insert('stage_history', {
        candidate_id: cand.id, from_stage: cand.stage_key, to_stage: cand.stage_key,
        note: 'Teste DISC respondido — perfil ' + result.primary + '/' + result.secondary
      });
      await db.update('candidates', { updated_at: new Date().toISOString() }, { id: 'eq.' + cand.id });

      return u.ok(res, { message: 'Teste enviado com sucesso!' });
    }

    // ---------------------------------------------------- QUIZ
    if (action === 'quiz_get') {
      const cand = await candidateByToken(q.t);
      if (!cand) return u.fail(res, 404, 'Link invalido ou expirado.');
      const quiz = await db.selectOne('quizzes', { active: 'eq.true', order: 'created_at.desc', select: '*' });
      if (!quiz) return u.fail(res, 404, 'Nenhum quiz ativo no momento.');
      const finished = await db.selectOne('quiz_attempts', {
        candidate_id: 'eq.' + cand.id, quiz_id: 'eq.' + quiz.id, finished_at: 'not.is.null', select: 'id,percent'
      });
      const questions = await db.select('quiz_questions', {
        quiz_id: 'eq.' + quiz.id, order: 'position.asc', select: 'id,position,kind,prompt,options,points'
      });
      return u.ok(res, {
        candidate: { first_name: u.firstName(cand.name), name: cand.name },
        quiz: { id: quiz.id, title: quiz.title, description: quiz.description, time_limit_min: quiz.time_limit_min },
        already_done: !!finished,
        questions: questions
      });
    }

    if (action === 'quiz_start') {
      if (req.method !== 'POST') return u.fail(res, 405, 'Metodo nao permitido');
      const body = await u.readBody(req);
      const cand = await candidateByToken(body.t);
      if (!cand) return u.fail(res, 404, 'Link invalido ou expirado.');
      const quiz = await db.selectOne('quizzes', { active: 'eq.true', order: 'created_at.desc', select: 'id' });
      if (!quiz) return u.fail(res, 404, 'Nenhum quiz ativo.');
      const finished = await db.selectOne('quiz_attempts', {
        candidate_id: 'eq.' + cand.id, quiz_id: 'eq.' + quiz.id, finished_at: 'not.is.null', select: 'id'
      });
      if (finished) return u.fail(res, 409, 'Este quiz ja foi respondido.');
      let attempt = await db.selectOne('quiz_attempts', {
        candidate_id: 'eq.' + cand.id, quiz_id: 'eq.' + quiz.id, finished_at: 'is.null', select: '*'
      });
      if (!attempt) {
        attempt = await db.insert('quiz_attempts', { candidate_id: cand.id, quiz_id: quiz.id });
      }
      return u.ok(res, { attempt_id: attempt.id, started_at: attempt.started_at });
    }

    if (action === 'quiz_submit') {
      if (req.method !== 'POST') return u.fail(res, 405, 'Metodo nao permitido');
      const body = await u.readBody(req);
      const cand = await candidateByToken(body.t);
      if (!cand) return u.fail(res, 404, 'Link invalido ou expirado.');
      const quiz = await db.selectOne('quizzes', { active: 'eq.true', order: 'created_at.desc', select: '*' });
      if (!quiz) return u.fail(res, 404, 'Nenhum quiz ativo.');

      const questions = await db.select('quiz_questions', {
        quiz_id: 'eq.' + quiz.id, order: 'position.asc', select: '*'
      });
      const answers = body.answers || {};

      let score = 0, max = 0, pendentes = 0;
      questions.forEach(function (qq) {
        const correct = Array.isArray(qq.correct) ? qq.correct : [];
        if (!correct.length) { pendentes += 1; return; }  // questao aberta -> correcao manual
        max += qq.points || 1;
        const given = answers[qq.id];
        const arr = Array.isArray(given) ? given : (given ? [given] : []);
        const acertou = arr.length === correct.length && correct.every(function (c) { return arr.indexOf(c) >= 0; });
        if (acertou) score += qq.points || 1;
      });
      const percent = max > 0 ? Math.round((score / max) * 100) : null;

      const flags = [];
      const focusLost = parseInt(body.focus_lost || 0, 10) || 0;
      const pasteBlocked = parseInt(body.paste_blocked || 0, 10) || 0;
      if (focusLost >= 1) flags.push('Saiu da aba ' + focusLost + 'x durante a prova');
      if (pasteBlocked >= 1) flags.push('Tentou colar texto ' + pasteBlocked + 'x');
      if (body.devtools) flags.push('Abriu ferramentas do navegador');

      const patch = {
        answers: answers,
        score: score, max_score: max, percent: percent,
        passed: percent === null ? null : percent >= (quiz.pass_score || 70),
        focus_lost: focusLost, paste_blocked: pasteBlocked,
        integrity_flags: flags,
        finished_at: new Date().toISOString()
      };

      let attempt = null;
      if (body.attempt_id) {
        attempt = await db.update('quiz_attempts', patch, { id: 'eq.' + body.attempt_id, candidate_id: 'eq.' + cand.id });
      }
      if (!attempt) {
        attempt = await db.insert('quiz_attempts', Object.assign({ candidate_id: cand.id, quiz_id: quiz.id }, patch));
      }

      await db.insert('stage_history', {
        candidate_id: cand.id, from_stage: cand.stage_key, to_stage: cand.stage_key,
        note: 'Quiz respondido — ' + (percent === null ? 'aguardando correcao' : percent + '%') +
              (pendentes ? ' (' + pendentes + ' questao(oes) aberta(s) para correcao manual)' : '')
      });

      return u.ok(res, { message: 'Respostas enviadas!', pendentes: pendentes });
    }

    // ---------------------------------------------------- AREA DE MEMBROS
    if (action === 'portal') {
      const cand = await candidateByToken(q.t);
      if (!cand) return u.fail(res, 404, 'Link invalido ou expirado.');
      if (!cand.member_access) {
        return u.fail(res, 403, 'Sua area de integracao ainda nao foi liberada. Fique de olho no seu e-mail e WhatsApp.');
      }
      const company = await getSetting('company', {});
      const modules = await db.select('modules', { published: 'eq.true', order: 'position.asc', select: '*' });
      const lessons = await db.select('lessons', { published: 'eq.true', order: 'position.asc', select: '*' });
      const progress = await db.select('lesson_progress', { candidate_id: 'eq.' + cand.id, select: 'lesson_id,completed' });
      const done = {};
      progress.forEach(function (p) { if (p.completed) done[p.lesson_id] = true; });

      const tree = modules.map(function (m) {
        return Object.assign({}, m, {
          lessons: lessons
            .filter(function (l) { return l.module_id === m.id; })
            .map(function (l) { return Object.assign({}, l, { done: !!done[l.id] }); })
        });
      });
      return u.ok(res, {
        candidate: {
          name: cand.name, first_name: u.firstName(cand.name), role_applied: cand.role_applied
        },
        company: company,
        modules: tree
      });
    }

    if (action === 'lesson_done') {
      if (req.method !== 'POST') return u.fail(res, 405, 'Metodo nao permitido');
      const body = await u.readBody(req);
      const cand = await candidateByToken(body.t);
      if (!cand || !cand.member_access) return u.fail(res, 403, 'Acesso nao liberado.');
      if (!body.lesson_id) return u.fail(res, 400, 'Aula nao informada.');
      if (body.completed === false) {
        await db.remove('lesson_progress', { candidate_id: 'eq.' + cand.id, lesson_id: 'eq.' + body.lesson_id });
      } else {
        await db.upsert('lesson_progress', {
          candidate_id: cand.id, lesson_id: body.lesson_id, completed: true,
          completed_at: new Date().toISOString()
        }, 'candidate_id,lesson_id');
      }
      return u.ok(res, {});
    }

    return u.fail(res, 404, 'Acao desconhecida: ' + action);
  } catch (e) {
    console.error('[public]', action, e);
    return u.fail(res, 500, e.message || 'Erro interno');
  }
};
