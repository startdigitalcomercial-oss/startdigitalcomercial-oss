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
// · O LINK SERVE PARA O TIME INTEIRO. O Dono gera UM link de
//   cadastro e manda no grupo; dez, vinte, trinta colaboradores usam
//   o mesmo. Usar o link não o gasta. Quem é "de uso único" é a
//   PESSOA, não o link: cada colaborador só consegue criar um
//   usuário, porque o banco recusa o segundo (índice único).
//
// · O LINK NÃO VIRA LISTA DE FUNCIONÁRIOS. Um link compartilhado não
//   pode travar para sempre (um curioso trancaria o time inteiro do
//   lado de fora), então a defesa é um FREIO: dez CPFs que não dão em
//   nada dentro de quinze minutos e o link descansa até a janela
//   passar. Dá para errar à vontade no dia a dia; não dá para sair
//   testando CPF em série. CPF errado e CPF de ex-colaborador dão
//   exatamente a mesma resposta, e o nome só aparece para quem tem o
//   link E acertou um CPF.
//
// · TEM PRAZO E TEM BOTÃO DE DESLIGAR. Trinta dias. O Dono cancela
//   quando quiser, e gerar um link novo para a mesma linha mata o
//   anterior na hora.
// ============================================================
'use strict';

const crypto = require('crypto');
const db = require('./db');
const u = require('./util');
const perms = require('./perms');

const DIAS_DE_VALIDADE = 30;
// O freio: tantas buscas sem resultado dentro da janela e o link
// descansa até ela passar.
const MAX_FALHAS = 10;
const JANELA_MINUTOS = 15;
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
// digitação ANTES de ele contar como tentativa no freio do link — e
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

// Quantas buscas sem resultado este link acumulou NA JANELA ATUAL.
// Passados os quinze minutos, a conta zera sozinha.
function falhasNaJanela(c, agora) {
  agora = agora || Date.now();
  const desde = c.falhas_desde ? new Date(c.falhas_desde).getTime() : 0;
  if (!desde || agora - desde > JANELA_MINUTOS * 60000) return { falhas: 0, desde: 0 };
  return { falhas: Number(c.tentativas) || 0, desde: desde };
}

// "usado_em" NÃO encerra mais o link: virou só a data do último
// cadastro feito por ele. O que encerra é cancelar ou vencer.
function estadoDe(c, agora) {
  agora = agora || Date.now();
  if (c.cancelado_em) return 'cancelado';
  if (new Date(c.expira_em).getTime() < agora) return 'expirado';
  if (falhasNaJanela(c, agora).falhas >= MAX_FALHAS) return 'pausado';
  return 'ativo';
}

const RECADO = {
  invalido: 'Este link de cadastro não existe ou não vale mais. Peça um novo ao administrador.',
  cancelado: 'Este link de cadastro não existe ou não vale mais. Peça um novo ao administrador.',
  expirado: 'Este link de cadastro expirou. Peça um novo ao administrador.',
  pausado: 'Muitas tentativas neste link em pouco tempo. Aguarde alguns minutos e tente de novo.'
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
    // quantas pessoas já se cadastraram por este link, e quando foi a última
    usos: Number(c.usos) || 0,
    ultimo_uso_em: c.usado_em || null
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
  if (!c) return { erro: 'Link de cadastro não encontrado.', status: 404 };
  const codigo = novoCodigo();
  const row = await db.update('panel_invites', {
    token_hash: hashDe(codigo),
    expira_em: new Date(Date.now() + DIAS_DE_VALIDADE * 86400000).toISOString(),
    tentativas: 0,
    falhas_desde: null,
    cancelado_em: null
  }, { id: 'eq.' + c.id });
  await anota(sessao, 'convite_colaborador_renovado', c.anotacao || c.id, { convite: c.id });
  return { convite: paraTela(row), link: linkDe(codigo) };
}

async function cancela(sessao, id, anota) {
  const c = await db.selectOne('panel_invites', { id: 'eq.' + String(id || ''), select: '*' });
  if (!c) return { erro: 'Link de cadastro não encontrado.', status: 404 };
  // Cancelar desliga o LINK. Quem já se cadastrou por ele continua
  // com o acesso — para tirar o acesso de alguém, é na ficha da pessoa.
  await db.update('panel_invites', { cancelado_em: new Date().toISOString() }, { id: 'eq.' + c.id });
  await anota(sessao, 'convite_colaborador_cancelado', c.anotacao || c.id, { convite: c.id });
  return { ok: true };
}

// Os links que ainda interessam ao Dono: os que não foram cancelados.
// Um link já usado continua na lista — ele segue valendo para o
// próximo colaborador.
async function emAberto() {
  const linhas = await db.select('panel_invites', {
    cancelado_em: 'is.null',
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
  // Link pausado pelo freio ainda ABRE: a pessoa vê o formulário e é
  // avisada só se tentar enviar antes de a janela passar.
  if (estado === 'cancelado' || estado === 'expirado') return { erro: RECADO[estado], status: 410, estado: estado };
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

  // O FREIO. Link que acumulou buscas demais sem resultado nos
  // últimos minutos nem consulta: descansa até a janela passar.
  const janela = falhasNaJanela(c);
  if (janela.falhas >= MAX_FALHAS) return { erro: RECADO.pausado, status: 429 };

  // Só conta o que NÃO deu em nada. Trinta colaboradores acertando o
  // próprio CPF, um atrás do outro, não podem pausar o link — quem
  // pausa é a sequência de CPFs que não levam a lugar nenhum.
  const contaFalha = async function () {
    await db.update('panel_invites', {
      tentativas: janela.falhas + 1,
      falhas_desde: new Date(janela.desde || Date.now()).toISOString()
    }, { id: 'eq.' + c.id });
  };

  const colab = await colaboradorPorCpf(cpf);
  if (!colab) {
    await contaFalha();
    await anota(null, 'convite_cpf_nao_encontrado', c.anotacao || c.id, { convite: c.id });
    return { erro: NAO_ACHEI, status: 404 };
  }

  const jaTemUsuario = await db.selectOne('panel_users', { collaborator_id: 'eq.' + colab.id, select: 'id' });
  if (jaTemUsuario) {
    await contaFalha();
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

  // O link NÃO morre aqui: ele continua valendo para o próximo
  // colaborador. Fica anotado só que mais uma pessoa se cadastrou por
  // ele, e quando. (Quem foi cada uma está no histórico, com o número
  // do link — a tabela de convites não guarda uma pessoa só.)
  await db.update('panel_invites', {
    usos: (Number(c.usos) || 0) + 1,
    usado_em: new Date().toISOString()
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
  DIAS_DE_VALIDADE, MAX_FALHAS, JANELA_MINUTOS, NIVEL_DO_CONVIDADO, RECADO, NAO_ACHEI,
  cpfLimpo, cpfVale, novoCodigo, hashDe, linkDe, estadoDe, mascaraEmail,
  cria, renova, cancela, emAberto, abre, identifica, confirma
};
