// ============================================================
// CONVITE DE COLABORADOR
//
// O caminho de uma pessoa que JÁ É colaboradora até ter um login:
//
//   1. o Dono gera um convite (um link) e manda para a pessoa;
//   2. ela abre o link e informa nome, CPF e e-mail;
//   3. o sistema procura o CPF entre os colaboradores e pergunta
//      "Você é Fulano da Silva?";
//   4. se ela confirma, nasce um USUÁRIO apontando para aquele
//      colaborador — nunca um colaborador novo;
//   5. chega um e-mail com um link para ela criar a própria senha.
//
// As regras que não podem quebrar, e onde cada uma mora:
//
// · COLABORADOR NÃO SE DUPLICA. Este arquivo não tem nenhum insert
//   na tabela collaborators — não é que ele "evita" duplicar, ele
//   não sabe criar colaborador. E o banco recusa um segundo usuário
//   para o mesmo colaborador (índice único em collaborator_id).
//
// · O LINK NÃO É ADIVINHÁVEL. São 32 bytes sorteados; no banco fica
//   só o hash deles. Nada de CPF, e-mail ou número sequencial na
//   URL. Quem ler a tabela inteira não consegue montar um link.
//
// · O CONVITE NÃO VIRA LISTA DE FUNCIONÁRIOS. Cada link aceita no
//   máximo cinco CPFs e depois trava. CPF errado e CPF de
//   ex-colaborador dão exatamente a mesma resposta. O nome só
//   aparece para quem tem um convite válido E acertou um CPF.
//
// · USO ÚNICO, COM PRAZO. Sete dias. Confirmou o cadastro, o link
//   morre. Gerou outro para a mesma linha, o anterior morre.
// ============================================================
'use strict';

const crypto = require('crypto');
const db = require('./db');
const u = require('./util');
const perms = require('./perms');

const DIAS_DE_VALIDADE = 7;
const MAX_TENTATIVAS = 5;
const MINUTOS_DO_BILHETE = 15;

// O nível de quem entra por convite. Os MÓDULOS marcados pelo Dono é
// que decidem onde a pessoa entra; dentro deles ela trabalha de
// verdade (não só olha). É o nível "RH" que já existia — reaproveitado,
// sem criar um papel paralelo. O Dono pode mudar depois, na ficha.
const NIVEL_DO_CONVIDADO = 'rh';

/* ------------------------------------------------------------
   CPF
   ------------------------------------------------------------ */
function cpfLimpo(v) { return String(v == null ? '' : v).replace(/\D/g, ''); }

// Confere os dois dígitos verificadores. Serve para barrar erro de
// digitação ANTES de gastar uma das cinco tentativas do convite — e
// para não ir ao banco perguntar por um número que nem CPF é.
function cpfVale(d) {
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const digito = function (ate) {
    let soma = 0;
    for (let i = 0; i < ate; i++) soma += Number(d[i]) * (ate + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return digito(9) === Number(d[9]) && digito(10) === Number(d[10]);
}

/* ------------------------------------------------------------
   O CÓDIGO DO LINK
   ------------------------------------------------------------ */
function novoCodigo() {
  return crypto.randomBytes(32).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function hashDe(codigo) {
  return crypto.createHash('sha256').update(String(codigo || '')).digest('hex');
}
function linkDe(codigo) {
  return u.appUrl() + '/convite/colaborador/' + codigo;
}

function estadoDe(c, agora) {
  agora = agora || Date.now();
  if (c.usado_em) return 'usado';
  if (c.cancelado_em) return 'cancelado';
  if (new Date(c.expira_em).getTime() < agora) return 'expirado';
  if ((Number(c.tentativas) || 0) >= MAX_TENTATIVAS) return 'travado';
  return 'pendente';
}

const RECADO = {
  invalido: 'Este convite não existe ou não vale mais. Peça um novo ao administrador.',
  cancelado: 'Este convite não existe ou não vale mais. Peça um novo ao administrador.',
  expirado: 'Este convite expirou. Peça um novo ao administrador.',
  usado: 'Este convite já foi utilizado. Se você já criou o seu acesso, entre pela tela de login.',
  travado: 'Este convite foi bloqueado por excesso de tentativas. Peça um novo ao administrador.'
};

const NAO_ACHEI = 'Não encontramos um colaborador correspondente a este CPF. ' +
  'Entre em contato com o administrador para validar seu cadastro.';

function paraTela(c) {
  return {
    id: c.id,
    estado: estadoDe(c),
    anotacao: c.anotacao || '',
    modulos: perms.modulosLimpos(c.modulos),
    criado_por: c.created_by || '',
    criado_em: c.created_at,
    expira_em: c.expira_em,
    tentativas: Number(c.tentativas) || 0
  };
}

/* ------------------------------------------------------------
   LADO DO DONO
   ------------------------------------------------------------ */
async function cria(sessao, body, anota) {
  const modulos = perms.modulosLimpos(body.modulos);
  if (modulos !== null && modulos.length === 0) {
    return { erro: 'Marque pelo menos um módulo — sem nenhum, a pessoa entraria e não veria nada.' };
  }
  const codigo = novoCodigo();
  const row = await db.insert('panel_invites', {
    token_hash: hashDe(codigo),
    role: NIVEL_DO_CONVIDADO,
    modulos: modulos,
    anotacao: String(body.anotacao || '').trim().slice(0, 120) || null,
    created_by: (sessao && (sessao.nome || sessao.email)) || 'senha mestra',
    created_by_id: (sessao && sessao.uid) || null,
    expira_em: new Date(Date.now() + DIAS_DE_VALIDADE * 86400000).toISOString()
  });
  await anota(sessao, 'convite_colaborador_criado', row.anotacao || row.id,
    { convite: row.id, modulos: modulos });
  // O link só existe AGORA: no banco ficou o hash. Por isso ele é
  // devolvido uma vez, para o Dono copiar.
  return { convite: paraTela(row), link: linkDe(codigo) };
}

// Gera um código novo para o mesmo convite. O anterior morre na hora,
// porque o hash guardado passa a ser outro.
async function renova(sessao, id, anota) {
  const c = await db.selectOne('panel_invites', { id: 'eq.' + String(id || ''), select: '*' });
  if (!c) return { erro: 'Convite não encontrado.', status: 404 };
  if (c.usado_em) return { erro: 'Este convite já foi utilizado — a pessoa já tem acesso.' };
  const codigo = novoCodigo();
  const row = await db.update('panel_invites', {
    token_hash: hashDe(codigo),
    expira_em: new Date(Date.now() + DIAS_DE_VALIDADE * 86400000).toISOString(),
    tentativas: 0,
    cancelado_em: null
  }, { id: 'eq.' + c.id });
  await anota(sessao, 'convite_colaborador_renovado', c.anotacao || c.id, { convite: c.id });
  return { convite: paraTela(row), link: linkDe(codigo) };
}

async function cancela(sessao, id, anota) {
  const c = await db.selectOne('panel_invites', { id: 'eq.' + String(id || ''), select: '*' });
  if (!c) return { erro: 'Convite não encontrado.', status: 404 };
  if (c.usado_em) return { erro: 'Este convite já foi utilizado — não há o que cancelar.' };
  await db.update('panel_invites', { cancelado_em: new Date().toISOString() }, { id: 'eq.' + c.id });
  await anota(sessao, 'convite_colaborador_cancelado', c.anotacao || c.id, { convite: c.id });
  return { ok: true };
}

// Os convites que ainda interessam ao Dono: os que não viraram
// usuário. Os usados já aparecem na lista como o próprio usuário.
async function emAberto() {
  const linhas = await db.select('panel_invites', {
    usado_em: 'is.null', cancelado_em: 'is.null',
    order: 'created_at.desc', limit: '50', select: '*'
  });
  return (linhas || []).map(paraTela);
}

/* ------------------------------------------------------------
   LADO DO COLABORADOR (sem login — quem manda é o código do link)
   ------------------------------------------------------------ */
async function abre(codigo) {
  codigo = String(codigo || '');
  // Código curto demais nem vai ao banco.
  if (codigo.length < 30) return { erro: RECADO.invalido, status: 404 };
  const c = await db.selectOne('panel_invites', { token_hash: 'eq.' + hashDe(codigo), select: '*' });
  if (!c) return { erro: RECADO.invalido, status: 404 };
  const estado = estadoDe(c);
  if (estado !== 'pendente') return { erro: RECADO[estado], status: 410, estado: estado };
  return { convite: c };
}

async function colaboradorPorCpf(cpf) {
  // Compara só os números dos dois lados. Hoje o banco guarda sem
  // máscara, mas basta um cadastro antigo com pontos e traço para um
  // "eq." exato deixar a pessoa de fora — ou, pior, para alguém criar
  // um segundo cadastro achando que o primeiro não existe.
  const todos = await db.select('collaborators', { select: 'id,name,cpf,email,active' });
  const achados = (todos || []).filter(function (c) { return cpfLimpo(c.cpf) === cpf; });
  // Ex-colaborador não ganha acesso por convite: para o link, é como
  // se o CPF não existisse.
  const ativos = achados.filter(function (c) { return c.active !== false; });
  return ativos[0] || null;
}

async function identifica(codigo, body, anota) {
  const a = await abre(codigo);
  if (a.erro) return a;
  const c = a.convite;

  const nome = String(body.nome || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  const cpf = cpfLimpo(body.cpf);
  const email = String(body.email || '').trim().toLowerCase();

  if (nome.split(' ').filter(Boolean).length < 2) {
    return { erro: 'Escreva o seu nome completo.', status: 400 };
  }
  if (!cpfVale(cpf)) return { erro: 'Confira o CPF: esse número não é válido.', status: 400 };
  if (!u.isEmail(email)) return { erro: 'O e-mail não parece certo.', status: 400 };

  // A tentativa é contada ANTES da busca. Contar depois abriria uma
  // brecha: derrubar a conexão no meio e tentar de novo, de graça.
  const tentativas = (Number(c.tentativas) || 0) + 1;
  await db.update('panel_invites', { tentativas: tentativas }, { id: 'eq.' + c.id });
  const restam = MAX_TENTATIVAS - tentativas;
  const sufixo = restam <= 0
    ? ' Este convite foi bloqueado por excesso de tentativas.'
    : (restam <= 2 ? ' (Restam ' + restam + (restam === 1 ? ' tentativa' : ' tentativas') + ' neste convite.)' : '');

  const colab = await colaboradorPorCpf(cpf);
  if (!colab) {
    await anota(null, 'convite_cpf_nao_encontrado', c.anotacao || c.id, { convite: c.id });
    return { erro: NAO_ACHEI + sufixo, status: 404 };
  }

  const jaTemUsuario = await db.selectOne('panel_users', { collaborator_id: 'eq.' + colab.id, select: 'id' });
  if (jaTemUsuario) {
    // O Dono fica sabendo: alguém com acesso tentou criar outro —
    // quase sempre é só senha esquecida, e ele pode reenviar.
    await anota(null, 'convite_colaborador_ja_tem_acesso', colab.name, { convite: c.id, colaborador: colab.id });
    return {
      erro: 'Este colaborador já possui acesso ao sistema. Se você esqueceu a senha, ' +
        'peça ao administrador para reenviar o seu acesso.',
      status: 409
    };
  }

  // O e-mail só é conferido DEPOIS de o CPF bater: assim esta tela
  // não serve para descobrir quais e-mails têm conta no painel.
  const emailEmUso = await db.selectOne('panel_users', { email: 'eq.' + email, select: 'id' });
  if (emailEmUso) {
    return { erro: 'Já existe um acesso associado a este e-mail. Use outro e-mail ou fale com o administrador.', status: 409 };
  }

  // O bilhete carrega a resposta desta etapa para a próxima, assinado:
  // a confirmação não precisa do CPF de novo e não dá para trocar o
  // colaborador no meio do caminho.
  const bilhete = u.signSession({
    role: 'cv_bilhete', cv: c.id, cid: colab.id, email: email, nome: nome,
    exp: Date.now() + MINUTOS_DO_BILHETE * 60000
  });

  // Só o nome. Nada de CPF, cargo, salário, endereço ou telefone.
  return { achou: true, nome: colab.name, bilhete: bilhete };
}

function mascaraEmail(e) {
  const p = String(e || '').split('@');
  if (p.length !== 2) return '';
  const nome = p[0];
  return nome.slice(0, Math.min(2, nome.length)) + '•••@' + p[1];
}

// ctx traz o que mora no api/admin.js: anota, senhaTrancada e
// enviaBoasVindas. Assim este arquivo não precisa conhecer o e-mail.
async function confirma(codigo, body, ctx) {
  const a = await abre(codigo);
  if (a.erro) return a;
  const c = a.convite;

  const b = u.verifySession(String(body.bilhete || ''));
  if (!b || b.role !== 'cv_bilhete' || b.cv !== c.id || !b.cid) {
    return { erro: 'A confirmação demorou demais. Preencha os dados de novo.', status: 400, recomecar: true };
  }

  if (String(body.resposta || '') !== 'sim') {
    // "Não sou eu": para aqui. Não há lista para escolher outro nome —
    // é o que impede alguém de se associar ao cadastro de um colega.
    await ctx.anota(null, 'convite_nao_sou_eu', c.anotacao || c.id, { convite: c.id, colaborador: b.cid });
    return {
      encerrado: true,
      mensagem: 'Tudo bem — não vinculamos nada. Entre em contato com o administrador ' +
        'para conferir o seu cadastro.'
    };
  }

  const colab = await db.selectOne('collaborators', { id: 'eq.' + b.cid, select: 'id,name,active' });
  if (!colab || colab.active === false) return { erro: NAO_ACHEI, status: 404 };

  // Confere de novo o que pode ter mudado nos minutos entre uma tela
  // e outra (dois convites confirmados quase juntos, por exemplo).
  if (await db.selectOne('panel_users', { collaborator_id: 'eq.' + colab.id, select: 'id' })) {
    return { erro: 'Este colaborador já possui acesso ao sistema.', status: 409 };
  }
  if (await db.selectOne('panel_users', { email: 'eq.' + b.email, select: 'id' })) {
    return { erro: 'Já existe um acesso associado a este e-mail.', status: 409 };
  }

  const cifra = ctx.senhaTrancada();
  let pessoa;
  try {
    pessoa = await db.insert('panel_users', {
      // O nome é o do CADASTRO do colaborador, não o digitado: o
      // registro que já existe é a referência.
      name: colab.name,
      email: b.email,
      role: perms.papelValido(c.role) ? c.role : NIVEL_DO_CONVIDADO,
      modulos: perms.modulosLimpos(c.modulos),
      collaborator_id: colab.id,
      password_hash: cifra.hash, password_salt: cifra.salt,
      must_change: true, active: true,
      created_by: (c.created_by || 'convite') + ' (convite de colaborador)'
    });
  } catch (e) {
    // O banco recusou: outro usuário para o mesmo colaborador entrou
    // no meio. É a tranca do índice único fazendo o trabalho dela.
    if (e.status === 409) return { erro: 'Este colaborador já possui acesso ao sistema.', status: 409 };
    throw e;
  }

  // O convite morre aqui: uso único.
  await db.update('panel_invites', {
    usado_em: new Date().toISOString(), user_id: pessoa.id, collaborator_id: colab.id
  }, { id: 'eq.' + c.id });

  await ctx.anota(null, 'convite_colaborador_usado', b.email, {
    convite: c.id, colaborador: colab.id, usuario: pessoa.id,
    convidado_por: c.created_by || '', nome_digitado: b.nome
  });

  const envio = await ctx.enviaBoasVindas(pessoa);
  await ctx.anota(null, envio.enviado ? 'convite_enviado' : 'convite_falhou', b.email, { erro: envio.erro });

  return {
    criado: true,
    primeiro_nome: u.firstName(colab.name) || colab.name,
    email: mascaraEmail(b.email),
    enviado: !!envio.enviado
  };
}

module.exports = {
  DIAS_DE_VALIDADE, MAX_TENTATIVAS, NIVEL_DO_CONVIDADO, RECADO, NAO_ACHEI,
  cpfLimpo, cpfVale, novoCodigo, hashDe, linkDe, estadoDe, mascaraEmail,
  cria, renova, cancela, emAberto, abre, identifica, confirma
};
