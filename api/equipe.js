// ============================================================
// Cadastro de colaboradores internos.
// Rota publica: o colaborador abre o link, preenche e recebe
// a confirmacao por e-mail, WhatsApp e SMS.
// ============================================================
'use strict';

const u = require('./_lib/util');
const db = require('./_lib/db');
const send = require('./_lib/send');

// Os campos que o formulario pode gravar. Qualquer coisa fora
// desta lista e ignorada — ninguem escreve no banco pelo que quiser.
const CAMPOS = [
  'name', 'nickname', 'birth_date', 'cpf',
  'email', 'phone',
  'role_title', 'area', 'started_on', 'work_mode',
  'cep', 'street', 'number', 'complement', 'district', 'city', 'state',
  'shirt_size', 'shoe_size'
];

const CAMISAS = ['PP', 'P', 'M', 'G', 'GG', 'XG', 'XGG'];
const MODOS = ['presencial', 'remoto', 'hibrido'];

function soDigitos(v) { return String(v || '').replace(/\D/g, ''); }

// Confere o CPF pelos dois digitos verificadores.
function cpfValido(bruto) {
  const d = soDigitos(bruto);
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;
  for (let volta = 0; volta < 2; volta++) {
    const ate = 9 + volta;
    let soma = 0;
    for (let i = 0; i < ate; i++) soma += Number(d[i]) * (ate + 1 - i);
    let dig = (soma * 10) % 11;
    if (dig === 10) dig = 0;
    if (dig !== Number(d[ate])) return false;
  }
  return true;
}

function dataValida(v) {
  if (!v) return true; // campo opcional
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + 'T12:00:00Z');
  return !isNaN(d.getTime()) && d.getUTCFullYear() > 1900;
}

function limpa(body) {
  const dados = {};
  CAMPOS.forEach(function (c) {
    if (body[c] === undefined || body[c] === null) return;
    let v = String(body[c]).trim();
    if (!v) return;
    if (c === 'cpf') v = soDigitos(v);
    if (c === 'cep') v = soDigitos(v);
    if (c === 'state') v = v.toUpperCase().slice(0, 2);
    if (c === 'shirt_size') v = v.toUpperCase();
    if (c === 'work_mode') v = v.toLowerCase();
    dados[c] = v.slice(0, 400);
  });
  return dados;
}

function valida(d) {
  const erros = [];
  if (!d.name || d.name.length < 3 || d.name.indexOf(' ') < 0) {
    erros.push('Escreva o seu nome completo.');
  }
  if (!u.isEmail(d.email)) erros.push('O e-mail nao parece certo.');
  if (!d.phone || soDigitos(d.phone).length < 10) {
    erros.push('Coloque o WhatsApp com DDD.');
  }
  if (d.cpf && !cpfValido(d.cpf)) erros.push('O CPF nao confere.');
  if (!dataValida(d.birth_date)) erros.push('A data de nascimento nao e valida.');
  if (!dataValida(d.started_on)) erros.push('A data de entrada nao e valida.');
  if (d.cep && d.cep.length !== 8) erros.push('O CEP precisa ter 8 numeros.');
  if (d.shirt_size && CAMISAS.indexOf(d.shirt_size) < 0) {
    erros.push('Tamanho de camisa desconhecido.');
  }
  if (d.work_mode && MODOS.indexOf(d.work_mode) < 0) {
    erros.push('Modo de trabalho desconhecido.');
  }
  if (d.shoe_size) {
    const n = Number(String(d.shoe_size).replace(',', '.'));
    if (!(n >= 30 && n <= 50)) erros.push('O numero do pe precisa ficar entre 30 e 50.');
  }
  return erros;
}

async function boasVindas(colab) {
  const company = await getSetting('company', {});
  const canais = [
    { canal: 'email', chave: 'team_welcome_email' },
    { canal: 'whatsapp', chave: 'team_welcome_whatsapp' },
    { canal: 'sms', chave: 'team_welcome_sms' }
  ];
  const vars = {
    nome: colab.name,
    primeiro_nome: colab.nickname || u.firstName(colab.name),
    email: colab.email,
    telefone: colab.phone || '',
    vaga: colab.role_title || '',
    cargo: colab.role_title || '',
    area: colab.area || '',
    cidade: colab.city || '',
    empresa: (company && company.name) || 'StartDigital'
  };

  const resultados = [];
  for (const c of canais) {
    const modelo = await db.selectOne('message_templates', { key: 'eq.' + c.chave, select: '*' });
    if (!modelo) continue;
    const corpo = u.renderTemplate(modelo.body, vars);
    const assunto = modelo.subject ? u.renderTemplate(modelo.subject, vars) : null;

    let r;
    if (c.canal === 'email') r = await send.sendEmail({ to: colab.email, subject: assunto, text: corpo });
    else if (c.canal === 'whatsapp') r = await send.sendWhatsApp({ to: colab.phone, text: corpo, instance: await instanciaWa() });
    else r = await send.sendSms({ to: colab.phone, text: corpo });

    await db.insert('message_logs', {
      candidate_id: null, channel: c.canal,
      to_address: c.canal === 'email' ? colab.email : colab.phone,
      subject: assunto, body: corpo,
      status: r.status, provider: r.provider, error: r.error || null
    });
    resultados.push({ canal: c.canal, status: r.status, erro: r.error || null });
  }
  return resultados;
}

async function getSetting(key, fallback) {
  const row = await db.selectOne('settings', { key: 'eq.' + key, select: 'key,value' });
  return row ? row.value : fallback;
}
async function instanciaWa() {
  const w = await getSetting('whatsapp', {});
  return (w && w.instance) || process.env.EVOLUTION_INSTANCE;
}

module.exports = async function (req, res) {
  u.setBaseFromReq(req);
  const params = req.query || {};
  const action = params.action || '';

  try {
    // dados para montar a tela (vagas/areas sugeridas e se esta aberto)
    if (action === 'config') {
      const cfg = await getSetting('equipe', {});
      const company = await getSetting('company', {});
      return u.ok(res, {
        aberto: cfg.open !== false,
        titulo: cfg.headline || 'Cadastro do time',
        texto: cfg.subhead || 'Leva menos de 3 minutos. É com esses dados que a gente organiza eventos, brindes e avisos do time.',
        areas: cfg.areas || ['Tráfego', 'Social Media', 'Design', 'Redação', 'Atendimento / CS', 'Comercial', 'Administrativo', 'Liderança'],
        camisas: CAMISAS,
        modos: MODOS,
        empresa: (company && company.name) || 'StartDigital'
      });
    }

    if (action === 'cadastrar') {
      const cfg = await getSetting('equipe', {});
      if (cfg.open === false) return u.fail(res, 403, 'O cadastro está fechado no momento.');

      const body = await u.readBody(req);
      const dados = limpa(body);
      const erros = valida(dados);
      if (erros.length) return u.fail(res, 400, erros[0], { erros: erros });

      const jaTem = await db.selectOne('collaborators', {
        email: 'eq.' + dados.email.toLowerCase(), select: 'id,name'
      });
      if (jaTem) {
        return u.fail(res, 409, 'Já existe um cadastro com este e-mail. Se precisar mudar algum dado, fale com a gente.');
      }

      dados.email = dados.email.toLowerCase();
      dados.source = 'formulario';
      const colab = await db.insert('collaborators', dados);

      let envios = [];
      try {
        envios = await boasVindas(colab);
        await db.update('collaborators', { welcomed_at: new Date().toISOString() }, { id: 'eq.' + colab.id });
      } catch (e) {
        console.error('[equipe] boas-vindas', e);
      }

      return u.ok(res, {
        id: colab.id,
        nome: colab.nickname || u.firstName(colab.name),
        envios: envios
      });
    }

    return u.fail(res, 404, 'Acao desconhecida: ' + action);
  } catch (e) {
    console.error('[equipe]', action, e);
    return u.fail(res, 500, e.message || 'Erro interno');
  }
};

module.exports.cpfValido = cpfValido;
module.exports.CAMISAS = CAMISAS;
