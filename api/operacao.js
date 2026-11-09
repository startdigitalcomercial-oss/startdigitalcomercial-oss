// ============================================================
// OPERAÇÃO — a carteira de tráfego, por gestor.
//
// Três tabelas:
//   op_gestores — quem cuida (ligado ao cadastro de colaboradores)
//   op_clientes — a carteira (a identidade vem do Financeiro)
//   op_eventos  — O HISTÓRICO, com data
//
// O histórico é o coração deste arquivo. Perguntar "quantos clientes
// estavam ativos em agosto" olhando o status de HOJE é errado: o
// cliente que foi suspenso em outubro apareceria como suspenso em
// agosto também. Então cada mudança vira um evento com data, e o
// dashboard REMONTA a situação de cada cliente no fim do período
// pedido. É mais trabalho e é a única forma de o número ser verdade.
// ============================================================
'use strict';

const db = require('./_lib/db');
const u = require('./_lib/util');
const porta = require('./_lib/porta');

const FASES = ['onboarding', 'estrategia', 'aprovacao', 'consolidacao'];
const FASES_NOME = {
  onboarding: 'Onboarding', estrategia: 'Estratégia',
  aprovacao: 'Aprovação', consolidacao: 'Consolidação'
};
const STATUS = ['ativo', 'suspenso', 'flopado', 'cancelado'];
const STATUS_NOME = {
  ativo: 'Ativo', suspenso: 'Suspenso', flopado: 'Flopado', cancelado: 'Cancelado'
};
const SATISFACAO = ['satisfeito', 'neutro', 'insatisfeito'];
const SATISFACAO_NOME = {
  satisfeito: 'Satisfeito', neutro: 'Neutro',
  insatisfeito: 'Insatisfeito', nao_informado: 'Não informado'
};
// Os nomes das cores; os códigos ficam na tela. Guardar o nome deixa
// afinar a paleta inteira sem reescrever o banco.
const CORES = ['azul', 'laranja', 'verdeagua', 'amarelo', 'magenta', 'verde', 'violeta'];

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

function limpaTexto(v, max) {
  const t = String(v == null ? '' : v).trim().replace(/\s+/g, ' ');
  return t ? t.slice(0, max || 160) : '';
}
function umDe(v, lista, padrao) {
  const x = String(v || '').trim().toLowerCase();
  return lista.indexOf(x) >= 0 ? x : padrao;
}

// hoje em São Paulo — o servidor roda em UTC
function hojeSP() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function eData(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')); }

// ------------------------------------------------------------
// O PERÍODO
// semana / mes / periodo personalizado — tudo vira {de, ate}.
// ------------------------------------------------------------
function periodoDe(params) {
  const hoje = hojeSP();

  if (params.de && params.ate && eData(params.de) && eData(params.ate)) {
    const de = params.de <= params.ate ? params.de : params.ate;
    const ate = params.de <= params.ate ? params.ate : params.de;
    return { tipo: 'personalizado', de: de, ate: ate, rotulo: brCurta(de) + ' a ' + brCurta(ate) };
  }

  if (params.semana) {
    // 0 = esta semana, 1 = a anterior, e assim por diante.
    const atras = Math.max(0, Math.min(Number(params.semana_atras) || 0, 520));
    const base = new Date(hoje + 'T12:00:00Z');
    base.setUTCDate(base.getUTCDate() - atras * 7);
    // segunda a domingo
    const diaSemana = (base.getUTCDay() + 6) % 7;
    const seg = new Date(base); seg.setUTCDate(seg.getUTCDate() - diaSemana);
    const dom = new Date(seg); dom.setUTCDate(dom.getUTCDate() + 6);
    const de = seg.toISOString().slice(0, 10);
    const ate = dom.toISOString().slice(0, 10);
    return {
      tipo: 'semana', de: de, ate: ate, semana_atras: atras,
      rotulo: atras === 0 ? 'Esta semana' : (atras === 1 ? 'Semana passada' : brCurta(de) + ' a ' + brCurta(ate))
    };
  }

  const ano = Number(params.ano) || Number(hoje.slice(0, 4));
  const mes = Math.min(Math.max(Number(params.mes) || Number(hoje.slice(5, 7)), 1), 12);
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return {
    tipo: 'mes', mes: mes, ano: ano,
    de: ano + '-' + String(mes).padStart(2, '0') + '-01',
    ate: ano + '-' + String(mes).padStart(2, '0') + '-' + String(ultimo).padStart(2, '0'),
    rotulo: MESES[mes - 1] + ' ' + ano
  };
}

function brCurta(iso) {
  const p = String(iso).split('-');
  return p.length === 3 ? p[2] + '/' + p[1] : iso;
}

// ------------------------------------------------------------
// REMONTAR A SITUAÇÃO NUMA DATA
//
// Caminha pelos eventos do cliente até a data pedida e devolve como
// ele estava naquele dia. Sem eventos (cliente recém-criado), vale o
// que está gravado nele.
// ------------------------------------------------------------
function situacaoEm(cliente, eventos, ateISO) {
  const limite = ateISO + 'T23:59:59.999Z';
  let status = null, fase = null, satisfacao = null, gestor = null;

  // Ordem do tempo, com desempate estável: dois eventos gravados no
  // mesmo instante mantêm a ordem em que chegaram.
  const meus = (eventos || []).filter(function (e) { return String(e.quando) <= limite; })
    .map(function (e, i) { return { e: e, i: i }; })
    .sort(function (a, b) {
      if (String(a.e.quando) === String(b.e.quando)) return a.i - b.i;
      return String(a.e.quando) < String(b.e.quando) ? -1 : 1;
    })
    .map(function (x) { return x.e; });

  meus.forEach(function (e) {
    if (e.tipo === 'entrada') {
      status = e.para || 'ativo';
    } else if (e.tipo === 'status' || e.tipo === 'cancelamento') {
      status = e.para || status;
    } else if (e.tipo === 'fase') {
      fase = e.para || fase;
    } else if (e.tipo === 'satisfacao') {
      satisfacao = e.para || null;
    } else if (e.tipo === 'gestor') {
      gestor = e.para || gestor;
    }
  });

  return {
    status: status || cliente.status || 'ativo',
    fase: fase || cliente.fase || 'onboarding',
    // satisfação pode ter sido LIMPA de propósito: só cai no valor
    // atual quando nunca houve evento nenhum
    satisfacao: meus.some(function (e) { return e.tipo === 'satisfacao'; })
      ? satisfacao : (cliente.satisfacao || null),
    gestor_id: gestor || cliente.gestor_id || null
  };
}

function clienteParaTela(c, gestores) {
  const g = (gestores || {})[c.gestor_id];
  return {
    id: c.id,
    customer_id: c.customer_id || null,
    nome: c.nome,
    gestor_id: c.gestor_id || null,
    gestor: g ? g.nome : '—',
    categoria: c.categoria || '',
    satisfacao: c.satisfacao || null,
    satisfacao_nome: SATISFACAO_NOME[c.satisfacao || 'nao_informado'],
    fase: c.fase, fase_nome: FASES_NOME[c.fase] || c.fase,
    status: c.status, status_nome: STATUS_NOME[c.status] || c.status,
    entrou_em: c.entrou_em,
    atualizado_em: c.updated_at
  };
}

async function carregaGestores() {
  const lista = await db.select('op_gestores', { order: 'position.asc', select: '*' });
  return lista.sort(function (a, b) { return (Number(a.position) || 0) - (Number(b.position) || 0); });
}

async function carteiraViva() {
  return await db.select('op_clientes', { excluido_em: 'is.null', order: 'nome.asc', select: '*' });
}

// Registra o que mudou. Um evento por campo: é isso que permite
// perguntar depois "quando foi que ele virou insatisfeito?".
async function anota(clienteId, tipo, de, para, quem, obs, quando) {
  try {
    await db.insert('op_eventos', {
      cliente_id: clienteId, tipo: tipo,
      de: de == null ? null : String(de),
      para: para == null ? null : String(para),
      quem: quem || null, observacao: obs || null,
      quando: quando || new Date().toISOString()
    });
  } catch (e) {
    console.error('[operacao] nao deu para anotar o evento:', e.message);
  }
}

// ============================================================
module.exports = async function handler(req, res) {
  u.setBaseFromReq(req);
  const url = new URL(req.url, 'http://x');
  const action = url.searchParams.get('action') || '';
  const params = Object.fromEntries(url.searchParams.entries());

  try {
    const aberta = await porta.abrir(req, res, action);
    if (!aberta) return;
    const quem = (aberta.session && aberta.session.nome) || aberta.papel;

    // ---------------------------------------------- os gestores
    if (action === 'op_gestores') {
      const gestores = await carregaGestores();
      const clientes = await carteiraViva();
      const colabs = await db.select('collaborators', {
        active: 'is.true', order: 'name.asc', select: 'id,name,role_title,area'
      });

      const porGestor = {};
      clientes.forEach(function (c) {
        const a = porGestor[c.gestor_id] || (porGestor[c.gestor_id] =
          { total: 0, ativo: 0, suspenso: 0, flopado: 0, cancelado: 0 });
        a[c.status] = (a[c.status] || 0) + 1;
        if (c.status !== 'cancelado') a.total++;
      });

      return u.ok(res, {
        gestores: gestores.map(function (g) {
          const a = porGestor[g.id] || { total: 0, ativo: 0, suspenso: 0, flopado: 0, cancelado: 0 };
          const c = colabs.filter(function (x) { return x.id === g.collaborator_id; })[0];
          return {
            id: g.id, nome: g.nome, cor: g.cor, ativo: g.ativo !== false,
            position: g.position,
            collaborator_id: g.collaborator_id || null,
            colaborador: c ? c.name : null,
            cargo: c ? (c.role_title || '') : '',
            clientes: a.total, ativos: a.ativo, suspensos: a.suspenso,
            flopados: a.flopado, cancelados: a.cancelado
          };
        }),
        colaboradores: colabs,
        cores: CORES
      });
    }

    if (action === 'op_gestor_salvar') {
      if (req.method !== 'POST') return u.fail(res, 405, 'Metodo nao permitido');
      const body = await u.readBody(req);
      const nome = limpaTexto(body.nome, 60);
      if (!nome) return u.fail(res, 400, 'Escreva o nome do gestor.');

      const campos = {
        nome: nome,
        collaborator_id: body.collaborator_id || null,
        cor: umDe(body.cor, CORES, 'azul'),
        ativo: body.ativo !== false && body.ativo !== 'false',
        updated_at: new Date().toISOString()
      };

      try {
        if (body.id) {
          const row = await db.update('op_gestores', campos, { id: 'eq.' + body.id });
          if (!row) return u.fail(res, 404, 'Gestor não encontrado.');
          return u.ok(res, { gestor: row });
        }
        const quantos = (await carregaGestores()).length;
        campos.position = quantos + 1;
        const novo = await db.insert('op_gestores', campos);
        return u.ok(res, { gestor: novo });
      } catch (e) {
        return u.fail(res, 409, 'Já existe um gestor com esse nome.');
      }
    }

    // ---------------------------------------------- a carteira
    if (action === 'op_carteira') {
      const gestores = await carregaGestores();
      const porId = {};
      gestores.forEach(function (g) { porId[g.id] = g; });

      let clientes = await carteiraViva();
      if (params.gestor_id) {
        clientes = clientes.filter(function (c) { return c.gestor_id === params.gestor_id; });
      }

      // os clientes do Financeiro que ainda não estão na carteira —
      // é dessa lista que sai o campo de cadastro
      const doFinanceiro = await db.select('finance_customers', { order: 'nome.asc', select: 'id,nome' });
      const jaTem = {};
      (await carteiraViva()).forEach(function (c) { if (c.customer_id) jaTem[c.customer_id] = true; });

      return u.ok(res, {
        clientes: clientes.map(function (c) { return clienteParaTela(c, porId); }),
        gestores: gestores.map(function (g) { return { id: g.id, nome: g.nome, cor: g.cor }; }),
        disponiveis: doFinanceiro.filter(function (x) { return !jaTem[x.id]; }),
        fases: FASES, fases_nome: FASES_NOME,
        status: STATUS, status_nome: STATUS_NOME,
        satisfacoes: SATISFACAO, satisfacao_nome: SATISFACAO_NOME
      });
    }

    if (action === 'op_cliente_salvar') {
      if (req.method !== 'POST') return u.fail(res, 405, 'Metodo nao permitido');
      const body = await u.readBody(req);

      const nome = limpaTexto(body.nome, 160);
      if (!nome) return u.fail(res, 400, 'Escolha ou escreva o nome do cliente.');
      if (!body.gestor_id) return u.fail(res, 400, 'Escolha o gestor responsável.');

      const fase = umDe(body.fase, FASES, 'onboarding');
      const status = umDe(body.status, STATUS, 'ativo');
      const satisfacao = SATISFACAO.indexOf(String(body.satisfacao || '').toLowerCase()) >= 0
        ? String(body.satisfacao).toLowerCase() : null;

      const campos = {
        nome: nome,
        customer_id: body.customer_id || null,
        gestor_id: body.gestor_id,
        categoria: limpaTexto(body.categoria, 80) || null,
        satisfacao: satisfacao,
        fase: fase,
        status: status,
        updated_at: new Date().toISOString()
      };
      if (eData(body.entrou_em)) campos.entrou_em = body.entrou_em;

      // ---- editar ----
      if (body.id) {
        const antes = await db.selectOne('op_clientes', { id: 'eq.' + body.id, select: '*' });
        if (!antes) return u.fail(res, 404, 'Cliente não encontrado.');

        const row = await db.update('op_clientes', campos, { id: 'eq.' + body.id });

        // uma anotação por campo que realmente mudou
        if (antes.status !== status) await anota(body.id, 'status', antes.status, status, quem);
        if (antes.fase !== fase) await anota(body.id, 'fase', antes.fase, fase, quem);
        if ((antes.satisfacao || null) !== satisfacao) {
          await anota(body.id, 'satisfacao', antes.satisfacao, satisfacao, quem);
        }
        if (antes.gestor_id !== body.gestor_id) {
          await anota(body.id, 'gestor', antes.gestor_id, body.gestor_id, quem);
        }
        return u.ok(res, { cliente: row });
      }

      // ---- novo ----
      campos.created_at = new Date().toISOString();
      if (!campos.entrou_em) campos.entrou_em = hojeSP();

      let novo;
      try {
        novo = await db.insert('op_clientes', campos);
      } catch (e) {
        return u.fail(res, 409, 'Esse cliente já está na carteira de algum gestor.');
      }
      // A entrada leva a data em que o cliente ENTROU, nao a data em
      // que alguem digitou. Sem isso, cadastrar hoje um cliente que
      // entrou em agosto faria agosto herdar a situacao de hoje — foi
      // exatamente o que o teste do historico pegou.
      // MEIA-NOITE, nao meio-dia. Se a entrada fosse carimbada ao
      // meio-dia, um cliente cadastrado de manha teria a entrada
      // "acontecendo" depois de tudo o que fosse feito com ele no
      // resto da manha — e a remontagem do historico leria a
      // entrada como o ultimo acontecimento. O teste pegou isso.
      const naEntrada = campos.entrou_em + 'T00:00:00.000Z';
      await anota(novo.id, 'entrada', null, status, quem, null, naEntrada);
      await anota(novo.id, 'fase', null, fase, quem, null, naEntrada);
      if (satisfacao) await anota(novo.id, 'satisfacao', null, satisfacao, quem, null, naEntrada);
      return u.ok(res, { cliente: novo });
    }

    // Sai da carteira — mas o histórico fica.
    if (action === 'op_cliente_excluir') {
      if (req.method !== 'POST') return u.fail(res, 405, 'Metodo nao permitido');
      const body = await u.readBody(req);
      if (!body.id) return u.fail(res, 400, 'Falta dizer qual cliente.');
      const row = await db.update('op_clientes',
        { excluido_em: new Date().toISOString(), updated_at: new Date().toISOString() },
        { id: 'eq.' + body.id });
      if (!row) return u.fail(res, 404, 'Cliente não encontrado.');
      return u.ok(res, { removido: true });
    }

    // ---------------------------------------------- movimentação
    // Renovar NÃO mexe no gestor, na fase nem na satisfação — só
    // registra que aconteceu, com a data. Cancelar registra e muda
    // a situação do cliente.
    if (action === 'op_movimentar') {
      if (req.method !== 'POST') return u.fail(res, 405, 'Metodo nao permitido');
      const body = await u.readBody(req);
      const tipo = String(body.tipo || '').toLowerCase();
      if (['renovacao', 'cancelamento'].indexOf(tipo) < 0) {
        return u.fail(res, 400, 'Movimentação desconhecida.');
      }
      const cli = await db.selectOne('op_clientes', { id: 'eq.' + String(body.id || ''), select: '*' });
      if (!cli) return u.fail(res, 404, 'Cliente não encontrado.');

      const quando = eData(body.quando) ? body.quando + 'T12:00:00.000Z' : new Date().toISOString();

      if (tipo === 'renovacao') {
        await db.insert('op_eventos', {
          cliente_id: cli.id, tipo: 'renovacao', de: null, para: 'renovado',
          quem: quem, observacao: limpaTexto(body.observacao, 200) || null, quando: quando
        });
        await db.update('op_clientes', { updated_at: new Date().toISOString() }, { id: 'eq.' + cli.id });
        return u.ok(res, { registrado: 'renovacao' });
      }

      await db.insert('op_eventos', {
        cliente_id: cli.id, tipo: 'cancelamento', de: cli.status, para: 'cancelado',
        quem: quem, observacao: limpaTexto(body.observacao, 200) || null, quando: quando
      });
      await db.update('op_clientes',
        { status: 'cancelado', updated_at: new Date().toISOString() }, { id: 'eq.' + cli.id });
      return u.ok(res, { registrado: 'cancelamento' });
    }

    // A ficha: o cliente e tudo o que já aconteceu com ele.
    if (action === 'op_cliente_historico') {
      const id = String(params.id || '');
      if (!id) return u.fail(res, 400, 'Falta dizer qual cliente.');
      const eventos = await db.select('op_eventos', {
        cliente_id: 'eq.' + id, order: 'quando.desc', select: '*'
      });
      const gestores = await carregaGestores();
      const nomeG = {};
      gestores.forEach(function (g) { nomeG[g.id] = g.nome; });

      const legivel = {
        entrada: 'Entrou na carteira', status: 'Mudou de situação', fase: 'Mudou de fase',
        satisfacao: 'Satisfação atualizada', gestor: 'Trocou de gestor',
        renovacao: 'Renovou o contrato', cancelamento: 'Contrato cancelado'
      };
      const rotulo = function (tipo, v) {
        if (v == null || v === '') return '—';
        if (tipo === 'gestor') return nomeG[v] || v;
        return STATUS_NOME[v] || FASES_NOME[v] || SATISFACAO_NOME[v] || v;
      };

      return u.ok(res, {
        eventos: eventos.map(function (e) {
          return {
            id: e.id, tipo: e.tipo, titulo: legivel[e.tipo] || e.tipo,
            de: rotulo(e.tipo, e.de), para: rotulo(e.tipo, e.para),
            quem: e.quem || '', observacao: e.observacao || '', quando: e.quando
          };
        })
      });
    }

    // ============================================================
    // O DASHBOARD
    // ============================================================
    if (action === 'op_dashboard') {
      const periodo = periodoDe(params);
      const gestores = await carregaGestores();
      const porId = {};
      gestores.forEach(function (g) { porId[g.id] = g; });

      const todos = await carteiraViva();
      const eventos = await db.select('op_eventos', { order: 'quando.asc', select: '*', limit: '20000' });
      const porCliente = {};
      eventos.forEach(function (e) {
        (porCliente[e.cliente_id] || (porCliente[e.cliente_id] = [])).push(e);
      });

      // Quem já tinha entrado até o fim do período. Quem entrou depois
      // não existia naquele mês — não pode contar.
      const naCarteira = todos.filter(function (c) {
        return String(c.entrou_em || '') <= periodo.ate;
      });

      const filtroGestor = params.gestor_id || '';
      const linhas = [];
      naCarteira.forEach(function (c) {
        const s = situacaoEm(c, porCliente[c.id], periodo.ate);
        if (filtroGestor && s.gestor_id !== filtroGestor) return;
        linhas.push({ cliente: c, s: s });
      });

      const zera = function () { return { ativo: 0, suspenso: 0, flopado: 0, cancelado: 0 }; };
      const situacao = zera();
      const fases = { onboarding: 0, estrategia: 0, aprovacao: 0, consolidacao: 0 };
      const satisf = { satisfeito: 0, neutro: 0, insatisfeito: 0, nao_informado: 0 };
      const porGestor = {};

      linhas.forEach(function (l) {
        situacao[l.s.status] = (situacao[l.s.status] || 0) + 1;
        // Cancelado é saída: não entra na foto da carteira nem nas
        // fases. Contar ele em "Consolidação" inflaria o quadro.
        if (l.s.status === 'cancelado') return;
        fases[l.s.fase] = (fases[l.s.fase] || 0) + 1;
        satisf[l.s.satisfacao || 'nao_informado'] = (satisf[l.s.satisfacao || 'nao_informado'] || 0) + 1;
        const g = l.s.gestor_id || 'sem';
        porGestor[g] = (porGestor[g] || 0) + 1;
      });

      const naCarteiraTotal = situacao.ativo + situacao.suspenso + situacao.flopado;

      // ---- movimentação: EVENTOS dentro do período ----
      // Clientes DISTINTOS, não número de eventos: quem renovou duas
      // vezes no mês é um cliente renovado, não dois.
      const inicio = periodo.de + 'T00:00:00.000Z';
      const fim = periodo.ate + 'T23:59:59.999Z';
      const renovou = {}, cancelou = {};
      eventos.forEach(function (e) {
        const q = String(e.quando);
        if (q < inicio || q > fim) return;
        const dono = todos.filter(function (c) { return c.id === e.cliente_id; })[0];
        if (!dono) return;
        if (filtroGestor) {
          const s = situacaoEm(dono, porCliente[dono.id], periodo.ate);
          if (s.gestor_id !== filtroGestor) return;
        }
        if (e.tipo === 'renovacao') renovou[e.cliente_id] = true;
        if (e.tipo === 'cancelamento') cancelou[e.cliente_id] = true;
      });

      const pct = function (n) { return naCarteiraTotal ? Math.round((n / naCarteiraTotal) * 1000) / 10 : 0; };

      return u.ok(res, {
        periodo: periodo,
        kpis: {
          total: naCarteiraTotal,
          ativos: situacao.ativo,
          suspensos: situacao.suspenso,
          flopados: situacao.flopado,
          renovados: Object.keys(renovou).length,
          cancelados: Object.keys(cancelou).length
        },
        por_gestor: gestores.map(function (g) {
          return {
            id: g.id, nome: g.nome, cor: g.cor,
            clientes: porGestor[g.id] || 0,
            percentual: pct(porGestor[g.id] || 0)
          };
        }).filter(function (g) { return g.clientes > 0 || !filtroGestor; }),
        sem_gestor: porGestor.sem || 0,
        fases: FASES.map(function (f) {
          return { chave: f, nome: FASES_NOME[f], clientes: fases[f] || 0, percentual: pct(fases[f] || 0) };
        }),
        situacao: [
          { chave: 'ativo', nome: 'Ativos', clientes: situacao.ativo, percentual: pct(situacao.ativo) },
          { chave: 'suspenso', nome: 'Suspensos', clientes: situacao.suspenso, percentual: pct(situacao.suspenso) },
          { chave: 'flopado', nome: 'Flopados', clientes: situacao.flopado, percentual: pct(situacao.flopado) }
        ],
        saidas: situacao.cancelado,
        satisfacao: ['satisfeito', 'neutro', 'insatisfeito', 'nao_informado'].map(function (k) {
          return { chave: k, nome: SATISFACAO_NOME[k], clientes: satisf[k] || 0, percentual: pct(satisf[k] || 0) };
        }),
        vazio: todos.length === 0,
        hoje: hojeSP(), meses: MESES
      });
    }

    // ============================================================
    // ONBOARDING
    //
    // A SITUACAO e o que a equipe decide: a iniciar, em andamento,
    // concluido. As colunas de PRAZO (atrasado, a vencer, em dia)
    // nao sao status: sao contas feitas com a data de hoje. Guardar
    // "atrasado" no banco daria errado no dia seguinte.
    //
    // Como as colunas se sobrepoem, cada card cai em UMA so, nesta
    // ordem de prioridade:
    //   1 concluido no mes · 2 a iniciar · 3 atrasado
    //   4 a vencer em 7 dias · 5 em dia · 6 em andamento (sem prazo)
    // ============================================================
    if (action === 'ob_lista') {
      const gestores = await carregaGestores();
      const porG = {};
      gestores.forEach(function (g) { porG[g.id] = g; });

      const clientes = await carteiraViva();
      const porC = {};
      clientes.forEach(function (c) { porC[c.id] = c; });

      const linhas = await db.select('op_onboardings', { order: 'created_at.desc', select: '*' });

      // o mes de referencia das "concluidas no mes"
      const ref = periodoDe(params);
      const hoje = hojeSP();
      const em7 = new Date(hoje + 'T12:00:00Z');
      em7.setUTCDate(em7.getUTCDate() + 7);
      const limite7 = em7.toISOString().slice(0, 10);

      const lista = linhas.map(function (o) {
        const c = porC[o.cliente_id];
        const g = porG[o.gestor_id];
        const atrasado = o.situacao === 'em_andamento' && !!o.prazo && o.prazo < hoje;

        let coluna;
        if (o.situacao === 'concluido') {
          coluna = (o.concluido_em && o.concluido_em >= ref.de && o.concluido_em <= ref.ate)
            ? 'concluidos_mes' : 'fora_do_mes';
        } else if (o.situacao === 'cancelado') {
          coluna = 'fora_do_mes';
        } else if (o.situacao === 'a_iniciar') {
          coluna = 'a_iniciar';
        } else if (atrasado) {
          coluna = 'atrasados';
        } else if (o.prazo && o.prazo <= limite7) {
          coluna = 'a_vencer';
        } else if (o.prazo) {
          coluna = 'em_dia';
        } else {
          coluna = 'em_andamento';
        }

        return {
          id: o.id,
          cliente_id: o.cliente_id,
          cliente: c ? c.nome : '(cliente removido)',
          categoria: c ? (c.categoria || '') : '',
          gestor_id: o.gestor_id, gestor: g ? g.nome : '—', cor: g ? g.cor : 'azul',
          situacao: o.situacao,
          situacao_nome: { a_iniciar: 'A iniciar', em_andamento: 'Em andamento',
            concluido: 'Concluído', cancelado: 'Cancelado' }[o.situacao] || o.situacao,
          inicio_previsto: o.inicio_previsto, iniciado_em: o.iniciado_em,
          prazo: o.prazo, concluido_em: o.concluido_em,
          observacao: o.observacao || '',
          criado_em: o.created_at,
          atrasado: atrasado,
          dias_para_o_prazo: o.prazo
            ? Math.round((new Date(o.prazo + 'T12:00:00Z') - new Date(hoje + 'T12:00:00Z')) / 86400000)
            : null,
          coluna: coluna
        };
      });

      // Clientes que ainda nao tem onboarding aberto — e dessa lista
      // que sai o seletor do botao "Iniciar Onboarding", para nao
      // cadastrar o mesmo cliente duas vezes.
      const ocupados = {};
      linhas.forEach(function (o) {
        if (o.situacao === 'a_iniciar' || o.situacao === 'em_andamento') ocupados[o.cliente_id] = true;
      });

      return u.ok(res, {
        onboardings: lista,
        colunas: [
          { chave: 'em_andamento', nome: 'Em andamento' },
          { chave: 'atrasados', nome: 'Atrasados' },
          { chave: 'concluidos_mes', nome: 'Concluídos no mês' },
          { chave: 'em_dia', nome: 'Em dia' },
          { chave: 'a_vencer', nome: 'A vencer em 7 dias' },
          { chave: 'a_iniciar', nome: 'A iniciar' }
        ],
        gestores: gestores.map(function (g) { return { id: g.id, nome: g.nome, cor: g.cor }; }),
        disponiveis: clientes.filter(function (c) { return !ocupados[c.id]; })
          .map(function (c) { return { id: c.id, nome: c.nome, gestor_id: c.gestor_id }; }),
        periodo: ref, hoje: hoje
      });
    }

    if (action === 'ob_salvar') {
      if (req.method !== 'POST') return u.fail(res, 405, 'Metodo nao permitido');
      const body = await u.readBody(req);
      if (!body.cliente_id) return u.fail(res, 400, 'Escolha o cliente.');
      if (!body.gestor_id) return u.fail(res, 400, 'Escolha o gestor responsável.');

      const campos = {
        cliente_id: body.cliente_id,
        gestor_id: body.gestor_id,
        inicio_previsto: eData(body.inicio_previsto) ? body.inicio_previsto : null,
        prazo: eData(body.prazo) ? body.prazo : null,
        observacao: limpaTexto(body.observacao, 400) || null,
        updated_at: new Date().toISOString()
      };

      if (body.id) {
        const antes = await db.selectOne('op_onboardings', { id: 'eq.' + body.id, select: '*' });
        if (!antes) return u.fail(res, 404, 'Onboarding não encontrado.');
        const row = await db.update('op_onboardings', campos, { id: 'eq.' + body.id });
        return u.ok(res, { onboarding: row });
      }

      // Comecar agora ou deixar guardado para comecar depois.
      const jaComeca = body.iniciar === true || body.iniciar === 'true';
      campos.situacao = jaComeca ? 'em_andamento' : 'a_iniciar';
      if (jaComeca) campos.iniciado_em = hojeSP();
      campos.created_at = new Date().toISOString();

      try {
        const novo = await db.insert('op_onboardings', campos);
        return u.ok(res, { onboarding: novo });
      } catch (e) {
        return u.fail(res, 409, 'Esse cliente já tem um onboarding em aberto.');
      }
    }

    // Mudar a SITUACAO. As colunas de prazo nao entram aqui: elas sao
    // calculadas, e arrastar um card nao pode "desatrasar" nada.
    if (action === 'ob_mover') {
      if (req.method !== 'POST') return u.fail(res, 405, 'Metodo nao permitido');
      const body = await u.readBody(req);
      const para = String(body.situacao || '').toLowerCase();
      if (['a_iniciar', 'em_andamento', 'concluido', 'cancelado'].indexOf(para) < 0) {
        return u.fail(res, 400, 'Situação desconhecida.');
      }
      const antes = await db.selectOne('op_onboardings', { id: 'eq.' + String(body.id || ''), select: '*' });
      if (!antes) return u.fail(res, 404, 'Onboarding não encontrado.');

      const campos = { situacao: para, updated_at: new Date().toISOString() };
      const hoje = hojeSP();
      if (para === 'em_andamento' && !antes.iniciado_em) campos.iniciado_em = hoje;
      if (para === 'concluido') campos.concluido_em = eData(body.quando) ? body.quando : hoje;
      if (para !== 'concluido') campos.concluido_em = null;
      if (para === 'a_iniciar') campos.iniciado_em = null;

      let row;
      try {
        row = await db.update('op_onboardings', campos, { id: 'eq.' + antes.id });
      } catch (e) {
        return u.fail(res, 409, 'Esse cliente já tem outro onboarding em aberto.');
      }
      return u.ok(res, { onboarding: row });
    }

    return u.fail(res, 404, 'Acao desconhecida: ' + action);
  } catch (e) {
    console.error('[operacao]', action, e);
    return u.fail(res, 500, e.message || 'Erro interno');
  }
};

module.exports.FASES = FASES;
module.exports.STATUS = STATUS;
module.exports.SATISFACAO = SATISFACAO;
module.exports.CORES = CORES;
module.exports.periodoDe = periodoDe;
module.exports.situacaoEm = situacaoEm;
