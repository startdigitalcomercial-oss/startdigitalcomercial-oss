// TESTE DA VIRADA DO MES (rode com: node tools/test-virada.js)
// Sobe o servidor com o relogio adiantado e confere que o historico
// nasce certo, nao duplica e nao reescreve o passado.
// Precisa do espelho local no ar (sh tools/start-local.sh).
// Testa a virada do mes DE VERDADE: sobe o servidor com o relogio
// adiantado e confere que o historico nasce certo e nao duplica.
'use strict';
const { execSync, spawn } = require('child_process');

const SENHA = execSync("grep '^ADMIN_PASSWORD=' .env | cut -d= -f2").toString().trim();
let ok = 0, falhas = 0;
const diz = (n, c, e) => { if (c) { ok++; console.log('  ok   ' + n); } else { falhas++; console.log('  FALHA ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } };

let PORTA = 3100;
const filhos = [];
function sobe(dataFake) {
  // Cada fase do teste sobe um servidor NOVO numa porta NOVA. Matar
  // processo e esperar a porta soltar e receita de teste intermitente.
  PORTA++;
  const p = spawn('node', ['-e', `
    process.env.PORT = '${PORTA}';
    const D = Date;
    const alvo = new D('${dataFake}').getTime();
    const inicio = D.now();
    global.Date = class extends D {
      constructor(...a) { if (!a.length) super(alvo + (D.now() - inicio)); else super(...a); }
      static now() { return alvo + (D.now() - inicio); }
    };
    require('./dev-server.js');
  `], { stdio: ['ignore', 'ignore', require('fs').openSync('/tmp/fake.log', 'a')] });
  filhos.push(p);
  for (let i = 0; i < 60; i++) {
    try { execSync('curl -sf -m 1 http://localhost:' + PORTA + '/api/admin?action=dica_senha > /dev/null 2>&1'); return p; }
    catch (e) { execSync('sleep 0.3'); }
  }
  throw new Error('o servidor nao subiu na porta ' + PORTA);
}

function base() { return 'http://localhost:' + PORTA; }

async function entra() {
  const r = await (await fetch(base() + '/api/admin?action=login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: SENHA })
  })).json();
  return r.token;
}
async function fin(T, action, body, query) {
  const qs = new URLSearchParams(Object.assign({ action }, query || {}));
  return (await fetch(base() + '/api/financeiro?' + qs, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + T },
    body: body ? JSON.stringify(body) : undefined
  })).json();
}

// O espelho local guarda tudo na memoria: reiniciar ele = voltar ao
// estado inicial. Sem isso, sobras de outros testes (competencias
// futuras criadas por fixtures) fazem a virada parecer quebrada.
function zeraEspelho() {
  try { execSync('kill $(cat /tmp/mock.pid) 2>/dev/null'); } catch (e) {}
  execSync('sleep 1');
  const fs = require('fs');
  const p = spawn('node', ['tools/mock-supabase.js'],
    { stdio: ['ignore', fs.openSync('/tmp/mock.log', 'a'), fs.openSync('/tmp/mock.log', 'a')], detached: true });
  fs.writeFileSync('/tmp/mock.pid', String(p.pid));
  p.unref();
  for (let i = 0; i < 40; i++) {
    try { execSync('curl -sf -m 1 http://127.0.0.1:54321/rest/v1/settings?limit=1 > /dev/null 2>&1'); return; }
    catch (e) { execSync('sleep 0.3'); }
  }
  throw new Error('o espelho local nao voltou');
}

(async function () {
  zeraEspelho();

  // ---------- 31/08/2026, ultimo dia: nada deve virar ----------
  sobe('2026-08-31T18:00:00-03:00');
  let T = await entra();
  let l = await fin(T, 'fin_lista');
  diz('em 31/08 ainda estamos em agosto', l.competencia.mes === 8 && l.competencia.ano === 2026, l.competencia);
  diz('nenhuma competencia foi criada antes da hora', (l.viradas || []).length === 0, l.viradas);
  const agostoOriginal = l.clientes.length;
  const somaAgosto = l.clientes.reduce((a, c) => a + c.valor, 0);
  // deixa uma marca em agosto para conferir que ela NAO viaja
  const marcado = l.clientes.filter(c => c.status === 'pago')[0];
  await fin(T, 'fin_salvar', { id: marcado.id, cliente: marcado.cliente, valor: marcado.valor,
    setup: marcado.setup, hospedagem: marcado.hospedagem, vencimento_dia: marcado.vencimento_dia,
    status: 'pago', observacao: 'PAGOU EM AGOSTO' });
  // um contrato encerrado nao pode gerar cobranca em setembro
  const encerrado = l.clientes.filter(c => c.cliente === 'BRAZ')[0];
  await fin(T, 'fin_salvar', { id: encerrado.id, cliente: encerrado.cliente, valor: encerrado.valor,
    setup: encerrado.setup, hospedagem: encerrado.hospedagem, vencimento_dia: encerrado.vencimento_dia,
    status: encerrado.status, ativo: false });

  // ---------- 01/09/2026, 00h05: a virada acontece ----------
  sobe('2026-09-01T00:05:00-03:00');
  T = await entra();
  l = await fin(T, 'fin_lista');
  diz('em 01/09 o sistema ja abre em SETEMBRO', l.competencia.mes === 9 && l.competencia.ano === 2026, l.competencia);
  diz('a virada foi feita sozinha', (l.viradas || []).indexOf('9/2026') >= 0, l.viradas);
  diz('setembro herdou as cobrancas ATIVAS de agosto',
    l.clientes.length === agostoOriginal - 1, { setembro: l.clientes.length, agosto: agostoOriginal });
  diz('o contrato encerrado NAO gerou cobranca nova',
    l.clientes.filter(c => c.cliente === 'BRAZ').length === 0);
  diz('setembro nasce todo em aberto (nada nasce pago)',
    l.clientes.every(c => c.status === 'aguardando'), l.clientes.filter(c => c.status !== 'aguardando').map(c => c.cliente));
  diz('a observacao do mes passado nao viajou',
    l.clientes.every(c => !/PAGOU EM AGOSTO/.test(c.observacao || '')));
  diz('os valores e responsaveis vieram do fechamento de agosto',
    Math.abs(l.clientes.reduce((a, c) => a + c.valor, 0) - (somaAgosto - encerrado.valor)) < 0.01,
    { setembro: l.clientes.reduce((a, c) => a + c.valor, 0), esperado: somaAgosto - encerrado.valor });

  // agosto continua congelado
  const ago = await fin(T, 'fin_lista', null, { mes: 8, ano: 2026 });
  diz('AGOSTO ficou preservado, do tamanho que era', ago.clientes.length === agostoOriginal, ago.clientes.length);
  diz('e com a marca do fechamento intacta',
    ago.clientes.some(c => /PAGOU EM AGOSTO/.test(c.observacao || '')));
  diz('inclusive o cliente que estava pago', ago.clientes.some(c => c.status === 'pago'));

  // mexer em setembro nao mexe em agosto
  const alvoSet = l.clientes[0];
  await fin(T, 'fin_salvar', { id: alvoSet.id, cliente: alvoSet.cliente, valor: '77',
    vencimento_dia: 3, status: 'inadimplente', observacao: 'coisa de setembro' });
  const agoDepois = await fin(T, 'fin_lista', null, { mes: 8, ano: 2026 });
  const gemeo = agoDepois.clientes.filter(c => c.cliente === alvoSet.cliente)[0];
  diz('EDITAR SETEMBRO NAO MUDOU AGOSTO',
    gemeo && gemeo.valor !== 77 && !/coisa de setembro/.test(gemeo.observacao || ''), gemeo);

  // abrir de novo nao duplica
  const l2 = await fin(T, 'fin_lista');
  diz('abrir de novo nao cria competencia repetida', (l2.viradas || []).length === 0, l2.viradas);
  diz('e setembro tem o mesmo tamanho', l2.clientes.length === l.clientes.length, l2.clientes.length);

  // ---------- 01/01/2027: virada de ANO, com 3 meses de buraco ----------
  sobe('2027-01-02T09:00:00-03:00');
  T = await entra();
  const jan = await fin(T, 'fin_lista');
  diz('VIRADA DE ANO: abre em JANEIRO de 2027',
    jan.competencia.mes === 1 && jan.competencia.ano === 2027, jan.competencia);
  diz('nao caiu em janeiro de 2026', jan.competencia.ano !== 2026);
  diz('preencheu os meses que ninguem abriu (out, nov, dez, jan)',
    ['10/2026', '11/2026', '12/2026', '1/2027'].every(m => (jan.viradas || []).indexOf(m) >= 0), jan.viradas);
  const dez = await fin(T, 'fin_lista', null, { mes: 12, ano: 2026 });
  diz('dezembro/2026 existe no historico', dez.clientes.length > 0, dez.clientes.length);
  const setFinal = await fin(T, 'fin_lista', null, { mes: 9, ano: 2026 });
  diz('e setembro continua lá, do jeito que ficou', setFinal.clientes.length === l.clientes.length);
  diz('o seletor lista todas as competencias criadas',
    (jan.competencias || []).length >= 6, (jan.competencias || []).length);

  // ---------- deixa o palco como encontrou ----------
  // Este teste mexeu em AGOSTO de proposito (marcou um pago, desligou
  // um contrato). Se nao desfizer, o proximo teste ve uma carteira
  // diferente e falha sem culpa nenhuma.
  const agoraAgosto = await fin(T, 'fin_lista', null, { mes: 8, ano: 2026 });
  for (const linha of (agoraAgosto.clientes || [])) {
    if (linha.cliente === encerrado.cliente && linha.ativo === false) {
      await fin(T, 'fin_salvar', { id: linha.id, cliente: linha.cliente, valor: linha.valor,
        setup: linha.setup, hospedagem: linha.hospedagem, vencimento_dia: linha.vencimento_dia,
        status: linha.status, observacao: linha.observacao, ativo: true });
    }
    if (/PAGOU EM AGOSTO/.test(linha.observacao || '')) {
      await fin(T, 'fin_salvar', { id: linha.id, cliente: linha.cliente, valor: linha.valor,
        setup: linha.setup, hospedagem: linha.hospedagem, vencimento_dia: linha.vencimento_dia,
        status: linha.status, observacao: '', ativo: linha.ativo });
    }
  }
  const restaurado = await fin(T, 'fin_lista', null, { mes: 8, ano: 2026 });
  diz('agosto foi restaurado ao estado original',
    restaurado.clientes.every(function (c) { return c.ativo; }) &&
    !restaurado.clientes.some(function (c) { return /PAGOU EM AGOSTO/.test(c.observacao || ''); }),
    restaurado.clientes.filter(function (c) { return !c.ativo; }).map(function (c) { return c.cliente; }));

  // Este teste cria competencias no espelho compartilhado. Sem limpar,
  // o proximo teste veria setembro cheio e falharia sem culpa nenhuma.
  for (const c of (jan.competencias || [])) {
    if (c.ano === 2026 && c.mes === 8) continue;              // agosto e o palco original
    const lista = await fin(T, 'fin_lista', null, { mes: c.mes, ano: c.ano });
    for (const linha of (lista.clientes || [])) await fin(T, 'fin_excluir', { id: linha.id });
  }
  const conferindo = await fin(T, 'fin_lista', null, { mes: 8, ano: 2026 });
  diz('a limpeza nao encostou em agosto', conferindo.clientes.length === agostoOriginal, conferindo.clientes.length);

  console.log('\n' + ok + ' passaram · ' + falhas + ' falharam');
  filhos.forEach(function (f) { try { f.kill('SIGKILL'); } catch (e) {} });
  process.exit(falhas ? 1 : 0);
})();
