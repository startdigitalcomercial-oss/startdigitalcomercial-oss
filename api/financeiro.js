// ============================================================
// FINANCEIRO
// A carteira de clientes: quanto cada um paga, quando vence e
// se já pagou. Mais o resumo do mês e o relatório para bater
// com o time toda semana.
//
// Endereço: /api/financeiro?action=...
// A porta (login + permissão) é a MESMA do painel — _lib/porta.js.
// ============================================================
'use strict';

const db = require('./_lib/db');
const u = require('./_lib/util');
const porta = require('./_lib/porta');

const STATUS = ['pago', 'aguardando', 'inadimplente'];
const STATUS_NOME = { pago: 'Pago', aguardando: 'Aguardando', inadimplente: 'Inadimplente' };

// ------------------------------------------------------------
// Dinheiro em centavos na hora de somar. Somar 0.1 + 0.2 em
// ponto flutuante dá 0.30000000000000004 — com dez clientes
// ninguém vê, com trezentos o total fecha errado no relatório.
// ------------------------------------------------------------
function centavos(v) { return Math.round(Number(v || 0) * 100); }
function reais(c) { return c / 100; }

function dinheiroBr(v) {
  return 'R$ ' + Number(v || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
}

// O que a tela recebe de cada linha.
function paraTela(r) {
  const total = centavos(r.valor) + centavos(r.setup) + centavos(r.hospedagem);
  return {
    id: r.id,
    cliente: r.cliente,
    valor: Number(r.valor || 0),
    setup: Number(r.setup || 0),
    hospedagem: Number(r.hospedagem || 0),
    total: reais(total),
    vencimento_dia: Number(r.vencimento_dia || 10),
    status: STATUS.indexOf(r.status) >= 0 ? r.status : 'aguardando',
    status_nome: STATUS_NOME[r.status] || 'Aguardando',
    responsavel: r.responsavel || '',
    telefone: r.telefone || '',
    observacao: r.observacao || '',
    destaque: r.destaque === true,
    ativo: r.ativo !== false,
    pago_em: r.pago_em || null,
    ref_mes: Number(r.ref_mes || 0),
    ref_ano: Number(r.ref_ano || 0),
    customer_id: r.customer_id || null,
    position: Number(r.position || 1)
  };
}

// ============================================================
// COMPETENCIA MENSAL
//
// Cada cobranca pertence a um mes/ano. "Agosto/2026" e uma lista
// propria: mexer em setembro nao toca agosto, e apagar agosto nao
// apaga setembro. Toda a tela — tabela, cartoes e dashboard — le da
// MESMA competencia, entao nunca divergem.
// ============================================================
const MESES = ['Janeiro', 'Fevereiro', 'Marco', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

// O mes de hoje NO BRASIL. O servidor roda em UTC: as 21h de dia 31
// em Sao Paulo ja e dia 1 em UTC, e a virada aconteceria cedo demais.
function hojeNoBrasil() {
  const s = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  const p = s.split('-');
  return { ano: Number(p[0]), mes: Number(p[1]), dia: Number(p[2]), iso: s };
}

function competenciaAtual() {
  const h = hojeNoBrasil();
  return { mes: h.mes, ano: h.ano };
}

// Numero unico e crescente por competencia: 2026*12+8. Serve para
// comparar e para andar mes a mes sem errar a virada do ano.
function ordinal(mes, ano) { return ano * 12 + (mes - 1); }
function deOrdinal(n) { return { mes: (n % 12) + 1, ano: Math.floor(n / 12) }; }

// A competencia pedida pela tela, com o mes atual como padrao.
function competenciaDe(params) {
  const mes = Number(params && params.mes);
  const ano = Number(params && params.ano);
  if (mes >= 1 && mes <= 12 && ano >= 2000 && ano <= 2200) return { mes: mes, ano: ano };
  return competenciaAtual();
}

async function carteira(comp) {
  const q = {
    order: 'position.asc,created_at.asc', select: '*',
    excluida_em: 'is.null'          // cobranca excluida some da tela, fica no banco
  };
  if (comp) {
    q.ref_mes = 'eq.' + comp.mes;
    q.ref_ano = 'eq.' + comp.ano;
  }
  const linhas = await db.select('finance_clients', q);
  return linhas.map(paraTela);
}

// ============================================================
// CLIENTE x COBRANCA
//
// Cliente e cadastro permanente: nome, telefone, responsavel e as
// observacoes que valem para sempre. Cobranca e o lancamento do mes.
// Um cliente tem N cobrancas — virar o mes nao cria cliente novo.
// ============================================================

// A identidade do cliente enquanto nao houver CNPJ: o nome sem
// acento, sem caixa e sem espaco sobrando. E o que impede
// "Start Digital" e "START DIGITAL" virarem dois cadastros.
function chaveDoCliente(nome) {
  return String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

// Acha o cadastro do cliente; se nao existir, cria. Devolve o id.
async function clienteDeCobranca(nome, dados) {
  const chave = chaveDoCliente(nome);
  if (!chave) return null;

  const achado = await db.selectOne('finance_customers', { chave: 'eq.' + chave, select: 'id' });
  if (achado) return achado.id;

  try {
    const novo = await db.insert('finance_customers', {
      nome: String(nome).trim(),
      chave: chave,
      telefone: (dados && dados.telefone) || null,
      responsavel: (dados && dados.responsavel) || null
    });
    return novo ? novo.id : null;
  } catch (e) {
    // dois pedidos ao mesmo tempo: o indice unico barrou o segundo.
    const agora = await db.selectOne('finance_customers', { chave: 'eq.' + chave, select: 'id' });
    return agora ? agora.id : null;
  }
}

function clienteParaTela(c) {
  return {
    id: c.id, nome: c.nome, telefone: c.telefone || '',
    responsavel: c.responsavel || '', observacoes: c.observacoes || '',
    ativo: c.ativo !== false
  };
}

// A data em que a cobranca VENCE, de verdade (dia do mes + competencia).
// Mes curto encosta no ultimo dia, como a cobranca faz na vida real.
function dataDeVencimento(linha) {
  const mes = Number(linha.ref_mes), ano = Number(linha.ref_ano);
  if (!mes || !ano) return null;
  const ultimo = new Date(ano, mes, 0).getDate();
  const dia = Math.min(Math.max(Number(linha.vencimento_dia) || 1, 1), ultimo);
  return ano + '-' + String(mes).padStart(2, '0') + '-' + String(dia).padStart(2, '0');
}

// ------------------------------------------------------------
// A VIRADA DO MES
//
// Idempotente de proposito: roda toda vez que alguem abre o
// Financeiro e so cria o que falta. Se ninguem abrir o sistema por
// tres meses, ela cria os tres de uma vez, cada um herdando do
// anterior — o historico nunca fica com buraco.
//
// A trava contra duplicidade nao e este codigo: e o indice unico
// (cliente, mes, ano) no banco. Duas pessoas abrindo no mesmo
// segundo? Uma insere, a outra leva erro e segue a vida.
// ------------------------------------------------------------
async function garantirCompetencias() {
  const atual = competenciaAtual();
  const alvo = ordinal(atual.mes, atual.ano);

  // qual e a competencia mais recente que ja existe?
  const ultimas = await db.select('finance_clients', {
    order: 'ref_ano.desc,ref_mes.desc', select: 'ref_mes,ref_ano', excluida_em: 'is.null', limit: 1
  });
  if (!ultimas.length) return { criadas: [] };          // carteira vazia: nada a virar

  let cursor = ordinal(Number(ultimas[0].ref_mes), Number(ultimas[0].ref_ano));
  if (cursor >= alvo) return { criadas: [] };           // ja estamos em dia

  const criadas = [];
  // no maximo 24 saltos: protege contra data maluca do servidor
  for (let volta = 0; volta < 24 && cursor < alvo; volta++) {
    const origem = deOrdinal(cursor);
    const destino = deOrdinal(cursor + 1);

    // ja existe? (outra requisicao pode ter criado meio segundo atras)
    const jaTem = await db.selectOne('finance_clients', {
      ref_mes: 'eq.' + destino.mes, ref_ano: 'eq.' + destino.ano, select: 'id'
    });

    if (!jaTem) {
      const base = await db.select('finance_clients', {
        ref_mes: 'eq.' + origem.mes, ref_ano: 'eq.' + origem.ano,
        ativo: 'is.true',                                 // contrato encerrado nao gera cobranca nova
        excluida_em: 'is.null',
        order: 'position.asc', select: '*'
      });

      if (base.length) {
        const agora = new Date().toISOString();
        const novas = base.map(function (r) {
          return {
            cliente: r.cliente,
            valor: r.valor, setup: r.setup, hospedagem: r.hospedagem,
            vencimento_dia: r.vencimento_dia,
            // mes novo, cobranca nova: comeca em aberto. O que era
            // "pago" em agosto nao nasce pago em setembro.
            status: 'aguardando',
            pago_em: null,
            responsavel: r.responsavel, telefone: r.telefone,
            // a observacao e do mes ("prometeu pagar sexta"), nao viaja
            observacao: null,
            destaque: r.destaque, ativo: true,
            position: r.position,
            // o mes novo aponta para o MESMO cadastro de cliente
            customer_id: r.customer_id || null,
            ref_mes: destino.mes, ref_ano: destino.ano,
            created_at: agora, updated_at: agora
          };
        });
        try {
          await db.insert('finance_clients', novas);
          criadas.push(destino.mes + '/' + destino.ano);
        } catch (e) {
          // o indice unico barrou: alguem criou primeiro. Tudo certo.
          console.error('[financeiro] virada ja feita por outra chamada:', destino.mes + '/' + destino.ano);
        }
      }
    }
    cursor++;
  }
  return { criadas: criadas };
}

// As competencias que existem no banco, da mais nova para a mais
// velha — e o mes atual sempre entra, mesmo que ainda esteja vazio.
async function competenciasExistentes() {
  const linhas = await db.select('finance_clients', {
    order: 'ref_ano.desc,ref_mes.desc', select: 'ref_mes,ref_ano', excluida_em: 'is.null'
  });
  const vistos = {};
  const lista = [];
  linhas.forEach(function (r) {
    const chave = r.ref_ano + '-' + r.ref_mes;
    if (vistos[chave]) return;
    vistos[chave] = true;
    lista.push({ mes: Number(r.ref_mes), ano: Number(r.ref_ano) });
  });
  const atual = competenciaAtual();
  if (!vistos[atual.ano + '-' + atual.mes]) lista.unshift(atual);
  lista.sort(function (a, b) { return ordinal(b.mes, b.ano) - ordinal(a.mes, a.ano); });
  return lista;
}

// ------------------------------------------------------------
// PREVISÃO DA PRÓXIMA SEMANA
// "Vence dia 30" é um dia do mês, não uma data. Aqui a gente
// traduz para a próxima data real em que aquele dia acontece —
// olhando este mês e, se já passou, o mês que vem. Mês curto
// (fevereiro, ou dia 31) cai no último dia do mês, que é como
// a cobrança funciona na prática.
// ------------------------------------------------------------
function proximaData(dia, hoje) {
  const d = Math.min(Math.max(Number(dia) || 1, 1), 31);
  for (let salto = 0; salto < 2; salto++) {
    const ano = hoje.getFullYear();
    const mes = hoje.getMonth() + salto;
    const ultimo = new Date(ano, mes + 1, 0).getDate();
    const cand = new Date(ano, mes, Math.min(d, ultimo));
    if (cand >= new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())) return cand;
  }
  return new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1);
}

function diaBr(d) {
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
}

// ------------------------------------------------------------
// OS CARTÕES POR PERÍODO (Recebidas / Aguardando / Vencidas)
//
// Cada cartão olha para a data CERTA — não a mesma para os três:
//   Recebidas   → a data em que o pagamento ACONTECEU (pago_em)
//   Aguardando  → a data em que a cobrança VENCE dentro do período
//   Vencidas    → a data em que ela VENCEU (já passou e ninguém pagou)
// Misturar essas datas é o jeito clássico de dashboard mentir.
// ------------------------------------------------------------
function dentro(data, de, ate) {
  if (!data) return false;
  const t = new Date(data).getTime();
  return t >= de.getTime() && t <= ate.getTime();
}

// O vencimento é um DIA do mês ("todo dia 30"). Aqui viram datas de
// verdade: todas as ocorrências desse dia dentro do período.
function vencimentosNoPeriodo(dia, de, ate) {
  const datas = [];
  const d = Math.min(Math.max(Number(dia) || 1, 1), 31);
  let ano = de.getFullYear(), mes = de.getMonth();
  while (ano < ate.getFullYear() || (ano === ate.getFullYear() && mes <= ate.getMonth())) {
    const ultimo = new Date(ano, mes + 1, 0).getDate();
    const cand = new Date(ano, mes, Math.min(d, ultimo), 12);
    if (cand >= de && cand <= ate) datas.push(cand);
    mes++;
    if (mes > 11) { mes = 0; ano++; }
  }
  return datas;
}

function cartoesDoPeriodo(linhas, de, ate, hoje) {
  const ativos = linhas.filter(function (r) { return r.ativo; });
  const c = {
    recebidas: { valor: 0, clientes: 0 },
    aguardando: { valor: 0, clientes: 0 },
    vencidas: { valor: 0, clientes: 0 }
  };

  ativos.forEach(function (r) {
    const linha = centavos(r.valor) + centavos(r.setup) + centavos(r.hospedagem);

    // Recebidas: pagou DENTRO do período.
    if (r.status === 'pago' && dentro(r.pago_em, de, ate)) {
      c.recebidas.valor += linha;
      c.recebidas.clientes++;
      return;
    }

    if (r.status === 'pago') return;   // pagou fora do período: não entra em nada

    const vencs = vencimentosNoPeriodo(r.vencimento_dia, de, ate);
    if (!vencs.length) return;         // esta cobrança não pertence a este período

    // Vencida = o vencimento do período já ficou para trás e ninguém pagou.
    // Vale para quem o time já marcou (inadimplente) E para quem está
    // "aguardando" com a data estourada — na prática, também venceu.
    const jaPassou = vencs.some(function (v) { return v.getTime() < hoje.getTime(); });
    if (r.status === 'inadimplente' || jaPassou) {
      c.vencidas.valor += linha;
      c.vencidas.clientes++;
      return;
    }

    // Aguardando: vence dentro do período, mas a data ainda vai chegar.
    c.aguardando.valor += linha;
    c.aguardando.clientes++;
  });

  return {
    de: de.toISOString().slice(0, 10),
    ate: ate.toISOString().slice(0, 10),
    recebidas: { valor: reais(c.recebidas.valor), clientes: c.recebidas.clientes },
    aguardando: { valor: reais(c.aguardando.valor), clientes: c.aguardando.clientes },
    vencidas: { valor: reais(c.vencidas.valor), clientes: c.vencidas.clientes }
  };
}

// ------------------------------------------------------------
// O RESUMO DO DASHBOARD
// ------------------------------------------------------------
function resumo(linhas, hoje) {
  const ativos = linhas.filter(function (r) { return r.ativo; });

  let setup = 0, mensal = 0, hosped = 0, inadimplente = 0, aguardando = 0;
  let qtdInad = 0, qtdAguard = 0, qtdPago = 0, recebido = 0;

  ativos.forEach(function (r) {
    setup += centavos(r.setup);
    mensal += centavos(r.valor);
    hosped += centavos(r.hospedagem);
    const linha = centavos(r.valor) + centavos(r.setup) + centavos(r.hospedagem);
    if (r.status === 'inadimplente') { inadimplente += linha; qtdInad++; }
    else if (r.status === 'aguardando') { aguardando += linha; qtdAguard++; }
    else { recebido += linha; qtdPago++; }
  });

  // Próxima semana: de hoje até daqui a 7 dias, quem ainda não pagou.
  const limite = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 7);
  const fila = [];
  ativos.forEach(function (r) {
    if (r.status === 'pago') return;
    const quando = proximaData(r.vencimento_dia, hoje);
    const linha = centavos(r.valor) + centavos(r.setup) + centavos(r.hospedagem);
    fila.push({
      cliente: r.cliente, valor: reais(linha), centavos: linha,
      quando: diaBr(quando), ordem: quando.getTime(),
      status: r.status, status_nome: r.status_nome
    });
  });
  fila.sort(function (a, b) { return a.ordem - b.ordem; });

  const semana = fila.filter(function (x) { return x.ordem <= limite.getTime(); });
  const totalSemana = semana.reduce(function (a, x) { return a + x.centavos; }, 0);

  // Se nada vence nesta semana, o quadro não fica vazio: mostra as
  // próximas cobranças mesmo assim, para o time saber o que vem.
  const depois = semana.length ? [] : fila.slice(0, 5);

  return {
    clientes: ativos.length,
    total_setup: reais(setup),
    total_mensalidade: reais(mensal),
    total_hospedagem: reais(hosped),
    total_carteira: reais(setup + mensal + hosped),
    inadimplente: reais(inadimplente),
    inadimplente_qtd: qtdInad,
    aguardando: reais(aguardando),
    aguardando_qtd: qtdAguard,
    recebido: reais(recebido),
    recebido_qtd: qtdPago,
    proxima_semana: reais(totalSemana),
    proxima_semana_qtd: semana.length,
    proxima_semana_ate: diaBr(limite),
    proxima_semana_lista: semana,
    proximas_depois: depois
  };
}

// ------------------------------------------------------------
// RELATÓRIO
// Sai como CSV com ponto e vírgula (é o que o Excel em português
// entende sem perguntar nada) e com BOM na frente, senão acento
// vira caractere estranho ao abrir.
// ------------------------------------------------------------
function celula(v) {
  const t = String(v == null ? '' : v);
  if (/[";\n\r]/.test(t)) return '"' + t.replace(/"/g, '""') + '"';
  return t;
}

function relatorioCsv(linhas, res, comp) {
  const cab = ['Cliente', 'Mensalidade', 'Setup', 'Hospedagem', 'Total',
    'Vencimento', 'Status', 'Responsavel', 'Telefone', 'Observacao', 'Situacao do contrato'];
  const corpo = linhas.map(function (r) {
    return [
      r.cliente,
      dinheiroBr(r.valor), dinheiroBr(r.setup), dinheiroBr(r.hospedagem), dinheiroBr(r.total),
      'dia ' + r.vencimento_dia, r.status_nome,
      r.responsavel, r.telefone, r.observacao,
      r.ativo ? 'Ativo' : 'Encerrado'
    ].map(celula).join(';');
  });

  // linha de total, para o time bater o fechamento sem somar na mão
  const soma = function (campo) {
    return reais(linhas.reduce(function (a, r) { return a + centavos(r[campo]); }, 0));
  };
  corpo.push('');
  corpo.push(['TOTAL', dinheiroBr(soma('valor')), dinheiroBr(soma('setup')),
    dinheiroBr(soma('hospedagem')), dinheiroBr(soma('total')), '', '', '', '', '', ''
  ].map(celula).join(';'));

  const texto = '﻿' + [cab.map(celula).join(';')].concat(corpo).join('\r\n') + '\r\n';
  const hoje = new Date();
  const nome = comp
    ? 'cobrancas-' + comp.ano + '-' + String(comp.mes).padStart(2, '0') + '.csv'
    : 'financeiro-startdigital-' + hoje.getFullYear() +
      String(hoje.getMonth() + 1).padStart(2, '0') + String(hoje.getDate()).padStart(2, '0') + '.csv';

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="' + nome + '"');
  res.end(texto);
}

// ------------------------------------------------------------
function limpaTexto(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max || 200) || null;
}

// O time digita valor de todo jeito: "2.500,00", "R$ 1.890", "997.50".
// Duas regras, nesta ordem:
//   1. tem vírgula? então a vírgula é o centavo e o ponto é milhar.
//   2. não tem vírgula? o ponto só é milhar quando vem seguido de
//      exatamente três dígitos ("1.890" = mil oitocentos e noventa).
//      "997.50" tem dois dígitos depois do ponto, então é centavo.
function limpaValor(v) {
  if (v === undefined || v === null || v === '') return 0;
  const t = String(v).replace(/[^\d,.-]/g, '');

  let normal;
  if (t.indexOf(',') >= 0) {
    normal = t.replace(/\./g, '').replace(',', '.');
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) {
    normal = t.replace(/\./g, '');
  } else {
    normal = t;
  }

  const n = Number(normal);
  if (!isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

module.exports = async function handler(req, res) {
  u.setBaseFromReq(req);
  const params = (req.query && Object.keys(req.query).length)
    ? req.query
    : Object.fromEntries(new URL(req.url, 'http://x').searchParams.entries());
  const action = params.action || '';

  try {
    const entrada = await porta.abrir(req, res, action);
    if (!entrada) return;

    // ---------------------------------------------------- a tabela
    if (action === 'fin_lista') {
      const virada = await garantirCompetencias();
      const comp = competenciaDe(params);
      const linhas = await carteira(comp);
      return u.ok(res, {
        clientes: linhas, status: STATUS, status_nomes: STATUS_NOME,
        competencia: comp,
        competencia_atual: competenciaAtual(),
        competencias: await competenciasExistentes(),
        meses: MESES,
        viradas: virada.criadas
      });
    }

    // ---------------------------------------------------- o dashboard
    if (action === 'fin_resumo') {
      await garantirCompetencias();
      const comp = competenciaDe(params);
      const linhas = await carteira(comp);
      const hoje = new Date();

      // O período do dashboard É a competência escolhida: do dia 1 ao
      // último dia daquele mês. É isso que faz Cobranças e Dashboard
      // nunca mostrarem meses diferentes.
      const de = new Date(comp.ano, comp.mes - 1, 1);
      const ate = new Date(comp.ano, comp.mes, 0, 23, 59, 59);

      const atual = competenciaAtual();
      const ehAtual = comp.mes === atual.mes && comp.ano === atual.ano;

      return u.ok(res, {
        // a previsão da próxima semana só faz sentido no mês corrente;
        // em mês fechado ela viraria adivinhação sobre o passado
        resumo: Object.assign(resumo(linhas, hoje), { competencia_corrente: ehAtual }),
        cartoes: cartoesDoPeriodo(linhas, de, ate, hoje),
        competencia: comp,
        competencia_atual: atual,
        competencias: await competenciasExistentes(),
        meses: MESES
      });
    }

    // ==========================================================
    // CLIENTES — o cadastro e a ficha financeira de cada um
    // ==========================================================
    if (action === 'fc_lista') {
      await garantirCompetencias();
      const cadastros = await db.select('finance_customers', { order: 'nome.asc', select: '*' });
      const cobrancas = await db.select('finance_clients', {
        excluida_em: 'is.null', select: 'customer_id,valor,status,ref_mes,ref_ano'
      });

      const porCliente = {};
      cobrancas.forEach(function (c) {
        if (!c.customer_id) return;
        const a = porCliente[c.customer_id] || (porCliente[c.customer_id] = {
          total: 0, pagas: 0, abertas: 0, recebido: 0, ultima: null
        });
        a.total++;
        if (c.status === 'pago') { a.pagas++; a.recebido += centavos(c.valor); }
        else a.abertas++;
        const ord = ordinal(Number(c.ref_mes), Number(c.ref_ano));
        if (!a.ultima || ord > a.ultima.ord) a.ultima = { ord: ord, mes: Number(c.ref_mes), ano: Number(c.ref_ano) };
      });

      return u.ok(res, {
        clientes: cadastros.map(function (c) {
          const a = porCliente[c.id] || { total: 0, pagas: 0, abertas: 0, recebido: 0, ultima: null };
          return Object.assign(clienteParaTela(c), {
            cobrancas: a.total, pagas: a.pagas, em_aberto: a.abertas,
            total_recebido: reais(a.recebido),
            ultima_competencia: a.ultima ? { mes: a.ultima.mes, ano: a.ultima.ano } : null
          });
        }),
        meses: MESES
      });
    }

    // A FICHA: o rastro financeiro completo daquele cliente. O
    // historico nao e digitado — sai das cobrancas vinculadas a ele.
    if (action === 'fc_ficha') {
      const id = String(params.id || '');
      if (!id) return u.fail(res, 400, 'Falta dizer qual cliente.');
      const c = await db.selectOne('finance_customers', { id: 'eq.' + id, select: '*' });
      if (!c) return u.fail(res, 404, 'Cliente nao encontrado.');

      const linhas = await db.select('finance_clients', {
        customer_id: 'eq.' + id, excluida_em: 'is.null',
        order: 'ref_ano.desc,ref_mes.desc', select: '*'
      });

      // do mais recente para o mais antigo
      linhas.sort(function (a, b) {
        return ordinal(Number(b.ref_mes), Number(b.ref_ano)) - ordinal(Number(a.ref_mes), Number(a.ref_ano));
      });

      let recebido = 0, aberto = 0;
      const historico = linhas.map(function (r) {
        const t = paraTela(r);
        if (t.status === 'pago') recebido += centavos(t.valor); else aberto += centavos(t.valor);
        return {
          id: t.id,
          competencia: { mes: t.ref_mes, ano: t.ref_ano },
          competencia_nome: (MESES[t.ref_mes - 1] || '?') + '/' + t.ref_ano,
          valor: t.valor,
          // vencimento e pagamento sao DATAS DIFERENTES, de proposito:
          // e a diferenca entre elas que conta como o cliente paga.
          vencimento: dataDeVencimento(r),
          vencimento_dia: t.vencimento_dia,
          pago_em: t.pago_em,
          status: t.status,
          status_nome: t.status_nome,
          observacao: t.observacao
        };
      });

      return u.ok(res, {
        cliente: clienteParaTela(c),
        historico: historico,
        resumo: {
          cobrancas: historico.length,
          recebido: reais(recebido),
          em_aberto: reais(aberto)
        },
        meses: MESES
      });
    }

    // Editar o CADASTRO — nome, telefone, responsavel e as observacoes
    // que atravessam os meses. Nao mexe em cobranca nenhuma.
    if (action === 'fc_salvar') {
      if (req.method !== 'POST') return u.fail(res, 405, 'Metodo nao permitido');
      const body = await u.readBody(req);
      if (!body.id) return u.fail(res, 400, 'Falta dizer qual cliente.');

      const nome = limpaTexto(body.nome, 160);
      if (!nome) return u.fail(res, 400, 'Escreva o nome do cliente.');

      const patch = {
        nome: nome,
        chave: chaveDoCliente(nome),
        telefone: limpaTexto(body.telefone, 40),
        responsavel: limpaTexto(body.responsavel, 120),
        observacoes: limpaTexto(body.observacoes, 2000),
        updated_at: new Date().toISOString()
      };

      let row;
      try {
        row = await db.update('finance_customers', patch, { id: 'eq.' + body.id });
      } catch (e) {
        return u.fail(res, 409, 'Ja existe outro cliente com esse nome.');
      }
      if (!row) return u.fail(res, 404, 'Cliente nao encontrado.');
      return u.ok(res, { cliente: clienteParaTela(row) });
    }

    // ---------------------------------------------------- DRE
    // Entradas - Despesas = Resultado. Nenhum numero e digitado nem
    // guardado: os tres saem dos lancamentos que ja existem. Marcou
    // uma cobranca como paga ou mexeu numa despesa? O DRE muda junto,
    // porque ele le da mesma fonte.
    if (action === 'fin_dre') {
      await garantirCompetencias();
      const comp = competenciaDe(params);

      // ENTRADAS = o que o cliente REALMENTE pagou nesta competencia.
      // Nao e "valor a receber": so entra quem esta com status pago.
      const cobrancas = await carteira(comp);
      const pagas = cobrancas.filter(function (c) { return c.ativo && c.status === 'pago'; });
      const entradasCent = pagas.reduce(function (a, c) { return a + centavos(c.valor); }, 0);

      // A MESMA competencia vira o intervalo de datas das despesas:
      // do dia 1 ao ultimo dia daquele mes.
      const de = comp.ano + '-' + String(comp.mes).padStart(2, '0') + '-01';
      const ultimoDia = new Date(comp.ano, comp.mes, 0).getDate();
      const ate = comp.ano + '-' + String(comp.mes).padStart(2, '0') + '-' + String(ultimoDia).padStart(2, '0');

      const todasDespesas = await db.select('finance_expenses', { order: 'data.desc', select: '*' });
      const despesas = todasDespesas.filter(function (g) {
        const d = String(g.data || '').slice(0, 10);
        return d >= de && d <= ate;
      });
      const despesasCent = despesas.reduce(function (a, g) { return a + centavos(g.valor); }, 0);

      // em centavos ate o fim: subtracao em ponto flutuante erra
      const resultadoCent = entradasCent - despesasCent;

      return u.ok(res, {
        competencia: comp,
        competencia_atual: competenciaAtual(),
        competencias: await competenciasExistentes(),
        meses: MESES,
        entradas: reais(entradasCent),
        entradas_qtd: pagas.length,
        despesas: reais(despesasCent),
        despesas_qtd: despesas.length,
        resultado: reais(resultadoCent),
        // quanto ainda esta em aberto no mes — nao entra na conta,
        // mas explica por que a entrada nao e a carteira inteira
        em_aberto: reais(cobrancas.filter(function (c) { return c.ativo && c.status !== 'pago'; })
          .reduce(function (a, c) { return a + centavos(c.valor); }, 0)),
        periodo: { de: de, ate: ate }
      });
    }

    // A virada por fora (cron mensal). Devolve o que criou, e chamar
    // duas vezes no mesmo mês não cria nada de novo.
    if (action === 'fin_virada') {
      const r = await garantirCompetencias();
      return u.ok(res, { criadas: r.criadas, competencia_atual: competenciaAtual() });
    }

    // ---------------------------------------------------- o relatório
    // Sai como arquivo mesmo, não como JSON: o navegador baixa direto.
    if (action === 'fin_relatorio') {
      const comp = competenciaDe(params);
      const linhas = await carteira(comp);
      return relatorioCsv(linhas, res, comp);
    }

    // ---------------------------------------------------- gravar
    if (action === 'fin_salvar') {
      if (req.method !== 'POST') return u.fail(res, 405, 'Metodo nao permitido');
      const body = await u.readBody(req);

      const cliente = limpaTexto(body.cliente, 120);
      if (!cliente) return u.fail(res, 400, 'Escreva o nome do cliente.');

      const dia = Math.min(Math.max(Number(body.vencimento_dia) || 10, 1), 31);
      const status = STATUS.indexOf(body.status) >= 0 ? body.status : 'aguardando';

      const patch = {
        cliente: cliente,
        valor: limpaValor(body.valor),
        setup: limpaValor(body.setup),
        hospedagem: limpaValor(body.hospedagem),
        vencimento_dia: dia,
        status: status,
        responsavel: limpaTexto(body.responsavel, 120),
        telefone: limpaTexto(body.telefone, 40),
        observacao: limpaTexto(body.observacao, 400),
        destaque: body.destaque === true,
        ativo: body.ativo !== false,
        updated_at: new Date().toISOString()
      };

      let row;
      if (body.id) {
        // A DATA DO PAGAMENTO: virou "pago" agora? Carimba o momento.
        // Saiu de "pago"? Apaga o carimbo. Já estava pago? Não mexe —
        // senão toda edição empurraria o pagamento para hoje.
        const antes = await db.selectOne('finance_clients', { id: 'eq.' + body.id, select: 'status,pago_em' });
        if (!antes) return u.fail(res, 404, 'Cliente nao encontrado.');
        if (status === 'pago') {
          patch.pago_em = antes.status === 'pago' ? (antes.pago_em || new Date().toISOString()) : new Date().toISOString();
        } else {
          patch.pago_em = null;
        }
        row = await db.update('finance_clients', patch, { id: 'eq.' + body.id });
        if (!row) return u.fail(res, 404, 'Cliente nao encontrado.');
      } else {
        if (status === 'pago') patch.pago_em = new Date().toISOString();
        // toda cobranca nasce ligada a um cadastro de cliente; se o
        // cliente ainda nao existe, ele e criado aqui — uma vez so.
        patch.customer_id = await clienteDeCobranca(cliente, {
          telefone: patch.telefone, responsavel: patch.responsavel
        });
        const comp = competenciaDe(body);
        patch.ref_mes = comp.mes;
        patch.ref_ano = comp.ano;
        const todos = await db.select('finance_clients', {
          ref_mes: 'eq.' + comp.mes, ref_ano: 'eq.' + comp.ano, select: 'position'
        });
        patch.position = todos.reduce(function (a, r) {
          return Math.max(a, Number(r.position || 0));
        }, 0) + 1;
        try {
          row = await db.insert('finance_clients', patch);
        } catch (e) {
          return u.fail(res, 409, 'Ja existe uma cobranca desse cliente em ' + MESES[comp.mes - 1] + '/' + comp.ano + '.');
        }
      }
      return u.ok(res, { cliente: paraTela(row) });
    }

    // ---------------------------------------------------- importação
    // A tela lê o arquivo (CSV/XLS/XLSX), mostra a prévia e manda para
    // cá linhas já em formato de gente. Aqui é a peneira final: nome
    // obrigatório, valores limpos, dia válido — e NINGUÉM entra duas
    // vezes. A identidade é o nome do cliente (sem acento, sem caixa),
    // que é o único identificador que esta carteira tem hoje.
    if (action === 'fin_importar') {
      if (req.method !== 'POST') return u.fail(res, 405, 'Metodo nao permitido');
      const body = await u.readBody(req);
      const linhas = Array.isArray(body.linhas) ? body.linhas : [];
      if (!linhas.length) return u.fail(res, 400, 'O arquivo nao trouxe nenhuma linha.');
      if (linhas.length > 500) return u.fail(res, 400, 'Maximo de 500 clientes por arquivo. Divida em partes.');

      function identidade(nome) {
        return String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
          .toLowerCase().replace(/\s+/g, ' ').trim();
      }

      const comp = competenciaDe(body);
      const existentes = await db.select('finance_clients', {
        ref_mes: 'eq.' + comp.mes, ref_ano: 'eq.' + comp.ano,
        excluida_em: 'is.null', select: 'cliente,position'
      });
      const vistos = {};
      existentes.forEach(function (r) { vistos[identidade(r.cliente)] = true; });
      let posicao = existentes.reduce(function (a, r) { return Math.max(a, Number(r.position || 0)); }, 0);

      const MAPA_STATUS = function (s) {
        const t = identidade(s);
        if (/pag|receb|ok|quitad/.test(t)) return 'pago';
        if (/venc|inadim|atras|devend/.test(t)) return 'inadimplente';
        return 'aguardando';
      };

      let importados = 0;
      const pulados = [];

      for (let i = 0; i < linhas.length; i++) {
        const l = linhas[i] || {};
        const numLinha = Number(l.linha) || (i + 1);
        const nome = limpaTexto(l.cliente, 120);

        if (!nome || nome.length < 2) {
          pulados.push({ linha: numLinha, nome: nome || '(vazio)', motivo: 'sem nome de cliente' });
          continue;
        }
        const id = identidade(nome);
        if (vistos[id]) {
          pulados.push({ linha: numLinha, nome: nome, motivo: 'ja existe na carteira (ou repetido no arquivo)' });
          continue;
        }

        let dia = Math.round(Number(String(l.vencimento_dia || '').replace(/\D/g, '')));
        if (!isFinite(dia) || dia < 1 || dia > 31) dia = 10;

        const status = MAPA_STATUS(l.status);
        const novo = {
          cliente: nome,
          valor: limpaValor(l.valor),
          setup: limpaValor(l.setup),
          hospedagem: limpaValor(l.hospedagem),
          vencimento_dia: dia,
          status: status,
          pago_em: status === 'pago' ? new Date().toISOString() : null,
          responsavel: limpaTexto(l.responsavel, 120),
          telefone: limpaTexto(l.telefone, 40),
          observacao: limpaTexto(l.observacao, 400),
          destaque: false, ativo: true,
          position: ++posicao,
          ref_mes: comp.mes, ref_ano: comp.ano,
          updated_at: new Date().toISOString()
        };

        try {
          novo.customer_id = await clienteDeCobranca(nome, {
            telefone: novo.telefone, responsavel: novo.responsavel
          });
          await db.insert('finance_clients', novo);
          vistos[id] = true;
          importados++;
        } catch (e) {
          pulados.push({ linha: numLinha, nome: nome, motivo: 'o banco recusou: ' + e.message });
        }
      }

      return u.ok(res, {
        importados: importados,
        pulados: pulados.slice(0, 100),
        total_pulados: pulados.length,
        total_no_arquivo: linhas.length,
        competencia: comp
      });
    }

    // ==========================================================
    // OUTROS GASTOS — o caderninho de despesas avulsas.
    // O total do período sai das MESMAS linhas da tabela: uma
    // fonte só, sem número paralelo para divergir depois.
    // ==========================================================
    if (action === 'fg_lista') {
      const todas = await db.select('finance_expenses', { order: 'data.desc,created_at.desc', select: '*' });

      // filtro de período feito aqui mesmo, sobre as linhas
      function dataOk(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : null; }
      const de = dataOk(params.de);
      const ate = dataOk(params.ate);
      const noPeriodo = todas.filter(function (g) {
        const d = String(g.data || '').slice(0, 10);
        if (de && d < de) return false;
        if (ate && d > ate) return false;
        return true;
      });

      const totalCent = noPeriodo.reduce(function (a, g) { return a + centavos(g.valor); }, 0);
      return u.ok(res, {
        gastos: noPeriodo.map(function (g) {
          return {
            id: g.id, item: g.item, valor: Number(g.valor || 0),
            data: String(g.data || '').slice(0, 10), observacao: g.observacao || ''
          };
        }),
        total: reais(totalCent),
        total_geral_qtd: todas.length,
        de: de, ate: ate
      });
    }

    if (action === 'fg_salvar') {
      if (req.method !== 'POST') return u.fail(res, 405, 'Metodo nao permitido');
      const body = await u.readBody(req);

      const item = limpaTexto(body.item, 160);
      if (!item) return u.fail(res, 400, 'Escreva o que foi o gasto.');
      const valor = limpaValor(body.valor);
      if (valor <= 0) return u.fail(res, 400, 'Confira o valor do gasto.');

      let data = String(body.data || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || isNaN(new Date(data + 'T12:00:00').getTime())) {
        data = new Date().toISOString().slice(0, 10);
      }

      const patch = {
        item: item, valor: valor, data: data,
        observacao: limpaTexto(body.observacao, 400),
        updated_at: new Date().toISOString()
      };

      let row;
      if (body.id) {
        row = await db.update('finance_expenses', patch, { id: 'eq.' + body.id });
        if (!row) return u.fail(res, 404, 'Gasto nao encontrado.');
      } else {
        row = await db.insert('finance_expenses', patch);
      }
      return u.ok(res, {
        gasto: { id: row.id, item: row.item, valor: Number(row.valor || 0), data: String(row.data || '').slice(0, 10), observacao: row.observacao || '' }
      });
    }

    if (action === 'fg_excluir') {
      if (req.method !== 'POST') return u.fail(res, 405, 'Metodo nao permitido');
      const body = await u.readBody(req);
      if (!body.id) return u.fail(res, 400, 'Falta dizer qual gasto.');
      await db.remove('finance_expenses', { id: 'eq.' + body.id });
      return u.ok(res, { removido: true });
    }

    if (action === 'fin_excluir') {
      if (req.method !== 'POST') return u.fail(res, 405, 'Metodo nao permitido');
      const body = await u.readBody(req);
      if (!body.id) return u.fail(res, 400, 'Falta dizer qual cliente.');
      // EXCLUSAO LOGICA: historico financeiro nao se joga fora. A linha
      // some das telas e do calculo, mas continua no banco — se alguem
      // apagar por engano, da para trazer de volta.
      await db.update('finance_clients', {
        excluida_em: new Date().toISOString(), updated_at: new Date().toISOString()
      }, { id: 'eq.' + body.id });
      return u.ok(res, { removido: true });
    }

    return u.fail(res, 400, 'Acao desconhecida: ' + action);
  } catch (e) {
    console.error('[financeiro]', e);
    return u.fail(res, 500, e.message);
  }
};

// exportado para o teste conferir a conta sem subir servidor
module.exports.resumo = resumo;
module.exports.ordinal = ordinal;
module.exports.deOrdinal = deOrdinal;
module.exports.competenciaAtual = competenciaAtual;
module.exports.MESES = MESES;
module.exports.proximaData = proximaData;
module.exports.limpaValor = limpaValor;
