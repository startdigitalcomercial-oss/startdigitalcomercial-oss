// ============================================================
// TESTE — BLACK WEEK START (landing page + leads)
//
// Confere o caminho inteiro sem tocar no banco real:
//   formulario publico -> bw_leads -> mensagem de WhatsApp -> painel
//
// Rode com o espelho local no ar:
//   node tools/mock-supabase.js &
//   node tools/mock-servicos.js &
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SECRET_KEY=x \
//   EVOLUTION_API_URL=http://127.0.0.1:54322 EVOLUTION_API_KEY=x EVOLUTION_INSTANCE=teste \
//   ADMIN_PASSWORD=senha APP_SECRET=segredo node dev-server.js &
//   ADMIN_PASSWORD=senha node tools/test-blackweek.js
// ============================================================
'use strict';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const SENHA = process.env.ADMIN_PASSWORD || '';
let falhas = 0;
function check(nome, cond, extra) {
  if (cond) console.log('  ok  ' + nome);
  else { falhas++; console.log('  FALHOU  ' + nome, extra === undefined ? '' : JSON.stringify(extra)); }
}
async function pub(body, metodo) {
  const r = await fetch(BASE + '/api/blackweek?action=bw_lead', {
    method: metodo || 'POST', headers: { 'Content-Type': 'application/json' },
    body: metodo === 'GET' ? undefined : JSON.stringify(body)
  });
  return { http: r.status, d: await r.json() };
}
let T = '';
async function adm(action, body, token) {
  const r = await fetch(BASE + '/api/blackweek?action=' + action, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token === undefined ? T : token) },
    body: body ? JSON.stringify(body) : undefined
  });
  return { http: r.status, d: await r.json() };
}

(async function () {
  const sufixo = String(Date.now()).slice(-8);
  const fone = '139' + sufixo;                   // (13) 9xxxx-xxxx
  const bom = { nome: 'Maria Teste ' + sufixo, whatsapp: fone, email: 'maria' + sufixo + '@exemplo.com',
    consentimento: true, origem: { utm_source: 'instagram', utm_campaign: 'bws', botao: 'EU QUERO APROVEITAR!', lixo: { a: 1 } } };

  console.log('\n-- a pagina --');
  const pg = await fetch(BASE + '/black-week');
  const html = await pg.text();
  check('/black-week responde a landing page', pg.status === 200 && html.indexOf('BLACK WEEK START') > 0);
  check('/blackfriday aponta para a mesma pagina', (await fetch(BASE + '/blackfriday')).status === 200);
  check('a pagina nao carrega nenhum script do painel', html.indexOf('/js/admin') < 0 && html.indexOf('start_rh_token') < 0);

  console.log('\n-- o formulario publico --');
  check('GET no formulario e recusado', (await pub(null, 'GET')).http === 405);
  check('sem nome nao passa', (await pub(Object.assign({}, bom, { nome: '' }))).http === 400);
  check('telefone curto nao passa', (await pub(Object.assign({}, bom, { whatsapp: '1399' }))).http === 400);
  check('e-mail torto nao passa', (await pub(Object.assign({}, bom, { email: 'maria@' }))).http === 400);
  check('sem autorizacao de contato nao passa', (await pub(Object.assign({}, bom, { consentimento: false }))).http === 400);

  const robo = await pub(Object.assign({}, bom, { nome: 'Robo ' + sufixo, site: 'http://spam.example' }));
  check('campo-isca preenchido: responde ok mas nao guarda', robo.http === 200 && robo.d.ok === true);

  const envio = await pub(bom);
  check('lead valido e aceito', envio.http === 200 && envio.d.ok === true, envio);
  check('a resposta publica nao devolve dados do lead', Object.keys(envio.d).sort().join(',') === 'ok,whatsapp');

  const segundo = await pub(bom);
  check('o mesmo numero de novo tambem e aceito', segundo.http === 200);

  console.log('\n-- o painel --');
  check('sem login o painel nao le os leads', (await adm('cm_bw_leads', null, '')).http === 401);
  check('token inventado nao entra', (await adm('cm_bw_leads', null, 'abc.def')).http === 401);

  if (!SENHA) { console.log('  (sem ADMIN_PASSWORD: pulando a parte logada)'); return fim(); }
  const login = await (await fetch(BASE + '/api/admin?action=login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: '', password: SENHA })
  })).json();
  if (!login.ok) { console.log('  (login do teste nao entrou: ' + login.error + ' — pulando a parte logada)'); return fim(); }
  T = login.token;

  const lista = await adm('cm_bw_leads');
  const meus = (lista.d.leads || []).filter((l) => l.email === bom.email);
  check('o painel lista os leads', lista.http === 200 && Array.isArray(lista.d.leads));
  check('os dois envios foram guardados', meus.length === 2, meus.length);
  check('o robo nao foi guardado', !(lista.d.leads || []).some((l) => l.nome.indexOf('Robo ' + sufixo) === 0));
  check('telefone guardado com DDI', meus.every((l) => l.whatsapp === '55' + fone), meus.map((l) => l.whatsapp));
  check('a origem guarda so os campos conhecidos',
    meus.every((l) => l.origem.utm_source === 'instagram' && l.origem.lixo === undefined));
  const status = meus.map((l) => l.wa_status).sort().join(',');
  check('primeiro envio dispara o WhatsApp, o repetido nao', status === 'enviado,repetido', status);
  check('o link divulgado termina em /black-week', /\/black-week$/.test(lista.d.link || ''), lista.d.link);

  const alvo = meus[0];
  const st = await adm('cm_bw_lead_status', { id: alvo.id, status: 'em_contato' });
  check('muda a situacao do lead', st.http === 200 && st.d.lead.status === 'em_contato');
  check('situacao inventada e recusada', (await adm('cm_bw_lead_status', { id: alvo.id, status: 'hackeado' })).http === 400);
  check('id torto e recusado', (await adm('cm_bw_lead_status', { id: 'x', status: 'novo' })).http === 400);

  const antes = lista.d.config;
  const cfg = await adm('cm_bw_config', { mensagem: 'Oi {{primeiro_nome}}!', whatsapp_comercial: '(13) 98888-7777', enviar_whatsapp: true });
  check('salva a mensagem e o WhatsApp comercial', cfg.http === 200 && cfg.d.config.whatsapp_comercial === '5513988887777');
  check('WhatsApp comercial torto e recusado', (await adm('cm_bw_config', { whatsapp_comercial: '123' })).http === 400);
  const re = await adm('cm_bw_reenviar', { id: alvo.id });
  check('reenviar dispara a mensagem', re.http === 200 && re.d.envio.status === 'enviado', re.d);
  await adm('cm_bw_config', antes);              // devolve a config como estava

  // ---------------------------------------------------------------
  // GOOGLE TAG MANAGER — a tag fica nas landing pages (Black Week e
  // Vagas) e em nenhum outro lugar. Pixel direto na pagina: nenhum
  // (ele e ligado DENTRO do GTM; nos dois lugares contaria em dobro).
  // ---------------------------------------------------------------
  console.log('\n-- a tag do Google Tag Manager --');
  const GTM = 'GTM-5C52WC2G';
  const vezes = (texto, pedaco) => texto.split(pedaco).length - 1;
  for (const rota of ['/black-week', '/black-friday', '/vagas', '/trabalhe-conosco']) {
    const pagina = await (await fetch(BASE + rota)).text();
    const cabeca = pagina.slice(0, pagina.indexOf('</head>'));
    check(rota + ': a tag do GTM esta no <head>, com o ID da Start, uma vez so',
      vezes(cabeca, '<script async src="https://www.googletagmanager.com/gtm.js?id=' + GTM + '"></script>') === 1 &&
      vezes(pagina, 'googletagmanager.com/gtm.js') === 1);
    check(rota + ': o dataLayer e criado e a tag e iniciada, uma vez so',
      vezes(cabeca, 'window.dataLayer = window.dataLayer || [];') === 1 &&
      vezes(cabeca, 'function gtag(){dataLayer.push(arguments);}') === 1 &&
      vezes(cabeca, "gtag('js', new Date());") === 1);
    check(rota + ': a tag fica no alto do <head> (antes de fontes, estilos e do resto)',
      cabeca.indexOf('googletagmanager.com/gtm.js') > cabeca.indexOf('<meta charset') &&
      cabeca.indexOf('googletagmanager.com/gtm.js') < cabeca.indexOf('<title>') &&
      cabeca.indexOf('googletagmanager.com/gtm.js') < cabeca.indexOf('<link'));
    check(rota + ': nao ha pixel da Meta direto na pagina (ele mora dentro do GTM)',
      pagina.indexOf('fbq(') < 0 && pagina.indexOf('fbevents') < 0 && pagina.indexOf('facebook.com/tr') < 0);
  }
  const bw = await (await fetch(BASE + '/black-week')).text();
  check('Black Week: o lead so e avisado ao GTM depois de o servidor confirmar',
    bw.indexOf('if (!r.ok) throw') > 0 && bw.indexOf('if (!r.ok) throw') < bw.indexOf("evento('bws_lead')"));
  check('Black Week: o aviso ao GTM leva so o nome do evento (nenhum dado da pessoa)',
    bw.indexOf("window.dataLayer.push({ event: nome })") > 0);
  for (const outra of ['/admin', '/convite', '/meta', '/vaga', '/portal', '/termos', '/privacidade']) {
    const t = await (await fetch(BASE + outra)).text();
    check('a tag NAO vazou para ' + outra, t.indexOf('googletagmanager') < 0 && t.indexOf(GTM) < 0);
  }

  console.log('\n-- limpando --');
  const SB = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
  if (/127\.0\.0\.1|localhost/.test(SB)) {
    await fetch(SB + '/rest/v1/bw_leads?email=eq.' + encodeURIComponent(bom.email), {
      method: 'DELETE', headers: { apikey: 'x', Authorization: 'Bearer x' }
    });
    console.log('  leads do teste removidos do espelho');
  }
  fim();

  function fim() {
    console.log(falhas ? '\n' + falhas + ' FALHA(S)\n' : '\nTUDO CERTO\n');
    process.exit(falhas ? 1 : 0);
  }
})().catch(function (e) { console.error(e); process.exit(1); });
