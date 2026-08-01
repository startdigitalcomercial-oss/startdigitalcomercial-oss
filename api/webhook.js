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

    const texto = String(extrairTexto(d.message) || '').trim();
    if (!texto) return descarta('sem texto');

    const tail = u.phoneTail(jid.split('@')[0]);
    if (!tail) return descarta('telefone invalido');

    const achados = await db.select('candidates', {
      phone_digits: 'like.*' + tail, archived: 'eq.false',
      order: 'created_at.desc', select: '*', limit: 5
    });

    // Número novo: veio do botão da landing. A Aurea abre a porta,
    // descobre a vaga pela mensagem e começa a pré-qualificação.
    if (!achados.length) {
      await anota({ decisao: 'entregue (numero novo)', evento: evento, de: de0, texto: texto.slice(0, 60) });
      const r = await aurea.receberDeDesconhecido({
        telefone: jid.split('@')[0],
        nome: d.pushName || d.pushname || (body.data && body.data.pushName) || '',
        texto: texto
      });
      return responder({ ok: true, resultado: r });
    }

    // se houver mais de um, prioriza quem tem conversa aberta
    let candidato = achados[0];
    let sessaoAberta = null;
    for (const c of achados) {
      const s = await db.selectOne('prequal_sessions', {
        candidate_id: 'eq.' + c.id, status: 'in.(em_andamento,escolhendo_vaga)',
        order: 'started_at.desc', select: '*'
      });
      if (s) { candidato = c; sessaoAberta = s; break; }
    }

    // ainda estava decidindo qual vaga quer
    await anota({ decisao: 'entregue', evento: evento, de: de0, texto: texto.slice(0, 60), quem: candidato.name });

    if (sessaoAberta && sessaoAberta.status === 'escolhendo_vaga') {
      const r = await aurea.receberEscolhaDeVaga(candidato, sessaoAberta, texto);
      return responder({ ok: true, resultado: r });
    }

    const r = await aurea.receber(candidato, texto);
    return responder({ ok: true, resultado: r });
  } catch (e) {
    console.error('[webhook]', e);
    await anota({ decisao: 'erro', erro: e.message });
    return responder({ ok: true, erro: e.message });
  }
};

module.exports.chaveWebhook = chaveWebhook;
