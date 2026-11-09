// ============================================================
// O ESPELHO DO QUADRO
//
// O Kanban do Onboarding agora move o card na hora, antes de o
// servidor responder. Para isso o navegador precisa saber, sozinho,
// em qual coluna o card vai cair — e essa regra existe duas vezes:
//
//   servidor → api/operacao.js, dentro do ob_lista
//   navegador → public/js/admin-onboarding.js, obRecalcula()
//
// Regra escrita duas vezes é regra que um dia discorda de si mesma.
// Este teste põe as duas lado a lado e quebra no minuto em que elas
// pararem de concordar.
//
// Uso:  ADMIN_PASSWORD="sua-senha" node tools/test-kanban.js
//       (precisa do espelho local no ar: sh tools/start-local.sh)
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');
const BASE = 'http://localhost:3000';
const SUF = Date.now().toString(36);
const SENHA = process.env.ADMIN_PASSWORD || process.env.ADMIN_SECRET || '';
let ok = 0, falhas = 0;
let T = '';

if (!SENHA) {
  console.error('Falta a senha. Rode:  ADMIN_PASSWORD="sua-senha" node tools/test-kanban.js');
  process.exit(1);
}

function check(nome, cond, extra) {
  if (cond) { ok++; console.log('  ok   ' + nome); }
  else {
    falhas++;
    console.log('  FALHA ' + nome + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
  }
}

async function api(action, body, params) {
  const qs = new URLSearchParams(Object.assign({ action: action }, params || {}));
  const r = await fetch(BASE + '/api/operacao?' + qs, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + T },
    body: body ? JSON.stringify(body) : undefined
  });
  return r.json();
}

// ------------------------------------------------------------
// Carrega as DUAS funções do navegador sem navegador nenhum: o
// arquivo é lido como texto e só os dois pedaços que interessam
// são avaliados. Assim o teste usa o código de verdade que vai
// para o ar, não uma cópia dele.
// ------------------------------------------------------------
function carregaEspelhoDoNavegador() {
  const txt = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'admin-onboarding.js'), 'utf8');
  const pega = function (nome) {
    const i = txt.indexOf('function ' + nome + '(');
    if (i < 0) throw new Error('não achei a função ' + nome + ' em admin-onboarding.js');
    // conta chaves até fechar a função
    let j = txt.indexOf('{', i), nivel = 0, k = j;
    for (; k < txt.length; k++) {
      if (txt[k] === '{') nivel++;
      else if (txt[k] === '}') { nivel--; if (!nivel) break; }
    }
    return txt.slice(i, k + 1);
  };
  const fonte = pega('obDiasAte') + '\n' + pega('obRecalcula') + '\n' + pega('obAplicaSituacao') +
    '\nreturn { obRecalcula: obRecalcula, obAplicaSituacao: obAplicaSituacao };';
  return new Function(fonte)();
}

function dia(desloca) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + desloca);
  return d.toISOString().slice(0, 10);
}

(async function () {
  console.log('\n=== ESPELHO DO QUADRO (navegador x servidor) ===\n');

  const espelho = carregaEspelhoDoNavegador();
  check('as funções do navegador foram carregadas do arquivo de verdade',
    typeof espelho.obRecalcula === 'function' && typeof espelho.obAplicaSituacao === 'function');

  T = (await (await fetch(BASE + '/api/admin?action=login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: SENHA })
  })).json()).token;
  check('entrou no painel', !!T);

  // Reaproveita um gestor que já existe. Criar um só para o teste
  // sujaria o cadastro para sempre: gestor não tem exclusão, e a
  // próxima suíte que conta gestores quebraria sem motivo.
  const gs = await api('op_gestores');
  check('o cadastro tem gestores para usar', (gs.gestores || []).length > 0, gs.error);
  const gestorId = (gs.gestores || [])[0] && gs.gestores[0].id;

  // Cada caso é um onboarding com uma combinação de situação e prazo.
  // O que a gente quer saber é só isto: o servidor e o navegador põem
  // o card na MESMA coluna?
  const casos = [
    { nome: 'a iniciar, sem prazo',        situacao: 'a_iniciar',    prazo: null },
    { nome: 'a iniciar, com prazo vencido', situacao: 'a_iniciar',   prazo: dia(-10) },
    { nome: 'em andamento, sem prazo',     situacao: 'em_andamento', prazo: null },
    { nome: 'em andamento, prazo ontem',   situacao: 'em_andamento', prazo: dia(-1) },
    { nome: 'em andamento, prazo hoje',    situacao: 'em_andamento', prazo: dia(0) },
    { nome: 'em andamento, prazo em 3d',   situacao: 'em_andamento', prazo: dia(3) },
    { nome: 'em andamento, prazo em 7d',   situacao: 'em_andamento', prazo: dia(7) },
    { nome: 'em andamento, prazo em 8d',   situacao: 'em_andamento', prazo: dia(8) },
    { nome: 'em andamento, prazo em 60d',  situacao: 'em_andamento', prazo: dia(60) },
    { nome: 'concluído hoje',              situacao: 'concluido',    prazo: dia(5) },
    { nome: 'cancelado',                   situacao: 'cancelado',    prazo: dia(5) }
  ];

  const criados = [];
  for (let i = 0; i < casos.length; i++) {
    const c = casos[i];
    const cli = await api('op_cliente_salvar', {
      nome: 'Kanban ' + SUF + ' ' + i, gestor_id: gestorId, categoria: 'Teste',
      fase: 'onboarding', status: 'ativo'
    });
    if (!cli.ok) { check('criou o cliente do caso "' + c.nome + '"', false, cli.error); continue; }
    const ob = await api('ob_salvar', {
      cliente_id: cli.cliente.id, gestor_id: gestorId,
      inicio_previsto: dia(-20), prazo: c.prazo, situacao: c.situacao
    });
    if (!ob.ok) { check('abriu o onboarding do caso "' + c.nome + '"', false, ob.error); continue; }
    criados.push({ caso: c, id: ob.onboarding && ob.onboarding.id });
  }
  check('todos os ' + casos.length + ' casos foram criados', criados.length === casos.length,
    criados.length);

  // ---- a comparação ----
  const lista = await api('ob_lista');
  check('o servidor devolveu o quadro', lista.ok === true, lista.error);
  const porId = {};
  (lista.onboardings || []).forEach(function (o) { porId[o.id] = o; });

  let iguais = 0;
  criados.forEach(function (x) {
    const doServidor = porId[x.id];
    if (!doServidor) { check('o servidor listou "' + x.caso.nome + '"', false); return; }

    // o navegador recebe os MESMOS campos crus e recalcula sozinho
    const noNavegador = espelho.obRecalcula({
      id: doServidor.id, situacao: doServidor.situacao,
      prazo: doServidor.prazo, concluido_em: doServidor.concluido_em,
      iniciado_em: doServidor.iniciado_em
    }, lista.hoje, lista.periodo);

    const bate = noNavegador.coluna === doServidor.coluna
      && noNavegador.atrasado === doServidor.atrasado
      && noNavegador.dias_para_o_prazo === doServidor.dias_para_o_prazo;
    if (bate) iguais++;
    check('mesma coluna nos dois lados — ' + x.caso.nome, bate, {
      servidor: { coluna: doServidor.coluna, atrasado: doServidor.atrasado, dias: doServidor.dias_para_o_prazo },
      navegador: { coluna: noNavegador.coluna, atrasado: noNavegador.atrasado, dias: noNavegador.dias_para_o_prazo }
    });
  });
  check('os ' + criados.length + ' casos concordaram', iguais === criados.length, iguais);

  // ---- e o que a mudança de situação faz com as datas ----
  // O obAplicaSituacao do navegador chuta o que o ob_mover vai fazer.
  // Se ele chutar errado, o card pousa na coluna errada por um
  // instante. Então: movemos de verdade e comparamos.
  const alvo = criados.filter(function (x) { return x.caso.situacao === 'a_iniciar' && !x.caso.prazo; })[0];
  if (alvo) {
    for (const destino of ['em_andamento', 'concluido', 'a_iniciar', 'em_andamento']) {
      const antes = Object.assign({}, porId[alvo.id]);
      const chute = espelho.obAplicaSituacao({
        situacao: antes.situacao, iniciado_em: antes.iniciado_em, concluido_em: antes.concluido_em
      }, destino, lista.hoje);

      const r = await api('ob_mover', { id: alvo.id, situacao: destino });
      check('moveu para ' + destino, r.ok === true, r.error);
      const linha = r.onboarding || {};
      check('o navegador acertou a situação ao mover para ' + destino,
        chute.situacao === linha.situacao, { chute: chute.situacao, servidor: linha.situacao });
      check('o navegador acertou iniciado_em ao mover para ' + destino,
        (chute.iniciado_em || null) === (linha.iniciado_em || null),
        { chute: chute.iniciado_em, servidor: linha.iniciado_em });
      check('o navegador acertou concluido_em ao mover para ' + destino,
        (chute.concluido_em || null) === (linha.concluido_em || null),
        { chute: chute.concluido_em, servidor: linha.concluido_em });
      porId[alvo.id] = Object.assign(antes, linha);
    }
  } else {
    check('achou um caso para testar a movimentação', false);
  }

  // ---- limpeza: tira do caminho o que este teste criou ----
  for (const x of criados) {
    const o = porId[x.id];
    if (o && o.cliente_id) await api('op_cliente_excluir', { id: o.cliente_id });
  }

  console.log('\n----------------------------------------');
  console.log(ok + ' passaram · ' + falhas + ' falharam');
  process.exit(falhas ? 1 : 0);
})().catch(function (e) {
  console.error('EXPLODIU', e);
  process.exit(1);
});
