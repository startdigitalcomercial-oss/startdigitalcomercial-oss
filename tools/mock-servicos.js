// ============================================================
// Espelho local da Anthropic e da Evolution (SO PARA TESTE)
// Uso: node tools/mock-servicos.js   (porta 54322)
// ============================================================
'use strict';
const http = require('http');

function ler(req) {
  return new Promise(function (res) {
    let b = '';
    req.on('data', function (c) { b += c; });
    req.on('end', function () { try { res(JSON.parse(b || '{}')); } catch (e) { res({}); } });
  });
}

const server = http.createServer(async function (req, res) {
  const url = new URL(req.url, 'http://x');
  const body = await ler(req);
  const json = function (o) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(o));
  };

  // ---------------- Anthropic ----------------
  if (url.pathname === '/v1/messages') {
    const sys = String(body.system || '');
    const tool = (body.tools || [])[0];

    if (tool && tool.name === 'responder_candidato') {
      const m = sys.match(/(\d+)\.\s+>>> PERGUNTA ATUAL <<</);
      const atual = m ? Number(m[1]) : 1;
      const todas = (sys.match(/^\s*(\d+)\.\s/gm) || []).map(function (x) { return Number(x.trim()); });
      const total = todas.length ? Math.max.apply(null, todas) : 1;
      const ultima = String((body.messages || []).slice(-1)[0] && (body.messages || []).slice(-1)[0].content || '');
      const fim = atual >= total;
      return json({
        content: [{
          type: 'tool_use', name: tool.name,
          input: {
            mensagem: fim ? 'Prontinho! Obrigada pelas respostas.' : 'Entendi. Próxima pergunta ' + (atual + 1) + '?',
            resposta_capturada: ultima.slice(0, 200),
            avancar: true,
            encerrar: fim,
            motivo_encerramento: fim ? 'concluida' : null
          }
        }]
      });
    }

    if (tool && tool.name === 'resumir_prequalificacao') {
      return json({
        content: [{
          type: 'tool_use', name: tool.name,
          input: {
            resumo: 'Candidato respondeu todas as perguntas. Tem experiencia na area e estrutura para o remoto.',
            nota: 8, recomendacao: 'avancar',
            pontos_fortes: ['Experiencia relevante', 'Disponibilidade imediata'],
            pontos_atencao: ['Pretensao acima da media']
          }
        }]
      });
    }
    return json({ content: [{ type: 'text', text: 'Conexao com a Aurea funcionando.' }] });
  }

  // ---------------- Evolution: instancias ----------------
  let ESTADO = global.__waEstado || (global.__waEstado = { criada: false, aberta: false, escaneios: 0 });

  if (url.pathname === '/instance/create') {
    ESTADO.criada = true; ESTADO.aberta = false; ESTADO.escaneios = 0;
    return json({
      instance: { instanceName: body.instanceName, status: 'created' },
      qrcode: { base64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==', code: '2@abc', pairingCode: 'ABCD-1234' }
    });
  }
  if (url.pathname.indexOf('/instance/connect/') === 0) {
    ESTADO.criada = true;
    return json({ base64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==', code: '2@abc', pairingCode: 'ABCD-1234' });
  }
  if (url.pathname.indexOf('/instance/connectionState/') === 0) {
    // simula o usuario escaneando depois de 2 consultas
    ESTADO.escaneios++;
    if (ESTADO.escaneios >= 2) ESTADO.aberta = true;
    return json({ instance: { instanceName: 'x', state: ESTADO.aberta ? 'open' : 'connecting' } });
  }
  if (url.pathname.indexOf('/instance/logout/') === 0) {
    ESTADO.aberta = false;
    return json({ status: 'SUCCESS' });
  }
  if (url.pathname.indexOf('/instance/delete/') === 0) {
    const nome = decodeURIComponent(url.pathname.split('/instance/delete/')[1] || '');
    ESTADO.apagadas = ESTADO.apagadas || [];
    ESTADO.apagadas.push(nome);
    ESTADO.criada = false; ESTADO.aberta = false; ESTADO.escaneios = 0;
    return json({ status: 'SUCCESS', instanceName: nome });
  }
  if (url.pathname.indexOf('/webhook/set/') === 0) {
    if (!body.webhook) { res.statusCode = 400; return res.end('{"message":"formato v1"}'); }
    return json({ webhook: { enabled: true, url: body.webhook.url } });
  }

  // ---------------- Evolution ----------------
  if (url.pathname.indexOf('/message/sendText/') === 0) {
    return json({ key: { id: 'mock-' + Math.random().toString(36).slice(2, 9) } });
  }
  if (url.pathname.indexOf('/chat/whatsappNumbers/') === 0) {
    const nums = (body && body.numbers) || [];
    return json(nums.map(function (n) {
      const d = String(n);
      // Simula o numero brasileiro antigo, cadastrado no WhatsApp SEM o nono
      // digito. So para o numero de teste terminado em 88559994.
      let jid = d;
      if (/88559994$/.test(d) && d.length === 13) jid = d.slice(0, 4) + d.slice(5);
      return { exists: true, jid: jid + '@s.whatsapp.net', number: d };
    }));
  }
  if (url.pathname === '/instance/fetchInstances') {
    return json([{ instance: { instanceName: 'start-comercial', connectionStatus: 'open', owner: '5511999999999' } }]);
  }

  res.statusCode = 404;
  res.end('{}');
});

server.listen(54322, function () { console.log('mock servicos em http://127.0.0.1:54322'); });
