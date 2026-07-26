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

  // ---------------- Evolution ----------------
  if (url.pathname.indexOf('/message/sendText/') === 0) {
    return json({ key: { id: 'mock-' + Math.random().toString(36).slice(2, 9) } });
  }
  if (url.pathname === '/instance/fetchInstances') {
    return json([{ instance: { instanceName: 'start-comercial', connectionStatus: 'open', owner: '5511999999999' } }]);
  }

  res.statusCode = 404;
  res.end('{}');
});

server.listen(54322, function () { console.log('mock servicos em http://127.0.0.1:54322'); });
