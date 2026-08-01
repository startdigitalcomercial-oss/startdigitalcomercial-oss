// ============================================================
// Espelho local do Supabase (SO PARA TESTE) — imita a API REST
// (PostgREST) na parte que o sistema usa, com dados em memoria.
// Nao vai para producao. Uso: node tools/mock-supabase.js
// ============================================================
'use strict';

const http = require('http');
const crypto = require('crypto');

const uuid = function () { return crypto.randomUUID(); };
const agora = function () { return new Date().toISOString(); };

/* ---------------- dados iniciais (iguais aos do banco real) ---------------- */
const DISC_WORDS = [
  ['Decidido', 'Entusiasmado', 'Paciente', 'Preciso'],
  ['Ousado', 'Sociável', 'Calmo', 'Analítico'],
  ['Competitivo', 'Otimista', 'Leal', 'Cuidadoso'],
  ['Direto', 'Falante', 'Estável', 'Detalhista'],
  ['Determinado', 'Animado', 'Prestativo', 'Organizado'],
  ['Firme', 'Persuasivo', 'Tranquilo', 'Sistemático'],
  ['Assertivo', 'Expressivo', 'Compreensivo', 'Metódico'],
  ['Corajoso', 'Divertido', 'Constante', 'Perfeccionista'],
  ['Objetivo', 'Comunicativo', 'Gentil', 'Criterioso'],
  ['Exigente', 'Espontâneo', 'Acolhedor', 'Racional'],
  ['Focado em resultado', 'Popular', 'Bom ouvinte', 'Questionador'],
  ['Impaciente', 'Impulsivo', 'Conformado', 'Reservado'],
  ['Líder', 'Inspirador', 'Colaborador', 'Técnico'],
  ['Rápido', 'Alegre', 'Ponderado', 'Cauteloso'],
  ['Independente', 'Extrovertido', 'Cooperativo', 'Disciplinado'],
  ['Confrontador', 'Convincente', 'Diplomático', 'Formal'],
  ['Ambicioso', 'Carismático', 'Confiável', 'Exato'],
  ['Autoconfiante', 'Entrosado', 'Sereno', 'Lógico'],
  ['Direto ao ponto', 'Emotivo', 'Previsível', 'Reflexivo'],
  ['Controlador', 'Sonhador', 'Rotineiro', 'Crítico'],
  ['Pioneiro', 'Simpático', 'Tolerante', 'Consciencioso'],
  ['Vencedor', 'Brincalhão', 'Modesto', 'Rigoroso'],
  ['Enérgico', 'Aberto', 'Discreto', 'Meticuloso'],
  ['Realizador', 'Espirituoso', 'Harmonioso', 'Investigativo']
];

const QUIZ_ID = '33333333-3333-4333-8333-333333333333';
const MOD1 = '11111111-1111-4111-8111-111111111111';
const MOD2 = '22222222-2222-4222-8222-222222222222';

const DB = {
  stages: [
    ['triagem', 'Triagem', '#0ea5e9', 1, 'normal'],
    ['entrevista', 'Entrevista', '#8b5cf6', 2, 'normal'],
    ['teste', 'Teste', '#f59e0b', 3, 'normal'],
    ['concluido', 'Concluído', '#00a15c', 4, 'hired'],
    ['nao_seguiu', 'Não seguiu', '#8e8e93', 5, 'rejected']
  ].map(function (r, i) { return { id: i + 1, key: r[0], name: r[1], color: r[2], position: r[3], kind: r[4] }; }),

  settings: [
    { key: 'company', value: { name: 'StartDigital', primary_color: '#22c55e', logo_url: '', site: '', support_email: 'startdigitalcomercial@gmail.com' } },
    { key: 'aurea', value: { nome: 'Aurea', ativa: true, auto_ao_receber_formulario: true, horario_comercial: false, hora_inicio: 8, hora_fim: 20, modelo: 'claude-sonnet-4-6', instancia_whatsapp: '', personalidade: 'Você é a Aurea, assistente de recrutamento da StartDigital. Fale em português do Brasil, informal e curto.' } },
    { key: 'origens', value: { lista: ['Formulário do site', 'Indeed', 'LinkedIn', 'Catho'] } },
    { key: 'landing', value: { whatsapp: '5513996003897', badge: 'Estamos contratando', headline_1: 'Se o seu trabalho é', headline_destaque: 'extraordinário,', headline_2: 'seu lugar é aqui.', sub: 'Somos um time movido por resultado, cultura e gente boa de verdade!', sobre_titulo_1: 'Uma agência que', sobre_destaque: 'transforma negócios', sobre_titulo_2: 'de verdade', sobre_texto: 'A Start é uma agência digital focada em performance, construída para entregar o que realmente importa: resultado.\n\nSomos um time com 💜 sangue roxo, que joga em alta performance, evolui rápido e cresce junto.\n\nSe você curte desafio, evolução constante o seu lugar é aqui.' } },
    { key: 'form', value: { headline: 'Trabalhe na StartDigital', subhead: 'Preencha o formulário abaixo. Levamos o seu tempo a sério: leia com calma e responda com sinceridade.', roles: ['Social Media', 'Gestor de Tráfego', 'Designer', 'Redator / Copywriter', 'Comercial / SDR', 'Atendimento / CS', 'Outra'], open: true } }
  ],

  message_templates: [
    { key: 'welcome_email_senha', channel: 'email', name: 'Boas-vindas com criação de senha', subject: 'Bem-vindo(a) à StartDigital, {{primeiro_nome}}!', body: 'Olá {{primeiro_nome}}!\n\nVocê foi aprovado(a) para {{vaga}}.\n\nCrie a sua senha aqui:\n{{link_senha}}\n\nSeu e-mail de acesso: {{email}}\n\nEquipe StartDigital' },
    { key: 'welcome_email', channel: 'email', name: 'Boas-vindas — E-mail', subject: 'Bem-vindo(a) à StartDigital, {{primeiro_nome}}!', body: 'Olá {{primeiro_nome}}, tudo bem?\n\nVocê foi aprovado(a) para a vaga de {{vaga}}.\n\nAcesse a sua área de integração:\n{{link_portal}}\n\nEquipe StartDigital' },
    { key: 'welcome_whatsapp', channel: 'whatsapp', name: 'Boas-vindas — WhatsApp', subject: null, body: 'Oi {{primeiro_nome}}! *Você foi aprovado(a)* para {{vaga}}.\n\n👉 {{link_portal}}' },
    { key: 'team_welcome_email', channel: 'email', name: 'Cadastro do colaborador — E-mail', subject: 'Cadastro concluído, {{primeiro_nome}}! Bem-vindo(a) ao time', body: 'Olá {{primeiro_nome}}, tudo bem?\n\nSeu cadastro na StartDigital foi concluído.\n\nO QUE VEM AGORA\nVocê passa a receber por aqui os avisos de eventos, novidades e planos do time.\n\nEquipe StartDigital' },
    { key: 'team_welcome_whatsapp', channel: 'whatsapp', name: 'Cadastro do colaborador — WhatsApp', subject: null, body: 'Oi {{primeiro_nome}}! Aqui é a equipe da *StartDigital* 💚\n\nSeu cadastro foi concluído com sucesso. Bom ter você com a gente!' },
    { key: 'team_welcome_sms', channel: 'sms', name: 'Cadastro do colaborador — SMS', subject: null, body: 'StartDigital: {{primeiro_nome}}, cadastro concluido! Enviamos os detalhes por e-mail. Bom ter voce no time.' },
    { key: 'welcome_sms', channel: 'sms', name: 'Boas-vindas — SMS', subject: null, body: 'StartDigital: {{primeiro_nome}}, voce foi aprovado(a)! Enviamos por e-mail o link da sua area de integracao. Confira a caixa de entrada e o spam.' },
    { key: 'disc_invite_email', channel: 'email', name: 'Convite Teste DISC — E-mail', subject: 'Seu teste de perfil — StartDigital', body: 'Olá {{primeiro_nome}}, faça seu teste: {{link_disc}}' },
    { key: 'disc_invite_whatsapp', channel: 'whatsapp', name: 'Convite Teste DISC — WhatsApp', subject: null, body: 'Oi {{primeiro_nome}}! Teste de perfil: {{link_disc}}' },
    { key: 'disc_invite_sms', channel: 'sms', name: 'Convite Teste DISC — SMS', subject: null, body: 'StartDigital: {{primeiro_nome}}, a proxima etapa e o teste de perfil, leva 10 min. O link foi para o seu e-mail. Veja tambem o spam.' },
    { key: 'quiz_invite_email', channel: 'email', name: 'Convite Quiz — E-mail', subject: 'Seu quiz — StartDigital', body: 'Olá {{primeiro_nome}}, seu quiz: {{link_quiz}}' },
    { key: 'quiz_invite_whatsapp', channel: 'whatsapp', name: 'Convite Quiz — WhatsApp', subject: null, body: 'Oi {{primeiro_nome}}! Quiz ao vivo: {{link_quiz}}' },
    { key: 'quiz_invite_sms', channel: 'sms', name: 'Convite Quiz — SMS', subject: null, body: 'StartDigital: {{primeiro_nome}}, seu quiz sera ao vivo na chamada com um avaliador. Enviamos os detalhes por e-mail.' },
    { key: 'reject_email', channel: 'email', name: 'Retorno negativo — E-mail', subject: 'Retorno do processo — StartDigital', body: 'Olá {{primeiro_nome}}, seguimos com outro candidato para {{vaga}}. Obrigado!' },
    { key: 'application_received_email', channel: 'email', name: 'Confirmação de inscrição (automático)', subject: 'Recebemos a sua candidatura — StartDigital', body: 'Olá {{primeiro_nome}}, recebemos sua candidatura para {{vaga}}. Até breve!' }
  ].map(function (t, i) { return Object.assign({ id: i + 1, updated_at: agora() }, t); }),

  disc_questions: DISC_WORDS.map(function (ws, i) {
    return {
      id: i + 1, position: i + 1, active: true,
      words: ws.map(function (w, j) { return { w: w, t: ['D', 'I', 'S', 'C'][j] }; })
    };
  }),

  quizzes: [{ id: QUIZ_ID, title: 'Quiz de Seleção — StartDigital', description: 'Respondido ao vivo, com avaliador presente. Sem consulta e sem IA.', time_limit_min: 20, pass_score: 70, active: true, created_at: agora() }],

  quiz_questions: [
    { position: 1, kind: 'single', prompt: 'Um cliente manda mensagem às 18h dizendo que a campanha dele parou de rodar. Qual a primeira coisa que você faz?', options: [{ id: 'a', text: 'Espero o dia seguinte para verificar com calma' }, { id: 'b', text: 'Confirmo o recebimento, verifico a conta e dou um retorno com o que encontrei' }, { id: 'c', text: 'Encaminho para outra pessoa e sigo com o meu trabalho' }, { id: 'd', text: 'Respondo que provavelmente é problema da plataforma' }], correct: ['b'], points: 1 },
    { position: 2, kind: 'single', prompt: 'O que significa CTR em uma campanha de anúncios?', options: [{ id: 'a', text: 'Custo total por resultado' }, { id: 'b', text: 'Taxa de cliques (cliques dividido por impressões)' }, { id: 'c', text: 'Conversões totais registradas' }, { id: 'd', text: 'Classificação de tráfego relevante' }], correct: ['b'], points: 1 },
    { position: 3, kind: 'multiple', prompt: 'Selecione TODAS as atitudes que combinam com trabalho remoto bem feito:', options: [{ id: 'a', text: 'Avisar quando algo vai atrasar, antes do prazo estourar' }, { id: 'b', text: 'Deixar o gestor perguntar para só então dar status' }, { id: 'c', text: 'Registrar o que foi combinado por escrito' }, { id: 'd', text: 'Cumprir os horários de disponibilidade acordados' }], correct: ['a', 'c', 'd'], points: 2 },
    { position: 4, kind: 'single', prompt: 'Você recebeu uma tarefa e não entendeu completamente o que foi pedido. O melhor caminho é:', options: [{ id: 'a', text: 'Fazer do jeito que imagino e entregar' }, { id: 'b', text: 'Não fazer e esperar alguém cobrar' }, { id: 'c', text: 'Perguntar de forma objetiva, dizendo o que entendi e o que ficou em dúvida' }, { id: 'd', text: 'Pedir para outra pessoa fazer no meu lugar' }], correct: ['c'], points: 1 },
    { position: 5, kind: 'text', prompt: 'Em até 5 linhas: por que você quer trabalhar na StartDigital e o que entrega de diferente?', options: [], correct: [], points: 2 }
  ].map(function (q) { return Object.assign({ id: uuid(), quiz_id: QUIZ_ID }, q); }),

  modules: [
    { id: MOD1, position: 1, title: 'Módulo 1 — Boas-vindas e Cultura', description: 'O ponto de partida: quem somos, no que acreditamos e como trabalhamos.', published: true, created_at: agora() },
    { id: MOD2, position: 2, title: 'Módulo 2 — Sua Função e as Rotinas', description: 'O que se espera de você no dia a dia e como a operação remota funciona.', published: true, created_at: agora() }
  ],

  lessons: [
    { module_id: MOD1, position: 1, title: 'Aula 1 — Boas-vindas', description: 'Mensagem de boas-vindas da liderança e o que esperar dos primeiros dias.', duration: '5 min', video_url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', materials: [{ label: 'Manual de boas-vindas (PDF)', url: 'https://example.com/manual.pdf' }] },
    { module_id: MOD1, position: 2, title: 'Aula 2 — A empresa e a nossa cultura', description: 'História, propósito, valores e comportamento que a gente valoriza.', duration: '12 min', video_url: null, materials: [] },
    { module_id: MOD2, position: 1, title: 'Aula 3 — Suas funções', description: 'Responsabilidades, entregas esperadas e como o trabalho é avaliado.', duration: '15 min', video_url: null, materials: [] },
    { module_id: MOD2, position: 2, title: 'Aula 4 — Rotinas da Start no remoto', description: 'Horários, reuniões, ferramentas e o ritual do dia a dia online.', duration: '10 min', video_url: null, materials: [] }
  ].map(function (l) { return Object.assign({ id: uuid(), published: true, created_at: agora() }, l); }),

  prequal_groups: [{
    id: 'g-padrao', name: 'Pré-qualificação geral',
    description: 'Perguntas iniciais para qualquer vaga.', role_target: null,
    active: true, is_default: true, auto_on_apply: true,
    opening_message: 'Oi {{primeiro_nome}}! Aqui é a Aurea, da *StartDigital*. Posso te fazer umas perguntas rápidas?',
    closing_message: 'Prontinho, {{primeiro_nome}}! Obrigada. Já encaminhei tudo para o time.',
    created_at: agora()
  }, {
    id: 'gggg1111-1111-4111-8111-111111111111', name: 'Gestor de Tráfego',
    description: 'Roteiro curto de quem chega pelo WhatsApp.', role_target: 'Gestor de Tráfego',
    active: true, is_default: false, auto_on_apply: false, job_id: null,
    opening_message: 'Boa! Aqui é a Aurea, da StartDigital. Vou te fazer 5 perguntinhas rápidas sobre a vaga de {{vaga}}, leva 2 minutos.',
    closing_message: 'Show, {{primeiro_nome}}! Era isso. Obrigada pelas respostas — se você passar nesta primeira etapa, a gente entra em contato para agendar a conversa com o time.',
    created_at: agora()
  }],

  prequal_questions: [
    ['Me conta rapidinho: qual foi a sua última experiência de trabalho e por quanto tempo?', 'Tempo de casa e estabilidade.', 1],
    ['Você já trabalhou com marketing digital? Com o que exatamente?', 'Experiência na área e frente de atuação.', 2],
    ['Você tem computador próprio e internet estável para trabalhar 100% remoto?', 'Requisito eliminatório.', 3],
    ['Qual a sua disponibilidade de horário e quando poderia começar?', 'Compatibilidade e prazo de entrada.', 2],
    ['Qual a sua pretensão salarial?', 'Cabe no orçamento da vaga.', 2],
    ['Por que você quer trabalhar na StartDigital?', 'Interesse real e pesquisa prévia.', 1]
  ].map(function (q, i) {
    return {
      id: 'q' + (i + 1), group_id: 'g-padrao', position: i + 1,
      question: q[0], objective: q[1], required: true, weight: q[2]
    };
  }).concat([
    ['Quanto tempo de experiência você tem como gestor de tráfego?', 'Tempo na função.', 2],
    ['Quanto tempo de experiência em Meta Ads e Google Ads?', 'Precisa ter rodado nas duas.', 2],
    ['Você tem disponibilidade para trabalhar presencial, no horário comercial, das 08h45 às 18h?', 'ELIMINATÓRIO: a vaga é presencial.', 3],
    ['Já rodou quanto em Ads? (soma aproximada de verba investida)', 'Volume de verba já gerenciada.', 2],
    ['Última e mais importante: qual é a sua música favorita?', 'Quebra-gelo, sem peso na nota.', 0]
  ].map(function (q, i) {
    return {
      id: 'gt' + (i + 1), group_id: 'gggg1111-1111-4111-8111-111111111111', position: i + 1,
      question: q[0], objective: q[1], required: true, weight: q[2]
    };
  })),

  jobs: [
    {
      id: 'aaaa1111-1111-4111-8111-111111111111',
      slug: 'gestor-de-trafego-pleno', title: 'Gestor de Tráfego Pleno',
      summary: 'Gestão e otimização de campanhas no Meta Ads e Google Ads para nossa carteira de clientes.',
      description: 'Você vai cuidar de uma carteira de clientes de ponta a ponta.',
      salary: 'R$ 2.200 + Comissões', employment_type: 'PJ', work_mode: 'presencial',
      location: 'Praia Grande, SP', schedule: '08h45 às 18h', area: 'Tráfego Pago', seniority: 'Pleno',
      requirements: ['Experiência como gestor de tráfego', 'Meta Ads e Google Ads'],
      responsibilities: ['Planejar e subir campanhas'], benefits: ['Comissão por resultado'],
      prequal_group_id: 'gggg1111-1111-4111-8111-111111111111', whatsapp_message: null,
      active: true, featured: true, position: 1, views: 0,
      created_at: agora(), updated_at: agora()
    },
    {
      id: 'aaaa2222-2222-4222-8222-222222222222',
      slug: 'gestor-de-trafego-jr', title: 'Gestor de Tráfego Jr',
      summary: 'Apoio na criação e gestão de campanhas, com foco em aprendizado.',
      description: 'Vaga para quem está começando.',
      salary: 'R$ 1.500 + Comissões', employment_type: 'PJ', work_mode: 'presencial',
      location: 'Praia Grande, SP', schedule: '08h45 às 18h', area: 'Tráfego Pago', seniority: 'Júnior',
      requirements: ['Noções de Meta Ads'], responsibilities: ['Apoiar as campanhas'], benefits: ['Treinamento'],
      prequal_group_id: 'gggg1111-1111-4111-8111-111111111111', whatsapp_message: null,
      active: true, featured: false, position: 2, views: 0,
      created_at: agora(), updated_at: agora()
    }
  ],

  prequal_sessions: [],
  prequal_messages: [],
  candidates: [],
  stage_history: [],
  disc_results: [],
  quiz_attempts: [],
  lesson_progress: [],
  message_logs: [],
  collaborators: [],
  broadcasts: [],
  panel_users: [],
  audit_log: []
};

/* ---------------- defaults por tabela ---------------- */
const DEFAULTS = {
  candidates: function () { return { id: uuid(), extra: {}, source: 'formulario', source_detail: null, stage_key: 'triagem', password_hash: null, password_salt: null, rating: null, notes: null, member_access: false, archived: false, created_at: agora(), updated_at: agora() }; },
  stage_history: function () { return { id: seq('stage_history'), created_at: agora(), note: null, from_stage: null, to_stage: null }; },
  disc_results: function () { return { id: uuid(), answers: {}, created_at: agora() }; },
  quiz_attempts: function () { return { id: uuid(), answers: {}, score: null, max_score: null, percent: null, passed: null, focus_lost: 0, paste_blocked: 0, integrity_flags: [], started_at: agora(), finished_at: null }; },
  lesson_progress: function () { return { completed: true, completed_at: agora() }; },
  message_logs: function () { return { id: seq('message_logs'), created_at: agora() }; },
  modules: function () { return { id: uuid(), published: true, position: 1, description: null, created_at: agora() }; },
  lessons: function () { return { id: uuid(), published: true, position: 1, description: null, video_url: null, duration: null, materials: [], created_at: agora() }; },
  quizzes: function () { return { id: uuid(), time_limit_min: 20, pass_score: 70, active: true, created_at: agora() }; },
  quiz_questions: function () { return { id: uuid(), kind: 'single', options: [], correct: [], points: 1, position: 1 }; },
  disc_questions: function () { return { id: seq('disc_questions'), active: true }; },
  settings: function () { return { value: {} }; },
  message_templates: function () { return { id: seq('message_templates'), updated_at: agora() }; },
  jobs: function () { return { id: uuid(), requirements: [], responsibilities: [], benefits: [], active: true, featured: false, position: 1, views: 0, prequal_group_id: null, created_at: agora(), updated_at: agora() }; },
  prequal_groups: function () { return { id: uuid(), active: true, is_default: false, auto_on_apply: true, job_id: null, created_at: agora() }; },
  prequal_questions: function () { return { id: uuid(), position: 1, required: true, weight: 1, objective: null }; },
  prequal_sessions: function () { return { id: uuid(), channel: 'whatsapp', status: 'aguardando', current_index: 0, answers: [], score: null, recommendation: null, summary: null, job_id: null, last_message_at: null, started_at: agora(), finished_at: null, error: null }; },
  prequal_messages: function () { return { id: seq('prequal_messages'), created_at: agora() }; },
  panel_users: function () { return { id: uuid(), role: 'leitura', active: true, must_change: true, password_hash: null, password_salt: null, last_login_at: null, created_by: null, created_at: agora(), updated_at: agora() }; },
  audit_log: function () { return { id: seq('audit_log'), detail: {}, created_at: agora() }; },
  broadcasts: function () { return { id: uuid(), total: 0, sent: 0, failed: 0, detail: {}, created_at: agora() }; },
  collaborators: function () { return { id: uuid(), token: uuid().replace(/-/g, ''), active: true, source: 'formulario', work_mode: null, welcomed_at: null, notes: null, created_at: agora(), updated_at: agora() }; }
};

const contadores = {};
function seq(t) {
  if (contadores[t] === undefined) {
    contadores[t] = (DB[t] || []).reduce(function (m, r) { return Math.max(m, Number(r.id) || 0); }, 0);
  }
  return ++contadores[t];
}

/* ---------------- filtros ---------------- */
function norm(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
}
function combina(row, campo, expr) {
  const val = row[campo];
  if (expr === 'is.null') return val === null || val === undefined;
  if (expr === 'not.is.null') return val !== null && val !== undefined;
  if (expr === 'is.true') return val === true;
  if (expr === 'is.false') return val === false;
  if (expr.startsWith('eq.')) {
    const alvo = norm(expr.slice(3));
    if (typeof val === 'boolean' || typeof alvo === 'boolean') return String(val) === String(alvo);
    return String(val) === String(alvo);
  }
  if (expr.startsWith('neq.')) return String(val) !== String(norm(expr.slice(4)));
  if (expr.startsWith('like.')) {
    const padrao = expr.slice(5).replace(/[.*+?^${}()|[\]\\]/g, function (m) { return m === '*' ? m : '\\' + m; });
    return new RegExp('^' + padrao.replace(/\*/g, '.*') + '$').test(String(val == null ? '' : val));
  }
  if (expr.startsWith('in.')) {
    const lista = expr.slice(3).replace(/^\(|\)$/g, '').split(',')
      .map(function (x) { return String(norm(x.trim().replace(/^"|"$/g, ''))); });
    return lista.indexOf(String(val)) >= 0;
  }
  // Um espelho que ignora filtro que nao conhece mente para o teste:
  // ele devolve linhas a mais e o teste passa onde a producao falharia.
  console.error('[mock-supabase] filtro desconhecido, devolvendo nada:', campo, expr);
  return false;
}

const IGNORAR = ['select', 'order', 'limit', 'offset', 'on_conflict'];

function aplica(rows, params) {
  let out = rows.slice();
  Object.keys(params).forEach(function (k) {
    if (IGNORAR.indexOf(k) >= 0) return;
    out = out.filter(function (r) { return combina(r, k, params[k]); });
  });
  if (params.order) {
    params.order.split(',').forEach(function (o) {
      const p = o.split('.');
      const campo = p[0], dir = p[1] === 'desc' ? -1 : 1;
      out.sort(function (a, b) {
        const x = a[campo], y = b[campo];
        if (x === y) return 0;
        if (x === null || x === undefined) return 1;
        if (y === null || y === undefined) return -1;
        return (x > y ? 1 : -1) * dir;
      });
    });
  }
  if (params.limit) out = out.slice(0, Number(params.limit));
  // projecao de colunas (igual ao ?select= do PostgREST)
  if (params.select && params.select !== '*') {
    const cols = params.select.split(',').map(function (c) { return c.trim(); });
    out = out.map(function (r) {
      const o = {};
      cols.forEach(function (c) { if (c in r) o[c] = r[c]; });
      return o;
    });
  }
  return out;
}

/* ---------------- servidor ---------------- */
const server = http.createServer(function (req, res) {
  const url = new URL(req.url, 'http://localhost');
  const m = url.pathname.match(/^\/rest\/v1\/([A-Za-z0-9_]+)$/);
  const responder = function (status, data, headers) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    Object.keys(headers || {}).forEach(function (h) { res.setHeader(h, headers[h]); });
    res.end(JSON.stringify(data));
  };
  if (!m) return responder(404, { message: 'rota nao suportada: ' + url.pathname });

  const tabela = m[1];
  if (!DB[tabela]) DB[tabela] = [];
  const params = Object.fromEntries(url.searchParams.entries());

  let corpo = '';
  req.on('data', function (c) { corpo += c; });
  req.on('end', function () {
    let body = null;
    if (corpo) { try { body = JSON.parse(corpo); } catch (e) { return responder(400, { message: 'json invalido' }); } }

    if (req.method === 'GET') {
      const rows = aplica(DB[tabela], params);
      const prefer = req.headers['prefer'] || '';
      if (prefer.indexOf('count=exact') >= 0) {
        const total = aplica(DB[tabela], Object.assign({}, params, { limit: undefined })).length;
        return responder(200, rows, { 'Content-Range': '0-' + Math.max(0, rows.length - 1) + '/' + total });
      }
      return responder(200, rows);
    }

    if (req.method === 'POST') {
      const arr = Array.isArray(body) ? body : [body];
      const conflito = params.on_conflict ? params.on_conflict.split(',') : null;
      const criados = arr.map(function (r) {
        if (conflito) {
          const achado = DB[tabela].find(function (x) {
            return conflito.every(function (c) { return String(x[c]) === String(r[c]); });
          });
          if (achado) { Object.assign(achado, r); return achado; }
        }
        const novo = Object.assign(DEFAULTS[tabela] ? DEFAULTS[tabela]() : { id: uuid() }, r);
        if (tabela === 'candidates') novo.phone_digits = String(novo.phone || '').replace(/\D/g, '');
        DB[tabela].push(novo);
        return novo;
      });
      return responder(201, criados);
    }

    if (req.method === 'PATCH') {
      const alvos = aplica(DB[tabela], params);
      alvos.forEach(function (r) {
        Object.assign(r, body);
        if (tabela === 'candidates') r.phone_digits = String(r.phone || '').replace(/\D/g, '');
      });
      return responder(200, alvos);
    }

    if (req.method === 'DELETE') {
      const alvos = aplica(DB[tabela], params);
      DB[tabela] = DB[tabela].filter(function (r) { return alvos.indexOf(r) < 0; });
      return responder(200, alvos);
    }

    return responder(405, { message: 'metodo nao suportado' });
  });
});

server.listen(54321, function () { console.log('mock supabase em http://127.0.0.1:54321'); });
