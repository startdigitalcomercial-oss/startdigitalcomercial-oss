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

// Texto simples -> HTML de e-mail
function textToEmailHtml(text, title) {
  const paragraphs = String(text || '')
    .split(/\n{2,}/)
    .map(function (p) { return '<p style="margin:0 0 16px;line-height:1.65">' + escapeHtml(p).replace(/\n/g, '<br>') + '</p>'; })
    .join('');
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + escapeHtml(title || '') + '</title></head>' +
    '<body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">' +
    '<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0">' +
    '<div style="background:#0f172a;padding:20px 28px;color:#fff;font-weight:700;font-size:18px;letter-spacing:.3px">StartDigital</div>' +
    '<div style="padding:28px;font-size:15px">' + paragraphs + '</div>' +
    '<div style="padding:16px 28px;background:#f8fafc;color:#64748b;font-size:12px;border-top:1px solid #e2e8f0">' +
    'Esta mensagem foi enviada pelo sistema de recrutamento da StartDigital.</div>' +
    '</div></body></html>';
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
