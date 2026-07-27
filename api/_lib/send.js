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
      let erro = (data && (data.message || data.name)) || ('HTTP ' + res.status);
      if (/verify a domain|only send testing emails/i.test(String(erro))) {
        erro = 'O Resend ainda está em modo de teste: só entrega e-mail para o seu próprio endereço. ' +
               'Verifique um domínio em resend.com/domains e troque a variável MAIL_FROM na Vercel. (Original: ' + erro + ')';
      }
      return { status: 'erro', provider: 'resend', error: erro };
    }
    return { status: 'enviado', provider: 'resend', id: data.id || null };
  } catch (e) {
    return { status: 'erro', provider: 'resend', error: e.message };
  }
}

// ---------------- WHATSAPP (Evolution API) ----------------
// Le a mensagem de erro REAL da Evolution. Ela costuma esconder o motivo
// dentro de response.message (as vezes uma lista), e deixar so
// "Bad Request" no campo error — que nao ajuda ninguem.
function erroEvolution(data, status) {
  function achata(x) {
    if (x === null || x === undefined) return '';
    if (typeof x === 'string') return x;
    if (Array.isArray(x)) return x.map(achata).filter(Boolean).join(' | ');
    if (typeof x === 'object') {
      if (x.message !== undefined) return achata(x.message);
      if (x.error !== undefined && typeof x.error !== 'string') return achata(x.error);
      try { return JSON.stringify(x); } catch (e) { return String(x); }
    }
    return String(x);
  }
  const partes = [];
  if (data && data.response) partes.push(achata(data.response));
  if (data && data.message) partes.push(achata(data.message));
  if (data && typeof data.error === 'string') partes.push(data.error);
  if (typeof data === 'string' && data) partes.push(data.slice(0, 300));
  const txt = partes.filter(Boolean).join(' — ');
  return txt || ('HTTP ' + status);
}

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
  let number = u.normalizePhone(opts.to);
  if (!number) return { status: 'erro', provider: 'evolution', error: 'Telefone invalido' };

  // No Brasil existe a bagunca do nono digito: a conta pode estar registrada
  // no WhatsApp SEM o 9 (numeros antigos). Se mandarmos para o numero errado,
  // a Evolution aceita e diz "enviado", mas nada chega.
  // Entao perguntamos a ela qual e o endereco de verdade (o "jid") e usamos ele.
  let numeroReal = null;
  try {
    const cheque = await waNumeroExiste(number, instance);
    if (cheque.ok && cheque.existe && cheque.jid) {
      const d = String(cheque.jid).split('@')[0].replace(/\D/g, '');
      if (d && d !== number) { numeroReal = d; number = d; }
    }
  } catch (e) { /* se nao der para checar, seguimos com o numero montado */ }

  const url = base + '/message/sendText/' + encodeURIComponent(instance);
  const headers = { apikey: apiKey, 'Content-Type': 'application/json' };

  const texto = String(opts.text || '');
  if (!texto.trim()) {
    return { status: 'erro', provider: 'evolution', error: 'Mensagem vazia (o modelo nao gerou texto).' };
  }

  async function tentativa(body) {
    const res = await fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(body) });
    const bruto = await res.text();
    let data = null;
    if (bruto) { try { data = JSON.parse(bruto); } catch (e) { data = bruto; } }
    return { ok: res.ok, status: res.status, data: data };
  }

  try {
    // 1) Evolution v2. linkPreview:false e importante: quando a mensagem tem um
    //    link, a Evolution tenta baixar a previa do site e o envio quebra
    //    ("Bad Request" / "Internal Server Error"). Sem previa, vai sempre.
    let r = await tentativa({ number: number, text: texto, linkPreview: false });

    // 2) versoes antigas nao conhecem "linkPreview" e recusam o corpo
    if (!r.ok && (r.status === 400 || r.status === 422)) {
      r = await tentativa({ number: number, text: texto });
    }

    // 3) Evolution v1 usa outro formato de corpo
    if (!r.ok && (r.status === 400 || r.status === 422)) {
      const r3 = await tentativa({
        number: number,
        options: { delay: 400, presence: 'composing', linkPreview: false },
        textMessage: { text: texto }
      });
      if (r3.ok) r = r3;
      else if (erroEvolution(r3.data, r3.status).length > erroEvolution(r.data, r.status).length) r = r3;
    }

    if (!r.ok) {
      return {
        status: 'erro',
        provider: 'evolution',
        error: erroEvolution(r.data, r.status) + ' [numero ' + number + ']'
      };
    }
    const d = r.data || {};
    // A Evolution devolve o estado da mensagem. "PENDING" quer dizer que ela
    // aceitou mas ainda nao entregou ao WhatsApp — util para diferenciar
    // "saiu daqui" de "chegou la".
    const estado = d.status || (d.key ? 'ACEITA' : null);
    return {
      status: 'enviado',
      provider: 'evolution',
      id: (d.key && d.key.id) || null,
      estado: estado,
      numero: number,
      numero_corrigido: numeroReal
    };
  } catch (e) {
    return { status: 'erro', provider: 'evolution', error: e.message };
  }
}

// Pergunta para a Evolution se um numero realmente existe no WhatsApp.
async function waNumeroExiste(telefone, instancia) {
  const base = (process.env.EVOLUTION_API_URL || '').replace(/\/+$/, '');
  const apiKey = process.env.EVOLUTION_API_KEY;
  const inst = instancia || process.env.EVOLUTION_INSTANCE;
  if (!base || !apiKey || !inst) return { ok: false, error: 'Evolution nao configurada.' };
  const number = u.normalizePhone(telefone);
  try {
    const res = await fetch(base + '/chat/whatsappNumbers/' + encodeURIComponent(inst), {
      method: 'POST',
      headers: { apikey: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ numbers: [number] })
    });
    const bruto = await res.text();
    let data = null;
    if (bruto) { try { data = JSON.parse(bruto); } catch (e) { data = bruto; } }
    if (!res.ok) return { ok: false, numero: number, error: erroEvolution(data, res.status) };
    const arr = Array.isArray(data) ? data : [];
    const achou = arr[0] || {};
    return {
      ok: true,
      numero: number,
      existe: achou.exists === true,
      jid: achou.jid || null
    };
  } catch (e) {
    return { ok: false, numero: number, error: e.message };
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

// ---------------- SMS ----------------
// Dois provedores: Comtele (brasileira, numero nacional) e Twilio.
// Se a chave da Comtele existir, ela tem preferencia.

// SMS com acento vira UCS-2 e o limite cai de 160 para 70 caracteres —
// a mesma mensagem passa a custar 2 ou 3 creditos. Entao tiramos os acentos.
function semAcento(txt) {
  return String(txt || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\x00-\x7F]/g, '');
}

// A Comtele quer DDD + numero, sem o 55 do Brasil na frente.
function telefoneNacional(raw) {
  let d = u.normalizePhone(raw);
  if (d.indexOf('55') === 0 && d.length > 11) d = d.slice(2);
  return d;
}

async function sendSmsComtele(opts) {
  const chave = process.env.COMTELE_API_KEY;
  const numero = telefoneNacional(opts.to);
  if (!numero || numero.length < 10) {
    return { status: 'erro', provider: 'comtele', error: 'Telefone invalido: ' + (opts.to || '') };
  }
  const corpo = {
    Sender: process.env.COMTELE_SENDER || 'StartDigital',
    Receivers: numero,
    Content: semAcento(opts.text).slice(0, 460)
  };
  try {
    const res = await fetch('https://sms.comtele.com.br/api/v2/send', {
      method: 'POST',
      headers: { 'auth-key': chave, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo)
    });
    const bruto = await res.text();
    let data = null;
    if (bruto) { try { data = JSON.parse(bruto); } catch (e) { data = bruto; } }
    const okApi = data && data.Success === true;
    if (!res.ok || !okApi) {
      const msg = (data && (data.Message || data.message)) ||
        (typeof data === 'string' ? data.slice(0, 200) : '') || ('HTTP ' + res.status);
      return { status: 'erro', provider: 'comtele', error: msg + ' [numero ' + numero + ']' };
    }
    return {
      status: 'enviado', provider: 'comtele',
      id: (data.Object && data.Object.requestUniqueId) || null
    };
  } catch (e) {
    return { status: 'erro', provider: 'comtele', error: e.message };
  }
}

async function sendSms(opts) {
  if (process.env.COMTELE_API_KEY) return sendSmsComtele(opts);

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

module.exports = { sendEmail, sendWhatsApp, sendSms, listWhatsAppInstances, providerStatus, waNumeroExiste };

// ============================================================
// GESTÃO DA INSTÂNCIA DO WHATSAPP (Evolution API)
// Criar, mostrar o QR code, ver o estado e ligar o webhook.
// ============================================================
function evoBase() {
  return (process.env.EVOLUTION_API_URL || '').replace(/\/+$/, '');
}
function evoKey() {
  return process.env.EVOLUTION_API_KEY || '';
}
function evoPronta() {
  return !!(evoBase() && evoKey());
}

async function evoFetch(caminho, opts) {
  opts = opts || {};
  const res = await fetch(evoBase() + caminho, {
    method: opts.method || 'GET',
    headers: { apikey: evoKey(), 'Content-Type': 'application/json' },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
  });
  const texto = await res.text();
  let data = null;
  if (texto) { try { data = JSON.parse(texto); } catch (e) { data = texto; } }
  return { ok: res.ok, status: res.status, data: data };
}

// cria a instância e já devolve o QR code
async function waCriarInstancia(nome) {
  if (!evoPronta()) return { ok: false, error: 'EVOLUTION_API_URL / EVOLUTION_API_KEY nao configuradas.' };
  const r = await evoFetch('/instance/create', {
    method: 'POST',
    body: { instanceName: nome, qrcode: true, integration: 'WHATSAPP-BAILEYS' }
  });
  if (!r.ok) {
    const msg = (r.data && (r.data.message || r.data.error)) || ('HTTP ' + r.status);
    // se ja existe, seguimos para o connect normalmente
    if (String(JSON.stringify(msg)).toLowerCase().indexOf('already') >= 0 || r.status === 403) {
      return waQrCode(nome);
    }
    return { ok: false, error: typeof msg === 'string' ? msg : JSON.stringify(msg) };
  }
  const q = r.data && r.data.qrcode;
  return {
    ok: true, criada: true,
    base64: (q && (q.base64 || q.code)) || null,
    pairingCode: (q && q.pairingCode) || null
  };
}

// pede o QR code de uma instância que já existe
async function waQrCode(nome) {
  if (!evoPronta()) return { ok: false, error: 'Evolution nao configurada.' };
  const r = await evoFetch('/instance/connect/' + encodeURIComponent(nome));
  if (!r.ok) {
    const msg = (r.data && (r.data.message || r.data.error)) || ('HTTP ' + r.status);
    return { ok: false, error: typeof msg === 'string' ? msg : JSON.stringify(msg) };
  }
  const d = r.data || {};
  return {
    ok: true,
    base64: d.base64 || (d.qrcode && d.qrcode.base64) || null,
    pairingCode: d.pairingCode || (d.qrcode && d.qrcode.pairingCode) || null,
    ja_conectada: d.instance && d.instance.state === 'open'
  };
}

// estado da conexão: open / connecting / close
async function waEstado(nome) {
  if (!evoPronta()) return { ok: false, error: 'Evolution nao configurada.' };
  const r = await evoFetch('/instance/connectionState/' + encodeURIComponent(nome));
  if (!r.ok) return { ok: false, error: 'HTTP ' + r.status };
  const st = (r.data && r.data.instance && (r.data.instance.state || r.data.instance.connectionStatus)) || 'desconhecido';
  return { ok: true, estado: st, conectada: st === 'open' };
}

// apaga a instância de vez (o QR antigo morre com ela)
async function waApagarInstancia(nome) {
  if (!evoPronta()) return { ok: false, error: 'Evolution nao configurada.' };
  const r = await evoFetch('/instance/delete/' + encodeURIComponent(nome), { method: 'DELETE' });
  // 404 = ja nao existe, o que para nos e sucesso
  if (r.status === 404) return { ok: true, ja_nao_existia: true };
  return { ok: r.ok, error: r.ok ? null : erroEvolution(r.data, r.status) };
}

// Recomeça do zero: desconecta, apaga e cria de novo.
// É o que resolve instância travada em "connecting" que nunca aceita o QR.
async function waRecriar(nome) {
  if (!evoPronta()) return { ok: false, error: 'Evolution nao configurada.' };
  await waDesconectar(nome).catch(function () { return null; });
  await waApagarInstancia(nome).catch(function () { return null; });
  // a Evolution precisa de um instante para liberar o nome
  await new Promise(function (r) { setTimeout(r, 1200); });
  const r = await evoFetch('/instance/create', {
    method: 'POST',
    body: { instanceName: nome, qrcode: true, integration: 'WHATSAPP-BAILEYS' }
  });
  if (!r.ok) return { ok: false, error: erroEvolution(r.data, r.status) };
  const q = (r.data && r.data.qrcode) || {};
  return { ok: true, recriada: true, base64: q.base64 || q.code || null, pairingCode: q.pairingCode || null };
}

// apaga todas as instâncias menos a que o sistema usa
async function waLimparOutras(manter) {
  if (!evoPronta()) return { ok: false, error: 'Evolution nao configurada.' };
  const todas = await listWhatsAppInstances();
  const alvos = todas.filter(function (i) { return i.name && i.name !== manter; });
  const apagadas = [];
  const falhas = [];
  for (const i of alvos) {
    const r = await waApagarInstancia(i.name);
    if (r.ok) apagadas.push(i.name);
    else falhas.push({ nome: i.name, erro: r.error });
  }
  return { ok: true, apagadas: apagadas, falhas: falhas };
}

async function waDesconectar(nome) {
  if (!evoPronta()) return { ok: false, error: 'Evolution nao configurada.' };
  const r = await evoFetch('/instance/logout/' + encodeURIComponent(nome), { method: 'DELETE' });
  return { ok: r.ok, error: r.ok ? null : 'HTTP ' + r.status };
}

// liga o webhook da instância no nosso endereço (tenta v2, cai para v1)
async function waWebhook(nome, url) {
  if (!evoPronta()) return { ok: false, error: 'Evolution nao configurada.' };
  const eventos = ['MESSAGES_UPSERT'];

  let r = await evoFetch('/webhook/set/' + encodeURIComponent(nome), {
    method: 'POST',
    body: { webhook: { enabled: true, url: url, webhookByEvents: false, webhookBase64: false, events: eventos } }
  });
  if (!r.ok) {
    r = await evoFetch('/webhook/set/' + encodeURIComponent(nome), {
      method: 'POST',
      body: { url: url, enabled: true, webhook_by_events: false, events: eventos }
    });
  }
  if (!r.ok) {
    const msg = (r.data && (r.data.message || r.data.error)) || ('HTTP ' + r.status);
    return { ok: false, error: typeof msg === 'string' ? msg : JSON.stringify(msg) };
  }
  return { ok: true };
}

module.exports.waCriarInstancia = waCriarInstancia;
module.exports.waQrCode = waQrCode;
module.exports.waEstado = waEstado;
module.exports.waDesconectar = waDesconectar;
module.exports.waWebhook = waWebhook;
module.exports.evoPronta = evoPronta;
module.exports.waApagarInstancia = waApagarInstancia;
module.exports.waRecriar = waRecriar;
module.exports.waLimparOutras = waLimparOutras;
