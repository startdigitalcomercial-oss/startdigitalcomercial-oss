// Teste do fluxo completo contra o espelho local. Uso: node tools/test-fluxo.js
'use strict';
const BASE = 'http://localhost:3000';
let TOKEN_ADMIN = '';
const SUFIXO = Date.now().toString(36);
let falhas = 0, ok = 0;

function check(nome, cond, extra) {
  if (cond) { ok++; console.log('  ok   ' + nome); }
  else { falhas++; console.log('  FALHA ' + nome + (extra ? '  → ' + JSON.stringify(extra) : '')); }
}

async function pub(action, body, query) {
  const qs = new URLSearchParams(Object.assign({ action: action }, query || {}));
  const r = await fetch(BASE + '/api/public?' + qs, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  return r.json();
}
async function adm(action, body, query) {
  const qs = new URLSearchParams(Object.assign({ action: action }, query || {}));
  const r = await fetch(BASE + '/api/admin?' + qs, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN_ADMIN },
    body: body ? JSON.stringify(body) : undefined
  });
  return r.json();
}

(async function () {
  console.log('\n1) FORMULARIO PUBLICO');
  const cfg = await pub('config');
  check('config carrega', cfg.ok && cfg.form.roles.length > 0);

  const ruim = await pub('apply', { name: 'Ab', email: 'x', phone: '1' });
  check('rejeita formulario invalido', !ruim.ok, ruim.error);

  const cand = await pub('apply', {
    name: 'Maria Aparecida Souza', email: 'maria.' + SUFIXO + '@exemplo.com', phone: '(11) 9' + String(Date.now()).slice(-8),
    city: 'São Paulo', state: 'SP', role_applied: 'Social Media',
    salary_expectation: 'R$ 2.500', availability: 'Imediata',
    has_computer: 'Sim, notebook', internet_speed: 'Fibra estável, acima de 100 Mbps',
    experience: 'Dois anos como social media em agencia, cuidando de 8 contas.',
    education: 'Publicidade — UNIP', english_level: 'Intermediário',
    tools: 'Meta Ads, Canva, CapCut, Notion',
    why_start: 'Quero crescer em uma agencia que trabalha com processo e dados.',
    strengths: 'Organizacao, escrita e ritmo', weaknesses: 'Falar em publico',
    extra: { onde_conheceu: 'Instagram' }
  });
  check('cria candidato', cand.ok && cand.id, cand);

  const dup = await pub('apply', { name: 'Maria Aparecida Souza', email: 'maria.' + SUFIXO + '@exemplo.com', phone: '(11) 9' + String(Date.now()).slice(-8), experience: 'x', why_start: 'y', role_applied: 'Social Media' });
  check('bloqueia e-mail duplicado', !dup.ok && /Ja recebemos/.test(dup.error || ''), dup.error);

  console.log('\n2) PAINEL');
  const login = await (await fetch(BASE + '/api/admin?action=login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'Start-RH-ioZSqXbN' })
  })).json();
  TOKEN_ADMIN = login.token;
  check('login do painel', login.ok && !!login.token);

  const semAuth = await (await fetch(BASE + '/api/admin?action=board')).json();
  check('bloqueia acesso sem login', !semAuth.ok);

  const board = await adm('board');
  check('quadro tem 5 etapas', board.ok && board.stages.length === 5, board.stages && board.stages.length);
  check('candidato aparece em "triagem"', board.candidates.some(function (c) { return c.id === cand.id && c.stage_key === 'triagem'; }));

  const ficha = await adm('candidate', null, { id: cand.id });
  check('ficha carrega com links', ficha.ok && /portal\?t=/.test(ficha.links.link_portal), ficha.links);
  const tk = ficha.links.link_portal.split('t=')[1];

  const mv = await adm('move', { id: cand.id, stage_key: 'teste' });
  check('move de etapa', mv.ok);
  const board2 = await adm('board');
  check('etapa persistiu', board2.candidates.find(function (c) { return c.id === cand.id; }).stage_key === 'teste');

  console.log('\n3) TESTE DISC');
  const dq = await pub('disc_questions', null, { t: tk });
  check('24 grupos de palavras', dq.ok && dq.questions.length === 24, dq.questions && dq.questions.length);

  const parcial = {};
  parcial['1'] = { more: 'D', less: 'S' };
  const ruimDisc = await pub('disc_submit', { t: tk, answers: parcial });
  check('exige todos os grupos', !ruimDisc.ok, ruimDisc.error);

  const respostas = {};
  dq.questions.forEach(function (q, i) {
    // perfil proposital: I predominante, C menos
    respostas[q.position] = { more: i % 3 === 0 ? 'D' : 'I', less: 'C' };
  });
  const envio = await pub('disc_submit', { t: tk, answers: respostas });
  check('envia DISC', envio.ok, envio.error);

  const dupDisc = await pub('disc_questions', null, { t: tk });
  check('marca DISC como respondido', dupDisc.already_done === true);

  const ficha2 = await adm('candidate', null, { id: cand.id });
  check('perfil calculado = I', ficha2.disc && ficha2.disc.primary_profile === 'I', ficha2.disc && ficha2.disc.primary_profile);
  check('percentuais somam ~100', ficha2.disc && Math.abs(['D', 'I', 'S', 'C'].reduce(function (s, L) { return s + ficha2.disc.computed.percent[L]; }, 0) - 100) <= 2);
  check('texto do perfil vem preenchido', !!(ficha2.disc && ficha2.disc.summary && ficha2.disc.summary.length > 40));

  console.log('\n4) QUIZ');
  const qz = await pub('quiz_get', null, { t: tk });
  check('quiz carrega 5 questoes', qz.ok && qz.questions.length === 5);
  check('nao expoe as respostas certas', qz.ok && qz.questions.every(function (q) { return q.correct === undefined; }));

  const st = await pub('quiz_start', { t: tk });
  check('inicia tentativa', st.ok && !!st.attempt_id);

  const objetivas = qz.questions.filter(function (q) { return q.kind !== 'text'; });
  const answers = {};
  answers[objetivas[0].id] = ['b'];
  answers[objetivas[1].id] = ['b'];
  answers[objetivas[2].id] = ['a', 'c', 'd'];
  answers[objetivas[3].id] = ['a'];  // erra de proposito
  answers[qz.questions.find(function (q) { return q.kind === 'text'; }).id] = 'Porque gosto de processo, dados e time que cobra resultado.';
  const sub = await pub('quiz_submit', { t: tk, answers: answers, attempt_id: st.attempt_id, focus_lost: 2, paste_blocked: 1 });
  check('envia quiz', sub.ok, sub.error);
  check('conta questao aberta como pendente', sub.pendentes === 1, sub.pendentes);

  const ficha3 = await adm('candidate', null, { id: cand.id });
  const at = ficha3.attempts[0];
  check('nota automatica = 4/5 = 80%', at && at.percent === 80, at && { score: at.score, max: at.max_score, pct: at.percent });
  check('aprovado na nota de corte', at && at.passed === true);
  check('registra alertas de integridade', at && at.integrity_flags.length === 2, at && at.integrity_flags);
  check('nao permite refazer', (await pub('quiz_start', { t: tk })).ok === false);

  const nota = await adm('grade_attempt', { attempt_id: at.id, percent: 90, passed: true });
  check('correcao manual salva', nota.ok && Number(nota.attempt.percent) === 90);

  console.log('\n5) PORTAL BLOQUEADO');
  const p1 = await pub('portal', null, { t: tk });
  check('portal fechado antes da liberacao', !p1.ok && /nao foi liberada/.test(p1.error || ''), p1.error);

  console.log('\n6) BOAS-VINDAS (3 canais)');
  const prev = await adm('preview', { candidate_id: cand.id, set: 'welcome' });
  check('gera 3 mensagens', prev.ok && prev.items.length === 3, prev.items && prev.items.length);
  check('troca as variaveis', prev.ok && prev.items[0].body.indexOf('Maria') >= 0 && prev.items[0].body.indexOf('{{') < 0);
  check('inclui o link de criar senha', prev.ok && prev.items[0].body.indexOf('/criar-senha?t=') >= 0, prev.items && prev.items[0].body.slice(0, 120));

  const envio2 = await adm('send', { candidate_id: cand.id, set: 'welcome', items: prev.items });
  check('envio registra os 3 canais', envio2.ok && envio2.results.length === 3, envio2.results);
  check('sem provedor -> nao quebra', envio2.ok && envio2.results.every(function (r) { return ['enviado', 'erro', 'pendente_manual'].indexOf(r.status) >= 0; }), envio2.results);

  const board3 = await adm('board');
  const cb = board3.candidates.find(function (c) { return c.id === cand.id; });
  check('boas-vindas move para "concluido"', cb.stage_key === 'concluido', cb.stage_key);
  check('boas-vindas libera a integracao', cb.member_access === true);

  console.log('\n7) AREA DE MEMBROS');
  const p2 = await pub('portal', null, { t: tk });
  check('portal abre', p2.ok);
  check('2 modulos e 4 aulas', p2.ok && p2.modules.length === 2 && p2.modules.reduce(function (s, m) { return s + m.lessons.length; }, 0) === 4);
  const aula = p2.modules[0].lessons[0];
  check('aula traz video e material', !!aula.video_url && aula.materials.length === 1);
  const done = await pub('lesson_done', { t: tk, lesson_id: aula.id, completed: true });
  check('marca aula concluida', done.ok);
  const p3 = await pub('portal', null, { t: tk });
  check('progresso persiste', p3.modules[0].lessons[0].done === true);
  const undone = await pub('lesson_done', { t: tk, lesson_id: aula.id, completed: false });
  const p4 = await pub('portal', null, { t: tk });
  check('desmarcar funciona', undone.ok && p4.modules[0].lessons[0].done === false);

  console.log('\n8) TOKEN INVALIDO');
  check('portal recusa token errado', (await pub('portal', null, { t: 'xxxxxx' })).ok === false);
  check('disc recusa token errado', (await pub('disc_questions', null, { t: 'xxxxxx' })).ok === false);
  check('quiz recusa token errado', (await pub('quiz_get', null, { t: 'xxxxxx' })).ok === false);

  console.log('\n9) GESTAO DE AULAS');
  const novoMod = await adm('module_save', { title: 'Módulo 3 — Ferramentas' });
  check('cria modulo', novoMod.ok && !!novoMod.module.id);
  const novaAula = await adm('lesson_save', {
    module_id: novoMod.module.id, title: 'Aula 5 — Notion na pratica',
    video_url: 'https://youtu.be/abc123XYZ', duration: '8 min',
    materials: [{ label: 'Template do Notion', url: 'https://exemplo.com/t.zip' }]
  });
  check('cria aula com material', novaAula.ok && novaAula.lesson.materials.length === 1);
  const cont = await adm('content');
  check('conteudo lista 3 modulos', cont.ok && cont.modules.length === 3);
  check('exclui aula', (await adm('lesson_delete', { id: novaAula.lesson.id })).ok);
  check('exclui modulo', (await adm('module_delete', { id: novoMod.module.id })).ok);

  console.log('\n10) QUIZ E TEMPLATES E AJUSTES');
  const qa = await adm('quiz_admin');
  check('editor do quiz carrega', qa.ok && qa.quizzes[0].questions.length === 5);
  const nq = await adm('question_save', { quiz_id: qa.quizzes[0].id, prompt: 'Nova?', kind: 'single', options: [{ id: 'a', text: 'Sim' }, { id: 'b', text: 'Não' }], correct: ['a'] });
  check('cria questao', nq.ok);
  check('exclui questao', (await adm('question_delete', { id: nq.question.id })).ok);
  const tpls = await adm('templates');
  check('12 modelos de mensagem', tpls.ok && tpls.templates.length === 12, tpls.templates && tpls.templates.length);
  const salvo = await adm('template_save', { key: 'welcome_sms', body: 'Texto novo {{primeiro_nome}}' });
  check('salva modelo', salvo.ok && salvo.template.body.indexOf('Texto novo') === 0);
  const stg = await adm('settings');
  check('ajustes carregam', stg.ok && !!stg.form.headline);
  check('salva ajustes do formulario', (await adm('settings_save', { key: 'form', value: Object.assign({}, stg.form, { headline: 'Venha para a Start' }) })).ok);
  check('formulario publico reflete o ajuste', (await pub('config')).form.headline === 'Venha para a Start');
  const lg = await adm('logs');
  check('log de envios registrado', lg.ok && lg.logs.length >= 3, lg.logs && lg.logs.length);

  console.log('\n11) ARQUIVAR / EXCLUIR');
  check('arquiva', (await adm('update_candidate', { id: cand.id, archived: true })).ok);
  check('sai do quadro', (await adm('board')).candidates.every(function (c) { return c.id !== cand.id; }));
  check('aparece em arquivados', (await adm('archived')).candidates.some(function (c) { return c.id === cand.id; }));
  check('desarquiva', (await adm('update_candidate', { id: cand.id, archived: false })).ok);
  check('salva nota e anotacao', (await adm('update_candidate', { id: cand.id, rating: 4, notes: 'Boa entrevista.' })).ok);

  console.log('\n----------------------------------------');
  console.log(ok + ' passaram · ' + falhas + ' falharam');
  process.exit(falhas ? 1 : 0);
})();
