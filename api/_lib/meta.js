// ============================================================
// META EM TEMPO REAL — o placar da Start
//
// Duas telas se servem deste arquivo:
//
//   Comercial → Meta                 o placar (fica numa TV)
//   Comercial → Gerenciador de Meta  onde a equipe lança o valor
//
// Três decisões mandam em tudo aqui, e vale entender as três:
//
// 1) DINHEIRO É NÚMERO INTEIRO DE CENTAVOS.
//    R$ 3.500,00 vira 350000. Nunca 3500.00. Número com vírgula no
//    computador é aproximado: 0,1 + 0,2 não dá 0,3. Num placar que
//    soma trezentos lançamentos, isso vira centavo errado no fim do
//    mês. Inteiro somado com inteiro acerta sempre. A vírgula só
//    aparece na hora de desenhar na tela.
//
// 2) O TOTAL NUNCA É GUARDADO.
//    Não existe campo "total_meta" em lugar nenhum. O total é a soma
//    dos lançamentos vivos, calculada na hora. Total guardado é total
//    que um dia discorda dos lançamentos — e aí ninguém sabe qual dos
//    dois está certo. Como efeito colateral, corrigir ou apagar um
//    lançamento já arruma o placar sozinho: não existe o que
//    "recalcular".
//
// 3) O MÊS É O DE SÃO PAULO, NÃO O DO SERVIDOR.
//    O servidor da Vercel roda em UTC. Uma venda fechada às 22h do
//    dia 30 em Praia Grande são 01h do dia 1º em UTC — ela cairia no
//    mês seguinte e sumiria do placar na reta final da meta. Por isso
//    todo corte de data aqui passa pelo fuso America/Sao_Paulo.
// ============================================================
'use strict';

const db = require('./db');

const TIPOS = ['comercial', 'operacional'];
const TIPOS_NOME = { comercial: 'Comercial', operacional: 'Operacional' };

// Teto de sanidade: R$ 10 milhões num único lançamento. Não é regra
// de negócio, é cinto de segurança contra dedo escorregando no
// teclado — "3500000000" digitado sem querer não vira meta batida.
const TETO_CENTAVOS = 1000000000;

/* ------------------------------------------------------------
   DATAS EM SÃO PAULO
   ------------------------------------------------------------ */
function hojeSP() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

// Meia-noite do dia 1º em São Paulo, escrita em UTC.
//
// São 03:00 em UTC, porque o Brasil está três horas atrás e não tem
// mais horário de verão desde 2019. Se um dia voltar, é esta linha
// (e só ela) que muda.
//
// E por que devolver em UTC, e não "2026-11-01T00:00:00-03:00", que
// é mais fácil de ler? Porque o banco guarda as datas em UTC, e
// texto com fuso diferente só é comparável depois de alguém
// interpretar as duas pontas. Com as duas na mesma forma, a
// comparação é direta e não depende de quem está interpretando.
function inicioDoMes(ym) {
  const ano = Number(ym.slice(0, 4));
  const mes = Number(ym.slice(5, 7));
  return new Date(Date.UTC(ano, mes - 1, 1, 3, 0, 0)).toISOString();
}

// Primeiro instante do mês SEGUINTE — o fim do intervalo. Usamos
// "menor que o começo do próximo" em vez de "até o último dia", que
// é como se esquece das 23h59 do dia 31.
function inicioDoProximo(ym) {
  const ano = Number(ym.slice(0, 4));
  const mes = Number(ym.slice(5, 7));
  const prox = mes === 12 ? (ano + 1) + '-01' : ano + '-' + String(mes + 1).padStart(2, '0');
  return inicioDoMes(prox);
}

function mesAnterior(ym) {
  const ano = Number(ym.slice(0, 4));
  const mes = Number(ym.slice(5, 7));
  return mes === 1 ? (ano - 1) + '-12' : ano + '-' + String(mes - 1).padStart(2, '0');
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function nomeDoMes(ym) {
  const m = Number(ym.slice(5, 7));
  const nome = MESES[m - 1] || ym;
  return nome.charAt(0).toUpperCase() + nome.slice(1);
}

// Aceita 2026-11 do pedido; qualquer coisa estranha cai no mês de hoje.
function mesDe(params) {
  const v = String((params && params.mes) || '').trim();
  if (/^\d{4}-\d{2}$/.test(v) && Number(v.slice(5, 7)) >= 1 && Number(v.slice(5, 7)) <= 12) return v;
  return hojeSP().slice(0, 7);
}

/* ------------------------------------------------------------
   O VALOR DIGITADO

   A pessoa vai digitar de um jeito diferente a cada dia: "3500",
   "3.500,00", "R$ 3.500", "3500,50". Todos querem dizer a mesma
   coisa. Esta função é a única porta de entrada do dinheiro no
   sistema, e devolve centavos ou null — nunca um palpite.
   ------------------------------------------------------------ */
function centavosDe(v) {
  if (v === null || v === undefined) return null;

  // Já veio número? Confia, mas arredonda: 35.005 * 100 em ponto
  // flutuante dá 3500.4999999, e Math.round põe no lugar.
  if (typeof v === 'number') {
    if (!isFinite(v)) return null;
    return Math.round(v * 100);
  }

  let s = String(v).trim();
  if (!s) return null;
  s = s.replace(/R\$/gi, '').replace(/[\s ]/g, '');
  if (!s || !/^-?[0-9.,]+$/.test(s)) return null;

  const temVirgula = s.indexOf(',') >= 0;
  const temPonto = s.indexOf('.') >= 0;

  if (temVirgula && temPonto) {
    // Os dois aparecem: quem vem por ÚLTIMO é o separador decimal.
    // "3.500,00" é brasileiro; "3,500.00" é americano. Os dois entram.
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (temVirgula) {
    // Vírgula sozinha: com uma ou duas casas depois é decimal
    // ("3500,5"); com três é separador de milhar ("3,500").
    const depois = s.length - s.lastIndexOf(',') - 1;
    s = (depois === 1 || depois === 2) ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if (temPonto) {
    const depois = s.length - s.lastIndexOf('.') - 1;
    if (depois !== 1 && depois !== 2) s = s.replace(/\./g, '');
  }

  const n = Number(s);
  if (!isFinite(n)) return null;
  return Math.round(n * 100);
}

/* ------------------------------------------------------------
   CONFIGURAÇÃO (alvo da meta + código da TV)

   Mora na tabela settings, que já existe e já guarda este tipo de
   coisa. Tabela nova para duas linhas de configuração seria
   mobília a mais.
   ------------------------------------------------------------ */
async function config() {
  let v = {};
  try {
    const row = await db.selectOne('settings', { key: 'eq.meta', select: 'value' });
    if (row && row.value && typeof row.value === 'object') v = row.value;
  } catch (e) { /* sem configuração ainda: segue com o padrão */ }

  return {
    // Alvo por tipo e alvo geral. 0 = "não defini alvo", e aí a tela
    // mostra só o acumulado, sem barra de progresso.
    alvo_centavos: Number(v.alvo_centavos) > 0 ? Math.round(Number(v.alvo_centavos)) : 0,
    tv_codigo: typeof v.tv_codigo === 'string' ? v.tv_codigo : '',
    tv_criado_em: v.tv_criado_em || null
  };
}

async function salvaConfig(patch) {
  const atual = await config();
  const novo = Object.assign({}, atual, patch || {});
  await db.upsert('settings', { key: 'meta', value: novo }, 'key');
  return novo;
}

/* ------------------------------------------------------------
   OS LANÇAMENTOS DE UM MÊS

   Pede ao banco só o mês pedido, e só as colunas que a tela usa.
   Nunca "select=*" num endpoint que a televisão chama a cada
   poucos segundos.
   ------------------------------------------------------------ */
const COLUNAS = 'id,tipo,responsavel,cliente,servico,valor_centavos,observacao,user_nome,created_at,updated_at';

async function lancamentosDoMes(ym) {
  const de = inicioDoMes(ym);
  const ate = inicioDoProximo(ym);

  // Um filtro só no banco (a borda de baixo) e a borda de cima aqui.
  // Daria para mandar as duas de uma vez com o "and=(...)" do
  // PostgREST, mas isso amarraria a consulta a um detalhe de sintaxe
  // de um fornecedor — e o mês corrente, que é o caso de 99% das
  // chamadas, não tem borda de cima nenhuma: ninguém lança venda no
  // futuro.
  const linhas = await db.select('meta_lancamentos', {
    select: COLUNAS,
    excluido_em: 'is.null',
    created_at: 'gte.' + de,
    order: 'created_at.desc'
  });
  return (linhas || []).filter(function (l) {
    return String(l.created_at || '') < ate;
  });
}

function somaPorTipo(linhas) {
  const s = { comercial: 0, operacional: 0 };
  linhas.forEach(function (l) {
    const t = l.tipo === 'operacional' ? 'operacional' : 'comercial';
    s[t] += Number(l.valor_centavos) || 0;
  });
  return s;
}

/* O SELO

   A televisão pergunta "mudou algo?" o dia inteiro. Na esmagadora
   maioria das vezes a resposta é "não", e seria desperdício mandar
   a lista inteira de volta nessas horas.

   O selo é uma assinatura curta do estado atual: quantos
   lançamentos existem e qual foi a última mexida. Se o selo que a
   TV mandou é igual ao de agora, a resposta é só "igual" — algumas
   dezenas de bytes em vez de alguns quilos.

   Contar JUNTO com a data da última mexida não é redundância: se
   alguém apagar um lançamento e cadastrar outro no mesmo segundo, a
   contagem volta ao mesmo número, mas a data mudou. E se alguém
   editar um valor sem criar nada, a contagem não muda, mas a data
   sim. Um sozinho erra; os dois juntos, não. */
function seloDe(linhas) {
  let ultima = '';
  linhas.forEach(function (l) {
    const q = String(l.updated_at || l.created_at || '');
    if (q > ultima) ultima = q;
  });
  return linhas.length + ':' + ultima;
}

function paraTela(l) {
  return {
    id: l.id,
    tipo: l.tipo,
    tipo_nome: TIPOS_NOME[l.tipo] || l.tipo,
    responsavel: l.responsavel || '',
    cliente: l.cliente || '',
    servico: l.servico || '',
    observacao: l.observacao || '',
    valor_centavos: Number(l.valor_centavos) || 0,
    user_nome: l.user_nome || '',
    created_at: l.created_at,
    updated_at: l.updated_at
  };
}

/* ------------------------------------------------------------
   O PLACAR

   É o que a TV e o painel desenham. Devolve os três números, o
   alvo, os últimos lançamentos (para a celebração saber o nome de
   quem vendeu) e o selo.
   ------------------------------------------------------------ */
async function placar(params, opts) {
  opts = opts || {};
  const ym = mesDe(params);
  const cfg = await config();
  const linhas = await lancamentosDoMes(ym);
  const selo = seloDe(linhas);

  // Nada mudou desde a última pergunta: resposta curta.
  if (opts.selo && opts.selo === selo) {
    return { igual: true, selo: selo, mes: ym };
  }

  const soma = somaPorTipo(linhas);
  const total = soma.comercial + soma.operacional;

  // O fechamento do mês passado, em letra pequena na TV: dia 1º o
  // placar zera, e sem essa linha parece que o sistema perdeu tudo.
  let anterior = null;
  if (opts.comAnterior !== false) {
    try {
      const ant = mesAnterior(ym);
      const linhasAnt = await lancamentosDoMes(ant);
      const somaAnt = somaPorTipo(linhasAnt);
      anterior = {
        mes: ant,
        mes_nome: nomeDoMes(ant),
        total: somaAnt.comercial + somaAnt.operacional
      };
    } catch (e) { anterior = null; }
  }

  return {
    igual: false,
    selo: selo,
    mes: ym,
    mes_nome: nomeDoMes(ym),
    ano: ym.slice(0, 4),
    alvo_centavos: cfg.alvo_centavos,
    comercial: soma.comercial,
    operacional: soma.operacional,
    total: total,
    quantidade: linhas.length,
    // Os últimos 25 bastam: a celebração só precisa do que acabou de
    // entrar, e o histórico completo tem tela própria no Gerenciador.
    lancamentos: linhas.slice(0, 25).map(paraTela),
    anterior: anterior,
    // Hora do SERVIDOR. A TV usa isto em vez do relógio dela, que
    // pode estar errado — televisão de empresa quase sempre está.
    agora: new Date().toISOString()
  };
}

/* ------------------------------------------------------------
   HISTÓRICO DO GERENCIADOR
   ------------------------------------------------------------ */
async function historico(params) {
  const ym = mesDe(params);
  const tudo = String((params && params.tudo) || '') === '1';

  let linhas;
  if (tudo) {
    linhas = await db.select('meta_lancamentos', {
      select: COLUNAS, excluido_em: 'is.null',
      order: 'created_at.desc', limit: '200'
    }) || [];
  } else {
    linhas = await lancamentosDoMes(ym);
  }
  const soma = somaPorTipo(linhas);

  return {
    mes: ym,
    mes_nome: nomeDoMes(ym),
    tudo: tudo,
    lancamentos: linhas.map(paraTela),
    comercial: soma.comercial,
    operacional: soma.operacional,
    total: soma.comercial + soma.operacional
  };
}

/* ------------------------------------------------------------
   VALIDAÇÃO DE UM LANÇAMENTO

   Devolve { erro } ou { campos }. A tela também confere, mas quem
   manda é aqui: a tela é educação, o servidor é tranca.
   ------------------------------------------------------------ */
function limpa(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max || 160);
}

function valida(body) {
  const tipo = TIPOS.indexOf(String(body.tipo || '').toLowerCase()) >= 0
    ? String(body.tipo).toLowerCase() : null;
  if (!tipo) return { erro: 'Escolha se o lançamento é Comercial ou Operacional.' };

  const responsavel = limpa(body.responsavel, 80);
  if (!responsavel) return { erro: 'Diga quem é o responsável por esse valor.' };

  const cliente = limpa(body.cliente, 120);
  if (!cliente) return { erro: 'Diga de qual cliente é esse valor.' };

  const centavos = centavosDe(body.valor);
  if (centavos === null) return { erro: 'Não entendi o valor. Escreva assim: 3.500,00' };
  if (centavos <= 0) return { erro: 'O valor precisa ser maior que zero.' };
  if (centavos > TETO_CENTAVOS) {
    return { erro: 'Esse valor passa de R$ 10 milhões. Confira se não sobrou um zero.' };
  }

  return {
    campos: {
      tipo: tipo,
      responsavel: responsavel,
      cliente: cliente,
      servico: limpa(body.servico, 120) || null,
      valor_centavos: centavos,
      observacao: String(body.observacao == null ? '' : body.observacao).trim().slice(0, 600) || null
    }
  };
}

/* Guarda no histórico quem fez o que. Mesmo formato do resto do
   painel, mesma tabela. Falhar aqui nunca derruba o lançamento:
   perder a anotação é chato, perder a venda é grave. */
async function anota(sessao, acao, alvo, detalhe) {
  try {
    await db.insert('audit_log', {
      user_id: sessao && sessao.uid ? sessao.uid : null,
      user_name: (sessao && sessao.nome) || 'senha mestra',
      user_email: (sessao && sessao.email) || '',
      action: acao,
      target: alvo || null,
      detail: detalhe || {}
    });
  } catch (e) { console.error('[meta/auditoria]', e.message); }
}

async function cria(body, sessao) {
  const v = valida(body);
  if (v.erro) return { erro: v.erro };

  const row = await db.insert('meta_lancamentos', Object.assign({}, v.campos, {
    user_id: (sessao && sessao.uid) || null,
    user_nome: (sessao && sessao.nome) || 'senha mestra'
  }));

  await anota(sessao, 'meta_lancamento', row && row.id, {
    tipo: v.campos.tipo, cliente: v.campos.cliente,
    responsavel: v.campos.responsavel, valor_centavos: v.campos.valor_centavos
  });

  return { lancamento: paraTela(row) };
}

async function edita(body, sessao) {
  const id = String(body.id || '');
  if (!id) return { erro: 'Diga qual lançamento você quer corrigir.' };

  const atual = await db.selectOne('meta_lancamentos', { id: 'eq.' + id, select: '*' });
  if (!atual || atual.excluido_em) return { erro: 'Lançamento não encontrado.', status: 404 };

  const v = valida(Object.assign({
    tipo: atual.tipo, responsavel: atual.responsavel, cliente: atual.cliente,
    servico: atual.servico, valor: atual.valor_centavos / 100, observacao: atual.observacao
  }, body));
  if (v.erro) return { erro: v.erro };

  const row = await db.update('meta_lancamentos',
    Object.assign({}, v.campos, { updated_at: new Date().toISOString() }),
    { id: 'eq.' + id });

  await anota(sessao, 'meta_lancamento_editar', id, {
    de_centavos: Number(atual.valor_centavos) || 0,
    para_centavos: v.campos.valor_centavos
  });

  return { lancamento: paraTela(row) };
}

async function exclui(id, sessao) {
  id = String(id || '');
  if (!id) return { erro: 'Diga qual lançamento você quer apagar.' };

  const atual = await db.selectOne('meta_lancamentos', { id: 'eq.' + id, select: '*' });
  if (!atual || atual.excluido_em) return { erro: 'Lançamento não encontrado.', status: 404 };

  const agora = new Date().toISOString();
  await db.update('meta_lancamentos',
    { excluido_em: agora, updated_at: agora },
    { id: 'eq.' + id });

  await anota(sessao, 'meta_lancamento_excluir', id, {
    tipo: atual.tipo, cliente: atual.cliente,
    valor_centavos: Number(atual.valor_centavos) || 0
  });

  return { ok: true };
}

/* ------------------------------------------------------------
   O CÓDIGO DA TELEVISÃO

   A TV da sala não faz login. Ela abre /meta?tv=CODIGO e só
   enxerga o placar — nada de Financeiro, Clientes ou Usuários.

   O código é longo e sorteado de propósito: ele é a senha dessa
   tela. Se vazar, vazou o placar (e não o painel), e trocar o
   código é um clique — o link antigo morre na hora.
   ------------------------------------------------------------ */
function sorteiaCodigo() {
  // Sem letras e números que se confundem numa TV vista de longe
  // (0/O, 1/I/l), porque alguém vai digitar isso na mão uma vez.
  const alfabeto = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = require('crypto').randomBytes(26);
  let s = '';
  for (let i = 0; i < 26; i++) s += alfabeto[bytes[i] % alfabeto.length];
  return s;
}

module.exports = {
  TIPOS, TIPOS_NOME, TETO_CENTAVOS,
  hojeSP, mesDe, nomeDoMes, mesAnterior, inicioDoMes, inicioDoProximo,
  centavosDe, seloDe, valida,
  config, salvaConfig, placar, historico,
  cria, edita, exclui, sorteiaCodigo
};
