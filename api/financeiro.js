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
    position: Number(r.position || 1)
  };
}

async function carteira() {
  const linhas = await db.select('finance_clients', {
    order: 'position.asc,created_at.asc', select: '*'
  });
  return linhas.map(paraTela);
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

function relatorioCsv(linhas, res) {
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
  const nome = 'financeiro-startdigital-' + hoje.getFullYear() +
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
      const linhas = await carteira();
      return u.ok(res, { clientes: linhas, status: STATUS, status_nomes: STATUS_NOME });
    }

    // ---------------------------------------------------- o dashboard
    if (action === 'fin_resumo') {
      const linhas = await carteira();
      return u.ok(res, { resumo: resumo(linhas, new Date()) });
    }

    // ---------------------------------------------------- o relatório
    // Sai como arquivo mesmo, não como JSON: o navegador baixa direto.
    if (action === 'fin_relatorio') {
      const linhas = await carteira();
      return relatorioCsv(linhas, res);
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
        row = await db.update('finance_clients', patch, { id: 'eq.' + body.id });
        if (!row) return u.fail(res, 404, 'Cliente nao encontrado.');
      } else {
        const todos = await db.select('finance_clients', { select: 'position' });
        patch.position = todos.reduce(function (a, r) {
          return Math.max(a, Number(r.position || 0));
        }, 0) + 1;
        row = await db.insert('finance_clients', patch);
      }
      return u.ok(res, { cliente: paraTela(row) });
    }

    if (action === 'fin_excluir') {
      if (req.method !== 'POST') return u.fail(res, 405, 'Metodo nao permitido');
      const body = await u.readBody(req);
      if (!body.id) return u.fail(res, 400, 'Falta dizer qual cliente.');
      await db.remove('finance_clients', { id: 'eq.' + body.id });
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
module.exports.proximaData = proximaData;
module.exports.limpaValor = limpaValor;
