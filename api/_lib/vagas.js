// ============================================================
// VAGAS — o que a landing mostra e o que a Aurea usa para
// saber de qual vaga a pessoa está falando.
// ============================================================
'use strict';

const db = require('./db');

// "Gestor de Tráfego Pago" -> "gestor-de-trafego-pago"
function apelido(texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'vaga';
}

async function apelidoLivre(titulo, ignorarId) {
  const base = apelido(titulo);
  let tentativa = base;
  for (let i = 2; i < 40; i++) {
    const achou = await db.selectOne('jobs', { slug: 'eq.' + tentativa, select: 'id' });
    if (!achou || (ignorarId && achou.id === ignorarId)) return tentativa;
    tentativa = base + '-' + i;
  }
  return base + '-' + Date.now().toString(36);
}

// Listas guardadas como jsonb. O painel manda texto com uma linha
// por item; aqui vira lista de verdade.
function paraLista(v) {
  if (Array.isArray(v)) return v.map(function (x) { return String(x).trim(); }).filter(Boolean);
  return String(v || '').split(/\r?\n/).map(function (x) {
    return x.replace(/^[-•*]\s*/, '').trim();
  }).filter(Boolean);
}

function listaParaTexto(v) {
  return (Array.isArray(v) ? v : []).join('\n');
}

const MODOS = ['presencial', 'remoto', 'hibrido'];
const MODO_NOME = { presencial: 'Presencial', remoto: 'Remoto', hibrido: 'Híbrido' };

// ---------------------------------------------------------------- leitura
async function ativas() {
  return await db.select('jobs', {
    active: 'is.true', order: 'position.asc,created_at.desc', select: '*'
  });
}

async function todas() {
  return await db.select('jobs', { order: 'position.asc,created_at.desc', select: '*' });
}

async function porId(id) {
  if (!id) return null;
  return await db.selectOne('jobs', { id: 'eq.' + id, select: '*' });
}

async function porApelido(slug) {
  if (!slug) return null;
  return await db.selectOne('jobs', { slug: 'eq.' + slug, active: 'is.true', select: '*' });
}

// ---------------------------------------------------------------- para o público
// A landing não precisa (nem deve) receber o id do grupo de perguntas.
function paraPublico(v, base, whatsapp) {
  return {
    slug: v.slug,
    title: v.title,
    summary: v.summary || '',
    description: v.description || '',
    salary: v.salary || '',
    employment_type: v.employment_type || '',
    work_mode: v.work_mode || '',
    work_mode_nome: MODO_NOME[v.work_mode] || '',
    location: v.location || '',
    schedule: v.schedule || '',
    area: v.area || '',
    seniority: v.seniority || '',
    requirements: Array.isArray(v.requirements) ? v.requirements : [],
    responsibilities: Array.isArray(v.responsibilities) ? v.responsibilities : [],
    benefits: Array.isArray(v.benefits) ? v.benefits : [],
    featured: v.featured === true,
    // Esta vaga termina no WhatsApp com a Aurea, ou acaba no proprio site?
    // Quem nao tem a coluna preenchida continua indo pro WhatsApp, que e
    // como o sistema sempre funcionou.
    usa_whatsapp: v.usa_whatsapp !== false,
    link_whatsapp: v.usa_whatsapp === false ? '' : linkWhatsApp(v, whatsapp)
  };
}

// O botão da vaga abre o WhatsApp com a mensagem já escrita.
// É por essa frase que a Aurea descobre a vaga do outro lado.
function textoDoBotao(v) {
  return String(v.whatsapp_message || '').trim() ||
    ('Olá! Tenho interesse na vaga de ' + v.title + '.');
}

function linkWhatsApp(v, numero) {
  const n = String(numero || '').replace(/\D/g, '');
  if (!n) return '';
  return 'https://wa.me/' + n + '?text=' + encodeURIComponent(textoDoBotao(v));
}

// ---------------------------------------------------------------- reconhecer
// Descobre de qual vaga fala a primeira mensagem que chegou no WhatsApp.
// Sem IA: compara o texto com o título e com o apelido de cada vaga.
function semAcento(t) {
  return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// palavras curtas e genéricas não valem como pista
const VAZIAS = new Set(['de', 'da', 'do', 'e', 'a', 'o', 'em', 'para', 'com', 'na', 'no',
  'vaga', 'vagas', 'ola', 'oi', 'tenho', 'interesse', 'gostaria', 'quero',
  'me', 'candidatar', 'sobre', 'the', 'jr', 'pleno', 'senior']);

function reconhecer(texto, lista) {
  const t = semAcento(texto);
  if (!t || !lista || !lista.length) return null;

  let melhor = null, melhorNota = 0;
  for (const v of lista) {
    const titulo = semAcento(v.title);
    let nota = 0;

    // título inteiro dentro da mensagem — praticamente certeza
    if (titulo && t.indexOf(titulo) >= 0) nota += 100;
    // o apelido também aparece se a pessoa colou o link
    if (v.slug && t.indexOf(String(v.slug).toLowerCase()) >= 0) nota += 100;

    // senão, conta quantas palavras do título aparecem
    const palavras = titulo.split(/[^a-z0-9]+/).filter(function (p) {
      return p.length > 2 && !VAZIAS.has(p);
    });
    if (palavras.length) {
      const achadas = palavras.filter(function (p) { return t.indexOf(p) >= 0; }).length;
      if (achadas === palavras.length) nota += 40;
      else nota += achadas * 8;
    }

    if (nota > melhorNota) { melhorNota = nota; melhor = v; }
  }

  // abaixo disso é chute; melhor a Aurea perguntar
  return melhorNota >= 24 ? melhor : null;
}

module.exports = {
  apelido, apelidoLivre, paraLista, listaParaTexto, MODOS, MODO_NOME,
  ativas, todas, porId, porApelido, paraPublico, textoDoBotao, linkWhatsApp, reconhecer
};
