// ============================================================
// WEBHOOK DO WHATSAPP (Evolution API)
// Recebe as respostas dos candidatos e entrega para a Aurea.
// Endereço: /api/webhook?k=CHAVE
// ============================================================
'use strict';

const crypto = require('crypto');
const db = require('./_lib/db');
const u = require('./_lib/util');
const aurea = require('./_lib/aurea');
const vagas = require('./_lib/vagas');

// A vaga desta pessoa termina no WhatsApp ou no site?
// Sem vaga (ou sem a coluna preenchida) vale o de sempre: WhatsApp.
async function vagaUsaWhatsApp(candidato) {
  if (!candidato || !candidato.job_id) return true;
  try {
    const v = await vagas.porId(candidato.job_id);
    return !v || v.usa_whatsapp !== false;
  } catch (e) { return true; }
}

// chave derivada do APP_SECRET — não precisa de variável nova
function chaveWebhook() {
  const base = process.env.APP_SECRET || process.env.ADMIN_SECRET || 'start-rh';
  return crypto.createHmac('sha256', base).update('webhook-whatsapp').digest('hex').slice(0, 32);
}

// evita processar a mesma mensagem duas vezes (Evolution reenvia)
const VISTAS = new Set();
function jaVista(id) {
  if (!id) return false;
  if (VISTAS.has(id)) return true;
  VISTAS.add(id);
  if (VISTAS.size > 500) {
    const it = VISTAS.values();
    for (let i = 0; i < 250; i++) VISTAS.delete(it.next().value);
  }
  return false;
}

// ------------------------------------------------------------
// DIARIO DO WEBHOOK
// Guarda as ultimas batidas — inclusive as ignoradas. Sem isto,
// quando a Aurea nao responde, nao da para saber se a Evolution
// nao chamou ou se chamou e a gente descartou.
// ------------------------------------------------------------
const MAX_BATIDAS = 25;

async function anota(dados) {
  try {
    const reg = await db.selectOne('settings', { key: 'eq.webhook_log', select: 'value' });
    const itens = (reg && reg.value && Array.isArray(reg.value.itens)) ? reg.value.itens : [];
    itens.unshift(Object.assign({ em: new Date().toISOString() }, dados));
    await db.upsert('settings', {
      key: 'webhook_log', value: { itens: itens.slice(0, MAX_BATIDAS) }
    }, 'key');
  } catch (e) { /* diario nunca pode derrubar o webhook */ }
}

// Que tipo de coisa a pessoa mandou. Video importa: e ele que
// fecha o processo seletivo.
function tipoDaMensagem(msg) {
  if (!msg) return 'outro';
  if (msg.videoMessage || msg.ptvMessage || msg.videoMessageV2) return 'video';
  const doc = msg.documentMessage || msg.documentWithCaptionMessage;
  if (doc) {
    const mime = String((doc.message && doc.message.documentMessage && doc.message.documentMessage.mimetype) ||
      doc.mimetype || '');
    if (/^video\//i.test(mime)) return 'video';
    return 'documento';
  }
  if (msg.audioMessage) return 'audio';
  if (msg.imageMessage) return 'imagem';
  if (msg.stickerMessage) return 'figurinha';
  if (msg.conversation || msg.extendedTextMessage) return 'texto';
  return 'outro';
}

function extrairTexto(msg) {
  if (!msg) return '';
  if (typeof msg.conversation === 'string') return msg.conversation;
  if (msg.extendedTextMessage && msg.extendedTextMessage.text) return msg.extendedTextMessage.text;
  if (msg.imageMessage && msg.imageMessage.caption) return msg.imageMessage.caption;
  if (msg.videoMessage && msg.videoMessage.caption) return msg.videoMessage.caption;
  if (msg.buttonsResponseMessage && msg.buttonsResponseMessage.selectedDisplayText) {
    return msg.buttonsResponseMessage.selectedDisplayText;
  }
  if (msg.listResponseMessage && msg.listResponseMessage.title) return msg.listResponseMessage.title;
  return '';
}

module.exports = async function handler(req, res) {
  u.setBaseFromReq(req);

  const params = (req.query && Object.keys(req.query).length)
    ? req.query
    : Object.fromEntries(new URL(req.url, 'http://x').searchParams.entries());

  // A Evolution reenvia em caso de erro, então respondemos 200 quase sempre.
  const responder = function (payload) { return u.json(res, 200, payload); };

  if (params.k !== chaveWebhook()) {
    // Grava mesmo assim: e exatamente o sintoma de APP_SECRET trocado.
    await anota({ decisao: 'chave invalida', chave_recebida: String(params.k || '').slice(0, 8) + '…' });
    return u.json(res, 401, { ok: false, error: 'chave invalida' });
  }
  if (req.method === 'GET') {
    return responder({ ok: true, servico: 'webhook whatsapp da Aurea', pronto: true });
  }

  let body;
  try { body = await u.readBody(req); } catch (e) { return responder({ ok: true, ignorado: 'corpo invalido' }); }

  try {
    const evento = body.event || body.Event || '';
    const d0 = body.data || body.Data || body;
    const k0 = d0.key || {};
    const de0 = String(k0.remoteJid || d0.remoteJid || '').split('@')[0];

    async function descarta(motivo) {
      await anota({ decisao: motivo, evento: evento || '(sem evento)', de: de0, de_mim: !!k0.fromMe });
      return responder({ ok: true, ignorado: motivo });
    }

    if (evento && evento.replace('.', '_').toLowerCase().indexOf('messages_upsert') < 0) {
      return descarta('evento ' + evento);
    }

    const d = d0;
    const key = k0;
    if (key.fromMe) return descarta('mensagem nossa');

    const jid = String(key.remoteJid || d.remoteJid || '');
    if (jid.indexOf('@g.us') >= 0) return descarta('mensagem de grupo');
    if (jid.indexOf('@broadcast') >= 0) return descarta('status');

    if (jaVista(key.id)) return descarta('repetida');

    const tipo = tipoDaMensagem(d.message);
    const texto = String(extrairTexto(d.message) || '').trim();
    // Video sem legenda nao pode ser descartado: e a entrega do candidato.
    if (!texto && tipo !== 'video') return descarta('sem texto');

    const tail = u.phoneTail(jid.split('@')[0]);
    if (!tail) return descarta('telefone invalido');

    const achados = await db.select('candidates', {
      phone_digits: 'like.*' + tail, archived: 'eq.false',
      order: 'created_at.desc', select: '*', limit: 5
    });

    // Número que não se cadastrou na landing. A regra do funil é clara:
    // a Aurea só fala com quem preencheu o formulário. Quem chega solto
    // fica registrado aqui para alguém do time olhar, e nada é enviado.
    if (!achados.length) {
      await anota({
        decisao: 'sem cadastro na landing', evento: evento, de: de0, texto: texto.slice(0, 60)
      });
      return responder({ ok: true, ignorado: 'sem cadastro na landing' });
    }

    // se houver mais de um, prioriza quem tem conversa aberta
    let candidato = achados[0];
    let sessaoAberta = null;
    const ABERTAS = ['em_andamento', 'escolhendo_vaga'];
    for (const c of achados) {
      const sessoes = await db.select('prequal_sessions', {
        candidate_id: 'eq.' + c.id, order: 'started_at.desc', select: '*', limit: 5
      });
      const s = sessoes.filter(function (x) { return ABERTAS.indexOf(x.status) >= 0; })[0];
      if (s) { candidato = c; sessaoAberta = s; break; }
    }

    // ainda estava decidindo qual vaga quer
    await anota({
      decisao: 'entregue', evento: evento, de: de0, tipo: tipo,
      texto: texto.slice(0, 60) || '(' + tipo + ')', quem: candidato.name
    });

    if (sessaoAberta && sessaoAberta.status === 'escolhendo_vaga') {
      const r = await aurea.receberEscolhaDeVaga(candidato, sessaoAberta, texto);
      return responder({ ok: true, resultado: r });
    }

    // ---- quem veio da landing ----
    // Primeira mensagem: dispara as perguntas e o pedido do vídeo.
    // Depois disso: a Aurea conversa, tira dúvidas, e só fecha quando
    // recebe as respostas E o vídeo.
    // Só entra aqui se a vaga dela for de WhatsApp. Vaga marcada para
    // terminar no site não dispara vídeo nem pré-qualificação — se a
    // pessoa chamar assim mesmo, cai no fluxo normal e a Aurea conversa.
    if (candidato.source === 'landing' && await vagaUsaWhatsApp(candidato)) {
      const r = candidato.wa_sequencia_em
        ? await aurea.acompanharDaLanding(candidato, texto, tipo)
        : await aurea.receberDaLanding(candidato);
      return responder({ ok: true, resultado: r });
    }

    // ---- os outros seguem no fluxo antigo, com a Aurea conversando ----
    const r = sessaoAberta
      ? await aurea.receber(candidato, texto)
      : await aurea.receberSemConversa(candidato, texto);
    return responder({ ok: true, resultado: r });
  } catch (e) {
    console.error('[webhook]', e);
    await anota({ decisao: 'erro', erro: e.message });
    return responder({ ok: true, erro: e.message });
  }
};

module.exports.chaveWebhook = chaveWebhook;
