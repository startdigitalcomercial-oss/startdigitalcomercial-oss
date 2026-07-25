// ============================================================
// Envio de mensagens: E-mail (Resend), WhatsApp (Evolution), SMS (Twilio)
// Nenhuma biblioteca — tudo com fetch nativo.
// Se a chave do canal nao estiver configurada, a mensagem e registrada
// com status "pendente_manual" para envio manual pelo painel.
// ============================================================
'use strict';

const u = require('./util');

// ---------------- E-MAIL (Resend) ----------------
async function sendEmail(opts) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { status: 'pendente_manual', provider: 'resend', error: 'RESEND_API_KEY nao configurada' };
  }
  const from = process.env.MAIL_FROM || 'StartDigital <onboarding@resend.dev>';
  const payload = {
    from: from,
    to: [opts.to],
    subject: opts.subject || '(sem assunto)',
    text: opts.text || '',
    html: opts.html || u.textToEmailHtml(opts.text, opts.subject)
  };
  if (process.env.MAIL_BCC) payload.bcc = [process.env.MAIL_BCC];

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      return { status: 'erro', provider: 'resend', error: (data && (data.message || data.name)) || ('HTTP ' + res.status) };
    }
    return { status: 'enviado', provider: 'resend', id: data.id || null };
  } catch (e) {
    return { status: 'erro', provider: 'resend', error: e.message };
  }
}

// ---------------- WHATSAPP (Evolution API) ----------------
async function sendWhatsApp(opts) {
  const base = (process.env.EVOLUTION_API_URL || '').replace(/\/+$/, '');
  const apiKey = process.env.EVOLUTION_API_KEY;
  const instance = opts.instance || process.env.EVOLUTION_INSTANCE;
  if (!base || !apiKey) {
    return { status: 'pendente_manual', provider: 'evolution', error: 'EVOLUTION_API_URL / EVOLUTION_API_KEY nao configuradas' };
  }
  if (!instance) {
    return { status: 'pendente_manual', provider: 'evolution', error: 'Instancia do WhatsApp nao escolhida (configure no painel, aba Ajustes)' };
  }
  const number = u.normalizePhone(opts.to);
  if (!number) return { status: 'erro', provider: 'evolution', error: 'Telefone invalido' };

  const url = base + '/message/sendText/' + encodeURIComponent(instance);
  const headers = { apikey: apiKey, 'Content-Type': 'application/json' };

  // Evolution v2
  let body = { number: number, text: opts.text || '' };
  try {
    let res = await fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(body) });
    if (res.status === 400 || res.status === 422) {
      // Evolution v1 usa outro formato
      body = { number: number, options: { delay: 400, presence: 'composing' }, textMessage: { text: opts.text || '' } };
      res = await fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(body) });
    }
    const data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      const msg = (data && (data.message || data.error)) || ('HTTP ' + res.status);
      return { status: 'erro', provider: 'evolution', error: typeof msg === 'string' ? msg : JSON.stringify(msg) };
    }
    return { status: 'enviado', provider: 'evolution', id: (data && data.key && data.key.id) || null };
  } catch (e) {
    return { status: 'erro', provider: 'evolution', error: e.message };
  }
}

async function listWhatsAppInstances() {
  const base = (process.env.EVOLUTION_API_URL || '').replace(/\/+$/, '');
  const apiKey = process.env.EVOLUTION_API_KEY;
  if (!base || !apiKey) return [];
  try {
    const res = await fetch(base + '/instance/fetchInstances', { headers: { apikey: apiKey } });
    if (!res.ok) return [];
    const data = await res.json();
    const arr = Array.isArray(data) ? data : (data && data.instances) || [];
    return arr.map(function (it) {
      const inst = it.instance || it;
      return {
        name: inst.instanceName || inst.name || '',
        status: inst.connectionStatus || inst.status || inst.state || '',
        number: inst.owner || inst.number || ''
      };
    }).filter(function (i) { return i.name; });
  } catch (e) {
    return [];
  }
}

// ---------------- SMS (Twilio, opcional) ----------------
async function sendSms(opts) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (!sid || !token || !from) {
    return { status: 'pendente_manual', provider: 'nenhum', error: 'Nenhum provedor de SMS configurado' };
  }
  const to = '+' + u.normalizePhone(opts.to);
  const form = new URLSearchParams();
  form.set('To', to);
  form.set('From', from);
  form.set('Body', (opts.text || '').slice(0, 480));
  try {
    const res = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + sid + '/Messages.json', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(sid + ':' + token).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: form.toString()
    });
    const data = await res.json().catch(function () { return {}; });
    if (!res.ok) return { status: 'erro', provider: 'twilio', error: (data && data.message) || ('HTTP ' + res.status) };
    return { status: 'enviado', provider: 'twilio', id: data.sid || null };
  } catch (e) {
    return { status: 'erro', provider: 'twilio', error: e.message };
  }
}

function providerStatus() {
  return {
    email: !!process.env.RESEND_API_KEY,
    whatsapp: !!(process.env.EVOLUTION_API_URL && process.env.EVOLUTION_API_KEY),
    sms: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM)
  };
}

module.exports = { sendEmail, sendWhatsApp, sendSms, listWhatsAppInstances, providerStatus };
