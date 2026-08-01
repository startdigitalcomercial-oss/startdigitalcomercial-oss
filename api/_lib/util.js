// ============================================================
// Utilidades compartilhadas
// ============================================================
'use strict';

const crypto = require('crypto');

// ---------- Resposta HTTP ----------
function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function ok(res, payload) { json(res, 200, Object.assign({ ok: true }, payload || {})); }
function fail(res, status, message, extra) {
  json(res, status, Object.assign({ ok: false, error: message }, extra || {}));
}

// ---------- Corpo da requisicao ----------
async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      try { return JSON.parse(req.body); } catch (e) { return {}; }
    }
    return req.body;
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  try { return JSON.parse(raw); } catch (e) { return {}; }
}

// ---------- Tokens e assinatura ----------
function appSecret() {
  return process.env.APP_SECRET || process.env.ADMIN_SECRET || 'start-rh-dev-secret';
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function hmac(data) {
  return b64url(crypto.createHmac('sha256', appSecret()).update(data).digest());
}

// Token de sessao do painel: payload.assinatura
function signSession(payload) {
  const body = b64url(JSON.stringify(payload));
  return body + '.' + hmac(body);
}

function verifySession(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const parts = token.split('.');
  const body = parts[0];
  const sig = parts[1];
  const expected = hmac(body);
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); }
  catch (e) { return null; }
  if (!payload || !payload.exp || payload.exp < Date.now()) return null;
  return payload;
}

function requireAdmin(req, res) {
  const auth = req.headers['authorization'] || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  const session = verifySession(token);
  if (!session || session.role !== 'admin') {
    fail(res, 401, 'Sessao expirada. Faca login novamente.');
    return null;
  }
  return session;
}

// Token pessoal do candidato (vai na URL dos links)
function candidateToken() {
  return crypto.randomBytes(18).toString('base64').replace(/\+/g, '').replace(/\//g, '').replace(/=+$/, '').slice(0, 22);
}

function safeEqual(a, b) {
  a = String(a || ''); b = String(b || '');
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}


// ---------- Senha do candidato ----------
function hashPassword(senha, saltHex) {
  const salt = saltHex || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(senha), salt, 32).toString('hex');
  return { hash: hash, salt: salt };
}

function checkPassword(senha, hash, salt) {
  if (!hash || !salt) return false;
  try {
    const calc = crypto.scryptSync(String(senha), salt, 32);
    const alvo = Buffer.from(hash, 'hex');
    if (calc.length !== alvo.length) return false;
    return crypto.timingSafeEqual(calc, alvo);
  } catch (e) { return false; }
}

// Sessao do candidato (12 horas)
function signCandidateSession(candidateId) {
  return signSession({ role: 'candidato', cid: candidateId, exp: Date.now() + 12 * 3600 * 1000 });
}

function candidateFromRequest(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  const s = verifySession(token);
  if (!s || s.role !== 'candidato' || !s.cid) return null;
  return s.cid;
}

// ---------- Telefone: ultimos 8 digitos para casar com o WhatsApp ----------
function phoneTail(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  return d.length >= 8 ? d.slice(-8) : '';
}

// ---------- Texto ----------
function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

// Endereço público do sistema.
// Se APP_URL não estiver configurada, ele é descoberto sozinho a partir
// do endereço pelo qual a requisição chegou (dominio da Vercel).
let BASE_DESCOBERTA = '';

function setBaseFromReq(req) {
  try {
    const host = req.headers['x-forwarded-host'] || req.headers['host'] || '';
    if (!host) return;
    const proto = req.headers['x-forwarded-proto'] ||
      (host.indexOf('localhost') === 0 || host.indexOf('127.') === 0 ? 'http' : 'https');
    BASE_DESCOBERTA = proto + '://' + host;
  } catch (e) { /* ignora */ }
}

function appUrl() {
  const u = process.env.APP_URL || BASE_DESCOBERTA || '';
  return u.replace(/\/+$/, '');
}

function candidateLinks(candidate) {
  const base = appUrl();
  const t = candidate.token;
  return {
    link_portal: base + '/portal?t=' + t,
    link_disc: base + '/disc?t=' + t,
    link_quiz: base + '/prova?t=' + t,
    link_senha: base + '/criar-senha?t=' + t,
    link_entrar: base + '/entrar'
  };
}

// Substitui {{variaveis}} no texto
function renderTemplate(text, vars) {
  return String(text || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, function (m, key) {
    const v = vars[key];
    return v === undefined || v === null ? '' : String(v);
  });
}

function templateVars(candidate, company) {
  const links = candidateLinks(candidate);
  return Object.assign({
    nome: candidate.name || '',
    primeiro_nome: firstName(candidate.name),
    email: candidate.email || '',
    telefone: candidate.phone || '',
    cidade: candidate.city || '',
    vaga: candidate.role_applied || 'a vaga',
    empresa: (company && company.name) || 'StartDigital',
    site: (company && company.site) || '',
    email_suporte: (company && company.support_email) || ''
  }, links);
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ============================================================
// E-MAIL: transforma o texto simples do modelo em um e-mail bonito.
//
// O time escreve texto puro no painel. Esta funcao le esse texto e
// reconhece sozinha quatro coisas:
//   1. linha em MAIUSCULAS  -> vira um titulo de secao
//   2. linha que e so um link -> vira um botao de verdade
//   3. linhas "Rotulo: valor" -> viram um quadro destacado
//   4. "Equipe StartDigital"  -> vira assinatura
// Tudo com estilo em linha e tabelas, que e o que e-mail entende.
// ============================================================
const COR = {
  fundo: '#f5f5f7',
  cartao: '#ffffff',
  topo: '#111214',
  tinta: '#1d1d1f',
  tinta2: '#515154',
  tinta3: '#86868b',
  fio: '#e5e5ea',
  suave: '#f5f5f7',
  destaque: '#00a15c',
  destaqueSuave: '#eaf7f0'
};

// O texto do botao muda conforme o destino do link.
function rotuloBotao(url) {
  const u = String(url || '');
  if (u.indexOf('/criar-senha-painel') >= 0) return 'Criar a minha senha do painel';
  if (u.indexOf('/criar-senha') >= 0) return 'Criar a minha senha';
  if (u.indexOf('/portal') >= 0) return 'Abrir a área de integração';
  if (u.indexOf('/disc') >= 0) return 'Fazer o teste de perfil';
  if (u.indexOf('/prova') >= 0) return 'Abrir o quiz';
  if (u.indexOf('/entrar') >= 0) return 'Entrar na minha conta';
  if (u.indexOf('/vaga') >= 0) return 'Ver a vaga';
  return 'Abrir o link';
}

function ehSoLink(linha) {
  return /^https?:\/\/\S+$/i.test(String(linha).trim());
}

// "O QUE ACONTECE AGORA" -> titulo. Precisa ter letras e nenhuma minuscula.
function ehTitulo(linha) {
  const t = String(linha).trim();
  if (!t || t.length > 64) return false;
  if (!/[A-ZÀ-Þ]/.test(t)) return false;
  if (/[a-zà-þ]/.test(t)) return false;
  return !/^https?:/i.test(t);
}

function ehCampo(linha) {
  return /^[^:]{2,28}:\s*.+$/.test(String(linha).trim()) && !/^https?:/i.test(String(linha).trim());
}

function botaoHtml(url) {
  const u = escapeHtml(url);
  return '' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 14px">' +
      '<tr><td align="center" bgcolor="' + COR.destaque + '" style="border-radius:980px">' +
        '<a href="' + u + '" target="_blank" style="display:inline-block;padding:14px 30px;' +
          'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;' +
          'font-size:15px;font-weight:600;letter-spacing:-.01em;color:#ffffff;text-decoration:none;border-radius:980px">' +
          escapeHtml(rotuloBotao(url)) +
        '</a>' +
      '</td></tr>' +
    '</table>' +
    '<p style="margin:0 0 20px;font-size:12.5px;line-height:1.6;color:' + COR.tinta3 + '">' +
      'Se o botão não abrir, copie e cole este endereço no navegador:<br>' +
      '<a href="' + u + '" style="color:' + COR.tinta3 + ';word-break:break-all">' + u + '</a>' +
    '</p>';
}

function corpoEmail(text) {
  const linhas = String(text || '').replace(/\r/g, '').split('\n');
  let html = '';
  let paragrafo = [];
  let campos = [];

  function fechaParagrafo() {
    if (!paragrafo.length) return;
    html += '<p style="margin:0 0 16px;font-size:15.5px;line-height:1.62;color:' + COR.tinta2 + '">' +
      paragrafo.map(escapeHtml).join('<br>') + '</p>';
    paragrafo = [];
  }
  function fechaCampos() {
    if (!campos.length) return;
    html += '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ' +
      'style="margin:0 0 20px;background:' + COR.suave + ';border-radius:12px">' +
      '<tr><td style="padding:16px 18px">' +
      campos.map(function (l) {
        const i = l.indexOf(':');
        const rot = l.slice(0, i).trim();
        const val = l.slice(i + 1).trim();
        return '<div style="font-size:14px;line-height:1.7;color:' + COR.tinta + '">' +
          '<span style="color:' + COR.tinta3 + '">' + escapeHtml(rot) + ':</span> ' +
          '<strong style="font-weight:600">' + escapeHtml(val) + '</strong></div>';
      }).join('') +
      '</td></tr></table>';
    campos = [];
  }
  function fecha() { fechaParagrafo(); fechaCampos(); }

  for (let i = 0; i < linhas.length; i++) {
    const bruta = linhas[i];
    const linha = bruta.trim();

    if (!linha) { fecha(); continue; }

    if (ehSoLink(linha)) { fecha(); html += botaoHtml(linha); continue; }

    if (ehTitulo(linha)) {
      fecha();
      html += '<p style="margin:26px 0 10px;font-size:11.5px;font-weight:700;letter-spacing:.08em;' +
        'text-transform:uppercase;color:' + COR.destaque + '">' + escapeHtml(linha) + '</p>';
      continue;
    }

    if (/^equipe\s+startdigital$/i.test(linha)) {
      fecha();
      html += '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:26px 0 0">' +
        '<tr><td style="border-top:1px solid ' + COR.fio + ';padding-top:18px;font-size:14.5px;color:' + COR.tinta + '">' +
        '<strong style="font-weight:600">Equipe StartDigital</strong>' +
        '<div style="font-size:13px;color:' + COR.tinta3 + ';margin-top:2px">Agência de marketing digital</div>' +
        '</td></tr></table>';
      continue;
    }

    if (ehCampo(linha)) { fechaParagrafo(); campos.push(linha); continue; }

    fechaCampos();
    paragrafo.push(bruta.trim());
  }
  fecha();
  return html;
}

// Texto simples -> HTML de e-mail
// opts.etiqueta = a palavrinha cinza ao lado da marca no topo
// opts.rodape    = as duas linhas discretas do rodape
// Sem opts, continua exatamente como era: "Recrutamento" e o aviso do
// processo seletivo — que e o certo para os e-mails de candidato.
function textToEmailHtml(text, title, opts) {
  opts = opts || {};
  const etiqueta = opts.etiqueta || 'Recrutamento';
  const rodape = opts.rodape ||
    ('Mensagem automática do processo seletivo da StartDigital.<br>' +
     'Se você não se candidatou a nenhuma vaga, pode ignorar este e-mail.');
  const previa = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 110);
  const fonte = '-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif';

  return '<!doctype html>' +
'<html lang="pt-BR"><head>' +
'<meta charset="utf-8">' +
'<meta name="viewport" content="width=device-width,initial-scale=1">' +
'<meta name="color-scheme" content="light dark">' +
'<meta name="supported-color-schemes" content="light dark">' +
'<title>' + escapeHtml(title || 'StartDigital') + '</title>' +
'<style>' +
'  a{color:' + COR.destaque + '}' +
'  @media (max-width:620px){ .env{padding:14px !important} .bloco{padding:26px 22px !important} }' +
'  @media (prefers-color-scheme:dark){' +
'    .bg{background:#000000 !important}' +
'    .cartao{background:#1c1c1e !important}' +
'    .txt{color:#ebebf0 !important}' +
'    .txt2{color:#aeaeb2 !important}' +
'    .caixa{background:#2c2c2e !important}' +
'    .fio{border-color:#3a3a3c !important}' +
'    .rodape{background:#161618 !important}' +
'  }' +
'</style>' +
'</head>' +
'<body class="bg" style="margin:0;padding:0;background:' + COR.fundo + ';">' +

// linha de previa que aparece na lista da caixa de entrada, sem aparecer no corpo
'<div style="display:none;max-height:0;overflow:hidden;opacity:0">' + escapeHtml(previa) + '</div>' +

'<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="bg" style="background:' + COR.fundo + '">' +
'<tr><td align="center" class="env" style="padding:28px 16px 40px">' +

'<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" class="cartao" ' +
  'style="width:100%;max-width:600px;background:' + COR.cartao + ';border-radius:16px;overflow:hidden;' +
  'font-family:' + fonte + '">' +

  // topo escuro com a marca
  '<tr><td style="background:' + COR.topo + ';padding:22px 32px">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>' +
      '<td style="padding-right:9px">' +
        '<div style="width:9px;height:9px;border-radius:50%;background:' + COR.destaque + ';font-size:0;line-height:0">&nbsp;</div>' +
      '</td>' +
      '<td style="font-family:' + fonte + ';font-size:16px;font-weight:600;letter-spacing:-.015em;color:#ffffff">' +
        'StartDigital' +
        '<span style="font-weight:400;color:#8e8e93;margin-left:8px;font-size:13.5px">' + escapeHtml(etiqueta) + '</span>' +
      '</td>' +
    '</tr></table>' +
  '</td></tr>' +

  // conteudo
  '<tr><td class="bloco txt" style="padding:32px 32px 30px;color:' + COR.tinta + '">' +
    corpoEmail(text) +
  '</td></tr>' +

'</table>' +

// rodape fora do cartao, discreto
'<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%;max-width:600px">' +
  '<tr><td align="center" style="padding:20px 24px 0">' +
    '<p class="txt2" style="margin:0;font-family:' + fonte + ';font-size:12px;line-height:1.65;color:' + COR.tinta3 + '">' +
      rodape +
    '</p>' +
  '</td></tr>' +
'</table>' +

'</td></tr></table>' +
'</body></html>';
}

// ---------- Telefone ----------
function normalizePhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length <= 11) d = '55' + d;              // numero brasileiro sem DDI
  if (d.startsWith('550')) d = '55' + d.slice(3); // remove zero do DDD
  return d;
}

// ---------- Validacao ----------
function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '').trim());
}

module.exports = {
  json, ok, fail, readBody,
  signSession, verifySession, requireAdmin, candidateToken, safeEqual,
  firstName, appUrl, setBaseFromReq, candidateLinks, renderTemplate, templateVars,
  hashPassword, checkPassword, signCandidateSession, candidateFromRequest, phoneTail,
  escapeHtml, textToEmailHtml, normalizePhone, isEmail
};
