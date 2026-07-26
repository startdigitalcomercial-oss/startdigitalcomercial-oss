// ============================================================
// AUREA — agente de pré-qualificação por WhatsApp
// Conversa de verdade: lê a resposta, decide se avança e
// escreve a próxima mensagem. Usa a API da Anthropic.
// ============================================================
'use strict';

const db = require('./db');
const u = require('./util');
const send = require('./send');

// Aceita tanto a base (https://api.anthropic.com) quanto o endpoint completo.
function endpointIA() {
  const base = (process.env.AUREA_API_URL || process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com')
    .replace(/\/+$/, '');
  return /\/v1\/messages$/.test(base) ? base : base + '/v1/messages';
}
const MODELO_PADRAO = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

// ---------------------------------------------------------------- config
async function config() {
  const row = await db.selectOne('settings', { key: 'eq.aurea', select: 'value' });
  return Object.assign({
    nome: 'Aurea',
    ativa: true,
    auto_ao_receber_formulario: true,
    horario_comercial: false,
    hora_inicio: 8,
    hora_fim: 20,
    modelo: MODELO_PADRAO,
    instancia_whatsapp: '',
    personalidade: ''
  }, (row && row.value) || {});
}

async function instancia(cfg) {
  if (cfg && cfg.instancia_whatsapp) return cfg.instancia_whatsapp;
  const w = await db.selectOne('settings', { key: 'eq.whatsapp', select: 'value' });
  return (w && w.value && w.value.instance) || process.env.EVOLUTION_INSTANCE || '';
}

function dentroDoHorario(cfg) {
  if (!cfg.horario_comercial) return true;
  // horário de Brasília
  const agora = new Date(Date.now() - 3 * 3600 * 1000);
  const dia = agora.getUTCDay();          // 0 domingo, 6 sábado
  const hora = agora.getUTCHours();
  if (dia === 0 || dia === 6) return false;
  return hora >= (cfg.hora_inicio || 8) && hora < (cfg.hora_fim || 20);
}

// ---------------------------------------------------------------- IA
async function chamarIA(opts) {
  const chave = process.env.ANTHROPIC_API_KEY;
  if (!chave) throw new Error('ANTHROPIC_API_KEY não configurada na Vercel.');

  const corpo = {
    model: opts.modelo || MODELO_PADRAO,
    max_tokens: opts.max_tokens || 1024,
    system: opts.system,
    messages: opts.messages
  };
  if (opts.tool) {
    corpo.tools = [opts.tool];
    corpo.tool_choice = { type: 'tool', name: opts.tool.name };
  }

  const res = await fetch(endpointIA(), {
    method: 'POST',
    headers: {
      'x-api-key': chave,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify(corpo)
  });
  const data = await res.json().catch(function () { return {}; });
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || ('HTTP ' + res.status);
    throw new Error('Anthropic: ' + msg);
  }
  if (opts.tool) {
    const bloco = (data.content || []).find(function (c) { return c.type === 'tool_use'; });
    if (!bloco) throw new Error('A IA não devolveu o formato esperado.');
    return bloco.input;
  }
  const texto = (data.content || []).filter(function (c) { return c.type === 'text'; })
    .map(function (c) { return c.text; }).join('\n');
  return texto;
}

// ferramenta que força a resposta estruturada
const FERRAMENTA_CONVERSA = {
  name: 'responder_candidato',
  description: 'Escreve a próxima mensagem para o candidato e informa o andamento da pré-qualificação.',
  input_schema: {
    type: 'object',
    properties: {
      mensagem: {
        type: 'string',
        description: 'A mensagem a enviar no WhatsApp agora. Curta, no máximo 3 linhas, uma pergunta só.'
      },
      resposta_capturada: {
        type: ['string', 'null'],
        description: 'A resposta consolidada do candidato para a pergunta atual, com as próprias palavras dele resumidas. null se ele ainda não respondeu de forma utilizável.'
      },
      avancar: {
        type: 'boolean',
        description: 'true se a pergunta atual já foi respondida de forma satisfatória e a mensagem acima já é a próxima pergunta.'
      },
      encerrar: {
        type: 'boolean',
        description: 'true se a conversa deve terminar agora (acabaram as perguntas, ou o candidato pediu para parar / disse que não tem interesse).'
      },
      motivo_encerramento: {
        type: ['string', 'null'],
        description: 'Se encerrar for true: "concluida", "desistencia" ou "sem_interesse".'
      }
    },
    required: ['mensagem', 'avancar', 'encerrar']
  }
};

const FERRAMENTA_RESUMO = {
  name: 'resumir_prequalificacao',
  description: 'Resume a pré-qualificação e dá uma recomendação ao time de RH.',
  input_schema: {
    type: 'object',
    properties: {
      resumo: { type: 'string', description: 'Resumo em até 5 linhas do que o candidato respondeu, em português.' },
      nota: { type: 'number', description: 'Nota de 0 a 10 para aderência à vaga, considerando os objetivos de cada pergunta.' },
      recomendacao: { type: 'string', enum: ['avancar', 'talvez', 'descartar'] },
      pontos_fortes: { type: 'array', items: { type: 'string' }, description: 'Até 3 pontos fortes.' },
      pontos_atencao: { type: 'array', items: { type: 'string' }, description: 'Até 3 pontos de atenção.' }
    },
    required: ['resumo', 'nota', 'recomendacao']
  }
};

// ---------------------------------------------------------------- prompt
function montarSystem(cfg, grupo, perguntas, sessao, candidato) {
  const lista = perguntas.map(function (q, i) {
    const marca = i < sessao.current_index ? '[já respondida]'
      : i === sessao.current_index ? '>>> PERGUNTA ATUAL <<<' : '[ainda não feita]';
    return (i + 1) + '. ' + marca + '\n   Pergunta: ' + q.question +
      (q.objective ? '\n   O que avaliar: ' + q.objective : '');
  }).join('\n\n');

  const respondidas = (sessao.answers || []).map(function (a, i) {
    return (i + 1) + '. ' + a.question + '\n   Resposta: ' + a.answer;
  }).join('\n') || '(nenhuma ainda)';

  return (cfg.personalidade || '') + '\n\n' +
    '=== CONTEXTO DESTA CONVERSA ===\n' +
    'Candidato: ' + (candidato.name || '') + '\n' +
    'Vaga: ' + (candidato.role_applied || 'não informada') + '\n' +
    'Origem: ' + (candidato.source_detail || candidato.source || 'formulário') + '\n\n' +
    '=== ROTEIRO DE PERGUNTAS ===\n' + lista + '\n\n' +
    '=== JÁ RESPONDIDO ===\n' + respondidas + '\n\n' +
    '=== SUA TAREFA AGORA ===\n' +
    'Leia a última mensagem do candidato e decida:\n' +
    '- Se ela responde a PERGUNTA ATUAL de forma utilizável: preencha resposta_capturada, marque avancar=true e escreva a PRÓXIMA pergunta do roteiro na mensagem.\n' +
    '- Se a resposta veio vaga, incompleta ou fugiu do assunto: marque avancar=false e faça UMA pergunta de aprofundamento (só uma) na mensagem.\n' +
    '- Se a pergunta atual era a última do roteiro e foi respondida: marque avancar=true e encerrar=true, e escreva a mensagem de encerramento.\n' +
    '- Se o candidato pediu para parar ou disse que não tem interesse: encerrar=true com o motivo, agradecendo com gentileza.\n\n' +
    (grupo.closing_message ? 'Mensagem de encerramento sugerida (adapte se precisar):\n' + grupo.closing_message + '\n\n' : '') +
    'Nunca repita uma pergunta já respondida. Nunca faça duas perguntas na mesma mensagem.';
}

// ---------------------------------------------------------------- dados
async function grupoComPerguntas(groupId) {
  let grupo = null;
  if (groupId) grupo = await db.selectOne('prequal_groups', { id: 'eq.' + groupId, select: '*' });
  if (!grupo) grupo = await db.selectOne('prequal_groups', { is_default: 'eq.true', active: 'eq.true', select: '*' });
  if (!grupo) grupo = await db.selectOne('prequal_groups', { active: 'eq.true', order: 'created_at.asc', select: '*' });
  if (!grupo) return null;
  const perguntas = await db.select('prequal_questions', {
    group_id: 'eq.' + grupo.id, order: 'position.asc', select: '*'
  });
  return { grupo: grupo, perguntas: perguntas };
}

async function registrar(sessionId, role, texto) {
  await db.insert('prequal_messages', { session_id: sessionId, role: role, text: texto });
}

async function enviarWhats(candidato, texto, cfg) {
  const inst = await instancia(cfg);
  return send.sendWhatsApp({ to: candidato.phone, text: texto, instance: inst });
}

// ---------------------------------------------------------------- iniciar
async function iniciar(candidato, groupId, opcoes) {
  opcoes = opcoes || {};
  const cfg = await config();
  if (!cfg.ativa && !opcoes.forcar) return { ok: false, error: 'A Aurea está desligada nos Ajustes.' };
  if (!dentroDoHorario(cfg) && !opcoes.forcar) {
    return { ok: false, error: 'Fora do horário comercial — a conversa fica agendada.', adiado: true };
  }

  const pacote = await grupoComPerguntas(groupId);
  if (!pacote || !pacote.perguntas.length) {
    return { ok: false, error: 'Nenhum grupo de pré-qualificação com perguntas foi configurado.' };
  }

  // já existe conversa em andamento?
  const aberta = await db.selectOne('prequal_sessions', {
    candidate_id: 'eq.' + candidato.id, status: 'eq.em_andamento', select: 'id'
  });
  if (aberta && !opcoes.reiniciar) {
    return { ok: false, error: 'Já existe uma conversa em andamento com este candidato.' };
  }

  const sessao = await db.insert('prequal_sessions', {
    candidate_id: candidato.id,
    group_id: pacote.grupo.id,
    status: 'em_andamento',
    current_index: 0,
    answers: [],
    last_message_at: new Date().toISOString()
  });

  const vars = u.templateVars(candidato, {});
  const abertura = u.renderTemplate(pacote.grupo.opening_message || 'Oi {{primeiro_nome}}! Aqui é a Aurea, da StartDigital.', vars);
  const primeira = pacote.perguntas[0].question;

  const r1 = await enviarWhats(candidato, abertura, cfg);
  await registrar(sessao.id, 'aurea', abertura);
  if (r1.status === 'erro') {
    await db.update('prequal_sessions', { status: 'erro', error: r1.error }, { id: 'eq.' + sessao.id });
    return { ok: false, error: 'Não consegui enviar no WhatsApp: ' + r1.error };
  }

  await enviarWhats(candidato, primeira, cfg);
  await registrar(sessao.id, 'aurea', primeira);

  await db.insert('stage_history', {
    candidate_id: candidato.id, from_stage: candidato.stage_key, to_stage: candidato.stage_key,
    note: 'Aurea iniciou a pré-qualificação (' + pacote.grupo.name + ')'
  });

  return { ok: true, session_id: sessao.id };
}

// ---------------------------------------------------------------- receber
async function receber(candidato, textoRecebido) {
  const cfg = await config();
  const sessao = await db.selectOne('prequal_sessions', {
    candidate_id: 'eq.' + candidato.id, status: 'eq.em_andamento',
    order: 'started_at.desc', select: '*'
  });
  if (!sessao) return { ok: false, ignorado: true, error: 'Sem conversa em andamento.' };

  await registrar(sessao.id, 'candidato', textoRecebido);

  const pacote = await grupoComPerguntas(sessao.group_id);
  if (!pacote) return { ok: false, error: 'Grupo de perguntas não encontrado.' };

  const historico = await db.select('prequal_messages', {
    session_id: 'eq.' + sessao.id, order: 'created_at.asc', select: 'role,text', limit: 40
  });
  const messages = historico.map(function (m) {
    return { role: m.role === 'candidato' ? 'user' : 'assistant', content: m.text };
  });
  if (!messages.length || messages[0].role !== 'user') {
    messages.unshift({ role: 'user', content: '(início da conversa)' });
  }

  let saida;
  try {
    saida = await chamarIA({
      modelo: cfg.modelo,
      system: montarSystem(cfg, pacote.grupo, pacote.perguntas, sessao, candidato),
      messages: messages,
      tool: FERRAMENTA_CONVERSA,
      max_tokens: 700
    });
  } catch (e) {
    await db.update('prequal_sessions', { error: e.message }, { id: 'eq.' + sessao.id });
    return { ok: false, error: e.message };
  }

  // guarda a resposta capturada
  const answers = Array.isArray(sessao.answers) ? sessao.answers.slice() : [];
  let indice = sessao.current_index;
  if (saida.resposta_capturada && pacote.perguntas[indice]) {
    answers.push({
      question: pacote.perguntas[indice].question,
      answer: saida.resposta_capturada,
      at: new Date().toISOString()
    });
  }
  if (saida.avancar) indice = Math.min(indice + 1, pacote.perguntas.length);

  const acabou = !!saida.encerrar || indice >= pacote.perguntas.length;

  await enviarWhats(candidato, saida.mensagem, cfg);
  await registrar(sessao.id, 'aurea', saida.mensagem);

  const patch = {
    answers: answers,
    current_index: indice,
    last_message_at: new Date().toISOString()
  };

  if (acabou) {
    patch.status = 'concluida';
    patch.finished_at = new Date().toISOString();
    if (saida.motivo_encerramento && saida.motivo_encerramento !== 'concluida') {
      patch.status = saida.motivo_encerramento === 'sem_interesse' ? 'sem_interesse' : 'desistiu';
    }
  }
  await db.update('prequal_sessions', patch, { id: 'eq.' + sessao.id });

  if (acabou) {
    await finalizar(Object.assign({}, sessao, patch), pacote, candidato, cfg);
  }
  return { ok: true, encerrou: acabou };
}

// ---------------------------------------------------------------- resumo
async function finalizar(sessao, pacote, candidato, cfg) {
  const respostas = (sessao.answers || []).map(function (a, i) {
    const q = pacote.perguntas[i];
    return (i + 1) + '. ' + a.question +
      (q && q.objective ? '\n   (o que avaliar: ' + q.objective + ')' : '') +
      '\n   Resposta: ' + a.answer;
  }).join('\n\n') || '(o candidato não respondeu nada)';

  try {
    const r = await chamarIA({
      modelo: cfg.modelo,
      system: 'Você é a Aurea, assistente de recrutamento da StartDigital. Analise a pré-qualificação abaixo e ' +
        'entregue um resumo honesto para o time de RH, em português do Brasil. Seja direto: se o candidato não ' +
        'atende um requisito eliminatório, diga isso com clareza. Nota 0 a 10 pela aderência à vaga.',
      messages: [{
        role: 'user',
        content: 'Vaga: ' + (candidato.role_applied || 'não informada') +
          '\nSituação da conversa: ' + sessao.status +
          '\n\nRESPOSTAS:\n' + respostas
      }],
      tool: FERRAMENTA_RESUMO,
      max_tokens: 900
    });

    const resumo = (r.resumo || '') +
      (r.pontos_fortes && r.pontos_fortes.length ? '\n\nPontos fortes: ' + r.pontos_fortes.join(' · ') : '') +
      (r.pontos_atencao && r.pontos_atencao.length ? '\nPontos de atenção: ' + r.pontos_atencao.join(' · ') : '');

    await db.update('prequal_sessions', {
      score: r.nota, recommendation: r.recomendacao, summary: resumo
    }, { id: 'eq.' + sessao.id });

    const rot = { avancar: 'recomenda avançar', talvez: 'em cima do muro', descartar: 'recomenda descartar' };
    await db.insert('stage_history', {
      candidate_id: candidato.id, from_stage: candidato.stage_key, to_stage: candidato.stage_key,
      note: 'Aurea concluiu a pré-qualificação — nota ' + r.nota + '/10, ' + (rot[r.recomendacao] || r.recomendacao)
    });
    await db.update('candidates', { updated_at: new Date().toISOString() }, { id: 'eq.' + candidato.id });
  } catch (e) {
    await db.update('prequal_sessions', { error: 'Falha ao resumir: ' + e.message }, { id: 'eq.' + sessao.id });
  }
}

// ---------------------------------------------------------------- teste
async function testar() {
  const cfg = await config();
  const texto = await chamarIA({
    modelo: cfg.modelo,
    system: 'Responda em português do Brasil, em uma frase curta.',
    messages: [{ role: 'user', content: 'Diga que a conexão com a Aurea está funcionando.' }],
    max_tokens: 100
  });
  return { modelo: cfg.modelo, resposta: texto };
}

module.exports = { config, instancia, dentroDoHorario, iniciar, receber, testar, chamarIA, grupoComPerguntas };
