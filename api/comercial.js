// ============================================================
// COMERCIAL — SIMULAÇÕES
//
// Um campo de treino para o time comercial. SDRs cadastram leads
// de mentira, marcam reunião, anotam se a pessoa apareceu e se o
// lead presta. No fim, um painel mostra quem agendou quanto.
//
// DUAS REGRAS QUE MANDAM NESTE ARQUIVO:
//
// 1. ISTO É TREINO, NÃO É O CRM.
//    As duas tabelas se chamam sim_participantes e sim_leads, e
//    este arquivo não lê nem escreve em finance_customers,
//    op_clientes ou candidates. Nenhuma simulação muda a carteira
//    de verdade — nem por acidente, porque o caminho não existe.
//
// 2. QUEM DECIDE O QUE A PESSOA VÊ É O DONO DO REGISTRO.
//    O papel (dono, rh, leitura...) não resolve sozinho: dois
//    usuários com o papel "leitura" podem ser SDRs diferentes,
//    cada um com a sua carteira. Então toda ação passa por
//    `cracha()`, que responde duas coisas: esta pessoa gerencia a
//    simulação inteira, ou ela é um participante? E, se for
//    participante, mexe só no que é dela.
//    Esconder botão na tela é gentileza. A tranca é aqui.
// ============================================================
'use strict';

const db = require('./_lib/db');
const u = require('./_lib/util');
const porta = require('./_lib/porta');
const perms = require('./_lib/perms');

const FUNCOES = ['sdr', 'closer'];
const FUNCOES_NOME = { sdr: 'SDR', closer: 'Closer' };

const COMPARECIMENTO = ['aguardando', 'compareceu', 'nao_compareceu'];
const COMPARECIMENTO_NOME = {
  aguardando: 'Aguardando reunião',
  compareceu: 'Compareceu',
  nao_compareceu: 'Não compareceu'
};

const QUALIFICACAO = ['pendente', 'sim', 'nao'];
const QUALIFICACAO_NOME = {
  pendente: 'Pendente de avaliação',
  sim: 'Qualificado',
  nao: 'Não qualificado'
};

/* ---------------- ajudantes ---------------- */

function limpa(v, max) {
  const t = String(v == null ? '' : v).trim().replace(/[ \t]+/g, ' ');
  return t ? t.slice(0, max || 160) : '';
}
function limpaTexto(v, max) {           // preserva quebra de linha
  const t = String(v == null ? '' : v).trim();
  return t ? t.slice(0, max || 4000) : '';
}
function umDe(v, lista, padrao) {
  const x = String(v == null ? '' : v).trim().toLowerCase();
  return lista.indexOf(x) >= 0 ? x : padrao;
}
function eSim(v) { return v === true || v === 'true' || v === 1 || v === '1' || v === 'sim'; }

// hoje em São Paulo — o servidor roda em UTC
function hojeSP() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}
function eData(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')); }
function eHora(v) { return /^\d{2}:\d{2}$/.test(String(v || '')); }

/* O CNPJ: guarda só os números, mas confere o dígito antes.
   Campo opcional — em branco passa. Preenchido errado, não: um CNPJ
   inventado no treino vira um CNPJ inventado no sistema de verdade
   quando a pessoa levar o hábito para o trabalho. */
function soNumeros(v) { return String(v == null ? '' : v).replace(/\D/g, ''); }

function cnpjVale(num) {
  if (num.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(num)) return false;        // 00000000000000 e companhia
  const digito = function (ate) {
    const pesos = ate === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
                             : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let soma = 0;
    for (let i = 0; i < ate; i++) soma += Number(num[i]) * pesos[i];
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return digito(12) === Number(num[12]) && digito(13) === Number(num[13]);
}

/* ------------------------------------------------------------
   O PERÍODO

   Um filtro de período precisa de uma regra clara sobre QUAL data
   ele olha, senão os números não fecham com nada.

   A regra aqui: sempre a data de CADASTRO do lead. É a única data
   que todo lead tem — "agendados" e "compareceram" são recortes
   dos mesmos leads, e filtrar cada indicador por uma data
   diferente faria "agendados" ser maior que "total de leads" em
   certos períodos, o que é absurdo na tela.
   ------------------------------------------------------------ */
function periodoDe(params) {
  const hoje = hojeSP();
  const dia = function (base, passo) {
    const d = new Date(base + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + passo);
    return d.toISOString().slice(0, 10);
  };

  const faixa = String(params.faixa || '').toLowerCase();

  if (faixa === 'hoje') {
    return { tipo: 'hoje', de: hoje, ate: hoje, rotulo: 'Hoje' };
  }
  if (faixa === 'semana') {
    const base = new Date(hoje + 'T12:00:00Z');
    const diaSemana = (base.getUTCDay() + 6) % 7;          // segunda = 0
    const de = dia(hoje, -diaSemana);
    return { tipo: 'semana', de: de, ate: dia(de, 6), rotulo: 'Esta semana' };
  }
  if (faixa === 'mes') {
    const de = hoje.slice(0, 8) + '01';
    const ultimo = new Date(Date.UTC(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)), 0)).getUTCDate();
    return { tipo: 'mes', de: de, ate: hoje.slice(0, 8) + String(ultimo).padStart(2, '0'), rotulo: 'Este mês' };
  }
  if (eData(params.de) && eData(params.ate)) {
    const de = params.de <= params.ate ? params.de : params.ate;
    const ate = params.de <= params.ate ? params.ate : params.de;
    return { tipo: 'personalizado', de: de, ate: ate, rotulo: brCurta(de) + ' a ' + brCurta(ate) };
  }
  return { tipo: 'tudo', de: null, ate: null, rotulo: 'Desde o início' };
}

function brCurta(iso) {
  const p = String(iso || '').slice(0, 10).split('-');
  return p.length === 3 ? p[2] + '/' + p[1] : iso;
}

/* O lead cai no período? Compara só a parte da DATA, em São Paulo —
   comparar o timestamp cru deixaria um lead das 22h de terça contando
   como quarta-feira, porque o banco guarda em UTC. */
function diaSP(iso) {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date(iso));
  } catch (e) { return String(iso).slice(0, 10); }
}

function noPeriodo(lead, periodo) {
  if (!periodo.de || !periodo.ate) return true;
  const d = diaSP(lead.created_at);
  return !!d && d >= periodo.de && d <= periodo.ate;
}

/* ------------------------------------------------------------
   O CRACHÁ

   Responde, para a pessoa que está batendo na porta:
     gerente  — manda na simulação inteira (Dono ou RH)
     eu       — o participante que ela é, se for algum
   ------------------------------------------------------------ */
async function cracha(aberta) {
  const gerente = perms.permite(aberta.papel, 'cm_participante_salvar');
  const uid = aberta.session && aberta.session.uid;

  let eu = null;
  if (uid) {
    eu = await db.selectOne('sim_participantes', {
      user_id: 'eq.' + uid, ativo: 'is.true', select: '*'
    });
  }
  return { gerente: gerente, eu: eu, uid: uid || null };
}

// Pode olhar a carteira deste participante?
function podeVer(c, participanteId) {
  if (c.gerente) return true;
  return !!(c.eu && c.eu.id === participanteId);
}

/* ---------------- leitura ---------------- */

async function participantes() {
  return db.select('sim_participantes', { ativo: 'is.true', order: 'nome.asc', select: '*' });
}

async function leadsDe(participanteIds) {
  if (!participanteIds.length) return [];
  return db.select('sim_leads', {
    participante_id: 'in.(' + participanteIds.join(',') + ')',
    excluido_em: 'is.null',
    order: 'created_at.desc',
    select: '*'
  });
}

function leadParaTela(l, dono) {
  return {
    id: l.id,
    participante_id: l.participante_id,
    sdr: dono ? dono.nome : '—',
    sdr_funcao: dono ? dono.funcao : null,
    nome: l.nome,
    contato: l.contato || '',
    cidade: l.cidade || '',
    cnpj: l.cnpj || '',
    cnpj_bonito: cnpjBonito(l.cnpj),
    nicho: l.nicho || '',
    agendado: l.agendado === true,
    agendado_em: l.agendado_em || null,
    comparecimento: l.comparecimento || 'aguardando',
    comparecimento_nome: COMPARECIMENTO_NOME[l.comparecimento] || l.comparecimento,
    observacoes: l.observacoes || '',
    qualificacao: l.qualificacao || 'pendente',
    qualificacao_nome: QUALIFICACAO_NOME[l.qualificacao] || l.qualificacao,
    criado_em: l.created_at
  };
}

function cnpjBonito(v) {
  const n = soNumeros(v);
  if (n.length !== 14) return v || '';
  return n.slice(0, 2) + '.' + n.slice(2, 5) + '.' + n.slice(5, 8) + '/' + n.slice(8, 12) + '-' + n.slice(12);
}

/* Os cinco números. Cada lead conta UMA vez em cada indicador.
   "Aguardando" não é falta: só entra em não_compareceu quem foi
   marcado como não compareceu de verdade. */
function conta(leads) {
  const n = { leads: 0, agendados: 0, compareceram: 0, nao_compareceram: 0, qualificados: 0 };
  leads.forEach(function (l) {
    n.leads++;
    if (l.agendado === true) n.agendados++;
    if (l.comparecimento === 'compareceu') n.compareceram++;
    if (l.comparecimento === 'nao_compareceu') n.nao_compareceram++;
    if (l.qualificacao === 'sim') n.qualificados++;
  });
  return n;
}

/* ============================================================
   as rotas
   ============================================================ */
module.exports = async function handler(req, res) {
  u.setBaseFromReq(req);
  const url = new URL(req.url, 'http://x');
  const action = url.searchParams.get('action') || '';
  const params = Object.fromEntries(url.searchParams.entries());

  try {
    const aberta = await porta.abrir(req, res, action);
    if (!aberta) return;
    const c = await cracha(aberta);

    // Quem não gerencia e não é participante não tem o que fazer aqui.
    // A tela já esconde o menu; isto é a tranca de verdade.
    if (!c.gerente && !c.eu) {
      return u.fail(res, 403, 'Você ainda não foi cadastrado como participante da simulação.');
    }

    // ---------------------------------------------- quem participa
    if (action === 'cm_participantes') {
      const todos = await participantes();
      const visiveis = c.gerente ? todos : todos.filter(function (p) { return p.id === c.eu.id; });
      const leads = await leadsDe(visiveis.map(function (p) { return p.id; }));
      const periodo = periodoDe(params);

      const porPart = {};
      leads.forEach(function (l) {
        if (!noPeriodo(l, periodo)) return;
        (porPart[l.participante_id] || (porPart[l.participante_id] = [])).push(l);
      });

      return u.ok(res, {
        participantes: visiveis.map(function (p) {
          return {
            id: p.id, nome: p.nome, funcao: p.funcao,
            funcao_nome: FUNCOES_NOME[p.funcao] || p.funcao,
            user_id: p.user_id || null,
            observacao: p.observacao || '',
            numeros: conta(porPart[p.id] || [])
          };
        }),
        eu: c.eu ? { id: c.eu.id, nome: c.eu.nome, funcao: c.eu.funcao } : null,
        gerente: c.gerente,
        funcoes: FUNCOES, funcoes_nome: FUNCOES_NOME,
        periodo: periodo
      });
    }

    // ---------------------------------------------- o painel de um SDR
    if (action === 'cm_painel') {
      const id = String(params.id || (c.eu && c.eu.id) || '');
      if (!id) return u.fail(res, 400, 'Diga de qual participante é o painel.');
      if (!podeVer(c, id)) {
        return u.fail(res, 403, 'Este painel é de outro participante.');
      }
      const p = await db.selectOne('sim_participantes', { id: 'eq.' + id, select: '*' });
      if (!p) return u.fail(res, 404, 'Participante não encontrado.');

      const leads = await leadsDe([p.id]);
      const periodo = periodoDe(params);
      const doPeriodo = leads.filter(function (l) { return noPeriodo(l, periodo); });

      return u.ok(res, {
        participante: {
          id: p.id, nome: p.nome, funcao: p.funcao,
          funcao_nome: FUNCOES_NOME[p.funcao] || p.funcao
        },
        // quem abriu pode MEXER nesta carteira? (gerente, ou o próprio dono)
        posso_mexer: c.gerente || (!!c.eu && c.eu.id === p.id),
        numeros: conta(doPeriodo),
        leads: doPeriodo.map(function (l) { return leadParaTela(l, p); }),
        periodo: periodo,
        comparecimento: COMPARECIMENTO, comparecimento_nome: COMPARECIMENTO_NOME,
        qualificacao: QUALIFICACAO, qualificacao_nome: QUALIFICACAO_NOME
      });
    }

    // ---------------------------------------------- o dashboard
    if (action === 'cm_dashboard') {
      const todos = await participantes();
      const visiveis = c.gerente ? todos : todos.filter(function (p) { return p.id === c.eu.id; });

      // O dashboard é dos SDRs. Closer tem perfil e acesso, mas não
      // entra nesta conta: misturar as duas funções faria a média de
      // agendamento mentir sobre as duas.
      const sdrs = visiveis.filter(function (p) { return p.funcao === 'sdr'; });

      const filtro = String(params.participante_id || '');
      const alvos = filtro ? sdrs.filter(function (p) { return p.id === filtro; }) : sdrs;

      const leads = await leadsDe(alvos.map(function (p) { return p.id; }));
      const periodo = periodoDe(params);
      const doPeriodo = leads.filter(function (l) { return noPeriodo(l, periodo); });

      const porPart = {};
      doPeriodo.forEach(function (l) {
        (porPart[l.participante_id] || (porPart[l.participante_id] = [])).push(l);
      });

      return u.ok(res, {
        total: conta(doPeriodo),
        por_sdr: alvos.map(function (p) {
          return Object.assign(
            { id: p.id, nome: p.nome, funcao: p.funcao },
            conta(porPart[p.id] || [])
          );
        }).sort(function (a, b) { return b.leads - a.leads || a.nome.localeCompare(b.nome); }),
        sdrs: sdrs.map(function (p) { return { id: p.id, nome: p.nome }; }),
        closers: visiveis.filter(function (p) { return p.funcao === 'closer'; })
          .map(function (p) { return { id: p.id, nome: p.nome }; }),
        gerente: c.gerente,
        periodo: periodo,
        hoje: hojeSP()
      });
    }

    // ---------------------------------------------- contas que podem virar participante
    if (action === 'cm_usuarios') {
      const usuarios = await db.select('panel_users', {
        active: 'is.true', order: 'name.asc', select: 'id,name,email,role'
      });
      const jaSao = await participantes();
      const ocupados = {};
      jaSao.forEach(function (p) { if (p.user_id) ocupados[p.user_id] = p.nome; });
      return u.ok(res, {
        usuarios: usuarios.map(function (x) {
          return {
            id: x.id, nome: x.name, email: x.email, papel: x.role,
            papel_nome: perms.NOMES[x.role] || x.role,
            ja_participa: ocupados[x.id] || null
          };
        })
      });
    }

    // ---------------------------------------------- cadastrar participante
    if (action === 'cm_participante_salvar') {
      if (req.method !== 'POST') return u.fail(res, 405, 'Metodo nao permitido');
      const body = await u.readBody(req);

      const nome = limpa(body.nome, 80);
      if (!nome) return u.fail(res, 400, 'Escreva o nome do participante.');

      const campos = {
        nome: nome,
        funcao: umDe(body.funcao, FUNCOES, 'sdr'),
        user_id: body.user_id ? String(body.user_id) : null,
        observacao: limpaTexto(body.observacao, 500) || null,
        updated_at: new Date().toISOString()
      };

      // A conta precisa existir e estar ativa. Não se cria acesso por
      // aqui: quem cria usuário é a tela de Usuários, com a permissão
      // dela. Este módulo só aponta para uma conta que já existe.
      if (campos.user_id) {
        const conta = await db.selectOne('panel_users', {
          id: 'eq.' + campos.user_id, select: 'id,active'
        });
        if (!conta) return u.fail(res, 400, 'Essa conta de acesso não existe.');
        if (conta.active === false) return u.fail(res, 400, 'Essa conta está desativada.');
      }

      try {
        if (body.id) {
          const antes = await db.selectOne('sim_participantes', { id: 'eq.' + String(body.id), select: '*' });
          if (!antes) return u.fail(res, 404, 'Participante não encontrado.');
          const row = await db.update('sim_participantes', campos, { id: 'eq.' + antes.id });
          return u.ok(res, { participante: row });
        }
        const row = await db.insert('sim_participantes', campos);
        return u.ok(res, { participante: row });
      } catch (e) {
        return u.fail(res, 409, 'Essa conta já está vinculada a outro participante.');
      }
    }

    // ---------------------------------------------- desativar participante
    if (action === 'cm_participante_excluir') {
      if (req.method !== 'POST') return u.fail(res, 405, 'Metodo nao permitido');
      const body = await u.readBody(req);
      const p = await db.selectOne('sim_participantes', { id: 'eq.' + String(body.id || ''), select: '*' });
      if (!p) return u.fail(res, 404, 'Participante não encontrado.');
      // Desativa, não apaga: os leads que ele cadastrou continuam
      // contando a história da simulação.
      await db.update('sim_participantes',
        { ativo: false, user_id: null, updated_at: new Date().toISOString() },
        { id: 'eq.' + p.id });
      return u.ok(res, {});
    }

    // ---------------------------------------------- criar/editar lead
    if (action === 'cm_lead_salvar') {
      if (req.method !== 'POST') return u.fail(res, 405, 'Metodo nao permitido');
      const body = await u.readBody(req);

      // DE QUEM É O LEAD. Esta é a linha mais importante do arquivo.
      // A origem NÃO vem do que o navegador mandou quando quem está
      // salvando é um participante: vem do crachá. Assim ninguém
      // atribui lead à carteira de outro SDR, nem por engano nem de
      // propósito. Só o gerente escolhe o dono.
      let participanteId = c.eu ? c.eu.id : null;
      if (c.gerente && body.participante_id) participanteId = String(body.participante_id);
      if (!participanteId) return u.fail(res, 400, 'Diga de qual SDR é este lead.');

      const dono = await db.selectOne('sim_participantes', {
        id: 'eq.' + participanteId, ativo: 'is.true', select: '*'
      });
      if (!dono) return u.fail(res, 404, 'Participante não encontrado.');
      if (!podeVer(c, dono.id)) {
        return u.fail(res, 403, 'Você só pode cadastrar leads na sua própria simulação.');
      }

      const nome = limpa(body.nome, 160);
      if (!nome) return u.fail(res, 400, 'Escreva o nome do lead.');

      const cnpj = soNumeros(body.cnpj);
      if (cnpj && !cnpjVale(cnpj)) {
        return u.fail(res, 400, 'Esse CNPJ não é válido. Confira os números (ou deixe em branco).');
      }

      const agendado = eSim(body.agendado);
      let agendadoEm = null;
      if (agendado) {
        const data = String(body.agendado_data || '');
        const hora = String(body.agendado_hora || '');
        if (!eData(data)) return u.fail(res, 400, 'Escolha a data da reunião.');
        if (!eHora(hora)) return u.fail(res, 400, 'Escolha o horário da reunião.');
        // -03:00 é o fuso de São Paulo. Guardar sem fuso faria a
        // reunião das 9h aparecer às 6h para quem lesse em UTC.
        agendadoEm = data + 'T' + hora + ':00-03:00';
      }

      // Comparecimento só faz sentido com reunião marcada. Sem
      // agendamento ele volta para "aguardando" — e não fica um
      // "compareceu" órfão inflando o indicador.
      let comparecimento = umDe(body.comparecimento, COMPARECIMENTO, 'aguardando');
      if (!agendado) comparecimento = 'aguardando';

      const campos = {
        participante_id: dono.id,
        nome: nome,
        contato: limpa(body.contato, 40) || null,
        cidade: limpa(body.cidade, 80) || null,
        cnpj: cnpj || null,
        nicho: limpa(body.nicho, 80) || null,
        agendado: agendado,
        agendado_em: agendadoEm,
        comparecimento: comparecimento,
        observacoes: limpaTexto(body.observacoes, 4000) || null,
        qualificacao: umDe(body.qualificacao, QUALIFICACAO, 'pendente'),
        updated_at: new Date().toISOString()
      };

      if (body.id) {
        const antes = await db.selectOne('sim_leads', { id: 'eq.' + String(body.id), select: '*' });
        if (!antes || antes.excluido_em) return u.fail(res, 404, 'Lead não encontrado.');
        if (!podeVer(c, antes.participante_id)) {
          return u.fail(res, 403, 'Esse lead é de outro participante.');
        }
        // Participante não muda o dono do lead nem editando.
        if (!c.gerente) campos.participante_id = antes.participante_id;
        const row = await db.update('sim_leads', campos, { id: 'eq.' + antes.id });
        return u.ok(res, { lead: leadParaTela(row, dono) });
      }

      const row = await db.insert('sim_leads', campos);
      return u.ok(res, { lead: leadParaTela(row, dono) });
    }

    // ---------------------------------------------- mudar UM campo do lead
    // A listagem muda comparecimento e qualificação direto na linha.
    // Mandar a ficha inteira só para trocar uma palavra seria pedir
    // para sobrescrever o que outra pessoa acabou de editar.
    if (action === 'cm_lead_campo') {
      if (req.method !== 'POST') return u.fail(res, 405, 'Metodo nao permitido');
      const body = await u.readBody(req);
      const lead = await db.selectOne('sim_leads', { id: 'eq.' + String(body.id || ''), select: '*' });
      if (!lead || lead.excluido_em) return u.fail(res, 404, 'Lead não encontrado.');
      if (!podeVer(c, lead.participante_id)) {
        return u.fail(res, 403, 'Esse lead é de outro participante.');
      }

      const campos = { updated_at: new Date().toISOString() };
      if (body.comparecimento !== undefined) {
        if (!lead.agendado) {
          return u.fail(res, 400, 'Marque a reunião antes de registrar o comparecimento.');
        }
        campos.comparecimento = umDe(body.comparecimento, COMPARECIMENTO, 'aguardando');
      }
      if (body.qualificacao !== undefined) {
        campos.qualificacao = umDe(body.qualificacao, QUALIFICACAO, 'pendente');
      }
      if (Object.keys(campos).length === 1) return u.fail(res, 400, 'Nada para mudar.');

      const row = await db.update('sim_leads', campos, { id: 'eq.' + lead.id });
      const dono = await db.selectOne('sim_participantes', { id: 'eq.' + lead.participante_id, select: '*' });
      return u.ok(res, { lead: leadParaTela(row, dono) });
    }

    // ---------------------------------------------- apagar lead
    if (action === 'cm_lead_excluir') {
      if (req.method !== 'POST') return u.fail(res, 405, 'Metodo nao permitido');
      const body = await u.readBody(req);
      const lead = await db.selectOne('sim_leads', { id: 'eq.' + String(body.id || ''), select: '*' });
      if (!lead || lead.excluido_em) return u.fail(res, 404, 'Lead não encontrado.');
      if (!podeVer(c, lead.participante_id)) {
        return u.fail(res, 403, 'Esse lead é de outro participante.');
      }
      await db.update('sim_leads',
        { excluido_em: new Date().toISOString(), updated_at: new Date().toISOString() },
        { id: 'eq.' + lead.id });
      return u.ok(res, {});
    }

    return u.fail(res, 404, 'Acao desconhecida: ' + action);
  } catch (e) {
    console.error('[comercial]', action, e);
    return u.fail(res, 500, e.message || 'Erro interno');
  }
};

module.exports.FUNCOES = FUNCOES;
module.exports.COMPARECIMENTO = COMPARECIMENTO;
module.exports.QUALIFICACAO = QUALIFICACAO;
module.exports.cnpjVale = cnpjVale;
module.exports.periodoDe = periodoDe;
