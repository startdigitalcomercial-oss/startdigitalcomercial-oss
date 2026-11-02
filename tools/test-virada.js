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
  // Um servidor falso esquecido de uma rodada anterior ainda responde
  // nessa porta — com o relogio e o codigo velhos. Entao a porta e
  // limpa antes de subir, senao o teste conversa com um fantasma.
  try { execSync('fuser -k ' + PORTA + '/tcp 2>/dev/null'); execSync('sleep 0.4'); } catch (e) {}
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
  // mata pelo PID e tambem pela PORTA: um espelho antigo esquecido
  // ali continua respondendo com o codigo velho e o teste culpa o
  // sistema por um erro que e do ambiente.
  try { execSync('kill $(cat /tmp/mock.pid) 2>/dev/null'); } catch (e) {}
  try { execSync('fuser -k 54321/tcp 2>/dev/null'); } catch (e) {}
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

// As tres datas do teste saem do MES DE HOJE, nao de 2026 fixo. O
// espelho semeia a carteira no mes corrente; se o teste insistisse
// numa data fixa, ele envelheceria sozinho e passaria a falhar sem
// ninguem ter mexido em nada.
const HOJE = (function () {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date()).split('-');
  return { ano: Number(p[0]), mes: Number(p[1]) };
})();
const ord = (m, a) => a * 12 + (m - 1);
const deOrd = (o) => ({ mes: (o % 12) + 1, ano: Math.floor(o / 12) });

const MES_A = HOJE.mes, ANO_A = HOJE.ano;                      // o mes de hoje
const B = deOrd(ord(MES_A, ANO_A) + 1);                        // o mes seguinte
const MES_B = B.mes, ANO_B = B.ano;
const F = deOrd(ord(MES_A, ANO_A) + 5);                        // cinco meses a frente
const MES_F = F.mes, ANO_F = F.ano;

const dois = (n) => String(n).padStart(2, '0');
const ultimoDia = (m, a) => new Date(a, m, 0).getDate();
const FIM_DE_A   = ANO_A + '-' + dois(MES_A) + '-' + dois(ultimoDia(MES_A, ANO_A)) + 'T18:00:00-03:00';
const INICIO_DE_B = ANO_B + '-' + dois(MES_B) + '-01T00:05:00-03:00';
const DIA_2_DE_F  = ANO_F + '-' + dois(MES_F) + '-02T09:00:00-03:00';
// os quatro meses que o pulo tem de preencher: de B+1 ate F
const BURACO = [1, 2, 3, 4].map((k) => {
  const d = deOrd(ord(MES_B, ANO_B) + k);
  return d.mes + '/' + d.ano;
});

(async function () {
  zeraEspelho();

  // ---------- 31/08/2026, ultimo dia: nada deve virar ----------
  sobe(FIM_DE_A);
  let T = await entra();
  let l = await fin(T, 'fin_lista');
  diz('no ultimo dia do mes ainda estamos NESTE mes', l.competencia.mes === MES_A && l.competencia.ano === ANO_A, l.competencia);
  diz('nenhuma competencia foi criada antes da hora', (l.viradas || []).length === 0, l.viradas);
  const agostoOriginal = l.clientes.length;
  const somaAgosto = l.clientes.reduce((a, c) => a + c.valor, 0);
  // deixa uma marca em agosto para conferir que ela NAO viaja
  const marcado = l.clientes.filter(c => c.status === 'pago')[0];
  await fin(T, 'fin_salvar', { id: marcado.id, cliente: marcado.cliente, valor: marcado.valor,
    setup: marcado.setup, hospedagem: marcado.hospedagem, vencimento_dia: marcado.vencimento_dia,
    status: 'pago', observacao: 'PAGOU NO MES ANTERIOR' });
  // um contrato encerrado nao pode gerar cobranca em setembro
  const encerrado = l.clientes.filter(c => c.cliente === 'BRAZ')[0];
  await fin(T, 'fin_salvar', { id: encerrado.id, cliente: encerrado.cliente, valor: encerrado.valor,
    setup: encerrado.setup, hospedagem: encerrado.hospedagem, vencimento_dia: encerrado.vencimento_dia,
    status: encerrado.status, ativo: false });

  // ---------- 01/09/2026, 00h05: a virada acontece ----------
  sobe(INICIO_DE_B);
  T = await entra();
  l = await fin(T, 'fin_lista');
  diz('no dia 1 o sistema ja abre no mes SEGUINTE', l.competencia.mes === MES_B && l.competencia.ano === ANO_B, l.competencia);
  diz('a virada foi feita sozinha', (l.viradas || []).indexOf(MES_B + '/' + ANO_B) >= 0, l.viradas);
  diz('o mes novo herdou as cobrancas ATIVAS do anterior',
    l.clientes.length === agostoOriginal - 1, { novo: l.clientes.length, anterior: agostoOriginal });
  diz('o contrato encerrado NAO gerou cobranca nova',
    l.clientes.filter(c => c.cliente === 'BRAZ').length === 0);
  diz('o mes novo nasce todo em aberto (nada nasce pago)',
    l.clientes.every(c => c.status === 'aguardando'), l.clientes.filter(c => c.status !== 'aguardando').map(c => c.cliente));
  diz('a observacao do mes passado nao viajou',
    l.clientes.every(c => !/PAGOU NO MES ANTERIOR/.test(c.observacao || '')));
  diz('os valores vieram do fechamento do mes anterior',
    Math.abs(l.clientes.reduce((a, c) => a + c.valor, 0) - (somaAgosto - encerrado.valor)) < 0.01,
    { novo: l.clientes.reduce((a, c) => a + c.valor, 0), esperado: somaAgosto - encerrado.valor });

  // agosto continua congelado
  const ago = await fin(T, 'fin_lista', null, { mes: MES_A, ano: ANO_A });
  diz('O MES ANTERIOR ficou preservado, do tamanho que era', ago.clientes.length === agostoOriginal, ago.clientes.length);
  diz('e com a marca do fechamento intacta',
    ago.clientes.some(c => /PAGOU NO MES ANTERIOR/.test(c.observacao || '')));
  diz('inclusive o cliente que estava pago', ago.clientes.some(c => c.status === 'pago'));

  // mexer em setembro nao mexe em agosto
  const alvoSet = l.clientes[0];
  await fin(T, 'fin_salvar', { id: alvoSet.id, cliente: alvoSet.cliente, valor: '77',
    vencimento_dia: 3, status: 'inadimplente', observacao: 'coisa do mes novo' });
  const agoDepois = await fin(T, 'fin_lista', null, { mes: MES_A, ano: ANO_A });
  const gemeo = agoDepois.clientes.filter(c => c.cliente === alvoSet.cliente)[0];
  diz('EDITAR O MES NOVO NAO MUDOU O ANTERIOR',
    gemeo && gemeo.valor !== 77 && !/coisa do mes novo/.test(gemeo.observacao || ''), gemeo);

  // abrir de novo nao duplica
  const l2 = await fin(T, 'fin_lista');
  diz('abrir de novo nao cria competencia repetida', (l2.viradas || []).length === 0, l2.viradas);
  diz('e o mes novo tem o mesmo tamanho', l2.clientes.length === l.clientes.length, l2.clientes.length);

  // ---------- 01/01/2027: virada de ANO, com 3 meses de buraco ----------
  sobe(DIA_2_DE_F);
  T = await entra();
  const jan = await fin(T, 'fin_lista');
  diz('PULO DE 4 MESES: abre no mes certo',
    jan.competencia.mes === MES_F && jan.competencia.ano === ANO_F, jan.competencia);
  diz('e nao voltou um ano no caminho', jan.competencia.ano >= ANO_A);
  diz('preencheu os meses que ninguem abriu',
    BURACO.every(m => (jan.viradas || []).indexOf(m) >= 0), { esperado: BURACO, veio: jan.viradas });
  const meio = deOrd(ord(MES_B, ANO_B) + 2);
  const dez = await fin(T, 'fin_lista', null, { mes: meio.mes, ano: meio.ano });
  diz('o mes do meio do pulo existe no historico', dez.clientes.length > 0, dez.clientes.length);
  const setFinal = await fin(T, 'fin_lista', null, { mes: MES_B, ano: ANO_B });
  diz('e o mes seguinte continua lá, do jeito que ficou', setFinal.clientes.length === l.clientes.length);
  diz('o seletor lista todas as competencias criadas',
    (jan.competencias || []).length >= 6, (jan.competencias || []).length);

  // ---------- deixa o palco como encontrou ----------
  // Este teste mexeu em AGOSTO de proposito (marcou um pago, desligou
  // um contrato). Se nao desfizer, o proximo teste ve uma carteira
  // diferente e falha sem culpa nenhuma.
  const agoraMesA = await fin(T, 'fin_lista', null, { mes: MES_A, ano: ANO_A });
  for (const linha of (agoraMesA.clientes || [])) {
    if (linha.cliente === encerrado.cliente && linha.ativo === false) {
      await fin(T, 'fin_salvar', { id: linha.id, cliente: linha.cliente, valor: linha.valor,
        setup: linha.setup, hospedagem: linha.hospedagem, vencimento_dia: linha.vencimento_dia,
        status: linha.status, observacao: linha.observacao, ativo: true });
    }
    if (/PAGOU NO MES ANTERIOR/.test(linha.observacao || '')) {
      await fin(T, 'fin_salvar', { id: linha.id, cliente: linha.cliente, valor: linha.valor,
        setup: linha.setup, hospedagem: linha.hospedagem, vencimento_dia: linha.vencimento_dia,
        status: linha.status, observacao: '', ativo: linha.ativo });
    }
  }
  const restaurado = await fin(T, 'fin_lista', null, { mes: MES_A, ano: ANO_A });
  diz('o mes de hoje foi restaurado ao estado original',
    restaurado.clientes.every(function (c) { return c.ativo; }) &&
    !restaurado.clientes.some(function (c) { return /PAGOU NO MES ANTERIOR/.test(c.observacao || ''); }),
    restaurado.clientes.filter(function (c) { return !c.ativo; }).map(function (c) { return c.cliente; }));

  // Este teste cria competencias no espelho compartilhado. Sem limpar,
  // o proximo teste veria setembro cheio e falharia sem culpa nenhuma.
  for (const c of (jan.competencias || [])) {
    if (c.ano === ANO_A && c.mes === MES_A) continue;              // agosto e o palco original
    const lista = await fin(T, 'fin_lista', null, { mes: c.mes, ano: c.ano });
    for (const linha of (lista.clientes || [])) await fin(T, 'fin_excluir', { id: linha.id });
  }
  const conferindo = await fin(T, 'fin_lista', null, { mes: MES_A, ano: ANO_A });
  diz('a limpeza nao encostou no mes de hoje', conferindo.clientes.length === agostoOriginal, conferindo.clientes.length);

  console.log('\n' + ok + ' passaram · ' + falhas + ' falharam');
  filhos.forEach(function (f) { try { f.kill('SIGKILL'); } catch (e) {} });
  process.exit(falhas ? 1 : 0);
})();
