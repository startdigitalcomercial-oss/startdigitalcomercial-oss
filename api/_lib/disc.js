// ============================================================
// Calculo e interpretacao do teste DISC
// ============================================================
'use strict';

const LETTERS = ['D', 'I', 'S', 'C'];

const PROFILES = {
  D: {
    nome: 'Dominância',
    apelido: 'Executor',
    resumo: 'Foco em resultado, ritmo rápido e disposição para decidir. Gosta de desafio, assume a frente e não trava diante de problema.',
    forcas: ['Decide rápido', 'Encara desafios de frente', 'Foco em meta e resultado', 'Assume responsabilidade'],
    atencao: ['Pode soar duro na comunicação', 'Impaciência com processo lento', 'Tende a atropelar detalhes'],
    como_gerir: 'Seja direto, traga o objetivo antes do caminho, dê autonomia e cobre resultado. Evite microgerenciar.'
  },
  I: {
    nome: 'Influência',
    apelido: 'Comunicador',
    resumo: 'Energia social alta, otimismo e facilidade para engajar pessoas. Aprende conversando e vende ideias com naturalidade.',
    forcas: ['Cria relacionamento rápido', 'Comunica e convence bem', 'Traz entusiasmo para o time', 'Boa adaptação a mudança'],
    atencao: ['Pode se perder em detalhes e prazos', 'Precisa de acompanhamento na organização', 'Tende a evitar conversa difícil'],
    como_gerir: 'Reconheça publicamente, dê espaço para falar e combine prazos por escrito. Checkpoints curtos funcionam melhor que prazos longos.'
  },
  S: {
    nome: 'Estabilidade',
    apelido: 'Planejador',
    resumo: 'Constância, paciência e lealdade. Sustenta rotina, cuida do time e entrega com regularidade sem precisar de holofote.',
    forcas: ['Muito confiável na rotina', 'Ótimo ouvinte e colaborativo', 'Paciente com processo e com pessoas', 'Gera estabilidade no time'],
    atencao: ['Resistência a mudança brusca', 'Dificuldade em dizer não', 'Pode demorar para expor discordância'],
    como_gerir: 'Explique o porquê das mudanças com antecedência, dê segurança e pergunte a opinião diretamente — ela nem sempre vem espontaneamente.'
  },
  C: {
    nome: 'Conformidade',
    apelido: 'Analista',
    resumo: 'Precisão, critério e apego à qualidade. Trabalha por dados, gosta de regra clara e entrega com padrão alto.',
    forcas: ['Atenção ao detalhe e à qualidade', 'Trabalha bem com dados e processo', 'Organizado e metódico', 'Faz as perguntas certas'],
    atencao: ['Perfeccionismo pode atrasar entrega', 'Pode travar sem informação completa', 'Costuma ser crítico consigo e com os outros'],
    como_gerir: 'Dê contexto, dados e critério de qualidade por escrito. Deixe claro o que é "bom o suficiente" para não virar perfeccionismo.'
  }
};

// answers: { "<posicao>": { more: "D", less: "C" } }
function score(answers, questions) {
  const more = { D: 0, I: 0, S: 0, C: 0 };
  const less = { D: 0, I: 0, S: 0, C: 0 };
  let answered = 0;

  const byPos = {};
  (questions || []).forEach(function (q) { byPos[String(q.position)] = q; });

  Object.keys(answers || {}).forEach(function (pos) {
    const a = answers[pos] || {};
    const q = byPos[String(pos)];
    if (!q) return;
    let counted = false;
    if (a.more && LETTERS.indexOf(a.more) >= 0) { more[a.more] += 1; counted = true; }
    if (a.less && LETTERS.indexOf(a.less) >= 0) { less[a.less] += 1; counted = true; }
    if (counted) answered += 1;
  });

  const net = {};
  LETTERS.forEach(function (L) { net[L] = more[L] - less[L]; });

  const ranked = LETTERS.slice().sort(function (a, b) {
    if (net[b] !== net[a]) return net[b] - net[a];
    return more[b] - more[a];
  });

  // Percentual relativo (base positiva) para o grafico
  const min = Math.min.apply(null, LETTERS.map(function (L) { return net[L]; }));
  const shifted = {};
  LETTERS.forEach(function (L) { shifted[L] = net[L] - min + 1; });
  const total = LETTERS.reduce(function (s, L) { return s + shifted[L]; }, 0);
  const percent = {};
  LETTERS.forEach(function (L) { percent[L] = Math.round((shifted[L] / total) * 100); });

  const primary = ranked[0];
  const secondary = ranked[1];

  return {
    answered: answered,
    total_questions: (questions || []).length,
    more: more,
    less: less,
    net: net,
    percent: percent,
    ranked: ranked,
    primary: primary,
    secondary: secondary,
    summary: buildSummary(primary, secondary),
    profiles: PROFILES
  };
}

function buildSummary(primary, secondary) {
  const p = PROFILES[primary];
  const s = PROFILES[secondary];
  if (!p) return '';
  let txt = 'Perfil predominante: ' + p.nome + ' (' + p.apelido + '). ' + p.resumo;
  if (s) {
    txt += ' Perfil de apoio: ' + s.nome + ' (' + s.apelido + '), o que costuma equilibrar o comportamento principal em situações de pressão.';
  }
  return txt;
}

module.exports = { score: score, PROFILES: PROFILES, LETTERS: LETTERS };
