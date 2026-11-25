// ============================================================
// ACESSO DE COLABORADOR — login limpo, convite, vinculo e modulos
//
// Percorre os 15 casos obrigatorios do pedido e os criterios de
// aceite dos itens 37 a 41, e mais o que o pedido nao listou mas
// que faria estrago em silencio:
//
//   - o convite virando maquina de descobrir quem trabalha aqui;
//   - dois convites confirmados juntos criando dois usuarios para
//     o mesmo colaborador;
//   - um modulo escondido do menu, mas aberto para quem chama a
//     API na mao;
//   - salvar so os modulos de alguem e rebaixar o nivel sem querer;
//   - quem ja tinha acesso perdendo alguma coisa com a mudanca.
//
// Uso:  ADMIN_PASSWORD="sua-senha" node tools/test-acesso.js
//       (precisa do espelho local no ar: sh tools/start-local.sh)
// ============================================================
'use strict';

const BASE = 'http://localhost:3000';
const BANCO = 'http://127.0.0.1:54321/rest/v1/';
const SUF = Date.now().toString(36);
const SENHA = process.env.ADMIN_PASSWORD || process.env.ADMIN_SECRET || '';
let ok = 0, falhas = 0;
let T = '';

if (!SENHA) {
  console.error('Falta a senha. Rode:  ADMIN_PASSWORD="sua-senha" node tools/test-acesso.js');
  process.exit(1);
}

function check(nome, cond, extra) {
  if (cond) { ok++; console.log('  ok   ' + nome); }
  else {
    falhas++;
    console.log('  FALHA ' + nome + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
  }
}

async function chama(rota, action, body, params, token) {
  const qs = new URLSearchParams(Object.assign({ action: action }, params || {}));
  const cab = { 'Content-Type': 'application/json' };
  const tk = token === undefined ? T : token;
  if (tk) cab.Authorization = 'Bearer ' + tk;
  const r = await fetch(BASE + '/api/' + rota + '?' + qs, {
    method: body ? 'POST' : 'GET', headers: cab, body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json().catch(function () { return { ok: false, error: 'resposta invalida' }; });
  j._status = r.status;
  return j;
}
const adm = (a, b, p, t) => chama('admin', a, b, p, t);
// as tres rotas publicas do convite: sem cracha nenhum
const pub = (a, b, p) => chama('admin', a, b, p, '');

// Conversa direta com o espelho do banco: para montar o cenario
// (colaboradores com CPF) e para olhar o que ficou GRAVADO de verdade.
async function banco(tabela, metodo, query, corpo) {
  const r = await fetch(BANCO + tabela + (query ? '?' + query : ''), {
    method: metodo || 'GET',
    headers: { apikey: 'x', Authorization: 'Bearer x', 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: corpo ? JSON.stringify(corpo) : undefined
  });
  const t = await r.text();
  try { return JSON.parse(t); } catch (e) { return t; }
}

// Um CPF valido (com os dois digitos verificadores certos) a partir
// de um numero qualquer. CPF inventado sem digito certo seria barrado
// antes de chegar na busca, e o teste nao testaria a busca.
function geraCpf(n) {
  const base = String(100000000 + (n % 800000000)).slice(0, 9).split('').map(Number);
  const dig = function (lista) {
    let s = 0;
    for (let i = 0; i < lista.length; i++) s += lista[i] * (lista.length + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dig(base);
  const d2 = dig(base.concat([d1]));
  return base.join('') + d1 + d2;
}
const comMascara = (c) => c.slice(0, 3) + '.' + c.slice(3, 6) + '.' + c.slice(6, 9) + '-' + c.slice(9);
const codigoDe = (link) => link.split('/convite/colaborador/')[1];
const ultimoEmail = async () => (await (await fetch('http://127.0.0.1:54322/__ultimo-email')).json());
const linkDaSenha = (texto) => { const m = String(texto || '').match(/criar-senha-painel\?t=([A-Za-z0-9_.\-]+)/); return m ? m[1] : ''; };

(async function () {
  console.log('\n=== ACESSO DE COLABORADOR ===\n');

  // MESA LIMPA. Uma rodada anterior interrompida pode ter deixado um
  // Dono de teste no espelho — e enquanto existe um Dono, a senha
  // mestra para de valer e esta suite nem consegue entrar. Tudo o que
  // tem e-mail de dominio ".test" e sobra de teste, por construcao.
  for (const x of (await banco('panel_users', 'GET', 'select=id,email'))) {
    if (/\.test$/.test(String(x.email || ''))) await banco('panel_users', 'DELETE', 'id=eq.' + x.id);
  }

  T = (await (await fetch(BASE + '/api/admin?action=login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: SENHA })
  })).json()).token;
  check('o Dono entrou', !!T);

  /* ------------------------------------------------------------
     CENARIO: colaboradores com CPF, direto no espelho do banco
     ------------------------------------------------------------ */
  const semente = Date.now() % 700000000;
  const PESSOAS = {};
  const nomes = ['Barbara Lima', 'Fernanda Rocha', 'Renan Costa', 'Caio Duarte', 'Lia Prado', 'Otto Nunes', 'Ex Colaborador'];
  for (let i = 0; i < nomes.length; i++) {
    const cpf = geraCpf(semente + i * 7919);
    const linhas = await banco('collaborators', 'POST', '', [{
      name: nomes[i] + ' ' + SUF, cpf: cpf, email: 'cadastro' + i + '.' + SUF + '@start.test',
      phone: '13 99999-000' + i, active: i !== 6, area: 'Comercial', role_title: 'Closer',
      street: 'Rua Secreta, 123', notes: 'salario 9999'
    }]);
    PESSOAS[i] = { id: linhas[0].id, nome: nomes[i] + ' ' + SUF, cpf: cpf };
  }
  const [BARBARA, FERNANDA, RENAN, CAIO, LIA, OTTO, EX] = [0, 1, 2, 3, 4, 5, 6].map((i) => PESSOAS[i]);
  const colabsAntes = (await banco('collaborators', 'GET', 'select=id')).length;
  const CRIADOS = [];           // usuarios a apagar no fim

  /* ============================================================
     ITEM 37 — A TELA DE LOGIN
     ============================================================ */
  console.log('\n-- item 37: a tela de login limpa --');
  const dica = await pub('dica_senha');
  check('o servidor nao manda senha nenhuma para a tela de login',
    dica.senha === undefined && dica.mostrar === undefined && JSON.stringify(dica).indexOf(SENHA) < 0, Object.keys(dica));
  const pagina = await (await fetch(BASE + '/admin')).text();
  const roteiro = await (await fetch(BASE + '/js/admin-core.js')).text();
  check('a pagina de login nao fala em fase de testes',
    !/fase de testes?\s*[—-]/i.test(pagina + roteiro) && (pagina + roteiro).indexOf('MOSTRAR_SENHA_LOGIN') < 0);
  check('a senha do painel nao esta escrita em nenhum arquivo servido',
    (pagina + roteiro).indexOf(SENHA) < 0);
  check('o formulario continua com e-mail, senha e Entrar',
    /id="email-login"/.test(pagina) && /id="senha"/.test(pagina) && /id="btn-login"/.test(pagina));
  check('senha errada continua barrada',
    (await (await fetch(BASE + '/api/admin?action=login', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'errada-' + SUF }) })).json()).ok === false);

  /* ============================================================
     QUEM JA TINHA ACESSO CONTINUA IGUAL
     ============================================================ */
  console.log('\n-- quem ja tinha acesso nao perdeu nem ganhou nada --');
  const euDono = await adm('usuarios_eu');
  check('o Dono continua com o menu completo',
    ['dashboard', 'opdash', 'cmsimulacoes', 'meta', 'financeiro', 'findre', 'usuarios', 'ajustes', 'colaboradores', 'conteudo']
      .every((a) => euDono.menu.indexOf(a) >= 0), euDono.menu);
  check('o Dono nao tem restricao de modulo', euDono.modulos === null, euDono.modulos);

  const antigo = await adm('usuario_salvar', { name: 'Antiga ' + SUF, email: 'antiga.' + SUF + '@start.test', role: 'rh' });
  CRIADOS.push(antigo.usuario.id);
  check('o "Dar acesso a alguem" de sempre continua funcionando', antigo.ok === true && !!antigo.convite.link, antigo.error);
  check('usuario criado pelo caminho comum nasce SEM restricao de modulo', antigo.usuario.modulos === null, antigo.usuario.modulos);
  check('e sem vinculo (colaborador e usuario sao coisas separadas)', antigo.usuario.collaborator_id === null);
  const senhaAntiga = await pub('convite_senha', { t: antigo.convite.link.split('t=')[1], password: 'SenhaForte' + SUF + '1' });
  const T_ANTIGA = senhaAntiga.token;
  const euAntiga = await adm('usuarios_eu', null, null, T_ANTIGA);
  check('RH sem restricao ve o mesmo menu de RH que sempre viu',
    euAntiga.menu.indexOf('financeiro') >= 0 && euAntiga.menu.indexOf('opdash') >= 0 &&
    euAntiga.menu.indexOf('cmsimulacoes') >= 0 && euAntiga.menu.indexOf('usuarios') < 0, euAntiga.menu);
  check('e continua entrando em tudo o que o nivel permite',
    (await chama('financeiro', 'fin_resumo', null, null, T_ANTIGA)).ok === true &&
    (await chama('operacao', 'op_dashboard', null, null, T_ANTIGA)).ok === true &&
    (await adm('board', null, null, T_ANTIGA)).ok === true);
  check('e continua SEM mexer em usuarios (isso sempre foi so do Dono)',
    (await adm('usuarios', null, null, T_ANTIGA)).ok === false);

  /* ============================================================
     ITEM 38 — O CONVITE
     ============================================================ */
  console.log('\n-- item 38: gerar o convite --');
  const lista0 = await adm('usuarios');
  check('a tela de usuarios recebe a lista de modulos do servidor (nao e fixa na tela)',
    Array.isArray(lista0.modulos) && lista0.modulos.length >= 7, lista0.modulos);
  check('os sete modulos do pedido estao la',
    ['Vagas', 'Colaboradores', 'Operação', 'Comercial', 'Start Academy', 'Financeiro', 'RH']
      .every((n) => lista0.modulos.some((m) => m.nome === n)), lista0.modulos.map((m) => m.nome));

  const c1 = await adm('cv_criar', { anotacao: 'Barbara do Comercial', modulos: ['comercial'] });
  check('o Dono gera um convite de colaborador', c1.ok === true && !!c1.link, c1.error);
  const cod1 = codigoDe(c1.link || '');
  check('o link tem a forma /convite/colaborador/CODIGO', /\/convite\/colaborador\/[A-Za-z0-9_-]{40,}$/.test(c1.link), c1.link);
  check('o codigo e longo e sorteado (nao da para adivinhar)', cod1.length >= 40, cod1.length);
  check('o link nao carrega CPF, e-mail nem ID do convite',
    c1.link.indexOf(c1.convite.id) < 0 && !/\d{11}/.test(c1.link) && c1.link.indexOf('@') < 0);
  const c1b = await adm('cv_criar', { anotacao: 'outro', modulos: ['comercial'] });
  check('dois convites nunca tem o mesmo codigo', codigoDe(c1b.link) !== cod1);
  await adm('cv_cancelar', { id: c1b.convite.id });

  const gravado = (await banco('panel_invites', 'GET', 'id=eq.' + c1.convite.id))[0];
  check('no banco fica o HASH do codigo, nunca o codigo',
    gravado.token_hash !== cod1 && JSON.stringify(gravado).indexOf(cod1) < 0 && /^[0-9a-f]{64}$/.test(gravado.token_hash));
  check('o link tem prazo de validade (30 dias)',
    Math.abs(new Date(gravado.expira_em).getTime() - Date.now() - 30 * 86400000) < 120000, gravado.expira_em);
  check('o convite guarda QUEM criou e QUANDO (auditoria)', !!gravado.created_by && !!gravado.created_at);
  check('convite sem nenhum modulo e barrado',
    (await adm('cv_criar', { modulos: [] })).ok === false);
  check('quem nao e Dono nao gera convite',
    (await adm('cv_criar', { modulos: ['comercial'] }, null, T_ANTIGA)).ok === false);
  check('sem login tambem nao', (await pub('cv_criar', { modulos: ['comercial'] })).ok === false);

  const pend = await adm('usuarios');
  check('o link aparece na lista como ATIVO, com zero cadastros',
    (pend.convites || []).some((c) => c.id === c1.convite.id && c.estado === 'ativo' && c.usos === 0), pend.convites);

  /* ============================================================
     CASOS 1 e 2 — convidado com CPF existente, COM pontuacao
     ============================================================ */
  console.log('\n-- casos 1 e 2: CPF existente, com pontuacao --');
  check('o colaborador abre o link sem login', (await pub('cv_abrir', null, { c: cod1 })).ok === true);
  const id1 = await pub('cv_identificar', { c: cod1, nome: 'Barbara Lima', cpf: comMascara(BARBARA.cpf), email: 'barbara.' + SUF + '@gmail.test' });
  check('CPF com pontos e traco encontra o colaborador', id1.ok === true && id1.achou === true, id1.error);
  check('a confirmacao mostra o NOME do cadastro', id1.nome === BARBARA.nome, id1.nome);
  check('e SO o nome: nada de CPF, telefone, endereco, cargo ou observacao',
    JSON.stringify(Object.keys(id1).filter((k) => k[0] !== '_').sort()) === '["achou","bilhete","nome","ok"]' &&
    !/Secreta|salario|99999|Closer|cadastro0/.test(JSON.stringify(id1).replace(id1.bilhete, '')),
    Object.keys(id1));
  check('o bilhete tambem nao carrega o CPF',
    Buffer.from(id1.bilhete.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString().indexOf(BARBARA.cpf) < 0);
  check('ainda nao existe usuario: so depois do "Sim, sou eu"',
    !(await adm('usuarios')).usuarios.some((x) => x.collaborator_id === BARBARA.id));

  const ok1 = await pub('cv_confirmar', { c: cod1, bilhete: id1.bilhete, resposta: 'sim' });
  check('"Sim, sou eu" cria o acesso', ok1.ok === true && ok1.criado === true, ok1.error);
  check('a resposta nao devolve link de senha nem token (isso vai so por e-mail)',
    JSON.stringify(ok1).indexOf('criar-senha') < 0 && ok1.token === undefined && ok1.link === undefined, Object.keys(ok1));
  check('o e-mail aparece mascarado na tela', /^ba•••@gmail\.test$/.test(ok1.email), ok1.email);

  const depois1 = await adm('usuarios');
  const uBarbara = depois1.usuarios.filter((x) => x.collaborator_id === BARBARA.id)[0] || {};
  CRIADOS.push(uBarbara.id);
  check('nasceu UM usuario vinculado ao colaborador pelo ID', !!uBarbara.id && uBarbara.collaborator_id === BARBARA.id);
  check('a lista mostra o colaborador vinculado', uBarbara.colaborador_nome === BARBARA.nome, uBarbara.colaborador_nome);
  check('o nome do usuario e o do CADASTRO, nao o digitado', uBarbara.name === BARBARA.nome, uBarbara.name);
  check('status: aguardando criacao de senha', uBarbara.situacao === 'aguardando_senha', uBarbara.situacao);
  check('as permissoes do convite ja valem (so Comercial)', JSON.stringify(uBarbara.modulos) === '["comercial"]', uBarbara.modulos);
  check('NENHUM colaborador novo foi criado (item 10)',
    (await banco('collaborators', 'GET', 'select=id')).length === colabsAntes);
  check('o cadastro do colaborador nao foi alterado',
    (await banco('collaborators', 'GET', 'id=eq.' + BARBARA.id))[0].email === 'cadastro0.' + SUF + '@start.test');
  check('a lista avisa que o e-mail do login difere do cadastro', uBarbara.email_difere === true);
  check('o link CONTINUA na lista, ativo, agora contando 1 cadastro',
    (depois1.convites || []).some((c) => c.id === c1.convite.id && c.estado === 'ativo' && c.usos === 1 && !!c.ultimo_uso_em),
    (depois1.convites || []).filter((c) => c.id === c1.convite.id));

  /* ============================================================
     ITEM 39 — O E-MAIL
     ============================================================ */
  console.log('\n-- item 39: o e-mail de boas-vindas --');
  const mail = await ultimoEmail();
  check('o e-mail foi para o endereco informado', JSON.stringify(mail.to).indexOf('barbara.' + SUF + '@gmail.test') >= 0, mail.to);
  check('assunto: "Bem-vindo à Start — finalize seu acesso"', mail.subject === 'Bem-vindo à Start — finalize seu acesso', mail.subject);
  check('chama a pessoa pelo primeiro nome', /Olá, Barbara\./.test(mail.text), String(mail.text).slice(0, 40));
  const tSenha = linkDaSenha(mail.text);
  check('traz o link para criar a senha', tSenha.length > 40);
  check('NAO traz senha pronta', !/senha:\s*\S+/i.test(mail.text) && !/password/i.test(mail.text));
  check('avisa o que fazer se a pessoa nao esperava o convite', /não esperava receber este convite/.test(mail.text));
  check('antes de criar a senha, o login ainda nao funciona',
    (await (await fetch(BASE + '/api/admin?action=login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'barbara.' + SUF + '@gmail.test', password: 'qualquercoisa1' }) })).json()).ok === false);

  /* ============================================================
     O MESMO LINK SERVE PARA VARIOS COLABORADORES

     O pedido original tinha um "caso 9: link ja utilizado". Ele
     foi substituido por decisao do Clovis: o link de cadastro e
     um so para o time inteiro. Quem e de uso unico e a PESSOA.
     ============================================================ */
  console.log('\n-- o mesmo link serve para varios colaboradores --');
  const denovo = await pub('cv_abrir', null, { c: cod1 });
  check('depois de um cadastro, o MESMO link abre de novo', denovo.ok === true, denovo.error);
  check('e nao diz mais que "ja foi utilizado"', !/utilizado/.test(JSON.stringify(denovo)));

  // tres colegas, um atras do outro, pelo mesmo link
  const TURMA = [[RENAN, 'renan'], [LIA, 'lia'], [OTTO, 'otto']];
  for (const [pessoa, apelido] of TURMA) {
    const i = await pub('cv_identificar', { c: cod1, nome: pessoa.nome, cpf: pessoa.cpf, email: apelido + '.turma.' + SUF + '@gmail.test' });
    const k = i.ok ? await pub('cv_confirmar', { c: cod1, bilhete: i.bilhete, resposta: 'sim' }) : { error: i.error };
    check('pelo mesmo link: ' + apelido + ' se cadastra', i.ok === true && i.nome === pessoa.nome && k.criado === true, k.error);
  }
  const turma = await adm('usuarios');
  const daTurma = TURMA.map(([pessoa]) => turma.usuarios.filter((x) => x.collaborator_id === pessoa.id)[0] || {});
  daTurma.forEach((x) => CRIADOS.push(x.id));
  check('cada um ganhou o PROPRIO usuario, vinculado ao PROPRIO cadastro',
    daTurma.every((x, n) => !!x.id && x.name === TURMA[n][0].nome) && new Set(daTurma.map((x) => x.id)).size === 3,
    daTurma.map((x) => x.name));
  check('todos com os modulos definidos no link (so Comercial)',
    daTurma.every((x) => JSON.stringify(x.modulos) === '["comercial"]'), daTurma.map((x) => x.modulos));
  check('cada um recebeu o e-mail no endereco que informou',
    daTurma.map((x) => x.email).sort().join() === ['lia', 'otto', 'renan'].map((a) => a + '.turma.' + SUF + '@gmail.test').join());
  const linkDepois = (turma.convites || []).filter((c) => c.id === c1.convite.id)[0] || {};
  check('o link conta 4 cadastros e continua ATIVO', linkDepois.usos === 4 && linkDepois.estado === 'ativo', linkDepois);
  check('quatro acertos seguidos NAO acionam o freio de tentativas',
    (await banco('panel_invites', 'GET', 'id=eq.' + c1.convite.id))[0].tentativas === 0);
  check('colaborador nenhum foi duplicado no caminho',
    (await banco('collaborators', 'GET', 'select=id')).length === colabsAntes);

  // a PESSOA e de uso unico, mesmo com o link valendo
  const repete = await pub('cv_identificar', { c: cod1, nome: 'Barbara Lima', cpf: BARBARA.cpf, email: 'barbara.outra.' + SUF + '@gmail.test' });
  check('quem ja se cadastrou nao cria um segundo acesso pelo mesmo link',
    repete.ok === false && /já possui acesso ao sistema/.test(repete.error), repete.error);
  check('o bilhete antigo dela nao cria outro usuario',
    (await pub('cv_confirmar', { c: cod1, bilhete: id1.bilhete, resposta: 'sim' })).criado === undefined);
  check('continua existindo UM usuario para cada colaborador',
    [BARBARA, RENAN, LIA, OTTO].every((p) => turma.usuarios.filter((x) => x.collaborator_id === p.id).length === 1));

  // dois colegas confirmando pelo MESMO link no mesmo instante
  const j1 = await pub('cv_identificar', { c: cod1, nome: CAIO.nome, cpf: CAIO.cpf, email: 'caio.x.' + SUF + '@a.test' });
  const j2 = await pub('cv_identificar', { c: cod1, nome: CAIO.nome, cpf: CAIO.cpf, email: 'caio.y.' + SUF + '@a.test' });
  const juntos = await Promise.all([
    pub('cv_confirmar', { c: cod1, bilhete: j1.bilhete, resposta: 'sim' }),
    pub('cv_confirmar', { c: cod1, bilhete: j2.bilhete, resposta: 'sim' })
  ]);
  const doCaioMesmoLink = (await adm('usuarios')).usuarios.filter((x) => x.collaborator_id === CAIO.id);
  check('a mesma pessoa confirmando duas vezes juntas, pelo mesmo link: UM usuario so',
    doCaioMesmoLink.length === 1 && juntos.filter((r) => r.criado === true).length === 1 && juntos.every((r) => r._status !== 500),
    juntos.map((r) => r._status));
  // devolve o cenario: os proximos casos precisam deles sem usuario
  for (const x of daTurma.concat(doCaioMesmoLink)) { await adm('usuario_excluir', { id: x.id }); }

  /* ============================================================
     CASO 10 — criar a senha
     ============================================================ */
  console.log('\n-- caso 10: criar a senha --');
  check('a pagina de senha reconhece o link do e-mail',
    (await pub('convite_info', null, { t: tSenha })).ok === true);
  check('senha curta e barrada (regra que ja existia)',
    (await pub('convite_senha', { t: tSenha, password: 'abc12' })).ok === false);
  check('senha so de numeros e barrada (regra que ja existia)',
    (await pub('convite_senha', { t: tSenha, password: '1234567890' })).ok === false);
  const SENHA_B = 'Barbara' + SUF + '9x';
  const criou = await pub('convite_senha', { t: tSenha, password: SENHA_B });
  check('a senha e criada', criou.ok === true && !!criou.token, criou.error);
  check('o link do e-mail morre depois de usado',
    (await pub('convite_senha', { t: tSenha, password: 'OutraSenha' + SUF + '1' })).ok === false);
  const ativa = (await adm('usuarios')).usuarios.filter((x) => x.id === uBarbara.id)[0];
  check('status passa para ATIVO', ativa.situacao === 'ativo', ativa.situacao);
  const loginB = await (await fetch(BASE + '/api/admin?action=login', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'barbara.' + SUF + '@gmail.test', password: SENHA_B }) })).json();
  check('ela entra com e-mail e senha, normalmente', loginB.ok === true && !!loginB.token, loginB.error);
  let TB = loginB.token;
  check('o CPF NAO serve de login',
    (await (await fetch(BASE + '/api/admin?action=login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: BARBARA.cpf, password: SENHA_B }) })).json()).ok === false);

  /* ============================================================
     ITEM 40 / 17 — usuario logado = colaborador correspondente
     ============================================================ */
  console.log('\n-- itens 17 e 40: o sistema sabe quem ela e --');
  const euB = await adm('usuarios_eu', null, null, TB);
  check('o sistema reconhece o colaborador pelo ID', euB.colaborador && euB.colaborador.id === BARBARA.id, euB.colaborador);
  check('e traz nome, area e funcao para uso futuro',
    euB.colaborador.nome === BARBARA.nome && euB.colaborador.area === 'Comercial' && euB.colaborador.funcao === 'Closer', euB.colaborador);
  check('sem expor CPF, endereco ou observacao',
    !/Secreta|salario/.test(JSON.stringify(euB)) && JSON.stringify(euB).indexOf(BARBARA.cpf) < 0);
  // o vinculo e por ID: mudar o nome do colaborador nao desfaz nada
  await banco('collaborators', 'PATCH', 'id=eq.' + BARBARA.id, { name: 'Barbara Lima Casada ' + SUF });
  const euB2 = await adm('usuarios_eu', null, null, TB);
  check('trocar o NOME do colaborador nao quebra o vinculo (e por ID, nao por nome)',
    euB2.colaborador && euB2.colaborador.id === BARBARA.id && /Casada/.test(euB2.colaborador.nome), euB2.colaborador);
  await banco('collaborators', 'PATCH', 'id=eq.' + BARBARA.id, { name: BARBARA.nome });

  /* ============================================================
     CASOS 11 e 12 — so Comercial; Financeiro direto pela URL
     ============================================================ */
  console.log('\n-- casos 11 e 12: so Comercial, e a tentativa pela URL --');
  check('o menu dela so tem o Comercial',
    JSON.stringify(euB.menu) === '["cmleads","cmagenda","cmatendimento","cmsimulacoes","meta","metagerente"]', euB.menu);
  check('ela entra no Comercial (Simulacoes)', (await chama('comercial', 'cm_participantes', null, null, TB)).ok === true);
  check('ela entra no Comercial (Meta)', (await chama('comercial', 'mt_placar', null, null, TB)).ok === true);

  const barrado = [
    ['financeiro', 'fin_lista', 'Financeiro'], ['financeiro', 'fin_resumo', 'Financeiro'],
    ['financeiro', 'fc_lista', 'Financeiro'], ['financeiro', 'fin_dre', 'Financeiro'],
    ['operacao', 'op_dashboard', 'Operação'], ['agenda', 'ag_lista', 'Operação'],
    ['admin', 'board', 'Vagas'], ['admin', 'dashboard', 'Vagas'], ['admin', 'vagas', 'Vagas'],
    ['admin', 'team', 'Colaboradores'], ['admin', 'content', 'Start Academy'],
    ['admin', 'settings', 'RH'], ['space', 'sp_painel', 'Colaboradores'], ['play', 'pl_painel', 'Colaboradores']
  ];
  for (const [rota, acao, modulo] of barrado) {
    const r = await chama(rota, acao, null, null, TB);
    check('direto pela URL: ' + acao + ' → bloqueado (403), e a mensagem diz o modulo',
      r.ok === false && r._status === 403 && r.error.indexOf(modulo) >= 0, [r._status, r.error]);
  }
  check('gravar no Financeiro pela API tambem e barrado (nao e so leitura)',
    (await chama('financeiro', 'fin_salvar', { cliente: 'Invasao', valor: 1 }, null, TB))._status === 403);
  check('e nada foi gravado la',
    !JSON.stringify(await chama('financeiro', 'fin_lista')).includes('Invasao'));

  /* ============================================================
     CASO 14 — alterar permissoes depois do cadastro
     ============================================================ */
  console.log('\n-- caso 14: alterar permissoes depois --');
  const mais = await adm('usuario_salvar', { id: uBarbara.id, modulos: ['comercial', 'financeiro'] });
  check('o Dono libera o Financeiro', mais.ok === true && JSON.stringify(mais.usuario.modulos) === '["comercial","financeiro"]', mais.error);
  check('salvar SO os modulos nao mexe no nivel (nao rebaixa ninguem sem querer)', mais.usuario.role === 'rh', mais.usuario.role);
  check('vale NA HORA, com o mesmo login aberto',
    (await chama('financeiro', 'fin_resumo', null, null, TB)).ok === true);
  check('e o que nao foi liberado continua fechado',
    (await chama('operacao', 'op_dashboard', null, null, TB))._status === 403);
  const menos = await adm('usuario_salvar', { id: uBarbara.id, modulos: ['financeiro'] });
  check('o Dono tira o Comercial', menos.ok === true);
  check('o Comercial fecha na hora, sem esperar novo login',
    (await chama('comercial', 'mt_placar', null, null, TB))._status === 403);
  check('lista vazia de modulos e barrada',
    (await adm('usuario_salvar', { id: uBarbara.id, modulos: [] })).ok === false);
  const todos = await adm('usuario_salvar', { id: uBarbara.id, modulos: lista0.modulos.map((m) => m.chave) });
  check('marcar todos vira "sem restricao" (assim ela ganha sozinha um modulo que nascer amanha)',
    todos.usuario.modulos === null, todos.usuario.modulos);
  await adm('usuario_salvar', { id: uBarbara.id, modulos: ['operacao', 'comercial'] });

  /* ============================================================
     CASO 15 — sair e entrar de novo
     ============================================================ */
  console.log('\n-- caso 15: logout e novo login --');
  TB = (await (await fetch(BASE + '/api/admin?action=login', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'barbara.' + SUF + '@gmail.test', password: SENHA_B }) })).json()).token;
  const euB3 = await adm('usuarios_eu', null, null, TB);
  check('no novo login o menu ja vem com os modulos novos',
    euB3.menu.indexOf('opdash') >= 0 && euB3.menu.indexOf('meta') >= 0 && euB3.menu.indexOf('financeiro') < 0, euB3.menu);
  check('e a ordem do menu e a de sempre (Operacao antes do Comercial)',
    euB3.menu.indexOf('opdash') < euB3.menu.indexOf('cmleads'));
  check('Operacao abre, Financeiro nao',
    (await chama('operacao', 'op_dashboard', null, null, TB)).ok === true &&
    (await chama('financeiro', 'fin_lista', null, null, TB))._status === 403);

  /* ============================================================
     CASO 3 — CPF sem pontuacao
     ============================================================ */
  console.log('\n-- caso 3: CPF sem pontuacao --');
  const c3 = await adm('cv_criar', { anotacao: 'Fernanda', modulos: null });
  const cod3 = codigoDe(c3.link);
  const id3 = await pub('cv_identificar', { c: cod3, nome: 'Fernanda Rocha', cpf: FERNANDA.cpf, email: 'fernanda.' + SUF + '@gmail.test' });
  check('CPF so com numeros encontra o mesmo colaborador', id3.ok === true && id3.nome === FERNANDA.nome, id3.error);
  const id3b = await pub('cv_identificar', { c: cod3, nome: 'Fernanda Rocha', cpf: '  ' + comMascara(FERNANDA.cpf) + ' ', email: 'fernanda.' + SUF + '@gmail.test' });
  check('com mascara e espacos sobrando, e o MESMO colaborador', id3b.nome === FERNANDA.nome);
  await banco('collaborators', 'PATCH', 'id=eq.' + FERNANDA.id, { cpf: comMascara(FERNANDA.cpf) });
  const id3c = await pub('cv_identificar', { c: cod3, nome: 'Fernanda Rocha', cpf: FERNANDA.cpf, email: 'fernanda.' + SUF + '@gmail.test' });
  check('mesmo se o CADASTRO estiver gravado com mascara, o CPF sem mascara acha', id3c.ok === true && id3c.nome === FERNANDA.nome, id3c.error);
  const ok3 = await pub('cv_confirmar', { c: cod3, bilhete: id3c.bilhete, resposta: 'sim' });
  const uFernanda = (await adm('usuarios')).usuarios.filter((x) => x.collaborator_id === FERNANDA.id)[0] || {};
  CRIADOS.push(uFernanda.id);
  check('convite "todos os modulos" cria usuario sem restricao', ok3.criado === true && uFernanda.modulos === null, uFernanda.modulos);
  check('quem entra por convite recebe o nivel RH (trabalha nos modulos, nao so olha)', uFernanda.role === 'rh', uFernanda.role);

  /* ============================================================
     CASO 4 — CPF nao existente (e o convite nao vira lista)
     ============================================================ */
  console.log('\n-- caso 4: CPF que nao existe, e o item 28 --');
  const c4 = await adm('cv_criar', { anotacao: 'curioso', modulos: ['comercial'] });
  const cod4 = codigoDe(c4.link);
  const naoExiste = await pub('cv_identificar', { c: cod4, nome: 'Fulano Qualquer', cpf: geraCpf(semente + 999983), email: 'f.' + SUF + '@a.test' });
  check('CPF desconhecido: mensagem simples, sem vinculo', naoExiste.ok === false && /Não encontramos um colaborador correspondente/.test(naoExiste.error), naoExiste.error);
  const exColab = await pub('cv_identificar', { c: cod4, nome: 'Ex Colaborador', cpf: EX.cpf, email: 'ex.' + SUF + '@a.test' });
  check('CPF de EX-colaborador da EXATAMENTE a mesma resposta (nao revela que ele ja trabalhou aqui)',
    exColab._status === naoExiste._status && exColab.error === naoExiste.error, [naoExiste.error, exColab.error]);
  check('a resposta nao traz nome nenhum', naoExiste.nome === undefined && exColab.nome === undefined);
  const digitoErrado = await pub('cv_identificar', { c: cod4, nome: 'Fulano Qualquer', cpf: '123.456.789-00', email: 'f.' + SUF + '@a.test' });
  check('CPF com digito verificador errado e barrado antes da busca', digitoErrado.ok === false && /não é válido/.test(digitoErrado.error), digitoErrado.error);
  check('e erro de digitacao NAO gasta tentativa do convite',
    (await banco('panel_invites', 'GET', 'id=eq.' + c4.convite.id))[0].tentativas === 2);
  check('nome incompleto e barrado',
    (await pub('cv_identificar', { c: cod4, nome: 'Fulano', cpf: RENAN.cpf, email: 'f.' + SUF + '@a.test' })).ok === false);
  check('e-mail torto e barrado',
    (await pub('cv_identificar', { c: cod4, nome: 'Fulano Qualquer', cpf: RENAN.cpf, email: 'nao-e-email' })).ok === false);

  // O FREIO. Um link que serve para o time inteiro nao pode travar
  // para sempre (um curioso trancaria todo mundo do lado de fora),
  // mas tambem nao pode virar maquina de perguntar "esse CPF trabalha
  // ai?". Dez buscas sem resultado em quinze minutos e ele descansa.
  for (let i = 0; i < 8; i++) {
    await pub('cv_identificar', { c: cod4, nome: 'Fulano Qualquer', cpf: geraCpf(semente + 555000 + i * 131), email: 'f.' + SUF + '@a.test' });
  }
  check('dez CPFs que nao dao em nada: o link entra em pausa',
    (await banco('panel_invites', 'GET', 'id=eq.' + c4.convite.id))[0].tentativas === 10);
  const pausado = await pub('cv_identificar', { c: cod4, nome: 'Renan Costa', cpf: RENAN.cpf, email: 'renan.' + SUF + '@a.test' });
  check('em pausa, nem um CPF CERTO passa (nao adianta insistir)',
    pausado.ok === false && pausado._status === 429 && pausado.nome === undefined && /Aguarde alguns minutos/.test(pausado.error), pausado.error);
  check('a pausa nao revela nada: mesma resposta para CPF certo e errado',
    (await pub('cv_identificar', { c: cod4, nome: 'Fulano Qualquer', cpf: geraCpf(semente + 31337), email: 'f.' + SUF + '@a.test' })).error === pausado.error);
  check('tentar durante a pausa nao estica a pausa',
    (await banco('panel_invites', 'GET', 'id=eq.' + c4.convite.id))[0].tentativas === 10);
  check('o link pausado ainda ABRE o formulario (a pessoa nao ve uma tela de erro a toa)',
    (await pub('cv_abrir', null, { c: cod4 })).ok === true);
  check('o Dono ve o link como "em pausa"',
    ((await adm('usuarios')).convites || []).some((c) => c.id === c4.convite.id && c.estado === 'pausado'));
  // quinze minutos depois (o teste atrasa o relogio do link, em vez de esperar)
  await banco('panel_invites', 'PATCH', 'id=eq.' + c4.convite.id, { falhas_desde: new Date(Date.now() - 16 * 60000).toISOString() });
  check('passada a janela, o link volta SOZINHO a ficar ativo',
    ((await adm('usuarios')).convites || []).some((c) => c.id === c4.convite.id && c.estado === 'ativo'));
  const voltou = await pub('cv_identificar', { c: cod4, nome: 'Renan Costa', cpf: RENAN.cpf, email: 'renan.' + SUF + '@a.test' });
  check('e o CPF certo volta a ser encontrado', voltou.ok === true && voltou.nome === RENAN.nome, voltou.error);
  await pub('cv_identificar', { c: cod4, nome: 'Fulano Qualquer', cpf: geraCpf(semente + 777), email: 'f.' + SUF + '@a.test' });
  check('a contagem recomeca do zero na janela nova (nao herda as dez antigas)',
    (await banco('panel_invites', 'GET', 'id=eq.' + c4.convite.id))[0].tentativas === 1);
  check('link inventado nao abre', (await pub('cv_abrir', null, { c: 'A'.repeat(43) })).ok === false);
  check('link vazio nao abre', (await pub('cv_abrir', null, { c: '' })).ok === false);

  /* ============================================================
     CASO 5 — "Nao sou eu"
     ============================================================ */
  console.log('\n-- caso 5: "Nao sou eu" --');
  const c5 = await adm('cv_criar', { anotacao: 'Renan', modulos: ['operacao'] });
  const cod5 = codigoDe(c5.link);
  const id5 = await pub('cv_identificar', { c: cod5, nome: 'Renan Costa', cpf: RENAN.cpf, email: 'renan.' + SUF + '@gmail.test' });
  const nao = await pub('cv_confirmar', { c: cod5, bilhete: id5.bilhete, resposta: 'nao' });
  check('"Nao sou eu" interrompe o vinculo', nao.ok === true && nao.encerrado === true && nao.criado === undefined, nao);
  check('e orienta a procurar o administrador', /administrador/.test(nao.mensagem), nao.mensagem);
  check('nenhum usuario foi criado para aquele colaborador',
    !(await adm('usuarios')).usuarios.some((x) => x.collaborator_id === RENAN.id));
  check('a resposta nao oferece lista de outros colaboradores para escolher',
    nao.colaboradores === undefined && nao.opcoes === undefined && Object.keys(nao).filter((k) => k[0] !== '_').sort().join() === 'encerrado,mensagem,ok');
  check('resposta que nao e "sim" nunca cria acesso (nem vazia, nem inventada)',
    (await pub('cv_confirmar', { c: cod5, bilhete: id5.bilhete, resposta: 'talvez' })).criado === undefined &&
    (await pub('cv_confirmar', { c: cod5, bilhete: id5.bilhete })).criado === undefined);

  // bilhete: nao da para trocar de colaborador no meio do caminho
  const c5b = await adm('cv_criar', { anotacao: 'outro convite', modulos: ['operacao'] });
  check('bilhete de um convite nao vale em outro',
    (await pub('cv_confirmar', { c: codigoDe(c5b.link), bilhete: id5.bilhete, resposta: 'sim' })).ok === false);
  check('bilhete inventado nao vale',
    (await pub('cv_confirmar', { c: cod5, bilhete: 'abc.def', resposta: 'sim' })).ok === false);
  check('confirmar sem bilhete nao cria nada',
    (await pub('cv_confirmar', { c: cod5, resposta: 'sim' })).ok === false);
  check('o bilhete nao serve de cracha do painel',
    (await adm('usuarios', null, null, id5.bilhete))._status === 401);
  check('o link de senha do e-mail tambem nao serve de cracha',
    (await adm('usuarios', null, null, tSenha))._status === 401);

  /* ============================================================
     CASO 6 — e-mail ja cadastrado
     ============================================================ */
  console.log('\n-- caso 6: e-mail ja cadastrado --');
  const emailUsado = await pub('cv_identificar', { c: cod5, nome: 'Renan Costa', cpf: RENAN.cpf, email: 'antiga.' + SUF + '@start.test' });
  check('e-mail que ja tem acesso: aviso, sem criar usuario repetido',
    emailUsado.ok === false && /Já existe um acesso associado a este e-mail/.test(emailUsado.error), emailUsado.error);
  check('maiusculas no e-mail nao enganam a conferencia',
    (await pub('cv_identificar', { c: codigoDe(c5b.link), nome: 'Renan Costa', cpf: RENAN.cpf, email: 'ANTIGA.' + SUF.toUpperCase() + '@START.TEST' })).ok === false);
  const semCpfComEmail = await pub('cv_identificar', { c: codigoDe(c5b.link), nome: 'Fulano Qualquer', cpf: geraCpf(semente + 424242), email: 'antiga.' + SUF + '@start.test' });
  check('com CPF errado, a tela NAO revela que o e-mail tem conta',
    /Não encontramos um colaborador/.test(semCpfComEmail.error) && !/e-mail/.test(semCpfComEmail.error), semCpfComEmail.error);

  /* ============================================================
     CASO 7 — colaborador ja possui usuario
     ============================================================ */
  console.log('\n-- caso 7: colaborador que ja tem usuario --');
  const c7 = await adm('cv_criar', { anotacao: 'Barbara de novo', modulos: ['comercial'] });
  const jaTem = await pub('cv_identificar', { c: codigoDe(c7.link), nome: 'Barbara Lima', cpf: BARBARA.cpf, email: 'barbara2.' + SUF + '@gmail.test' });
  check('nao cria segundo acesso: "ja possui acesso ao sistema"',
    jaTem.ok === false && /já possui acesso ao sistema/.test(jaTem.error), jaTem.error);
  check('continua existindo UM usuario para ela',
    (await adm('usuarios')).usuarios.filter((x) => x.collaborator_id === BARBARA.id).length === 1);
  const audit7 = await adm('auditoria');
  check('o Dono fica sabendo da tentativa (historico)',
    audit7.registros.some((l) => l.action === 'convite_colaborador_ja_tem_acesso'));
  const reenvio = await adm('usuario_senha', { id: uBarbara.id });
  check('e pode reenviar o acesso dela (a acao que ja existia)', reenvio.ok === true && reenvio.convite.enviado === true, reenvio.error);
  // devolve a senha dela para os proximos testes
  await pub('convite_senha', { t: linkDaSenha((await ultimoEmail()).text), password: SENHA_B });

  /* ============================================================
     CORRIDA — dois convites confirmados juntos
     ============================================================ */
  console.log('\n-- dois convites para a mesma pessoa, confirmados juntos --');
  const ca = await adm('cv_criar', { anotacao: 'Caio A', modulos: ['comercial'] });
  const cb = await adm('cv_criar', { anotacao: 'Caio B', modulos: ['comercial'] });
  const ia = await pub('cv_identificar', { c: codigoDe(ca.link), nome: 'Caio Duarte', cpf: CAIO.cpf, email: 'caio.a.' + SUF + '@a.test' });
  const ib = await pub('cv_identificar', { c: codigoDe(cb.link), nome: 'Caio Duarte', cpf: CAIO.cpf, email: 'caio.b.' + SUF + '@a.test' });
  const par = await Promise.all([
    pub('cv_confirmar', { c: codigoDe(ca.link), bilhete: ia.bilhete, resposta: 'sim' }),
    pub('cv_confirmar', { c: codigoDe(cb.link), bilhete: ib.bilhete, resposta: 'sim' })
  ]);
  const doCaio = (await adm('usuarios')).usuarios.filter((x) => x.collaborator_id === CAIO.id);
  doCaio.forEach((x) => CRIADOS.push(x.id));
  check('mesmo confirmados no mesmo instante, nasce UM usuario so', doCaio.length === 1, doCaio.length);
  check('um dos dois recebe "ja possui acesso", sem erro de servidor',
    par.filter((r) => r.criado === true).length === 1 && par.every((r) => r._status !== 500), par.map((r) => r._status));

  /* ============================================================
     CASO 8 — link expirado
     ============================================================ */
  console.log('\n-- caso 8: link expirado --');
  const c8 = await adm('cv_criar', { anotacao: 'Lia', modulos: ['academy'] });
  const cod8 = codigoDe(c8.link);
  await banco('panel_invites', 'PATCH', 'id=eq.' + c8.convite.id, { expira_em: new Date(Date.now() - 60000).toISOString() });
  const exp = await pub('cv_abrir', null, { c: cod8 });
  check('convite vencido nao abre', exp.ok === false && /expirou/.test(exp.error), exp.error);
  check('nem aceita CPF',
    (await pub('cv_identificar', { c: cod8, nome: 'Lia Prado', cpf: LIA.cpf, email: 'lia.' + SUF + '@a.test' })).ok === false);
  check('o Dono ve como expirado',
    ((await adm('usuarios')).convites || []).some((c) => c.id === c8.convite.id && c.estado === 'expirado'));

  // item 25: gerar de novo invalida o anterior
  const novo8 = await adm('cv_renovar', { id: c8.convite.id });
  check('o Dono gera um link novo para o mesmo convite', novo8.ok === true && codigoDe(novo8.link) !== cod8, novo8.error);
  check('o link ANTIGO continua morto', (await pub('cv_abrir', null, { c: cod8 })).ok === false);
  check('o link novo funciona', (await pub('cv_abrir', null, { c: codigoDe(novo8.link) })).ok === true);
  const id8 = await pub('cv_identificar', { c: codigoDe(novo8.link), nome: 'Lia Prado', cpf: LIA.cpf, email: 'lia.' + SUF + '@a.test' });
  // bilhete vencido: a pessoa deixou a pergunta aberta e foi almocar
  const cancelado = await adm('cv_cancelar', { id: c8.convite.id });
  check('o Dono cancela um convite', cancelado.ok === true);
  check('convite cancelado nao abre nem confirma',
    (await pub('cv_abrir', null, { c: codigoDe(novo8.link) })).ok === false &&
    (await pub('cv_confirmar', { c: codigoDe(novo8.link), bilhete: id8.bilhete, resposta: 'sim' })).ok === false);
  check('e a Lia segue sem usuario', !(await adm('usuarios')).usuarios.some((x) => x.collaborator_id === LIA.id));
  // um link que ja cadastrou gente tambem pode ser trocado ou desligado
  const troca1 = await adm('cv_renovar', { id: c1.convite.id });
  check('link ja usado pode ganhar um codigo novo', troca1.ok === true && codigoDe(troca1.link) !== cod1, troca1.error);
  check('o codigo antigo morre na hora', (await pub('cv_abrir', null, { c: cod1 })).ok === false);
  check('a contagem de cadastros do link e preservada', troca1.convite.usos >= 4, troca1.convite.usos);
  check('e link ja usado pode ser cancelado', (await adm('cv_cancelar', { id: c1.convite.id })).ok === true);
  check('cancelado, ninguem mais se cadastra por ele', (await pub('cv_abrir', null, { c: codigoDe(troca1.link) })).ok === false);
  check('mas quem JA se cadastrou por ele continua com o acesso',
    (await adm('usuarios_eu', null, null, TB)).ok === true &&
    (await adm('usuarios')).usuarios.some((x) => x.id === uBarbara.id && x.situacao === 'ativo'));

  /* ============================================================
     VINCULO MANUAL (o Dono liga um acesso antigo a um colaborador)
     ============================================================ */
  console.log('\n-- vinculo feito pelo Dono --');
  const livres = (await adm('usuarios')).colaboradores_livres || [];
  check('a lista de colaboradores para vincular so tem quem AINDA nao tem usuario',
    livres.some((c) => c.id === OTTO.id) && !livres.some((c) => c.id === BARBARA.id) && !livres.some((c) => c.id === EX.id));
  check('e traz so id e nome', livres.every((c) => Object.keys(c).sort().join() === 'id,nome'));
  const vinc = await adm('usuario_salvar', { id: antigo.usuario.id, collaborator_id: OTTO.id });
  check('o Dono vincula um acesso antigo a um colaborador', vinc.ok === true && vinc.usuario.collaborator_id === OTTO.id, vinc.error);
  check('vincular nao mexe no nivel nem nos modulos', vinc.usuario.role === 'rh' && vinc.usuario.modulos === null);
  const dup = await adm('usuario_salvar', { id: uFernanda.id, collaborator_id: OTTO.id });
  check('o mesmo colaborador nao aceita um segundo usuario', dup.ok === false && dup._status === 409, dup.error);
  check('vincular a colaborador que nao existe e barrado',
    (await adm('usuario_salvar', { id: antigo.usuario.id, collaborator_id: '00000000-0000-4000-8000-000000000000' })).ok === false);
  const solta = await adm('usuario_salvar', { id: antigo.usuario.id, collaborator_id: '' });
  check('o Dono desfaz o vinculo', solta.ok === true && solta.usuario.collaborator_id === null);
  check('desvincular NAO apaga o colaborador',
    (await banco('collaborators', 'GET', 'id=eq.' + OTTO.id)).length === 1);

  /* ============================================================
     CASO 13 — administrador com acesso total
     ============================================================ */
  console.log('\n-- caso 13: administrador com acesso total --');
  for (const [rota, acao] of [['financeiro', 'fin_resumo'], ['operacao', 'op_dashboard'], ['comercial', 'cm_participantes'],
    ['comercial', 'mt_placar'], ['admin', 'board'], ['admin', 'team'], ['admin', 'content'], ['admin', 'settings'],
    ['admin', 'usuarios'], ['agenda', 'ag_lista'], ['space', 'sp_painel'], ['play', 'pl_painel']]) {
    check('o Dono continua abrindo ' + acao, (await chama(rota, acao)).ok === true);
  }
  // um Dono de verdade (com usuario), para provar que restricao nao pega nele
  const dono2 = await adm('usuario_salvar', { name: 'Dona Dois ' + SUF, email: 'dona2.' + SUF + '@start.test', role: 'dono', modulos: ['comercial'] });
  CRIADOS.push(dono2.usuario.id);
  check('tentar restringir um Dono nao tem efeito (ele acessa tudo, sempre)', dono2.usuario.modulos === null, dono2.usuario.modulos);
  const TD = (await pub('convite_senha', { t: dono2.convite.link.split('t=')[1], password: 'DonaDois' + SUF + '1' })).token;
  const lim = await adm('usuario_salvar', { id: dono2.usuario.id, modulos: ['comercial'] }, null, TD);
  check('nem editando depois', lim.ok === true && lim.usuario.modulos === null);
  check('e o Dono com usuario abre o Financeiro normalmente',
    (await chama('financeiro', 'fin_resumo', null, null, TD)).ok === true);
  // A protecao do "ultimo Dono" continua de pe: nem ele mesmo consegue
  // se excluir ou se rebaixar. (E por isso que o teste tira este Dono
  // direto no espelho do banco, logo abaixo.)
  check('o unico Dono nao consegue se excluir (protecao que ja existia)',
    (await adm('usuario_excluir', { id: dono2.usuario.id }, null, TD)).ok === false);
  check('nem se rebaixar',
    (await adm('usuario_salvar', { id: dono2.usuario.id, role: 'rh' }, null, TD)).ok === false);
  check('salvar so os modulos do unico Dono nao esbarra nessa protecao por engano',
    (await adm('usuario_salvar', { id: dono2.usuario.id, modulos: ['comercial'] }, null, TD)).ok === true);
  await banco('panel_users', 'DELETE', 'id=eq.' + dono2.usuario.id);
  CRIADOS.pop();

  /* ============================================================
     DESATIVAR E REATIVAR
     ============================================================ */
  console.log('\n-- item 24: desativar e reativar --');
  await adm('usuario_salvar', { id: uBarbara.id, active: false });
  check('desativado: o login aberto para de funcionar',
    (await chama('comercial', 'mt_placar', null, null, TB))._status === 401);
  check('e a lista mostra Inativo',
    (await adm('usuarios')).usuarios.filter((x) => x.id === uBarbara.id)[0].situacao === 'inativo');
  const reat = await adm('usuario_salvar', { id: uBarbara.id, active: true });
  check('reativar devolve o acesso, com os mesmos modulos e o mesmo vinculo',
    reat.usuario.active === true && JSON.stringify(reat.usuario.modulos) === '["operacao","comercial"]' &&
    reat.usuario.collaborator_id === BARBARA.id, reat.usuario);

  /* ============================================================
     ITEM 29 — AUDITORIA
     ============================================================ */
  console.log('\n-- item 29: auditoria --');
  const hist = (await adm('auditoria')).registros;
  const tem = (acao) => hist.some((l) => l.action === acao);
  check('quem criou o convite e quando', tem('convite_colaborador_criado') &&
    hist.filter((l) => l.action === 'convite_colaborador_criado').every((l) => !!l.user_name && !!l.created_at));
  check('quando o convite foi utilizado, e por qual convidado', hist.some((l) => l.action === 'convite_colaborador_usado' &&
    l.target === 'barbara.' + SUF + '@gmail.test'));
  check('quando o acesso foi ativado (senha criada)', hist.some((l) => l.action === 'senha_criada' &&
    l.target === 'barbara.' + SUF + '@gmail.test'));
  const perm = hist.filter((l) => l.action === 'permissoes_alteradas' && l.target === 'barbara.' + SUF + '@gmail.test');
  check('quem alterou permissoes, quando, e de-para', perm.length >= 3 && perm.every((l) => !!l.user_name && l.detail && 'antes' in l.detail && 'depois' in l.detail),
    perm.length);
  check('"nao sou eu" e renovacao/cancelamento tambem ficam registrados',
    tem('convite_nao_sou_eu') && tem('convite_colaborador_renovado') && tem('convite_colaborador_cancelado'));
  check('vinculo e desvinculo feitos pelo Dono ficam registrados', tem('usuario_vinculado') && tem('usuario_desvinculado'));
  check('nenhum CPF foi parar no historico',
    !Object.keys(PESSOAS).some((i) => JSON.stringify(hist).indexOf(PESSOAS[i].cpf) >= 0));
  check('o que o convidado fez nao aparece como se fosse a "senha mestra"',
    hist.filter((l) => l.action === 'convite_colaborador_usado').every((l) => l.user_name === 'Pelo link de convite'));

  /* ============================================================
     O MAPA DE MODULOS NAO TEM BURACO
     ============================================================ */
  console.log('\n-- o mapa de modulos cobre o sistema inteiro --');
  const perms = require('../api/_lib/perms.js');
  const fs = require('fs');
  const path = require('path');
  const orfas = [];
  for (const f of ['admin', 'financeiro', 'operacao', 'agenda', 'comercial', 'space', 'play', 'blackweek']) {
    const t = fs.readFileSync(path.join(__dirname, '..', 'api', f + '.js'), 'utf8');
    (t.match(/action === '[a-z_0-9]+'/g) || []).forEach((x) => {
      const a = x.slice(12, -1);
      if (!perms.modulosDaAcao(a) && perms.SEM_MODULO.indexOf(a) < 0) orfas.push(f + ':' + a);
    });
  }
  check('toda acao da API pertence a um modulo ou esta declarada livre de proposito',
    orfas.length === 0, Array.from(new Set(orfas)));
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
  const abasDoMenu = Array.from(new Set((html.match(/<button data-aba="[a-z]+"/g) || []).map((x) => x.split('"')[1])));
  const abasDosModulos = [].concat.apply([], perms.MODULOS.map((m) => m.abas));
  check('toda aba do menu pertence a um modulo', abasDoMenu.every((a) => abasDosModulos.indexOf(a) >= 0),
    abasDoMenu.filter((a) => abasDosModulos.indexOf(a) < 0));
  check('nenhum modulo aponta para aba que nao existe', abasDosModulos.every((a) => abasDoMenu.indexOf(a) >= 0),
    abasDosModulos.filter((a) => abasDoMenu.indexOf(a) < 0));
  check('nenhuma aba esta em dois modulos', abasDosModulos.length === new Set(abasDosModulos).size);
  check('cada modulo corresponde a um grupo do menu',
    perms.MODULOS.every((m) => html.indexOf('data-grupo="' + m.grupo + '"') >= 0));
  check('as acoes publicas (login, convite, TV) nunca sao barradas por modulo',
    ['login', 'usuarios_eu', 'cv_abrir', 'cv_identificar', 'cv_confirmar', 'convite_senha', 'mt_tv']
      .every((a) => perms.moduloPermite('rh', ['vagas'], a) === true));
  check('chave de modulo inventada e ignorada, nao vira permissao',
    JSON.stringify(perms.modulosLimpos(['comercial', 'tudo', '*', 'financeiro', 'comercial'])) === '["comercial","financeiro"]');

  // CPF: a conferencia dos digitos
  const conv = require('../api/_lib/convites.js');
  check('CPFs validos conhecidos passam', conv.cpfVale('52998224725') && conv.cpfVale('11144477735'));
  check('CPF com todos os digitos iguais e barrado', !conv.cpfVale('11111111111') && !conv.cpfVale('00000000000'));
  check('CPF com um digito trocado e barrado', !conv.cpfVale('52998224726'));
  check('mascara nao muda o CPF', conv.cpfLimpo('529.982.247-25') === '52998224725' && conv.cpfLimpo(' 529 982 247 25 ') === '52998224725');

  /* ============================================================
     LIMPEZA
     ============================================================ */
  console.log('\n-- limpando o cenario --');
  for (const id of CRIADOS.filter(Boolean)) await adm('usuario_excluir', { id: id });
  for (const c of ((await adm('usuarios')).convites || [])) await adm('cv_cancelar', { id: c.id });
  for (const i of Object.keys(PESSOAS)) await banco('collaborators', 'DELETE', 'id=eq.' + PESSOAS[i].id);
  const fim = await adm('usuarios');
  check('os usuarios do teste sairam', fim.usuarios.every((x) => String(x.email).indexOf(SUF) < 0),
    fim.usuarios.map((x) => x.email));
  check('apagar o USUARIO nao apagou colaborador nenhum alem dos do teste',
    (await banco('collaborators', 'GET', 'select=id')).length === colabsAntes - nomes.length);

  console.log('\n----------------------------------------');
  console.log(ok + ' passaram · ' + falhas + ' falharam');
  process.exit(falhas ? 1 : 0);
})().catch(function (e) {
  console.error('EXPLODIU', e);
  process.exit(1);
});
