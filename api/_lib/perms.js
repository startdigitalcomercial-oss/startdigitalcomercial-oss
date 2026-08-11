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
const PODE = {
  dono:      { ver: '*', mexer: '*', enviar: true, usuarios: true, ajustes: true,
               financeiro: true, financeiro_mexer: true },
  rh:        { ver: '*', mexer: '*', enviar: true, usuarios: false, ajustes: true,
               financeiro: true, financeiro_mexer: true },
  avaliador: {
    ver: ['dashboard', 'candidatos', 'quiz', 'aulas', 'time'],
    mexer: ['quiz_nota', 'candidato_nota'],
    enviar: false, usuarios: false, ajustes: false,
    financeiro: false, financeiro_mexer: false
  },
  // Leitura ve quase tudo, mas dinheiro nao. Valor de contrato e
  // telefone de cliente nao sao coisa de "so olhar".
  leitura:   { ver: '*', mexer: [], enviar: false, usuarios: false, ajustes: false,
               financeiro: false, financeiro_mexer: false }
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
  send: 'enviar', broadcast_send: 'enviar', sms_teste: 'enviar',
  wa_teste: 'enviar', aurea_start: 'enviar', import_candidates: 'enviar',

  // --- configuracao pesada ---
  settings_save: 'ajustes', aurea_config_save: 'ajustes', wa_conectar: 'ajustes',
  wa_recriar: 'ajustes', wa_limpar: 'ajustes', wa_desconectar: 'ajustes',
  wa_webhook: 'ajustes', wa_qr: 'ajustes', wa_diagnostico: 'ajustes',

  // --- gestao de usuarios: so o dono ---
  usuarios: 'usuarios', usuario_salvar: 'usuarios', usuario_excluir: 'usuarios',
  usuario_senha: 'usuarios', auditoria: 'usuarios',
  vagas: 'ver', vaga_salvar: 'mexer', vaga_excluir: 'mexer', vaga_ordem: 'mexer',
  curriculo_link: 'ver',

  // --- financeiro: so quem cuida do dinheiro ---
  fin_lista: 'financeiro', fin_resumo: 'financeiro', fin_relatorio: 'financeiro',
  fin_salvar: 'financeiro_mexer', fin_excluir: 'financeiro_mexer',

  // --- Space Colaborador: libera dinheiro de verdade, mesma tranca ---
  sp_painel: 'financeiro',
  sp_voucher_salvar: 'financeiro_mexer', sp_liberar: 'financeiro_mexer',
  sp_cancelar: 'financeiro_mexer', sp_conferir: 'financeiro_mexer'
};

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
  if (exige === 'enviar') return 'O seu acesso (' + nome + ') não permite disparar mensagens.';
  if (exige === 'ajustes') return 'O seu acesso (' + nome + ') não permite mudar as configurações.';
  return 'O seu acesso (' + nome + ') é só de consulta — esta ação não é permitida.';
}

// O que a tela deve mostrar para cada papel. Serve para esconder menu,
// mas quem realmente barra e o servidor.
function menuDoPapel(papel) {
  if (papel === 'dono') {
    return ['dashboard', 'vagas', 'triagem', 'candidatos', 'prequalificacao', 'aurea', 'preonboarding',
      'colaboradores', 'avisos', 'space', 'conteudo', 'quiz', 'mensagens',
      'financeiro', 'findash', 'ajustes', 'usuarios'];
  }
  if (papel === 'rh') {
    return ['dashboard', 'vagas', 'triagem', 'candidatos', 'prequalificacao', 'aurea', 'preonboarding',
      'colaboradores', 'avisos', 'space', 'conteudo', 'quiz', 'mensagens',
      'financeiro', 'findash', 'ajustes'];
  }
  if (papel === 'avaliador') {
    return ['dashboard', 'vagas', 'triagem', 'candidatos', 'quiz', 'conteudo'];
  }
  return ['dashboard', 'vagas', 'triagem', 'candidatos', 'colaboradores', 'conteudo', 'quiz'];
}

module.exports = { PAPEIS, NOMES, DESCRICOES, ACOES, permite, recado, menuDoPapel, papelValido };
