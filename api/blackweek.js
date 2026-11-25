// ============================================================
// BLACK WEEK START 2026 — LEADS DA LANDING PAGE
//
// A pagina publica /black-week tem um formulario: nome, WhatsApp e
// e-mail. Este arquivo recebe o envio, guarda o lead em bw_leads e
// dispara a mensagem automatica de WhatsApp pela mesma Evolution
// que o resto do sistema usa. O painel le os leads na aba
// Comercial > BLACK FRIDAY.
//
// TRES REGRAS QUE MANDAM NESTE ARQUIVO:
//
// 1. ARQUIVO SEPARADO, TABELA SEPARADA.
//    So le e escreve em bw_leads e na chave "black_week" de
//    settings. Nao encosta em candidates, finance_*, op_* nem sim_*.
//
// 2. A ROTA DO FORMULARIO E PUBLICA — ENTAO TEM FREIO.
//    Qualquer pessoa na internet pode chamar bw_lead. Sem freio,
//    isso viraria um jeito de fazer o WhatsApp da Start mandar
//    mensagem para numero alheio. Por isso: campo-isca contra robo,
//    o mesmo numero nao recebe duas mensagens em 24h, e existe um
//    teto de envios automaticos por janela. Passou do teto, o lead e
//    guardado do mesmo jeito e a mensagem fica como "pendente_manual".
//
// 3. O PRAZO VALE NO SERVIDOR.
//    A pagina esconde a oferta quando o cronometro zera, mas quem
//    manda e esta data: depois dela o formulario nao aceita mais.
// ============================================================
'use strict';

const db = require('./_lib/db');
const u = require('./_lib/util');
const porta = require('./_lib/porta');
const send = require('./_lib/send');

// 30/11/2026 23:59:59 em America/Sao_Paulo (UTC-3, sem horario de verao)
const FIM = Date.UTC(2026, 11, 1, 2, 59, 59);

const STATUS = ['novo', 'em_contato', 'fechado', 'descartado'];
const STATUS_NOME = {
  novo: 'Novo', em_contato: 'Em contato', fechado: 'Fechado', descartado: 'Descartado'
};

// Freio dos envios automaticos: no maximo TETO mensagens a cada JANELA.
const JANELA_MIN = 10;
const TETO_ENVIOS = 40;

const MENSAGEM_PADRAO =
  'Olá, {{primeiro_nome}}! Aqui é da Start Digital. ⚡\n\n' +
  'Recebemos o seu interesse na *Black Week Start 2026*: a assessoria completa de ' +
  'marketing por *R$ 998,00*, com o primeiro pagamento só em *janeiro de 2027*.\n\n' +
  'A condição é exclusiva para empresas de Praia Grande e Santos e vale até 30/11.\n\n' +
  'Em instantes alguém do nosso time comercial fala com você por aqui. ' +
  'Se preferir, já pode responder esta mensagem contando um pouco sobre a sua empresa.';

/* ---------------- ajudantes ---------------- */

function limpa(v, max) {
  const t = String(v == null ? '' : v).trim().replace(/\s+/g, ' ');
  return t ? t.slice(0, max || 160) : '';
}
function limpaTexto(v, max) {           // preserva quebra de linha
  const t = String(v == null ? '' : v).trim();
  return t ? t.slice(0, max || 2000) : '';
}
function eSim(v) { return v === true || v === 'true' || v === 1 || v === '1' || v === 'sim'; }

function aberta() { return Date.now() < FIM; }

// Celular ou fixo brasileiro com DDD: 10 ou 11 digitos, com ou sem o 55.
function telefoneValido(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.length >= 12 && d.indexOf('55') === 0) d = d.slice(2);
  if (d.charAt(0) === '0') d = d.slice(1);
  return d.length === 10 || d.length === 11;
}

async function config() {
  let salvo = {};
  try {
    const row = await db.selectOne('settings', { key: 'eq.black_week', select: 'value' });
    salvo = (row && row.value) || {};
  } catch (e) { /* sem config salva, valem os padroes */ }
  return {
    mensagem: salvo.mensagem || MENSAGEM_PADRAO,
    whatsapp_comercial: String(salvo.whatsapp_comercial || '').replace(/\D/g, ''),
    enviar_whatsapp: salvo.enviar_whatsapp !== false
  };
}

// A instancia do WhatsApp e a mesma do resto do sistema.
async function instanciaZap() {
  const a = await db.selectOne('settings', { key: 'eq.aurea', select: 'value' });
  if (a && a.value && a.value.instancia_whatsapp) return a.value.instancia_whatsapp;
  const w = await db.selectOne('settings', { key: 'eq.whatsapp', select: 'value' });
  return (w && w.value && w.value.instance) || process.env.EVOLUTION_INSTANCE || '';
}

// So o que e util para saber de onde o lead veio. Nada de guardar
// objeto arbitrario que chegou da internet.
function origemLimpa(o) {
  o = (o && typeof o === 'object') ? o : {};
  const fora = {};
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'referrer', 'botao']
    .forEach(function (k) {
      const v = limpa(o[k], 200);
      if (v) fora[k] = v;
    });
  return fora;
}

function leadParaTela(l) {
  return {
    id: l.id,
    created_at: l.created_at,
    nome: l.nome,
    whatsapp: l.whatsapp,
    email: l.email,
    origem: l.origem || {},
    status: l.status || 'novo',
    status_nome: STATUS_NOME[l.status] || STATUS_NOME.novo,
    wa_status: l.wa_status || null,
    wa_erro: l.wa_erro || null,
    wa_enviado_em: l.wa_enviado_em || null
  };
}

async function disparaMensagem(lead, cfg) {
  if (!cfg.enviar_whatsapp) return { status: 'desligado' };

  // freio: quantas mensagens automaticas ja sairam nesta janela?
  const desde = new Date(Date.now() - JANELA_MIN * 60000).toISOString();
  let recentes = 0;
  try {
    recentes = await db.count('bw_leads', { wa_enviado_em: 'gte.' + desde });
  } catch (e) { recentes = 0; }
  if (recentes >= TETO_ENVIOS) {
    return { status: 'pendente_manual', error: 'Muitos envios em pouco tempo: mensagem segurada para envio manual.' };
  }

  const texto = u.renderTemplate(cfg.mensagem, {
    nome: lead.nome,
    primeiro_nome: u.firstName(lead.nome)
  });
  const instancia = await instanciaZap();
  return send.sendWhatsApp({ to: lead.whatsapp, text: texto, instance: instancia });
}

// ============================================================
module.exports = async function handler(req, res) {
  u.setBaseFromReq(req);
  const url = new URL(req.url, 'http://x');
  const action = url.searchParams.get('action') || '';

  try {
    // ------------------------------------------------ 1) PUBLICAS
    // O envio do formulario.
    if (action === 'bw_lead') {
      if (req.method !== 'POST') return u.fail(res, 405, 'Metodo nao permitido');
      if (!aberta()) return u.fail(res, 410, 'A Black Week Start foi encerrada.');
      const body = await u.readBody(req);
      const cfg = await config();

      // Campo-isca: gente nao ve, robo preenche. Responde "ok" para o
      // robo nao aprender, mas nao guarda nem envia nada.
      if (limpa(body.site, 200)) return u.ok(res, { whatsapp: cfg.whatsapp_comercial });

      const nome = limpa(body.nome, 120);
      const email = limpa(body.email, 160).toLowerCase();
      if (nome.length < 2) return u.fail(res, 400, 'Informe o seu nome.');
      if (!telefoneValido(body.whatsapp)) return u.fail(res, 400, 'Informe um WhatsApp válido, com DDD.');
      if (!u.isEmail(email)) return u.fail(res, 400, 'Informe um e-mail válido.');
      if (!eSim(body.consentimento)) {
        return u.fail(res, 400, 'Para enviar, é preciso autorizar o contato da Start Digital.');
      }
      const whatsapp = u.normalizePhone(body.whatsapp);

      // O mesmo numero nas ultimas 24h: guarda o envio novo (o
      // comercial ve que a pessoa voltou), mas nao manda a mensagem
      // automatica de novo.
      const ontem = new Date(Date.now() - 24 * 3600000).toISOString();
      const repetido = await db.selectOne('bw_leads', {
        whatsapp: 'eq.' + whatsapp, created_at: 'gte.' + ontem, select: 'id'
      });

      const lead = await db.insert('bw_leads', {
        created_at: new Date().toISOString(),
        nome: nome,
        whatsapp: whatsapp,
        email: email,
        consentimento: true,
        origem: origemLimpa(body.origem),
        status: 'novo'
      });

      let envio;
      if (repetido) {
        envio = { status: 'repetido' };
      } else {
        try { envio = await disparaMensagem(lead, cfg); }
        catch (e) { envio = { status: 'erro', error: e.message }; }
      }
      // O lead ja esta guardado. Se o registro do envio falhar, a
      // pessoa nao pode receber erro por causa disso.
      try {
        await db.update('bw_leads', {
          wa_status: envio.status || 'erro',
          wa_erro: envio.error ? String(envio.error).slice(0, 400) : null,
          wa_enviado_em: envio.status === 'enviado' ? new Date().toISOString() : null
        }, { id: 'eq.' + lead.id });
      } catch (e) { /* segue */ }

      return u.ok(res, { whatsapp: cfg.whatsapp_comercial });
    }

    // ------------------------------------------------ 2) PAINEL
    const acesso = await porta.abrir(req, res, action);
    if (!acesso) return;

    if (action === 'cm_bw_leads') {
      const linhas = await db.select('bw_leads', { select: '*', order: 'created_at.desc', limit: 1000 });
      const leads = (linhas || []).map(leadParaTela);
      const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
      const diaSP = function (iso) {
        return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(iso));
      };
      return u.ok(res, {
        leads: leads,
        totais: {
          total: leads.length,
          hoje: leads.filter(function (l) { return l.created_at && diaSP(l.created_at) === hoje; }).length,
          wa_enviados: leads.filter(function (l) { return l.wa_status === 'enviado'; }).length,
          wa_pendentes: leads.filter(function (l) {
            return l.wa_status === 'erro' || l.wa_status === 'pendente_manual';
          }).length
        },
        config: await config(),
        mensagem_padrao: MENSAGEM_PADRAO,
        status: STATUS, status_nome: STATUS_NOME,
        aberta: aberta(), fim: FIM,
        link: u.appUrl() + '/black-week',
        whatsapp_pronto: send.providerStatus().whatsapp === true
      });
    }

    if (action === 'cm_bw_config') {
      if (req.method !== 'POST') return u.fail(res, 405, 'Metodo nao permitido');
      const body = await u.readBody(req);
      const numero = String(body.whatsapp_comercial || '').replace(/\D/g, '');
      if (numero && !telefoneValido(numero)) {
        return u.fail(res, 400, 'WhatsApp comercial inválido. Use DDD + número.');
      }
      const novo = {
        mensagem: limpaTexto(body.mensagem, 2000) || MENSAGEM_PADRAO,
        whatsapp_comercial: numero ? u.normalizePhone(numero) : '',
        enviar_whatsapp: body.enviar_whatsapp === undefined ? true : eSim(body.enviar_whatsapp)
      };
      await db.upsert('settings', { key: 'black_week', value: novo }, 'key');
      return u.ok(res, { config: novo });
    }

    if (action === 'cm_bw_lead_status') {
      if (req.method !== 'POST') return u.fail(res, 405, 'Metodo nao permitido');
      const body = await u.readBody(req);
      const id = limpa(body.id, 60);
      if (!/^[0-9a-f-]{36}$/i.test(id)) return u.fail(res, 400, 'Lead não encontrado.');
      if (STATUS.indexOf(body.status) < 0) return u.fail(res, 400, 'Situação inválida.');
      const lead = await db.update('bw_leads', { status: body.status }, { id: 'eq.' + id });
      if (!lead) return u.fail(res, 404, 'Lead não encontrado.');
      return u.ok(res, { lead: leadParaTela(lead) });
    }

    // Reenvia a mensagem automatica para um lead (quando deu erro ou
    // ficou pendente). E um disparo: exige permissao de gestao.
    if (action === 'cm_bw_reenviar') {
      if (req.method !== 'POST') return u.fail(res, 405, 'Metodo nao permitido');
      const body = await u.readBody(req);
      const id = limpa(body.id, 60);
      if (!/^[0-9a-f-]{36}$/i.test(id)) return u.fail(res, 400, 'Lead não encontrado.');
      const lead = await db.selectOne('bw_leads', { id: 'eq.' + id, select: '*' });
      if (!lead) return u.fail(res, 404, 'Lead não encontrado.');
      const cfg = await config();
      cfg.enviar_whatsapp = true;        // pedido explicito do painel
      const envio = await disparaMensagem(lead, cfg);
      const salvo = await db.update('bw_leads', {
        wa_status: envio.status || 'erro',
        wa_erro: envio.error ? String(envio.error).slice(0, 400) : null,
        wa_enviado_em: envio.status === 'enviado' ? new Date().toISOString() : (lead.wa_enviado_em || null)
      }, { id: 'eq.' + id });
      return u.ok(res, { lead: leadParaTela(salvo || lead), envio: { status: envio.status, error: envio.error || null } });
    }

    return u.fail(res, 404, 'Acao desconhecida');
  } catch (e) {
    return u.fail(res, 500, e.message || 'Erro interno');
  }
};

module.exports.FIM = FIM;
module.exports.MENSAGEM_PADRAO = MENSAGEM_PADRAO;
