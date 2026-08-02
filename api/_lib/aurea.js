// ============================================================
// AUREA — agente de pré-qualificação por WhatsApp
// Conversa de verdade: lê a resposta, decide se avança e
// escreve a próxima mensagem. Usa a API da Anthropic.
// ============================================================
'use strict';

const db = require('./db');
const u = require('./util');
const send = require('./send');
const vagas = require('./vagas');

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
    personalidade: '',
    // quem chega pelo botao da landing cai direto no WhatsApp
    atende_desconhecido: true,
    // 'aprovados' = so quem a Aurea recomendou | 'todos' | 'nunca'
    enviar_link_cadastro: 'aprovados',
    nota_minima: 6,
    // a primeira resposta demora mais, como alguem que foi ler a mensagem
    pausa_primeira: 10000,
    pausa_entre_mensagens: 4000
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
    (cfg._conhecimento ? '=== SOBRE A EMPRESA (use só o que está aqui) ===\n' + cfg._conhecimento + '\n\n' : '') +
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

// O roteiro certo para a vaga: primeiro o que está preso nela,
// depois um grupo marcado com o id dela, e por último o padrão.
async function grupoDaVaga(vaga) {
  if (vaga && vaga.prequal_group_id) {
    const p = await grupoComPerguntas(vaga.prequal_group_id);
    if (p && p.perguntas.length) return p;
  }
  if (vaga && vaga.id) {
    const g = await db.selectOne('prequal_groups', {
      job_id: 'eq.' + vaga.id, active: 'eq.true', select: '*'
    });
    if (g) {
      const p = await grupoComPerguntas(g.id);
      if (p && p.perguntas.length) return p;
    }
  }
  return await grupoComPerguntas(null);
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

// ============================================================
// FUNIL NOVO: a pessoa vem da landing e cai direto no WhatsApp.
// Ela ainda não é candidata — vira uma "porta de entrada" que só
// se transforma em cadastro completo depois de passar aqui.
// ============================================================

// Abre o roteiro daquela vaga e manda a primeira pergunta.
async function abrirRoteiro(candidato, vaga, cfg, sessaoExistente) {
  const pacote = await grupoDaVaga(vaga);
  if (!pacote || !pacote.perguntas.length) {
    return { ok: false, error: 'Nenhum roteiro de pré-qualificação configurado.' };
  }

  const patch = {
    group_id: pacote.grupo.id,
    job_id: vaga ? vaga.id : null,
    status: 'em_andamento',
    current_index: 0,
    answers: [],
    last_message_at: new Date().toISOString()
  };

  let sessao;
  if (sessaoExistente) {
    sessao = await db.update('prequal_sessions', patch, { id: 'eq.' + sessaoExistente.id })
      || Object.assign({}, sessaoExistente, patch);
  } else {
    sessao = await db.insert('prequal_sessions', Object.assign({ candidate_id: candidato.id }, patch));
  }

  if (vaga) {
    await db.update('candidates', {
      job_id: vaga.id, role_applied: vaga.title, updated_at: new Date().toISOString()
    }, { id: 'eq.' + candidato.id });
    candidato.role_applied = vaga.title;
  }

  const vars = u.templateVars(candidato, {});
  const abertura = u.renderTemplate(
    pacote.grupo.opening_message || 'Boa! Vou te fazer algumas perguntas rápidas sobre a vaga, tudo bem?',
    Object.assign({ vaga: vaga ? vaga.title : (candidato.role_applied || 'a vaga') }, vars));

  await enviarWhats(candidato, abertura, cfg);
  await registrar(sessao.id, 'aurea', abertura);
  await enviarWhats(candidato, pacote.perguntas[0].question, cfg);
  await registrar(sessao.id, 'aurea', pacote.perguntas[0].question);

  return { ok: true, session_id: sessao.id, vaga: vaga ? vaga.title : null };
}

// Lista as vagas abertas quando a Aurea não entendeu qual é.
function perguntaQualVaga(lista) {
  if (!lista.length) {
    return 'Oi! No momento não temos vaga aberta, mas guardo seu contato para quando abrir. ' +
      'Obrigada pelo interesse!';
  }
  if (lista.length === 1) {
    return 'Oi! Você está falando da vaga de ' + lista[0].title + '? Responde sim que a gente começa.';
  }
  return 'Oi! Aqui é a Aurea, da StartDigital. Para qual vaga você quer se candidatar?\n\n' +
    lista.map(function (v, i) { return (i + 1) + '. ' + v.title; }).join('\n') +
    '\n\nÉ só me dizer o nome ou o número.';
}

// Aceita "1", "2"... além do nome da vaga.
function vagaPeloNumero(texto, lista) {
  const m = String(texto || '').trim().match(/^\s*(\d{1,2})\s*[.)]?\s*$/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= lista.length ? lista[n - 1] : null;
}

// O miolo comum: a pessoa mandou a primeira mensagem. Se der para saber
// a vaga, começa o roteiro. Se não der, pergunta qual é e espera.
async function comecarPelaVaga(candidato, texto, cfg, abertas, vagaJaSabida) {
  const vaga = vagaJaSabida || vagas.reconhecer(texto, abertas);

  if (vaga) {
    const r = await abrirRoteiro(candidato, vaga, cfg, null);
    return Object.assign({ ok: true, candidate_id: candidato.id }, r);
  }

  const sessao = await db.insert('prequal_sessions', {
    candidate_id: candidato.id,
    status: 'escolhendo_vaga',
    current_index: 0,
    answers: [],
    last_message_at: new Date().toISOString()
  });
  await registrar(sessao.id, 'candidato', texto);
  const pergunta = perguntaQualVaga(abertas);
  await enviarWhats(candidato, pergunta, cfg);
  await registrar(sessao.id, 'aurea', pergunta);
  return { ok: true, candidate_id: candidato.id, perguntou_vaga: true };
}

// Chamado pelo webhook quando o número não está cadastrado.
async function receberDeDesconhecido(info) {
  const cfg = await config();
  if (!cfg.ativa) return { ok: false, ignorado: true, error: 'Aurea desligada.' };
  if (cfg.atende_desconhecido === false) {
    return { ok: false, ignorado: true, error: 'Aurea não atende número novo.' };
  }

  const abertas = await vagas.ativas();
  const vaga = vagas.reconhecer(info.texto, abertas);


  // cria a porta de entrada: ainda não é candidatura, é um contato
  const candidato = await db.insert('candidates', {
    token: u.candidateToken(),
    name: String(info.nome || '').trim().slice(0, 120) || 'Contato do WhatsApp',
    email: '',
    phone: info.telefone,
    stage_key: 'triagem',
    source: 'whatsapp',
    source_detail: 'Landing page → WhatsApp',
    role_applied: vaga ? vaga.title : null,
    job_id: vaga ? vaga.id : null
  });
  await db.insert('stage_history', {
    candidate_id: candidato.id, from_stage: null, to_stage: 'triagem',
    note: 'Chegou pelo WhatsApp' + (vaga ? ' — vaga de ' + vaga.title : '')
  });

  const r = await comecarPelaVaga(candidato, info.texto, cfg, abertas, vaga);
  return Object.assign({ novo: true }, r);
}

// ============================================================
// SEQUÊNCIA DA LANDING
// Quem se cadastrou na landing e chamou no WhatsApp recebe estas
// quatro mensagens, uma vez só, com "digitando…" entre elas.
// Não é conversa com IA: é um roteiro fixo, que o time edita em
// Mensagens. A pessoa responde e um humano lê.
// ============================================================
// Na chegada: saudação (com as perguntas da vaga, se ela tiver),
// o pedido do vídeo e o link do cadastro. O agradecimento e as redes
// ficam para o fim, quando a pessoa entrega tudo.
const SEQUENCIA = [
  'landing_wa_1_ola',
  'landing_wa_2_video',
  'landing_wa_3_cadastro'
];

const FECHAMENTO = [
  'landing_wa_3_obrigado',
  'landing_wa_4_redes'
];

// Tira a cara de robô do texto que a IA escreveu. O travessão é a
// marca registrada de texto de máquina; em conversa de WhatsApp
// ninguém usa.
function semCaraDeIA(txt) {
  return String(txt || '')
    .replace(/\s+[—–]\s+/g, ', ')
    .replace(/[—–]/g, '-')
    .replace(/,\s*,/g, ',')
    .replace(/\s+([,.!?])/g, '$1')
    .trim();
}

const PAUSA_PADRAO = 4000;
const PAUSA_PRIMEIRA = 10000;

async function textoDoModelo(chave, vars, reserva) {
  const tpl = await db.selectOne('message_templates', { key: 'eq.' + chave, select: 'body' });
  const corpo = (tpl && tpl.body) || reserva || '';
  return u.renderTemplate(corpo, vars);
}

// O link do cadastro vai com o token da pessoa, para o formulário
// completar o registro dela em vez de criar outro.
function linkDoCadastro(candidato, vaga) {
  const base = u.appUrl();
  if (!base) return '';
  return base + '/vaga?t=' + candidato.token + (vaga ? '&v=' + vaga.slug : '');
}

// A saudação leva junto as perguntas da vaga, quando ela tem.
async function textoDaSequencia(chave, vars, vaga) {
  const texto = await textoDoModelo(chave, vars);
  if (chave === 'landing_wa_1_ola' && vaga && String(vaga.wa_perguntas || '').trim()) {
    return texto + '\n\n' + u.renderTemplate(String(vaga.wa_perguntas).trim(), vars);
  }
  return texto;
}

async function mandarSequencia(candidato, vaga, cfg, chaves) {
  cfg = cfg || await config();
  const lista = chaves || SEQUENCIA;
  const inst = await instancia(cfg);
  const pausa = pausaDe(cfg);
  const primeira = cfg.pausa_primeira === undefined ? PAUSA_PRIMEIRA : Number(cfg.pausa_primeira);

  const empresa = await db.selectOne('settings', { key: 'eq.company', select: 'value' });
  const vars = Object.assign(
    u.templateVars(candidato, (empresa && empresa.value) || {}),
    {
      vaga: vaga ? vaga.title : (candidato.role_applied || 'a vaga'),
      link_cadastro: linkDoCadastro(candidato, vaga)
    }
  );

  const saidas = [];
  for (let i = 0; i < lista.length; i++) {
    const texto = await textoDaSequencia(lista[i], vars, vaga);
    if (!texto.trim()) continue;

    // A primeira já entra digitando também: a pessoa acabou de mandar
    // a mensagem e vê a resposta sendo escrita, como com uma pessoa.
    const r = await send.sendWhatsAppComPausa({
      to: candidato.phone, text: texto, instance: inst,
      pausa: (i === 0 && !chaves) ? primeira : pausa
    });
    saidas.push({ chave: lista[i], status: r.status, error: r.error || null });

    await db.insert('message_logs', {
      candidate_id: candidato.id, channel: 'whatsapp', to_address: candidato.phone,
      subject: lista[i], body: texto,
      status: r.status, provider: r.provider, error: r.error || null
    });
    if (r.status === 'erro') break;
  }

  if (!chaves) {
    await db.update('candidates', {
      wa_sequencia_em: new Date().toISOString(), updated_at: new Date().toISOString()
    }, { id: 'eq.' + candidato.id });
  }

  await db.insert('stage_history', {
    candidate_id: candidato.id, from_stage: candidato.stage_key, to_stage: candidato.stage_key,
    note: 'Aurea enviou ' + saidas.length + ' mensagem(ns) da landing'
  });

  return { ok: true, sequencia: true, mensagens: saidas.length, saidas: saidas };
}

// Chamado pelo webhook: a pessoa cadastrada na landing chamou no WhatsApp.
async function receberDaLanding(candidato) {
  const cfg = await config();
  if (!cfg.ativa) return { ok: false, ignorado: true, error: 'Aurea desligada.' };

  if (candidato.wa_sequencia_em) {
    return { ok: false, ignorado: true, error: 'Sequência já enviada para esta pessoa.' };
  }
  const vaga = candidato.job_id ? await vagas.porId(candidato.job_id) : null;
  const r = await mandarSequencia(candidato, vaga, cfg);

  // A partir daqui a conversa fica aberta: a pessoa responde no tempo
  // dela, tira dúvidas, e manda o vídeo quando conseguir.
  const sessao = await db.insert('prequal_sessions', {
    candidate_id: candidato.id,
    job_id: vaga ? vaga.id : null,
    status: 'em_andamento',
    current_index: 0,
    answers: [],
    respostas_ok: false,
    last_message_at: new Date().toISOString()
  });
  const vars = Object.assign(u.templateVars(candidato, {}), {
    vaga: vaga ? vaga.title : (candidato.role_applied || 'a vaga'),
    link_cadastro: linkDoCadastro(candidato, vaga)
  });
  for (const ch of SEQUENCIA) {
    await registrar(sessao.id, 'aurea', await textoDaSequencia(ch, vars, vaga));
  }
  return Object.assign({ session_id: sessao.id }, r);
}

// ------------------------------------------------------------
// DEPOIS DAS PERGUNTAS: a conversa fica aberta.
// A pessoa responde no tempo dela, pode perguntar sobre a vaga, e
// manda o vídeo quando conseguir. A Aurea acompanha e só fecha o
// processo quando tem as duas coisas: respostas e vídeo.
// ------------------------------------------------------------
const FERRAMENTA_ACOMPANHA = {
  name: 'acompanhar_candidato',
  description: 'Responde o candidato e informa se ele já respondeu as perguntas da pré-qualificação.',
  input_schema: {
    type: 'object',
    properties: {
      mensagem: {
        type: 'string',
        description: 'A mensagem a enviar agora no WhatsApp. Curta, no máximo 3 linhas. ' +
          'Deixe vazio ("") se não houver nada útil a dizer.'
      },
      respostas_completas: {
        type: 'boolean',
        description: 'true somente se o candidato já respondeu, somando tudo que ele escreveu, as QUATRO perguntas.'
      },
      resumo_respostas: {
        type: ['string', 'null'],
        description: 'Se respostas_completas for true: as respostas dele resumidas, uma por linha, numeradas.'
      },
      desistiu: {
        type: 'boolean',
        description: 'true se o candidato disse que não tem mais interesse ou pediu para parar.'
      }
    },
    required: ['mensagem', 'respostas_completas', 'desistiu']
  }
};

// O que a Aurea sabe sobre a empresa. Editavel no painel, em Ajustes.
async function baseDeConhecimento() {
  const row = await db.selectOne('settings', { key: 'eq.conhecimento', select: 'value' });
  return (row && row.value && row.value.texto) || '';
}

function fichaDaVaga(vaga) {
  if (!vaga) return '(nenhuma vaga vinculada)';
  const lista = function (t, a) {
    return (a && a.length) ? '\n' + t + ':\n- ' + a.join('\n- ') : '';
  };
  return 'Vaga: ' + vaga.title +
    (vaga.salary ? '\nRemuneração: ' + vaga.salary : '') +
    (vaga.employment_type ? '\nContrato: ' + vaga.employment_type : '') +
    (vaga.work_mode ? '\nModelo: ' + (vagas.MODO_NOME[vaga.work_mode] || vaga.work_mode) : '') +
    (vaga.location ? '\nLocal: ' + vaga.location : '') +
    (vaga.schedule ? '\nHorário: ' + vaga.schedule : '') +
    (vaga.description ? '\nSobre: ' + vaga.description : '') +
    lista('Requisitos', vaga.requirements) +
    lista('Responsabilidades', vaga.responsibilities) +
    lista('Benefícios', vaga.benefits);
}

async function acompanharDaLanding(candidato, texto, tipo) {
  const cfg = await config();
  if (!cfg.ativa) return { ok: false, ignorado: true, error: 'Aurea desligada.' };

  const sessao = await db.selectOne('prequal_sessions', {
    candidate_id: 'eq.' + candidato.id, order: 'started_at.desc', select: '*'
  });
  if (!sessao) return { ok: false, ignorado: true, error: 'Sem conversa aberta.' };
  if (sessao.status !== 'em_andamento') {
    return { ok: false, ignorado: true, error: 'Processo já concluído com esta pessoa.' };
  }

  const vaga = sessao.job_id ? await vagas.porId(sessao.job_id) : null;
  const inst = await instancia(cfg);

  // ---- chegou o vídeo ----
  let videoEm = sessao.video_em;
  if (tipo === 'video') {
    videoEm = videoEm || new Date().toISOString();
    await db.update('prequal_sessions', { video_em: videoEm, last_message_at: new Date().toISOString() },
      { id: 'eq.' + sessao.id });
    await registrar(sessao.id, 'candidato', texto || '[enviou um vídeo]');
    await db.insert('stage_history', {
      candidate_id: candidato.id, from_stage: candidato.stage_key, to_stage: candidato.stage_key,
      note: 'Candidato enviou o vídeo de apresentação'
    });
  } else {
    await registrar(sessao.id, 'candidato', texto || '[' + tipo + ']');
  }

  // ---- a IA lê tudo e decide o que falar ----
  const historico = await db.select('prequal_messages', {
    session_id: 'eq.' + sessao.id, order: 'created_at.asc', select: 'role,text', limit: 40
  });
  const messages = historico.map(function (m) {
    return { role: m.role === 'candidato' ? 'user' : 'assistant', content: m.text || '...' };
  });
  if (!messages.length || messages[0].role !== 'user') {
    messages.unshift({ role: 'user', content: '(início da conversa)' });
  }

  const temPerguntas = !!(vaga && String(vaga.wa_perguntas || '').trim());
  const perguntas = temPerguntas ? String(vaga.wa_perguntas).trim() : '';
  const cadastroOk = !!candidato.cadastro_em;

  const conhecimento = await baseDeConhecimento();

  const system = (cfg.personalidade || '') + '\n\n' +
    '=== ONDE ESTAMOS ===\n' +
    'Candidato: ' + (candidato.name || '') + '\n' +
    'Ele se candidatou pela landing page. Já pedimos três coisas a ele:\n' +
    (temPerguntas
      ? '1) Responder estas perguntas:\n---\n' + perguntas + '\n---\n'
      : '1) (esta vaga não tem perguntas, pule este item)\n') +
    '2) Um vídeo de até 1 minuto se apresentando. Recebido: ' + (videoEm ? 'SIM' : 'AINDA NÃO') + '\n' +
    '3) Preencher o cadastro completo neste link: ' + linkDoCadastro(candidato, vaga) + '\n' +
    '   Cadastro preenchido: ' + (cadastroOk ? 'SIM' : 'AINDA NÃO') + '\n\n' +
    '=== A VAGA (use só o que está aqui) ===\n' + fichaDaVaga(vaga) + '\n\n' +
    (conhecimento ? '=== SOBRE A EMPRESA (use só o que está aqui) ===\n' + conhecimento + '\n\n' : '') +
    '=== O QUE VOCÊ FAZ AGORA ===\n' +
    'A sua missão em toda mensagem é a mesma: fazer o candidato ENVIAR as respostas e o vídeo. ' +
    'Tudo que você escrever termina puxando ele de volta para isso.\n\n' +
    '1. Se ele fez uma pergunta, responda primeiro — com o que está na ficha da vaga ou no bloco ' +
    'sobre a empresa. Se a resposta não estiver em nenhum dos dois, diga com honestidade que vai ' +
    'confirmar com o time. Nunca invente.\n' +
    '2. Logo depois de responder, retome: peça com gentileza o que ainda falta para ele ' +
    'participar do processo seletivo.\n' +
    '3. Cobre só o que ainda falta da lista acima. Nunca peça de novo o que já chegou.\n' +
    '4. Incentive sem pressionar. Uma frase curta de encorajamento basta, nada de cobrança dura.\n' +
    '5. Nunca prometa aprovação, prazo ou vaga garantida.\n' +
    '6. Não agradeça pelo encerramento. Quem fecha o processo é o sistema, não você.\n\n' +
    (temPerguntas
      ? 'Marque respostas_completas=true SÓ quando TODAS as perguntas acima estiverem respondidas, ' +
        'somando tudo que ele já escreveu na conversa.'
      : 'Esta vaga não tem perguntas, então marque respostas_completas=true sempre.');

  let saida;
  try {
    saida = await chamarIA({
      modelo: cfg.modelo, system: system, messages: messages,
      tool: FERRAMENTA_ACOMPANHA, max_tokens: 700
    });
  } catch (e) {
    await db.update('prequal_sessions', { error: e.message }, { id: 'eq.' + sessao.id });
    return { ok: false, error: e.message };
  }

  const respostasOk = !temPerguntas || sessao.respostas_ok === true || saida.respostas_completas === true;

  // ---- desistiu ----
  const fala = semCaraDeIA(saida.mensagem);

  if (saida.desistiu) {
    if (fala) {
      await send.sendWhatsAppComPausa({ to: candidato.phone, text: fala, instance: inst, pausa: pausaDe(cfg) });
      await registrar(sessao.id, 'aurea', fala);
    }
    await db.update('prequal_sessions', {
      status: 'sem_interesse', finished_at: new Date().toISOString(),
      respostas_ok: respostasOk, video_em: videoEm
    }, { id: 'eq.' + sessao.id });
    return { ok: true, desistiu: true };
  }

  // ---- fala o que tiver para falar ----
  if (fala) {
    await send.sendWhatsAppComPausa({
      to: candidato.phone, text: fala, instance: inst, pausa: pausaDe(cfg)
    });
    await registrar(sessao.id, 'aurea', fala);
  }

  const patch = {
    respostas_ok: respostasOk, video_em: videoEm,
    last_message_at: new Date().toISOString()
  };
  if (saida.resumo_respostas) patch.summary = saida.resumo_respostas;

  // ---- entregou as três coisas? aí sim fecha ----
  const concluiu = respostasOk && !!videoEm && cadastroOk;
  if (concluiu) {
    patch.status = 'concluida';
    patch.finished_at = new Date().toISOString();
  }
  await db.update('prequal_sessions', patch, { id: 'eq.' + sessao.id });

  if (!concluiu) {
    return { ok: true, aguardando: { respostas: !respostasOk, video: !videoEm, cadastro: !cadastroOk } };
  }

  // agradecimento + redes, só agora
  const r = await mandarSequencia(candidato, vaga, cfg, FECHAMENTO);
  const vars2 = u.templateVars(candidato, {});
  for (const ch of FECHAMENTO) {
    await registrar(sessao.id, 'aurea', await textoDoModelo(ch, vars2));
  }
  await db.insert('stage_history', {
    candidate_id: candidato.id, from_stage: candidato.stage_key, to_stage: candidato.stage_key,
    note: 'Candidato concluiu: respostas, vídeo e cadastro completo'
  });
  return { ok: true, concluiu: true, mensagens: r.mensagens };
}

function pausaDe(cfg) {
  return cfg.pausa_entre_mensagens === undefined ? PAUSA_PADRAO : Number(cfg.pausa_entre_mensagens);
}

// ------------------------------------------------------------
// Quem JÁ está cadastrado mas não tem conversa aberta.
// A regra é simples e sem exceção: chamou o número, a Aurea responde.
// Não importa se a pessoa já é candidata, se já conversou antes ou
// se acabou de terminar um roteiro. Sempre responde.
// ------------------------------------------------------------
async function receberSemConversa(candidato, texto) {
  const cfg = await config();
  if (!cfg.ativa) return { ok: false, ignorado: true, error: 'Aurea desligada.' };

  const abertas = await vagas.ativas();
  const r = await comecarPelaVaga(candidato, texto, cfg, abertas, null);
  return Object.assign({ recomecou: true }, r);
}

// A pessoa respondeu qual vaga quer.
async function receberEscolhaDeVaga(candidato, sessao, texto) {
  const cfg = await config();
  await registrar(sessao.id, 'candidato', texto);

  const abertas = await vagas.ativas();
  let vaga = vagaPeloNumero(texto, abertas) || vagas.reconhecer(texto, abertas);

  // "sim" quando só existe uma vaga aberta
  if (!vaga && abertas.length === 1 && /^\s*(sim|isso|essa|é|e|claro|quero|pode)\b/i.test(texto)) {
    vaga = abertas[0];
  }

  if (!vaga) {
    const tentativas = (sessao.answers || []).length + 1;
    await db.update('prequal_sessions', { answers: new Array(tentativas).fill({ tentativa: true }) },
      { id: 'eq.' + sessao.id });
    if (tentativas >= 3) {
      const desiste = 'Sem problema. Vou passar seu contato para o time dar uma olhada e alguém te chama por aqui. Obrigada!';
      await enviarWhats(candidato, desiste, cfg);
      await registrar(sessao.id, 'aurea', desiste);
      await db.update('prequal_sessions', {
        status: 'desistiu', finished_at: new Date().toISOString()
      }, { id: 'eq.' + sessao.id });
      return { ok: true, encerrou: true };
    }
    const denovo = perguntaQualVaga(abertas);
    await enviarWhats(candidato, denovo, cfg);
    await registrar(sessao.id, 'aurea', denovo);
    return { ok: true, perguntou_vaga: true };
  }

  const r = await abrirRoteiro(candidato, vaga, cfg, sessao);
  return Object.assign({ ok: true }, r);
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
  cfg._conhecimento = await baseDeConhecimento();
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

  const dito = semCaraDeIA(saida.mensagem);
  await enviarWhats(candidato, dito, cfg);
  await registrar(sessao.id, 'aurea', dito);

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

    // passou? entao mandamos o link do cadastro completo
    await talvezMandarCadastro(candidato, sessao, r, cfg);
  } catch (e) {
    await db.update('prequal_sessions', { error: 'Falha ao resumir: ' + e.message }, { id: 'eq.' + sessao.id });
  }
}

// ---------------------------------------------------------------- link do cadastro
// Só quem passa na conversa recebe o formulário. Quem não passa recebe
// um "obrigado" e fica guardado no sistema para o time olhar depois.
async function talvezMandarCadastro(candidato, sessao, analise, cfg) {
  const regra = cfg.enviar_link_cadastro || 'aprovados';
  if (regra === 'nunca') return { enviado: false, motivo: 'desligado' };
  if (sessao.status !== 'concluida') return { enviado: false, motivo: 'nao concluiu' };

  if (regra === 'aprovados') {
    const nota = Number(analise && analise.nota);
    const rec = analise && analise.recomendacao;
    const passou = rec === 'avancar' || (rec === 'talvez' && nota >= Number(cfg.nota_minima || 6));
    if (!passou) return { enviado: false, motivo: 'nao passou' };
  }

  const base = u.appUrl();
  if (!base) return { enviado: false, motivo: 'sem APP_URL' };

  const vaga = sessao.job_id ? await vagas.porId(sessao.job_id) : null;
  const link = base + '/vaga?t=' + candidato.token + (vaga ? '&v=' + vaga.slug : '');
  const primeiro = u.firstName(candidato.name) || '';

  const texto = 'Boa, ' + primeiro + '! Você passou na primeira etapa. 🎉\n\n' +
    'Agora é só preencher seu cadastro completo neste link — leva uns 3 minutinhos:\n' + link +
    '\n\nAssim que você enviar, o time analisa e a gente te chama para os próximos passos.';

  const r = await enviarWhats(candidato, texto, cfg);
  await registrar(sessao.id, 'aurea', texto);
  await db.insert('message_logs', {
    candidate_id: candidato.id, channel: 'whatsapp', to_address: candidato.phone,
    subject: 'Link do cadastro', body: texto,
    status: r.status, provider: r.provider, error: r.error || null
  });
  await db.insert('stage_history', {
    candidate_id: candidato.id, from_stage: candidato.stage_key, to_stage: candidato.stage_key,
    note: 'Aurea enviou o link do cadastro completo'
  });
  return { enviado: r.status === 'enviado', link: link };
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

module.exports = {
  config, instancia, dentroDoHorario, iniciar, receber, testar, chamarIA,
  grupoComPerguntas, grupoDaVaga,
  receberDeDesconhecido, receberSemConversa, receberEscolhaDeVaga, abrirRoteiro, perguntaQualVaga,
  receberDaLanding, acompanharDaLanding, mandarSequencia, semCaraDeIA, SEQUENCIA, FECHAMENTO
};
