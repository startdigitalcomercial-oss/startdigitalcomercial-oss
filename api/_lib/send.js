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
    // RESEND_API_URL so existe para os testes apontarem para o espelho local.
    // Em producao fica vazia e vale o endereco de verdade do Resend.
    const base = (process.env.RESEND_API_URL || 'https://api.resend.com').replace(/\/+$/, '');
    const res = await fetch(base + '/emails', {
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
      // O numero conectado vem em nomes diferentes conforme a versao
      // da Evolution. Pega o primeiro que existir e deixa so digitos.
      const cru = inst.ownerJid || inst.owner || inst.number ||
        inst.wuid || (inst.profile && inst.profile.wuid) || '';
      return {
        name: inst.instanceName || inst.name || '',
        status: inst.connectionStatus || inst.status || inst.state || '',
        number: String(cru).split('@')[0].replace(/\D/g, '')
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

// Mostra a cara da chave sem revelar ela: "8e56…2bbe (36 caracteres)".
// Serve para comparar com o que esta no painel sem expor o segredo no log.
function retratoDaChave(bruta) {
  const c = String(bruta == null ? '' : bruta);
  const limpa = c.trim();
  const partes = [];
  partes.push(limpa.length >= 8 ? limpa.slice(0, 4) + '…' + limpa.slice(-4) : '(muito curta)');
  partes.push(limpa.length + ' caracteres');
  if (c !== limpa) partes.push('TINHA ESPAÇO OU QUEBRA DE LINHA SOBRANDO');
  if (/^[A-Z_]+=/.test(limpa)) partes.push('COMEÇA COM O NOME DA VARIÁVEL — tire o "' + limpa.split('=')[0] + '=" do valor');
  if (!/^[0-9a-fA-F-]{36}$/.test(limpa)) partes.push('não tem o formato de chave da Comtele (36 caracteres, só números, letras de a-f e hífens)');
  return partes.join(' · ');
}

function comteleChave() {
  // trim: valor colado na Vercel costuma vir com espaço ou quebra de linha atrás
  return String(process.env.COMTELE_API_KEY || '').trim();
}
function comteleBase() {
  return String(process.env.COMTELE_API_URL || 'https://api.comtele.com.br').replace(/\/+$/, '');
}

async function comteleFetch(caminho, opts) {
  opts = opts || {};
  const res = await fetch(comteleBase() + caminho, {
    method: opts.method || 'GET',
    headers: { 'x-api-key': comteleChave(), 'Content-Type': 'application/json' },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
  });
  const bruto = await res.text();
  let data = null;
  if (bruto) { try { data = JSON.parse(bruto); } catch (e) { data = bruto; } }
  return { ok: res.ok, status: res.status, data: data };
}

// A resposta da Comtele v4 vem em {hasError, message, errors:[...]}
function erroComtele(data, status) {
  if (typeof data === 'string' && data) return data.slice(0, 250);
  const partes = [];
  if (data && data.message) partes.push(String(data.message));
  if (data && Array.isArray(data.errors) && data.errors.length) partes.push(data.errors.join(' | '));
  return partes.filter(Boolean).join(' — ') || ('HTTP ' + status);
}

// A rota decide o preço e a qualidade da entrega. O painel mostra
// "Marketing" (mais barata) e "Premium" (melhor entrega). Para mensagem de
// processo seletivo a gente quer a Premium — marketing costuma ser filtrada.
let ROTAS_CACHE = null;
async function comteleRotas() {
  if (ROTAS_CACHE) return ROTAS_CACHE;
  const r = await comteleFetch('/routes');
  if (!r.ok || !r.data || r.data.hasError === true) {
    return { ok: false, error: erroComtele(r.data, r.status) };
  }
  const lista = Array.isArray(r.data.object) ? r.data.object : [];
  ROTAS_CACHE = { ok: true, rotas: lista };
  return ROTAS_CACHE;
}

async function comteleRotaEscolhida() {
  const fixa = parseInt(process.env.COMTELE_ROUTE || '', 10);
  if (fixa) return { ok: true, id: fixa, nome: 'definida na variável COMTELE_ROUTE' };

  const r = await comteleRotas();
  if (!r.ok) return { ok: false, error: 'Não consegui listar as rotas: ' + r.error };
  if (!r.rotas.length) return { ok: false, error: 'A conta não tem nenhuma rota de envio liberada.' };

  const premium = r.rotas.filter(function (x) { return /premium/i.test(String(x.displayName || x.productName || '')); })[0];
  const escolhida = premium || r.rotas.slice().sort(function (a, b) {
    return (Number(b.farePrice) || 0) - (Number(a.farePrice) || 0);
  })[0];
  return { ok: true, id: escolhida.id, nome: escolhida.displayName || escolhida.productName || ('rota ' + escolhida.id) };
}

// "enviado" na Comtele quer dizer "aceitei e coloquei na fila". Quem diz se
// chegou no celular e o relatorio de entrega — e o unico jeito de saber o
// motivo real quando o SMS some.
async function comteleEntregas(opts) {
  opts = opts || {};
  const dias = Math.max(1, Math.min(30, parseInt(opts.dias, 10) || 2));
  const limite = Math.max(1, Math.min(200, parseInt(opts.limite, 10) || 40));
  const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const r = await comteleFetch('/reports/messages/sent?startDate=' + desde + '&limit=' + limite);
  if (!r.ok || !r.data || r.data.hasError === true) {
    return { ok: false, error: erroComtele(r.data, r.status) };
  }
  const lista = Array.isArray(r.data.object) ? r.data.object : [];
  return {
    ok: true,
    desde: desde,
    mensagens: lista.map(function (m) {
      return {
        id: m.id || null,
        numero: m.receiver || '',
        quando: m.sentAt || m.createdAt || null,
        situacao: m.status || '—',
        detalhe: m.statusDetails || '',
        rota: m.route || '',
        trecho: String(m.content || '').slice(0, 60)
      };
    })
  };
}

async function comteleSaldo() {
  const r = await comteleFetch('/balance');
  if (!r.ok || !r.data || r.data.hasError === true) {
    return { ok: false, error: erroComtele(r.data, r.status) };
  }
  const o = r.data.object;
  const valor = (o && (o.balance !== undefined ? o.balance : o.amount)) !== undefined
    ? (o.balance !== undefined ? o.balance : o.amount)
    : o;
  return { ok: true, saldo: valor };
}

// Envio pela API nova (painel portal.comtele.com.br, GatewayV4).
async function sendSmsComtele(opts) {
  const numero = u.normalizePhone(opts.to); // a v4 quer com o 55 na frente
  if (!numero || numero.length < 12) {
    return { status: 'erro', provider: 'comtele', error: 'Telefone invalido: ' + (opts.to || '') };
  }

  const rota = await comteleRotaEscolhida();
  if (!rota.ok) {
    const pista = /401|chave|unauthor/i.test(String(rota.error))
      ? ' [chave usada: ' + retratoDaChave(process.env.COMTELE_API_KEY) + ']'
      : '';
    return { status: 'erro', provider: 'comtele', error: rota.error + pista };
  }

  // A especificacao da Comtele se contradiz: no exemplo o numero e a rota vao
  // como numero, no esquema vao como texto. Mandamos como no exemplo e, se ela
  // recusar o formato, repetimos como texto.
  const tag = (process.env.COMTELE_SENDER || 'StartDigital-RH').slice(0, 40);
  const texto = semAcento(opts.text).slice(0, 460);
  function montaCorpo(comoTexto) {
    return {
      receivers: [comoTexto ? String(numero) : Number(numero)],
      contactGroups: [],
      message: texto,
      route: comoTexto ? String(rota.id) : rota.id,
      tag: tag,
      custom: 'start-rh',
      scheduleDate: null
    };
  }

  try {
    let r = await comteleFetch('/messages/sms/send', { method: 'POST', body: montaCorpo(false) });
    let deuCerto = r.ok && r.data && r.data.hasError !== true;

    if (!deuCerto && (r.status === 400 || r.status === 422)) {
      const r2 = await comteleFetch('/messages/sms/send', { method: 'POST', body: montaCorpo(true) });
      if (r2.ok && r2.data && r2.data.hasError !== true) { r = r2; deuCerto = true; }
      else if (erroComtele(r2.data, r2.status).length > erroComtele(r.data, r.status).length) r = r2;
    }

    if (!deuCerto) {
      const msg = erroComtele(r.data, r.status);
      const pista = (r.status === 401 || /chave|unauthor/i.test(msg))
        ? ' [chave usada: ' + retratoDaChave(process.env.COMTELE_API_KEY) + ']'
        : '';
      return {
        status: 'erro', provider: 'comtele',
        error: msg + ' [numero ' + numero + ' · rota ' + rota.id + ' ' + rota.nome + ']' + pista
      };
    }
    return {
      status: 'enviado', provider: 'comtele',
      id: (r.data && r.data.object && (r.data.object.id || r.data.object.requestUniqueId)) || null,
      rota: rota.id, rota_nome: rota.nome, numero: numero
    };
  } catch (e) {
    return { status: 'erro', provider: 'comtele', error: e.message };
  }
}

async function sendSms(opts) {
  if (comteleChave()) return sendSmsComtele(opts);

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
  const temComtele = !!comteleChave();
  const temTwilio = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);
  return {
    email: !!process.env.RESEND_API_KEY,
    whatsapp: !!(process.env.EVOLUTION_API_URL && process.env.EVOLUTION_API_KEY),
    sms: temComtele || temTwilio,
    // qual provedor de SMS o sistema esta enxergando agora
    sms_provider: temComtele ? 'Comtele' : (temTwilio ? 'Twilio' : null)
  };
}

module.exports = {
  sendEmail, sendWhatsApp, sendSms, listWhatsAppInstances, providerStatus,
  waNumeroExiste, comteleRotas, comteleRotaEscolhida, comteleEntregas, comteleSaldo
};

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

// Le de volta o que a Evolution REALMENTE guardou como webhook.
// Sem isso a gente configura no escuro: manda o pedido, ela responde
// "ok", e ninguem confere se o endereco que ficou la e o nosso.
async function waWebhookAtual(nome) {
  if (!evoPronta()) return { ok: false, error: 'Evolution nao configurada.' };
  const r = await evoFetch('/webhook/find/' + encodeURIComponent(nome), { method: 'GET' });
  if (!r.ok) {
    return { ok: false, error: 'HTTP ' + r.status, url: null, ligado: null, eventos: [] };
  }
  const d = (r.data && r.data.webhook) ? r.data.webhook : (r.data || {});
  const eventos = d.events || d.Events || [];
  return {
    ok: true,
    url: d.url || d.Url || null,
    ligado: d.enabled !== undefined ? !!d.enabled : (d.Enabled !== undefined ? !!d.Enabled : null),
    eventos: Array.isArray(eventos) ? eventos : []
  };
}

module.exports.waWebhookAtual = waWebhookAtual;
module.exports.waCriarInstancia = waCriarInstancia;
module.exports.waQrCode = waQrCode;
module.exports.waEstado = waEstado;
module.exports.waDesconectar = waDesconectar;
module.exports.waWebhook = waWebhook;
module.exports.evoPronta = evoPronta;
module.exports.waApagarInstancia = waApagarInstancia;
module.exports.waRecriar = waRecriar;
module.exports.waLimparOutras = waLimparOutras;
