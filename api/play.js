// ============================================================
// START PLAY — a roleta de recompensa.
//
// Duas portas neste arquivo:
//   1. PÚBLICA  — o colaborador abre /play, diz o nome e gira
//   2. PAINEL   — nós, com login, editamos prêmios e vemos o histórico
//
// A REGRA QUE NÃO SE NEGOCIA: quem sorteia é o servidor, com
// crypto.randomInt, e os prêmios ativos têm exatamente a MESMA
// chance. Não existe prêmio raro, prêmio por horário, prêmio por
// quantidade de giros nem compensação. A animação da tela é só a
// encenação de um resultado que já foi decidido aqui.
// ============================================================
'use strict';

const crypto = require('crypto');
const db = require('./_lib/db');
const u = require('./_lib/util');
const porta = require('./_lib/porta');

// As cores que a roda aceita. Guardamos o NOME, não o código —
// assim dá para afinar a paleta inteira sem reescrever o banco.
const CORES = ['roxo', 'lilas', 'azul', 'rosa', 'amarelo', 'verde', 'laranja'];

// Ícones desenhados na tela (SVG). Nome curto, sem biblioteca.
const ICONES = ['dinheiro', 'presente', 'comida', 'folga', 'estrela', 'sorte', 'troreu'];

const SLOTS = 7;           // a roda é de 7 fatias, por desenho

function limpaTexto(v, max) {
  const t = String(v == null ? '' : v).trim().replace(/\s+/g, ' ');
  return t ? t.slice(0, max || 160) : '';
}

function limpaCor(v) {
  const c = String(v || '').trim().toLowerCase();
  return CORES.indexOf(c) >= 0 ? c : 'roxo';
}

function limpaIcone(v) {
  const i = String(v || '').trim().toLowerCase();
  return ICONES.indexOf(i) >= 0 ? i : 'presente';
}

function limpaValor(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
  return isFinite(n) ? n : null;
}

// O que a tela pode ver de um prêmio. Nada de probabilidade aqui:
// não existe probabilidade para mandar — todas são iguais.
function premioParaTela(p) {
  return {
    id: p.id,
    nome: p.nome,
    descricao: p.descricao || '',
    valor: p.valor === null || p.valor === undefined ? null : Number(p.valor),
    icone: p.icone || 'presente',
    cor: p.cor || 'roxo',
    ativo: p.ativo !== false,
    position: Number(p.position) || 1
  };
}

function giroParaTela(g) {
  return {
    id: g.id,
    participante: g.participante,
    premio: g.prize_nome,
    premio_id: g.prize_id || null,
    premio_descricao: g.prize_descricao || '',
    premio_cor: g.prize_cor || 'roxo',
    indice: Number(g.sorteio_indice),
    total: Number(g.sorteio_total),
    quando: g.criado_em
  };
}

async function premiosOrdenados() {
  const lista = await db.select('play_prizes', { order: 'position.asc', select: '*' });
  return lista.sort(function (a, b) { return (Number(a.position) || 0) - (Number(b.position) || 0); });
}

// ------------------------------------------------------------
// O SORTEIO
//
// crypto.randomInt(n) devolve um inteiro de 0 a n-1 com
// distribuição uniforme de verdade — sem o viés de módulo que
// Math.random() + arredondamento costuma esconder. Com 7 prêmios
// ativos cada um sai 1/7 das vezes, ou 14,2857%.
//
// Nada aqui olha para a hora, para o nome da pessoa, para quantos
// giros já aconteceram ou para o que saiu antes. De propósito.
// ------------------------------------------------------------
function sorteia(quantos) {
  return crypto.randomInt(quantos);
}

// ============================================================
module.exports = async function handler(req, res) {
  u.setBaseFromReq(req);
  const url = new URL(req.url, 'http://x');
  const action = url.searchParams.get('action') || '';
  const params = Object.fromEntries(url.searchParams.entries());

  try {
    // ------------------------------------------------ 1) PÚBLICA
    // A roda que o colaborador vê. Só os prêmios ativos, na ordem
    // que o painel definiu.
    if (action === 'play_roleta') {
      const todos = await premiosOrdenados();
      const ativos = todos.filter(function (p) { return p.ativo !== false; });
      return u.ok(res, {
        premios: ativos.map(premioParaTela),
        total: ativos.length,
        pronta: ativos.length >= 2
      });
    }

    // O giro. O nome é obrigatório; o resultado sai daqui.
    if (action === 'play_girar') {
      if (req.method !== 'POST') return u.fail(res, 405, 'Metodo nao permitido');
      const body = await u.readBody(req);

      const nome = limpaTexto(body.nome, 60);
      if (nome.length < 2) {
        return u.fail(res, 400, 'Escreva o seu nome para girar.');
      }

      // Trava contra clique duplo: a tela manda uma etiqueta única
      // por giro. Se o mesmo pedido chegar duas vezes (dedo pesado,
      // internet repetindo), a segunda recebe o MESMO resultado em
      // vez de sortear de novo. Quem garante isso é o índice único.
      const etiqueta = limpaTexto(body.giro_id, 60) || null;
      if (etiqueta) {
        const jaFoi = await db.selectOne('play_spins', { client_token: 'eq.' + etiqueta, select: '*' });
        if (jaFoi) {
          return u.ok(res, { giro: giroParaTela(jaFoi), repetido: true });
        }
      }

      const ativos = (await premiosOrdenados()).filter(function (p) { return p.ativo !== false; });
      if (ativos.length < 2) {
        return u.fail(res, 409, 'A roleta ainda não está pronta. Fale com a Start.');
      }

      const indice = sorteia(ativos.length);
      const premio = ativos[indice];

      const linha = {
        participante: nome,
        prize_id: premio.id,
        // retrato do prêmio agora: se amanhã mudarem o nome, o
        // histórico continua dizendo o que a pessoa ganhou
        prize_nome: premio.nome,
        prize_descricao: premio.descricao || null,
        prize_cor: premio.cor || 'roxo',
        sorteio_indice: indice,
        sorteio_total: ativos.length,
        client_token: etiqueta,
        criado_em: new Date().toISOString()
      };

      let gravado;
      try {
        gravado = await db.insert('play_spins', linha);
      } catch (e) {
        // o índice único barrou: dois cliques chegaram juntos.
        if (etiqueta) {
          const agora = await db.selectOne('play_spins', { client_token: 'eq.' + etiqueta, select: '*' });
          if (agora) return u.ok(res, { giro: giroParaTela(agora), repetido: true });
        }
        throw e;
      }

      return u.ok(res, { giro: giroParaTela(gravado), repetido: false });
    }

    // ------------------------------------------------ 2) PAINEL
    const aberta = await porta.abrir(req, res, action);
    if (!aberta) return;

    // Tudo o que a tela do painel precisa de uma vez só.
    if (action === 'pl_painel') {
      const premios = await premiosOrdenados();
      const giros = await db.select('play_spins', {
        order: 'criado_em.desc', select: '*', limit: '400'
      });

      // Quantas vezes cada prêmio saiu. Serve para você CONFERIR
      // que o sorteio é honesto: com muitos giros os números se
      // aproximam uns dos outros. Não é uma regra, é um espelho.
      const porPremio = {};
      giros.forEach(function (g) {
        const k = g.prize_id || ('x|' + g.prize_nome);
        porPremio[k] = (porPremio[k] || 0) + 1;
      });

      return u.ok(res, {
        premios: premios.map(function (p) {
          return Object.assign(premioParaTela(p), { saiu: porPremio[p.id] || 0 });
        }),
        giros: giros.map(giroParaTela),
        total_giros: giros.length,
        slots: SLOTS,
        cores: CORES,
        icones: ICONES,
        link: u.appUrl() + '/play'
      });
    }

    // Criar ou editar um prêmio. Nunca encosta em giro nenhum.
    if (action === 'pl_premio_salvar') {
      if (req.method !== 'POST') return u.fail(res, 405, 'Metodo nao permitido');
      const body = await u.readBody(req);

      const nome = limpaTexto(body.nome, 60);
      if (!nome) return u.fail(res, 400, 'Escreva o nome do prêmio.');

      const campos = {
        nome: nome,
        descricao: limpaTexto(body.descricao, 160) || null,
        valor: limpaValor(body.valor),
        icone: limpaIcone(body.icone),
        cor: limpaCor(body.cor),
        ativo: body.ativo !== false && body.ativo !== 'false',
        updated_at: new Date().toISOString()
      };

      if (body.id) {
        const row = await db.update('play_prizes', campos, { id: 'eq.' + body.id });
        if (!row) return u.fail(res, 404, 'Prêmio não encontrado.');
        return u.ok(res, { premio: premioParaTela(row) });
      }

      const quantos = (await premiosOrdenados()).length;
      if (quantos >= SLOTS) {
        return u.fail(res, 409, 'A roleta tem ' + SLOTS + ' lugares e todos já estão ocupados. ' +
          'Edite um prêmio que já existe.');
      }
      campos.position = quantos + 1;
      campos.created_at = new Date().toISOString();
      const novo = await db.insert('play_prizes', campos);
      return u.ok(res, { premio: premioParaTela(novo) });
    }

    // Reordenar arrastando. Mudar a ordem NÃO mexe na chance de
    // nada: a chance é 1 dividido pelo número de prêmios ativos,
    // esteja cada um em que lugar estiver.
    if (action === 'pl_ordem') {
      if (req.method !== 'POST') return u.fail(res, 405, 'Metodo nao permitido');
      const body = await u.readBody(req);
      const ids = Array.isArray(body.ids) ? body.ids : [];
      if (!ids.length) return u.fail(res, 400, 'Falta a nova ordem.');

      const agora = new Date().toISOString();
      for (let i = 0; i < ids.length; i++) {
        await db.update('play_prizes', { position: i + 1, updated_at: agora }, { id: 'eq.' + ids[i] });
      }
      return u.ok(res, { premios: (await premiosOrdenados()).map(premioParaTela) });
    }

    // Histórico com filtros. Separado do painel para a busca não
    // precisar recarregar os prêmios junto.
    if (action === 'pl_historico') {
      const consulta = { order: 'criado_em.desc', select: '*', limit: '500' };
      if (params.premio_id) consulta.prize_id = 'eq.' + params.premio_id;
      if (params.de) consulta.criado_em = 'gte.' + params.de + 'T00:00:00';

      let giros = await db.select('play_spins', consulta);

      // O "até" e a busca por nome ficam aqui porque o PostgREST
      // não aceita duas condições na mesma coluna numa consulta
      // simples, e porque acento não combina com filtro de texto.
      if (params.ate) {
        const limite = params.ate + 'T23:59:59.999';
        giros = giros.filter(function (g) { return String(g.criado_em) <= limite; });
      }
      if (params.nome) {
        const alvo = chave(params.nome);
        giros = giros.filter(function (g) { return chave(g.participante).indexOf(alvo) >= 0; });
      }

      return u.ok(res, { giros: giros.map(giroParaTela), total: giros.length });
    }

    return u.fail(res, 404, 'Acao desconhecida: ' + action);
  } catch (e) {
    console.error('[play]', action, e);
    return u.fail(res, 500, e.message || 'Erro interno');
  }
};

// procurar "jose" tem que achar "José"
function chave(t) {
  return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

module.exports.CORES = CORES;
module.exports.ICONES = ICONES;
module.exports.SLOTS = SLOTS;
