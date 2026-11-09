// ============================================================
// AGENDA OPERACIONAL — as reuniões dos gestores com os clientes.
//
// Duas coisas moram aqui:
//   1. a agenda do sistema (reuniões, situação, indicadores)
//   2. a ponte com o Google Calendar (OAuth 2.0)
//
// Sobre ATRASADA x NÃO REALIZADA — é a confusão mais fácil de
// cometer e o documento pede para não cometer:
//   atrasada     = a hora passou e NINGUÉM disse o que aconteceu
//   não realizada = alguém disse que não aconteceu
// A primeira é uma conta feita com o relógio; a segunda é uma
// decisão registrada. Por isso "atrasada" não é um status no
// banco: é calculada na hora de mostrar.
//
// Sobre o Google: enquanto não existirem as credenciais, nada
// aqui finge que conecta. A tela diz o que falta.
// ============================================================
'use strict';

const crypto = require('crypto');
const db = require('./_lib/db');
const u = require('./_lib/util');
const porta = require('./_lib/porta');

const STATUS = ['agendada', 'realizada', 'nao_realizada', 'cancelada'];
const STATUS_NOME = {
  agendada: 'Agendada', realizada: 'Realizada',
  nao_realizada: 'Não realizada', cancelada: 'Cancelada'
};

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_API = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_ESCOPO = 'https://www.googleapis.com/auth/calendar.events.readonly ' +
  'https://www.googleapis.com/auth/userinfo.email';

function limpaTexto(v, max) {
  const t = String(v == null ? '' : v).trim().replace(/\s+/g, ' ');
  return t ? t.slice(0, max || 200) : '';
}
function eData(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')); }

function hojeSP() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

// O dia de uma reunião em São Paulo. Guardamos o instante exato em
// UTC; na hora de agrupar por dia, o que vale é o fuso daqui.
function diaSP(iso) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(iso));
}
function horaSP(iso) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit'
  }).format(new Date(iso));
}

// O período que a tela pediu. Padrão: o mês corrente.
function periodo(params) {
  const hoje = hojeSP();
  if (eData(params.de) && eData(params.ate)) {
    const de = params.de <= params.ate ? params.de : params.ate;
    const ate = params.de <= params.ate ? params.ate : params.de;
    return { de: de, ate: ate };
  }
  const ano = Number(params.ano) || Number(hoje.slice(0, 4));
  const mes = Math.min(Math.max(Number(params.mes) || Number(hoje.slice(5, 7)), 1), 12);
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return {
    mes: mes, ano: ano,
    de: ano + '-' + String(mes).padStart(2, '0') + '-01',
    ate: ano + '-' + String(mes).padStart(2, '0') + '-' + String(ultimo).padStart(2, '0')
  };
}

// ------------------------------------------------------------
// ATRASADA: a hora passou e ninguém disse o que aconteceu.
// ------------------------------------------------------------
function estaAtrasada(r, agoraISO) {
  if (r.status !== 'agendada') return false;
  const fim = r.fim || r.inicio;
  return String(fim) < agoraISO;
}

function paraTela(r, nomes, agoraISO) {
  const atrasada = estaAtrasada(r, agoraISO);
  return {
    id: r.id,
    titulo: r.titulo,
    cliente_id: r.cliente_id || null,
    cliente: r.cliente_id ? (nomes.clientes[r.cliente_id] || '—') : '',
    gestor_id: r.gestor_id || null,
    gestor: r.gestor_id ? (nomes.gestores[r.gestor_id] || '—') : '—',
    cor: r.gestor_id ? (nomes.cores[r.gestor_id] || 'azul') : 'azul',
    inicio: r.inicio, fim: r.fim || null,
    dia: diaSP(r.inicio),
    hora: horaSP(r.inicio) + (r.fim ? ' – ' + horaSP(r.fim) : ''),
    status: r.status, status_nome: STATUS_NOME[r.status] || r.status,
    atrasada: atrasada,
    link: r.link || '',
    observacao: r.observacao || '',
    origem: r.origem || 'sistema',
    externo_id: r.externo_id || null,
    resolvido_em: r.resolvido_em || null,
    resolvido_por: r.resolvido_por || ''
  };
}

async function nomesDeApoio() {
  const gestores = await db.select('op_gestores', { order: 'position.asc', select: 'id,nome,cor' });
  const clientes = await db.select('op_clientes', { excluido_em: 'is.null', order: 'nome.asc', select: 'id,nome,gestor_id' });
  const g = {}, cor = {}, c = {};
  gestores.forEach(function (x) { g[x.id] = x.nome; cor[x.id] = x.cor; });
  clientes.forEach(function (x) { c[x.id] = x.nome; });
  return { gestores: g, cores: cor, clientes: c, listaG: gestores, listaC: clientes };
}

/* ============================================================
   GOOGLE CALENDAR
   ============================================================ */
function googleConfigurado() {
  return !!(String(process.env.GOOGLE_CLIENT_ID || '').trim() &&
            String(process.env.GOOGLE_CLIENT_SECRET || '').trim());
}
function googleRedirect() {
  return u.appUrl() + '/api/agenda?action=google_callback';
}

// O "state" leva quem pediu a conexão, assinado. Sem assinatura,
// qualquer um poderia devolver um code e ligar a conta de outra
// pessoa. A chave é a mesma APP_SECRET do resto do sistema.
function selo(texto) {
  const chave = process.env.APP_SECRET || process.env.ADMIN_SECRET || 'start-rh-dev-secret';
  return crypto.createHmac('sha256', chave).update(String(texto)).digest('base64url');
}
function assinaEstado(dono) {
  const corpo = Buffer.from(JSON.stringify({ d: dono, t: Date.now() })).toString('base64url');
  return corpo + '.' + selo(corpo);
}
function leEstado(state) {
  const p = String(state || '').split('.');
  if (p.length !== 2) return null;
  if (!u.safeEqual(p[1], selo(p[0]))) return null;
  try {
    const dados = JSON.parse(Buffer.from(p[0], 'base64url').toString('utf8'));
    if (Date.now() - Number(dados.t) > 20 * 60 * 1000) return null;   // vale 20 min
    return dados.d;
  } catch (e) { return null; }
}

async function googleTrocaCodigo(code) {
  const r = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: googleRedirect(),
      grant_type: 'authorization_code'
    }).toString()
  });
  const dados = await r.json().catch(function () { return {}; });
  if (!r.ok) throw new Error(dados.error_description || dados.error || 'o Google recusou a autorização');
  return dados;
}

async function googleRenova(conta) {
  if (!conta.refresh_token) throw new Error('a conta precisa ser conectada de novo');
  const r = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: conta.refresh_token,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token'
    }).toString()
  });
  const dados = await r.json().catch(function () { return {}; });
  if (!r.ok) throw new Error(dados.error_description || dados.error || 'não deu para renovar o acesso');

  const expira = new Date(Date.now() + (Number(dados.expires_in || 3600) - 60) * 1000).toISOString();
  await db.update('op_google_contas', {
    access_token: dados.access_token, expira_em: expira, updated_at: new Date().toISOString()
  }, { id: 'eq.' + conta.id });
  return dados.access_token;
}

async function googleToken(conta) {
  if (conta.access_token && conta.expira_em && new Date(conta.expira_em) > new Date()) {
    return conta.access_token;
  }
  return await googleRenova(conta);
}

/* ============================================================ */
module.exports = async function handler(req, res) {
  u.setBaseFromReq(req);
  const url = new URL(req.url, 'http://x');
  const action = url.searchParams.get('action') || '';
  const params = Object.fromEntries(url.searchParams.entries());

  try {
    // ---------------------------------------------------------
    // A volta do Google. Esta porta NÃO leva crachá do painel: quem
    // chega aqui é o navegador vindo do Google. Quem garante que é
    // de verdade é o "state" assinado.
    // ---------------------------------------------------------
    if (action === 'google_callback') {
      const dono = leEstado(params.state);
      const pagina = function (titulo, texto, erro) {
        res.statusCode = erro ? 400 : 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end('<!doctype html><meta charset="utf-8"><title>' + u.escapeHtml(titulo) + '</title>' +
          '<body style="font-family:-apple-system,system-ui,sans-serif;background:#f5f5f7;margin:0;' +
          'display:grid;place-items:center;height:100vh;color:#1d1d1f">' +
          '<div style="max-width:420px;text-align:center;padding:28px">' +
          '<div style="font-size:19px;font-weight:650;margin-bottom:8px">' + u.escapeHtml(titulo) + '</div>' +
          '<div style="font-size:14.5px;color:#6e6e73;line-height:1.6">' + u.escapeHtml(texto) + '</div>' +
          '<a href="' + u.escapeHtml(u.appUrl()) + '/admin" style="display:inline-block;margin-top:22px;' +
          'background:#00a15c;color:#fff;text-decoration:none;padding:11px 20px;border-radius:12px;' +
          'font-weight:600;font-size:14px">Voltar ao painel</a></div></body>');
      };

      if (!dono) return pagina('Link expirado', 'Tente conectar de novo pelo painel.', true);
      if (params.error) return pagina('Autorização cancelada', 'O Google não liberou o acesso.', true);
      if (!params.code) return pagina('Faltou o código', 'O Google não devolveu a autorização.', true);

      try {
        const tk = await googleTrocaCodigo(params.code);
        let email = '';
        try {
          const quem = await (await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: 'Bearer ' + tk.access_token }
          })).json();
          email = quem.email || '';
        } catch (e) { /* o e-mail é só enfeite */ }

        const expira = new Date(Date.now() + (Number(tk.expires_in || 3600) - 60) * 1000).toISOString();
        const antes = await db.selectOne('op_google_contas', { dono: 'eq.' + dono, select: '*' });
        const campos = {
          dono: dono, email: email,
          access_token: tk.access_token,
          // O refresh_token só vem na PRIMEIRA autorização. Se não
          // veio, guardamos o que já tínhamos — senão a conta morre
          // na próxima renovação.
          refresh_token: tk.refresh_token || (antes && antes.refresh_token) || null,
          expira_em: expira, escopo: tk.scope || GOOGLE_ESCOPO,
          updated_at: new Date().toISOString()
        };
        if (antes) await db.update('op_google_contas', campos, { id: 'eq.' + antes.id });
        else await db.insert('op_google_contas', Object.assign({ created_at: new Date().toISOString() }, campos));

        return pagina('Google Calendar conectado',
          email ? 'Conta ' + email + ' ligada à Agenda.' : 'Conta ligada à Agenda.');
      } catch (e) {
        return pagina('Não deu para conectar', e.message, true);
      }
    }

    // ---------------------------------------------- daqui para baixo, só com crachá
    const aberta = await porta.abrir(req, res, action);
    if (!aberta) return;
    const quem = (aberta.session && aberta.session.nome) || aberta.papel;

    // ---------------------------------------------- a agenda
    if (action === 'ag_lista') {
      const p = periodo(params);
      const nomes = await nomesDeApoio();
      const agoraISO = new Date().toISOString();
      const hoje = hojeSP();

      // uma folga de um dia em cada ponta: reunião da virada da noite
      // em São Paulo cai no dia seguinte em UTC
      const de = new Date(p.de + 'T00:00:00Z'); de.setUTCDate(de.getUTCDate() - 1);
      const ate = new Date(p.ate + 'T23:59:59Z'); ate.setUTCDate(ate.getUTCDate() + 1);

      let linhas = await db.select('op_reunioes', {
        inicio: 'gte.' + de.toISOString(), order: 'inicio.asc', select: '*', limit: '3000'
      });
      linhas = linhas.filter(function (r) { return String(r.inicio) <= ate.toISOString(); });

      let lista = linhas.map(function (r) { return paraTela(r, nomes, agoraISO); })
        .filter(function (r) { return r.dia >= p.de && r.dia <= p.ate; });

      if (params.gestor_id) lista = lista.filter(function (r) { return r.gestor_id === params.gestor_id; });
      if (params.status) lista = lista.filter(function (r) { return r.status === params.status; });

      // Os quatro indicadores. Saem desta mesma lista — se a tela
      // mostra 3 reuniões e o cartão diz 5, alguém está mentindo.
      const kpis = {
        hoje: lista.filter(function (r) { return r.dia === hoje && r.status !== 'cancelada'; }).length,
        agendadas: lista.filter(function (r) { return r.status === 'agendada'; }).length,
        realizadas: lista.filter(function (r) { return r.status === 'realizada'; }).length,
        atrasadas: lista.filter(function (r) { return r.atrasada; }).length
      };

      const google = await db.selectOne('op_google_contas', { dono: 'eq.' + quem, select: '*' });

      return u.ok(res, {
        reunioes: lista,
        kpis: kpis,
        periodo: p,
        hoje: hoje,
        status: STATUS, status_nome: STATUS_NOME,
        gestores: nomes.listaG,
        clientes: nomes.listaC,
        google: {
          configurado: googleConfigurado(),
          conectado: !!(google && google.refresh_token),
          email: (google && google.email) || '',
          ultimo_sync: (google && google.ultimo_sync) || null,
          redirect_uri: googleRedirect()
        }
      });
    }

    if (action === 'ag_salvar') {
      if (req.method !== 'POST') return u.fail(res, 405, 'Metodo nao permitido');
      const body = await u.readBody(req);

      const titulo = limpaTexto(body.titulo, 160);
      if (!titulo) return u.fail(res, 400, 'Escreva o título da reunião.');
      if (!body.inicio) return u.fail(res, 400, 'Escolha a data e a hora.');

      const inicio = new Date(body.inicio);
      if (isNaN(inicio.getTime())) return u.fail(res, 400, 'A data da reunião não é válida.');
      let fim = body.fim ? new Date(body.fim) : null;
      if (fim && isNaN(fim.getTime())) fim = null;
      if (fim && fim <= inicio) return u.fail(res, 400, 'O fim precisa ser depois do início.');

      const campos = {
        titulo: titulo,
        cliente_id: body.cliente_id || null,
        gestor_id: body.gestor_id || null,
        inicio: inicio.toISOString(),
        fim: fim ? fim.toISOString() : null,
        link: limpaTexto(body.link, 400) || null,
        observacao: limpaTexto(body.observacao, 500) || null,
        updated_at: new Date().toISOString()
      };

      if (body.id) {
        const antes = await db.selectOne('op_reunioes', { id: 'eq.' + body.id, select: '*' });
        if (!antes) return u.fail(res, 404, 'Reunião não encontrada.');
        // Reunião que veio do Google: mexer no horário aqui não muda
        // lá. Só o que é nosso é editado sem ressalva.
        const row = await db.update('op_reunioes', campos, { id: 'eq.' + body.id });
        return u.ok(res, {
          reuniao: row,
          aviso: antes.origem === 'google'
            ? 'Esta reunião veio do Google Calendar. A alteração vale só aqui no sistema.' : null
        });
      }

      campos.status = 'agendada';
      campos.origem = 'sistema';
      campos.created_at = new Date().toISOString();
      const nova = await db.insert('op_reunioes', campos);
      return u.ok(res, { reuniao: nova });
    }

    // Realizada / não realizada / cancelada / de volta para agendada.
    if (action === 'ag_status') {
      if (req.method !== 'POST') return u.fail(res, 405, 'Metodo nao permitido');
      const body = await u.readBody(req);
      const novo = String(body.status || '').toLowerCase();
      if (STATUS.indexOf(novo) < 0) return u.fail(res, 400, 'Situação desconhecida.');

      const r = await db.selectOne('op_reunioes', { id: 'eq.' + String(body.id || ''), select: '*' });
      if (!r) return u.fail(res, 404, 'Reunião não encontrada.');

      const campos = {
        status: novo,
        // Guardar QUANDO alguém decidiu é o que separa "não
        // realizada" (tem resposta) de "atrasada" (não tem).
        resolvido_em: novo === 'agendada' ? null : new Date().toISOString(),
        resolvido_por: novo === 'agendada' ? null : quem,
        updated_at: new Date().toISOString()
      };
      if (body.observacao !== undefined) campos.observacao = limpaTexto(body.observacao, 500) || null;

      const row = await db.update('op_reunioes', campos, { id: 'eq.' + r.id });
      return u.ok(res, {
        reuniao: row,
        aviso: r.origem === 'google'
          ? 'Marcado aqui no sistema. O Google Calendar não guarda "realizada", então lá o evento continua igual.'
          : null
      });
    }

    if (action === 'ag_excluir') {
      if (req.method !== 'POST') return u.fail(res, 405, 'Metodo nao permitido');
      const body = await u.readBody(req);
      const r = await db.selectOne('op_reunioes', { id: 'eq.' + String(body.id || ''), select: '*' });
      if (!r) return u.fail(res, 404, 'Reunião não encontrada.');
      if (r.origem === 'google') {
        return u.fail(res, 409, 'Esta reunião veio do Google Calendar. Apague no Google e sincronize de novo.');
      }
      await db.remove('op_reunioes', { id: 'eq.' + r.id });
      return u.ok(res, { removida: true });
    }

    /* ---------------------------------------------- Google ---- */
    if (action === 'ag_google_status') {
      const conta = await db.selectOne('op_google_contas', { dono: 'eq.' + quem, select: '*' });
      return u.ok(res, {
        configurado: googleConfigurado(),
        conectado: !!(conta && conta.refresh_token),
        email: (conta && conta.email) || '',
        ultimo_sync: (conta && conta.ultimo_sync) || null,
        redirect_uri: googleRedirect(),
        // o que falta, em palavras, para quem for configurar
        precisa: googleConfigurado() ? [] : [
          'Criar um projeto em console.cloud.google.com',
          'Ativar a API "Google Calendar"',
          'Criar credencial OAuth 2.0 do tipo "Aplicativo da Web"',
          'Colar em "URIs de redirecionamento autorizados": ' + googleRedirect(),
          'Criar GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET na Vercel e fazer Redeploy'
        ]
      });
    }

    if (action === 'ag_google_ligar') {
      if (!googleConfigurado()) {
        return u.fail(res, 409, 'O Google Calendar ainda não está configurado. ' +
          'Faltam GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET na Vercel.');
      }
      const destino = GOOGLE_AUTH + '?' + new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        redirect_uri: googleRedirect(),
        response_type: 'code',
        scope: GOOGLE_ESCOPO,
        access_type: 'offline',          // para vir o refresh_token
        prompt: 'consent',
        include_granted_scopes: 'true',
        state: assinaEstado(quem)
      }).toString();
      return u.ok(res, { url: destino });
    }

    if (action === 'ag_google_desligar') {
      if (req.method !== 'POST') return u.fail(res, 405, 'Metodo nao permitido');
      const conta = await db.selectOne('op_google_contas', { dono: 'eq.' + quem, select: 'id' });
      if (conta) await db.remove('op_google_contas', { id: 'eq.' + conta.id });
      return u.ok(res, { desconectado: true });
    }

    // Puxa os eventos do período. Importar de novo NÃO duplica: o
    // id do evento no Google é único no banco, então o mesmo evento
    // é atualizado em vez de entrar outra vez.
    if (action === 'ag_google_sync') {
      if (req.method !== 'POST') return u.fail(res, 405, 'Metodo nao permitido');
      if (!googleConfigurado()) {
        return u.fail(res, 409, 'O Google Calendar ainda não está configurado nesta instalação.');
      }
      const conta = await db.selectOne('op_google_contas', { dono: 'eq.' + quem, select: '*' });
      if (!conta || !conta.refresh_token) {
        return u.fail(res, 409, 'Conecte a sua conta Google antes de sincronizar.');
      }

      const body = await u.readBody(req);
      const p = periodo(body);
      const token = await googleToken(conta);

      const consulta = new URLSearchParams({
        timeMin: new Date(p.de + 'T00:00:00-03:00').toISOString(),
        timeMax: new Date(p.ate + 'T23:59:59-03:00').toISOString(),
        singleEvents: 'true', orderBy: 'startTime', maxResults: '250'
      }).toString();

      const r = await fetch(GOOGLE_API + '/calendars/primary/events?' + consulta, {
        headers: { Authorization: 'Bearer ' + token }
      });
      const dados = await r.json().catch(function () { return {}; });
      if (!r.ok) {
        return u.fail(res, 502, 'O Google recusou: ' +
          ((dados.error && dados.error.message) || ('HTTP ' + r.status)));
      }

      let novos = 0, atualizados = 0, pulados = 0;
      for (const ev of (dados.items || [])) {
        // evento de dia inteiro não é reunião com hora marcada
        if (!ev.start || !ev.start.dateTime) { pulados++; continue; }
        if (ev.status === 'cancelled') { pulados++; continue; }

        const campos = {
          titulo: limpaTexto(ev.summary, 160) || '(sem título)',
          inicio: new Date(ev.start.dateTime).toISOString(),
          fim: ev.end && ev.end.dateTime ? new Date(ev.end.dateTime).toISOString() : null,
          link: ev.hangoutLink || ev.htmlLink || null,
          origem: 'google', externo_id: ev.id, externo_conta: conta.email || quem,
          updated_at: new Date().toISOString()
        };

        const jaTem = await db.selectOne('op_reunioes', {
          origem: 'eq.google', externo_id: 'eq.' + ev.id, select: '*'
        });

        if (jaTem) {
          // o que a equipe decidiu aqui (realizada, cliente, gestor)
          // não é sobrescrito pelo Google
          await db.update('op_reunioes', campos, { id: 'eq.' + jaTem.id });
          atualizados++;
        } else {
          try {
            await db.insert('op_reunioes', Object.assign({
              status: 'agendada', created_at: new Date().toISOString()
            }, campos));
            novos++;
          } catch (e) { pulados++; }   // o índice único barrou: já existia
        }
      }

      await db.update('op_google_contas',
        { ultimo_sync: new Date().toISOString(), updated_at: new Date().toISOString() },
        { id: 'eq.' + conta.id });

      return u.ok(res, { novos: novos, atualizados: atualizados, pulados: pulados });
    }

    return u.fail(res, 404, 'Acao desconhecida: ' + action);
  } catch (e) {
    console.error('[agenda]', action, e);
    return u.fail(res, 500, e.message || 'Erro interno');
  }
};

module.exports.STATUS = STATUS;
module.exports.estaAtrasada = estaAtrasada;
module.exports.periodo = periodo;
module.exports.googleConfigurado = googleConfigurado;
