// ============================================================
// PAPEIS E PERMISSOES DO PAINEL
//
// Sao quatro papeis, do mais para o menos poderoso:
//
//   dono       — faz tudo, inclusive criar e remover usuarios
//   rh         — cuida do processo inteiro: candidatos, time, avisos,
//                aulas, quiz, mensagens e ajustes. Nao mexe em usuarios.
//   avaliador  — ve os candidatos e corrige o quiz. Nao envia mensagem
//                nem muda configuracao.
//   leitura    — so olha. Nao muda nada.
//
// A regra vale no SERVIDOR. Esconder botao na tela e so gentileza —
// quem manda e esta lista.
// ============================================================
'use strict';

const PAPEIS = ['dono', 'rh', 'avaliador', 'leitura'];

const NOMES = {
  dono: 'Dono',
  rh: 'RH',
  avaliador: 'Avaliador',
  leitura: 'Leitura'
};

const DESCRICOES = {
  dono: 'Faz tudo, inclusive criar e remover usuários do painel.',
  rh: 'Cuida do processo inteiro: candidatos, time, avisos, aulas e ajustes.',
  avaliador: 'Vê os candidatos e corrige o quiz. Não envia mensagem nem muda configuração.',
  leitura: 'Só acompanha. Não altera nada.'
};

// O que cada papel PODE fazer, por area.
// ver = enxergar a tela. mexer = alterar/criar/excluir. enviar = disparar mensagem.
//
// comercial_gerir = cadastrar participante e ver a simulacao dos OUTROS.
// Quem nao tem isso ainda pode usar o modulo, mas so a propria carteira —
// e quem decide isso e o api/comercial.js, olhando o dono do registro.
// Papel sozinho nao resolve aqui: dois usuarios com o mesmo papel "leitura"
// podem ser SDRs diferentes, cada um com os seus leads.
const PODE = {
  dono:      { ver: '*', mexer: '*', enviar: true, usuarios: true, ajustes: true,
               financeiro: true, financeiro_mexer: true, comercial_gerir: true },
  rh:        { ver: '*', mexer: '*', enviar: true, usuarios: false, ajustes: true,
               financeiro: true, financeiro_mexer: true, comercial_gerir: true },
  avaliador: {
    ver: ['dashboard', 'candidatos', 'quiz', 'aulas', 'time'],
    mexer: ['quiz_nota', 'candidato_nota'],
    enviar: false, usuarios: false, ajustes: false,
    financeiro: false, financeiro_mexer: false, comercial_gerir: false
  },
  // Leitura ve quase tudo, mas dinheiro nao. Valor de contrato e
  // telefone de cliente nao sao coisa de "so olhar".
  leitura:   { ver: '*', mexer: [], enviar: false, usuarios: false, ajustes: false,
               financeiro: false, financeiro_mexer: false, comercial_gerir: false }
};

// Cada acao da API declara o que exige.
// Quem nao esta nesta lista cai na regra padrao: precisa de "mexer".
const ACOES = {
  // --- so olhar ---
  board: 'ver', candidate: 'ver', archived: 'ver', dashboard: 'ver',
  candidates_list: 'ver', logs: 'ver', content: 'ver', quiz_admin: 'ver',
  disc_admin: 'ver', templates: 'ver', settings: 'ver', preview: 'ver',
  team: 'ver', prequal: 'ver', aurea: 'ver', aurea_session: 'ver',
  broadcast_info: 'ver', broadcast_preview: 'ver', dica_senha: 'livre',
  login: 'livre', logout_todos: 'livre', usuarios_eu: 'livre',
  sms_rotas: 'ver', sms_entregas: 'ver', wa_status: 'ver', wa_estado: 'ver',

  // --- correcao do quiz: o avaliador pode ---
  grade_attempt: 'quiz_nota',
  update_candidate: 'candidato_nota',

  // --- disparo de mensagem ---
  send: 'enviar', broadcast_send: 'enviar', aviso_imagem: 'enviar', sms_teste: 'enviar',
  wa_teste: 'enviar', aurea_start: 'enviar', import_candidates: 'enviar',

  // --- configuracao pesada ---
  settings_save: 'ajustes', aurea_config_save: 'ajustes', wa_conectar: 'ajustes',
  wa_recriar: 'ajustes', wa_limpar: 'ajustes', wa_desconectar: 'ajustes',
  wa_webhook: 'ajustes', wa_qr: 'ajustes', wa_diagnostico: 'ajustes',

  // --- gestao de usuarios: so o dono ---
  usuarios: 'usuarios', usuario_salvar: 'usuarios', usuario_excluir: 'usuarios',
  usuario_senha: 'usuarios', auditoria: 'usuarios',
  // convite de colaborador: gerar, renovar e cancelar e gestao de
  // usuarios, entao segue a mesma tranca (so o Dono).
  cv_criar: 'usuarios', cv_renovar: 'usuarios', cv_cancelar: 'usuarios',
  vagas: 'ver', vaga_salvar: 'mexer', vaga_excluir: 'mexer', vaga_ordem: 'mexer',
  curriculo_link: 'ver',

  // --- financeiro: so quem cuida do dinheiro ---
  fin_lista: 'financeiro', fin_resumo: 'financeiro', fin_relatorio: 'financeiro',
  fin_salvar: 'financeiro_mexer', fin_excluir: 'financeiro_mexer',
  fin_importar: 'financeiro_mexer', fin_virada: 'financeiro', fin_dre: 'financeiro',
  fc_lista: 'financeiro', fc_ficha: 'financeiro', fc_salvar: 'financeiro_mexer',
  fg_lista: 'financeiro', fg_salvar: 'financeiro_mexer', fg_excluir: 'financeiro_mexer',

  // --- OPERACAO: a carteira de trafego por gestor ---
  op_dashboard: 'ver', op_gestores: 'ver', op_carteira: 'ver', op_cliente_historico: 'ver',
  ob_lista: 'ver', ob_salvar: 'mexer', ob_mover: 'mexer',
  ag_lista: 'ver', ag_salvar: 'mexer', ag_status: 'mexer', ag_excluir: 'mexer',
  ag_google_status: 'ver', ag_google_ligar: 'ajustes',
  ag_google_desligar: 'ajustes', ag_google_sync: 'mexer',
  op_gestor_salvar: 'mexer', op_cliente_salvar: 'mexer',
  op_cliente_excluir: 'mexer', op_movimentar: 'mexer',

  // --- START PLAY: a roleta. Ver o historico e coisa de quem cuida
  // do time; mexer nos premios tambem. Giro em si nao passa por aqui:
  // a pagina do colaborador e publica, sem login.
  pl_painel: 'ver', pl_historico: 'ver',
  pl_premio_salvar: 'mexer', pl_ordem: 'mexer',

  // --- COMERCIAL / SIMULACOES ---
  // Marcadas como 'livre' DE PROPOSITO, e nao por descuido: 'livre' aqui
  // quer dizer "o papel sozinho nao decide". A porta ja exigiu um cracha
  // valido antes de chegar neste ponto; quem decide o que a pessoa ve e
  // o que ela pode mexer e o api/comercial.js, que olha de quem e o
  // registro. Um SDR mexe na carteira dele e em mais nenhuma.
  cm_participantes: 'livre', cm_painel: 'livre', cm_dashboard: 'livre',
  cm_lead_salvar: 'livre', cm_lead_campo: 'livre', cm_lead_excluir: 'livre',
  cm_participante_salvar: 'comercial_gerir',
  cm_participante_excluir: 'comercial_gerir',
  cm_usuarios: 'comercial_gerir',

  // --- META EM TEMPO REAL ---
  // O placar entra dinheiro de verdade, entao usa a MESMA tranca do
  // Financeiro, que e onde dinheiro ja mora. Nao inventamos papel
  // novo: 'financeiro' e 'financeiro_mexer' hoje sao true so para
  // Dono e RH, que e exatamente quem o Clovis escolheu para lancar.
  // Se um dia nascer o papel "Comercial", ele herda isto sozinho.
  //
  // mt_tv NAO esta nesta lista de proposito: a tela da televisao nao
  // tem login nenhum, ela entra por um codigo secreto e e conferida
  // antes da porta, dentro do api/comercial.js.
  mt_placar: 'financeiro',
  mt_lista: 'financeiro',
  mt_salvar: 'financeiro_mexer',
  mt_excluir: 'financeiro_mexer',
  mt_config: 'financeiro_mexer',

  // --- Space Colaborador: libera dinheiro de verdade, mesma tranca ---
  sp_painel: 'financeiro',
  sp_voucher_salvar: 'financeiro_mexer', sp_liberar: 'financeiro_mexer',
  sp_cancelar: 'financeiro_mexer', sp_conferir: 'financeiro_mexer',
  sp_config_save: 'financeiro_mexer'
};

/* ============================================================
   MODULOS — o que cada USUARIO pode acessar

   Ate aqui existia uma pergunta so: "este NIVEL pode fazer isto?".
   Agora existem duas, e as duas precisam dizer sim:

     1. o NIVEL permite a acao?        (dono, rh, avaliador, leitura)
     2. o MODULO esta liberado para esta pessoa?

   O nivel diz O QUE a pessoa pode fazer (so olhar, alterar, mexer
   em dinheiro). O modulo diz ONDE. Um colaborador do Comercial pode
   ter nivel para alterar e, mesmo assim, nao enxergar o Financeiro.

   A lista abaixo e o espelho do menu lateral: cada modulo e um
   grupo do menu, com as mesmas abas. Um teste confere que toda aba
   do menu e toda acao da API pertencem a algum modulo — assim, quem
   criar uma tela nova e esquecer de dizer de qual modulo ela e nao
   consegue passar despercebido.

   modulos = null  ->  sem restricao (vale so o nivel). E como todos
                       os usuarios que ja existiam continuam.
   modulos = [...]  -> so os modulos da lista.
   Dono             -> sempre tudo. Restringir o Dono criaria o risco
                       de ninguem mais conseguir abrir Usuarios para
                       desfazer a restricao.
   ============================================================ */
const MODULOS = [
  { chave: 'vagas', nome: 'Vagas', grupo: 'principal',
    abas: ['dashboard', 'vagas', 'triagem', 'candidatos'] },
  { chave: 'automacao', nome: 'Automação', grupo: 'automacao',
    abas: ['prequalificacao', 'aurea', 'preonboarding'] },
  { chave: 'colaboradores', nome: 'Colaboradores', grupo: 'time',
    abas: ['colaboradores', 'avisos', 'space', 'play'] },
  { chave: 'operacao', nome: 'Operação', grupo: 'operacao',
    abas: ['opdash', 'opgestores', 'oponboarding', 'opagenda'] },
  { chave: 'comercial', nome: 'Comercial', grupo: 'comercial',
    abas: ['cmleads', 'cmagenda', 'cmatendimento', 'cmsimulacoes', 'meta', 'metagerente'] },
  { chave: 'academy', nome: 'Start Academy', grupo: 'conteudo',
    abas: ['conteudo', 'quiz', 'mensagens'] },
  { chave: 'financeiro', nome: 'Financeiro', grupo: 'financeiro',
    abas: ['findash', 'financeiro', 'finclientes', 'fingastos', 'findre'] },
  { chave: 'rh', nome: 'RH', grupo: 'admin',
    abas: ['usuarios', 'ajustes'] }
];

const MODULO_CHAVES = MODULOS.map(function (m) { return m.chave; });

// De qual modulo e cada acao da API. Quase todas saem pelo prefixo
// (fin_ e Financeiro, op_ e Operacao...); as do api/admin.js, que
// nasceram antes dos prefixos, estao escritas uma a uma.
const PREFIXOS = [
  ['fin_', 'financeiro'], ['fc_', 'financeiro'], ['fg_', 'financeiro'],
  ['op_', 'operacao'], ['ob_', 'operacao'], ['ag_', 'operacao'],
  ['cm_', 'comercial'], ['mt_', 'comercial'],
  ['sp_', 'colaboradores'], ['pl_', 'colaboradores'],
  ['aurea', 'automacao'], ['prequal', 'automacao'],
  ['vaga', 'vagas'], ['wa_', 'rh'], ['sms_', 'rh'],
  ['usuario_', 'rh'], ['cv_', 'rh'],
  ['lesson_', 'academy'], ['module_', 'academy'], ['question_', 'academy'],
  ['quiz_', 'academy'], ['template', 'academy'], ['team', 'colaboradores'],
  ['broadcast_', 'colaboradores']
];

const ACAO_MODULOS = {
  // recrutamento
  board: ['vagas'], candidate: ['vagas'], archived: ['vagas'], dashboard: ['vagas'],
  candidates_list: ['vagas'], move: ['vagas'], update_candidate: ['vagas'],
  delete_candidate: ['vagas'], grade_attempt: ['vagas'], curriculo_link: ['vagas'],
  disc_admin: ['vagas'], disc_question_save: ['vagas'],
  // usadas pela Triagem E pela Automacao: basta ter um dos dois
  send: ['vagas', 'automacao'], preview: ['vagas', 'automacao'],
  import_candidates: ['automacao'],
  // time
  aviso_imagem: ['colaboradores'],
  // academy
  content: ['academy'],
  // administracao
  usuarios: ['rh'], auditoria: ['rh'], settings: ['rh'], settings_save: ['rh'], logs: ['rh']
};

// Acoes que nao pertencem a modulo nenhum: entrar, saber quem sou,
// sair. Estao aqui escritas para o teste distinguir "livre de
// proposito" de "esqueceram de classificar".
const SEM_MODULO = ['login', 'dica_senha', 'usuarios_eu', 'logout_todos',
  'convite_info', 'convite_senha', 'cv_abrir', 'cv_identificar', 'cv_confirmar',
  'mt_tv',
  // Rotas que nem passam pela porta do painel: paginas do proprio
  // colaborador (beneficio, roleta) e retornos de servicos externos.
  'meu_space', 'sacar', 'webhook', 'play_roleta', 'play_girar', 'google_callback'];

function modulosDaAcao(acao) {
  if (SEM_MODULO.indexOf(acao) >= 0) return null;
  if (ACAO_MODULOS[acao]) return ACAO_MODULOS[acao];
  for (let i = 0; i < PREFIXOS.length; i++) {
    if (String(acao).indexOf(PREFIXOS[i][0]) === 0) return [PREFIXOS[i][1]];
  }
  return null;
}

// Arruma o que veio da tela ou do banco: so chaves que existem, sem
// repetir. Devolve null quando nao ha restricao.
function modulosLimpos(lista) {
  if (lista === null || lista === undefined) return null;
  if (!Array.isArray(lista)) return null;
  const vistos = {};
  return MODULO_CHAVES.filter(function (k) {
    if (lista.indexOf(k) < 0 || vistos[k]) return false;
    vistos[k] = true;
    return true;
  });
}

// Esta pessoa (nivel + modulos) pode executar esta acao?
function moduloPermite(papel, modulos, acao) {
  if (papel === 'dono') return true;
  const lista = modulosLimpos(modulos);
  if (lista === null) return true;                 // sem restricao
  const precisa = modulosDaAcao(acao);
  if (!precisa) return true;                       // acao sem modulo
  return precisa.some(function (m) { return lista.indexOf(m) >= 0; });
}

function nomeDoModulo(chave) {
  const m = MODULOS.filter(function (x) { return x.chave === chave; })[0];
  return m ? m.nome : chave;
}

function recadoModulo(acao) {
  const precisa = modulosDaAcao(acao) || [];
  return 'O seu acesso não inclui o módulo ' + nomeDoModulo(precisa[0] || '') +
    '. Se precisar dele, fale com o administrador.';
}

// O menu de uma pessoa: o que o nivel mostra, menos o que os
// modulos escondem.
function menuDaPessoa(papel, modulos) {
  const base = menuDoPapel(papel);
  if (papel === 'dono') return base;
  const lista = modulosLimpos(modulos);
  if (lista === null) return base;
  const liberadas = {};
  MODULOS.forEach(function (m) {
    if (lista.indexOf(m.chave) >= 0) m.abas.forEach(function (a) { liberadas[a] = true; });
  });
  return base.filter(function (aba) { return liberadas[aba]; });
}

function papelValido(p) { return PAPEIS.indexOf(p) >= 0; }

// Responde: este papel pode executar esta acao?
function permite(papel, acao) {
  const exige = ACOES[acao] || 'mexer';
  if (exige === 'livre') return true;

  const regra = PODE[papel];
  if (!regra) return false;

  if (exige === 'enviar') return regra.enviar === true;
  if (exige === 'usuarios') return regra.usuarios === true;
  if (exige === 'ajustes') return regra.ajustes === true;
  if (exige === 'financeiro') return regra.financeiro === true;
  if (exige === 'financeiro_mexer') return regra.financeiro_mexer === true;
  if (exige === 'comercial_gerir') return regra.comercial_gerir === true;

  if (exige === 'ver') {
    return regra.ver === '*' || (Array.isArray(regra.ver) && regra.ver.length > 0);
  }

  // exige "mexer" ou uma permissao nomeada (quiz_nota, candidato_nota...)
  if (regra.mexer === '*') return true;
  if (!Array.isArray(regra.mexer)) return false;
  return regra.mexer.indexOf(exige) >= 0;
}

// Recado claro quando falta permissao — nada de "erro 403".
function recado(papel, acao) {
  const exige = ACOES[acao] || 'mexer';
  const nome = NOMES[papel] || papel;
  if (exige === 'usuarios') return 'Só o Dono pode mexer nos usuários do painel.';
  if (exige === 'financeiro' || exige === 'financeiro_mexer') {
    return 'O seu acesso (' + nome + ') não enxerga o financeiro.';
  }
  if (exige === 'comercial_gerir') {
    return 'Só o Dono ou o RH podem cadastrar participantes e ver a simulação dos outros.';
  }
  if (exige === 'enviar') return 'O seu acesso (' + nome + ') não permite disparar mensagens.';
  if (exige === 'ajustes') return 'O seu acesso (' + nome + ') não permite mudar as configurações.';
  return 'O seu acesso (' + nome + ') é só de consulta — esta ação não é permitida.';
}

// O que a tela deve mostrar para cada papel. Serve para esconder menu,
// mas quem realmente barra e o servidor.
function menuDoPapel(papel) {
  if (papel === 'dono') {
    return ['dashboard', 'vagas', 'triagem', 'candidatos', 'prequalificacao', 'aurea', 'preonboarding',
      'colaboradores', 'avisos', 'space', 'play', 'conteudo', 'quiz', 'mensagens',
      'opdash', 'opgestores', 'oponboarding', 'opagenda',
      'cmleads', 'cmagenda', 'cmatendimento', 'cmsimulacoes', 'meta', 'metagerente',
      'financeiro', 'finclientes', 'findash', 'fingastos', 'findre', 'ajustes', 'usuarios'];
  }
  if (papel === 'rh') {
    return ['dashboard', 'vagas', 'triagem', 'candidatos', 'prequalificacao', 'aurea', 'preonboarding',
      'colaboradores', 'avisos', 'space', 'play', 'conteudo', 'quiz', 'mensagens',
      'opdash', 'opgestores', 'oponboarding', 'opagenda',
      'cmleads', 'cmagenda', 'cmatendimento', 'cmsimulacoes', 'meta', 'metagerente',
      'financeiro', 'finclientes', 'findash', 'fingastos', 'findre', 'ajustes'];
  }
  if (papel === 'avaliador') {
    return ['dashboard', 'vagas', 'triagem', 'candidatos', 'quiz', 'conteudo'];
  }
  return ['dashboard', 'vagas', 'triagem', 'candidatos', 'colaboradores', 'conteudo', 'quiz'];
}

module.exports = {
  PAPEIS, NOMES, DESCRICOES, ACOES, permite, recado, menuDoPapel, papelValido,
  MODULOS, MODULO_CHAVES, SEM_MODULO, modulosDaAcao, modulosLimpos, moduloPermite,
  nomeDoModulo, recadoModulo, menuDaPessoa
};
