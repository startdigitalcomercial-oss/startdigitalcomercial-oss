// ============================================================
// Servidor de desenvolvimento (SO PARA TESTE LOCAL)
// A Vercel nao usa este arquivo. Rode com: npm run dev
// ============================================================
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

// carrega o .env (sem biblioteca)
try {
  const envFile = path.join(__dirname, '.env');
  if (fs.existsSync(envFile)) {
    fs.readFileSync(envFile, 'utf8').split('\n').forEach(function (line) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    });
  }
} catch (e) { /* ignora */ }

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

const ROTAS = {
  '/space': '/space.html',
  '/beneficio': '/space.html',
  '/vagas': '/vagas.html',
  '/carreiras': '/vagas.html',
  '/trabalhe-conosco': '/vagas.html',
  '/vaga': '/vaga.html',
  '/candidatura': '/vaga.html',
  '/admin': '/admin.html',
  '/disc': '/disc.html',
  '/teste': '/disc.html',
  '/prova': '/prova.html',
  '/portal': '/portal.html',
  '/integracao': '/portal.html',
  '/entrar': '/entrar.html',
  '/criar-senha': '/criar-senha.html',
  '/criar-senha-painel': '/criar-senha-painel.html',
  '/equipe': '/equipe.html',
  '/time': '/equipe.html',
  '/colaborador': '/equipe.html'
};

// Os icones sao gerados por codigo. Na Vercel isso e um rewrite no
// vercel.json; aqui o espelho local precisa fazer o mesmo, senao ele
// mente sobre como a producao se comporta.
const ICONES = {
  '/favicon-32.png': 's=32',
  '/favicon.ico': 's=48&f=ico',
  '/apple-touch-icon.png': 's=180',
  '/icone-192.png': 's=192',
  '/icone-512.png': 's=512'
};

const server = http.createServer(async function (req, res) {
  const url = new URL(req.url, 'http://localhost');
  let pathname = url.pathname;

  if (ICONES[pathname]) {
    // Reescreve o req.url de verdade: o handler le a query dali. Se a
    // gente so trocasse o caminho, o espelho responderia diferente da
    // producao e o teste local nao valeria nada.
    req.url = '/api/icone?' + ICONES[pathname];
    pathname = '/api/icone';
  }


  if (pathname.startsWith('/api/')) {
    const nome = pathname.replace('/api/', '').replace(/\/+$/, '');
    const arquivo = path.join(__dirname, 'api', nome + '.js');
    if (!fs.existsSync(arquivo)) {
      res.statusCode = 404;
      return res.end(JSON.stringify({ ok: false, error: 'rota nao encontrada' }));
    }
    delete require.cache[require.resolve(arquivo)];
    Object.keys(require.cache).forEach(function (k) {
      if (k.indexOf(path.join(__dirname, 'api', '_lib')) === 0) delete require.cache[k];
    });
    const handler = require(arquivo);
    req.query = Object.fromEntries(url.searchParams.entries());
    try {
      await handler(req, res);
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  if (ROTAS[pathname]) pathname = ROTAS[pathname];
  if (pathname === '/') pathname = '/index.html';

  const file = path.join(__dirname, 'public', pathname);
  if (!file.startsWith(path.join(__dirname, 'public')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.statusCode = 404;
    return res.end('nao encontrado');
  }
  res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, function () {
  console.log('StartDigital RH rodando em http://localhost:' + PORT);
  console.log('  formulario  http://localhost:' + PORT + '/vaga');
  console.log('  painel      http://localhost:' + PORT + '/admin');
});
