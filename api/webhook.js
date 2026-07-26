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
    return u.json(res, 401, { ok: false, error: 'chave invalida' });
  }
  if (req.method === 'GET') {
    return responder({ ok: true, servico: 'webhook whatsapp da Aurea', pronto: true });
  }

  let body;
  try { body = await u.readBody(req); } catch (e) { return responder({ ok: true, ignorado: 'corpo invalido' }); }

  try {
    const evento = body.event || body.Event || '';
    if (evento && evento.replace('.', '_').toLowerCase().indexOf('messages_upsert') < 0) {
      return responder({ ok: true, ignorado: 'evento ' + evento });
    }

    const d = body.data || body.Data || body;
    const key = d.key || {};
    if (key.fromMe) return responder({ ok: true, ignorado: 'mensagem nossa' });

    const jid = String(key.remoteJid || d.remoteJid || '');
    if (jid.indexOf('@g.us') >= 0) return responder({ ok: true, ignorado: 'mensagem de grupo' });
    if (jid.indexOf('@broadcast') >= 0) return responder({ ok: true, ignorado: 'status' });

    if (jaVista(key.id)) return responder({ ok: true, ignorado: 'repetida' });

    const texto = String(extrairTexto(d.message) || '').trim();
    if (!texto) return responder({ ok: true, ignorado: 'sem texto' });

    const tail = u.phoneTail(jid.split('@')[0]);
    if (!tail) return responder({ ok: true, ignorado: 'telefone invalido' });

    const achados = await db.select('candidates', {
      phone_digits: 'like.*' + tail, archived: 'eq.false',
      order: 'created_at.desc', select: '*', limit: 5
    });
    if (!achados.length) {
      return responder({ ok: true, ignorado: 'numero nao cadastrado' });
    }

    // se houver mais de um, prioriza quem tem conversa em andamento
    let candidato = achados[0];
    if (achados.length > 1) {
      for (const c of achados) {
        const s = await db.selectOne('prequal_sessions', {
          candidate_id: 'eq.' + c.id, status: 'eq.em_andamento', select: 'id'
        });
        if (s) { candidato = c; break; }
      }
    }

    const r = await aurea.receber(candidato, texto);
    return responder({ ok: true, resultado: r });
  } catch (e) {
    console.error('[webhook]', e);
    return responder({ ok: true, erro: e.message });
  }
};

module.exports.chaveWebhook = chaveWebhook;
