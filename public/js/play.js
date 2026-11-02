// ============================================================
// START PLAY — a roleta.
//
// Regra que manda em todo este arquivo: QUEM SORTEIA É O SERVIDOR.
// A tela pergunta "quem ganhou?", recebe um índice e só então
// calcula o ângulo necessário para a roda PARAR naquela fatia.
// Nada aqui escolhe prêmio, empurra resultado ou lê o ângulo final
// para decidir qualquer coisa. A animação é encenação.
//
// Sem biblioteca: SVG para a roda, transform da CSS para o giro
// (roda na GPU), Web Audio para os sons e canvas para os confetes.
// ============================================================
'use strict';

var SLOTS_COR = {
  roxo: '#7c3aed', lilas: '#a78bfa', azul: '#3b82f6', rosa: '#ec4899',
  amarelo: '#f5b301', verde: '#10b981', laranja: '#f97316'
};
// a cor do texto que fica legível em cima de cada fatia
var SLOTS_TINTA = {
  roxo: '#ffffff', lilas: '#2e1065', azul: '#ffffff', rosa: '#ffffff',
  amarelo: '#422006', verde: '#ffffff', laranja: '#431407'
};

var PREMIOS = [];
var NOME = '';
var GIRANDO = false;
var ANGULO = 0;          // onde a roda está agora, em graus
var SOM_LIGADO = true;

function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function recado(txt) { $('recado').textContent = txt || ''; }

/* ============================================================
   SOM — gerado na hora pelo navegador.
   Nenhum arquivo .mp3 no projeto: são ondas criadas por código,
   então não pesa no carregamento e não tem o que dar 404.
   ============================================================ */
var Audio_ = null;
function audio() {
  if (Audio_) return Audio_;
  var AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try { Audio_ = new AC(); } catch (e) { return null; }
  return Audio_;
}
// O navegador só deixa tocar som depois de um toque da pessoa.
// Por isso nada começa sozinho — nem música de fundo.
function acordaSom() {
  var a = audio();
  if (a && a.state === 'suspended') a.resume();
}
function bip(freq, dur, tipo, volume, desce) {
  if (!SOM_LIGADO) return;
  var a = audio();
  if (!a) return;
  try {
    var osc = a.createOscillator();
    var g = a.createGain();
    osc.type = tipo || 'sine';
    osc.frequency.setValueAtTime(freq, a.currentTime);
    if (desce) osc.frequency.exponentialRampToValueAtTime(Math.max(40, desce), a.currentTime + dur);
    g.gain.setValueAtTime(0.0001, a.currentTime);
    g.gain.exponentialRampToValueAtTime(volume || 0.08, a.currentTime + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
    osc.connect(g); g.connect(a.destination);
    osc.start(); osc.stop(a.currentTime + dur + 0.02);
  } catch (e) { /* som é enfeite: se falhar, o jogo continua */ }
}
var somTick     = function () { bip(1180, 0.035, 'square', 0.035); };
var somAlavanca = function () { bip(160, 0.20, 'sawtooth', 0.10, 60); };
var somLargada  = function () { bip(320, 0.34, 'triangle', 0.09, 820); };
var somVitoria  = function () {
  [523, 659, 784, 1047].forEach(function (f, i) {
    setTimeout(function () { bip(f, 0.26, 'triangle', 0.11); }, i * 105);
  });
};

var ICO_SOM_ON = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M11 5 6.5 9H3v6h3.5L11 19z"/><path d="M15.6 8.4a5 5 0 0 1 0 7.2"/>' +
  '<path d="M18.4 5.6a9 9 0 0 1 0 12.8"/></svg>';
var ICO_SOM_OFF = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M11 5 6.5 9H3v6h3.5L11 19z"/><path d="m16.5 9.5 5 5M21.5 9.5l-5 5"/></svg>';

function pintaBotaoSom() {
  $('som').innerHTML = SOM_LIGADO ? ICO_SOM_ON : ICO_SOM_OFF;
  $('som').setAttribute('title', SOM_LIGADO ? 'Som ligado' : 'Som desligado');
}

/* ============================================================
   A RODA (SVG)
   ============================================================ */
var ICONES_SVG = {
  dinheiro: 'M12 5.4v13.2M15.2 8.6c0-1.3-1.4-2.1-3.2-2.1s-3.2.8-3.2 2.1 1.4 1.9 3.2 2.3 3.2 1 3.2 2.5-1.4 2.3-3.2 2.3-3.2-1-3.2-2.3',
  presente: 'M4.4 10.6h15.2v8.6H4.4zM3.4 7.2h17.2v3.4H3.4zM12 7.2v12M12 7.2C12 5.4 10.6 4 9 4S6.4 5.4 6.4 7.2zM12 7.2c0-1.8 1.4-3.2 3-3.2s2.6 1.4 2.6 3.2z',
  comida: 'M7 4v7.4a2.4 2.4 0 0 0 4.8 0V4M9.4 11.8V20M16.4 4c-1.3 1.3-2 3-2 5.2 0 1.6.7 2.6 2 2.8V20',
  folga: 'M20 14.4A8.2 8.2 0 0 1 9.6 4 8.4 8.4 0 1 0 20 14.4z',
  estrela: 'm12 4.4 2.4 4.9 5.4.8-3.9 3.8.9 5.3-4.8-2.5-4.8 2.5.9-5.3-3.9-3.8 5.4-.8z',
  sorte: 'M12 3.6c2.6 3 4 5.4 4 7.4a4 4 0 0 1-8 0c0-2 1.4-4.4 4-7.4zM6.6 16.8c1.6 2.3 3.4 3.6 5.4 3.6s3.8-1.3 5.4-3.6',
  troreu: 'M8 4.4h8v4.2a4 4 0 0 1-8 0zM8 5.6H5.4v1.6A3 3 0 0 0 8 10.1M16 5.6h2.6v1.6A3 3 0 0 1 16 10.1M12 12.6V16M9 19.6h6'
};

function corDe(p) { return SLOTS_COR[p.cor] || SLOTS_COR.roxo; }
function tintaDe(p) { return SLOTS_TINTA[p.cor] || '#fff'; }

// Encurta o nome para caber na fatia sem virar sopa de letras.
function cabe(txt, max) {
  var t = String(txt || '');
  return t.length > max ? t.slice(0, max - 1).trim() + '…' : t;
}

function desenhaRoda() {
  var n = PREMIOS.length;
  var svg = $('roda');
  if (!n) { svg.innerHTML = ''; return; }

  var fatia = 360 / n;
  var R = 100, cx = 100, cy = 100;
  var partes = [];

  // Fatia 0 começa no topo e cresce no sentido do relógio. O ponteiro
  // mora em -90° (topo), então o MEIO da fatia i fica em
  // i*fatia + fatia/2, medido a partir do topo.
  for (var i = 0; i < n; i++) {
    var p = PREMIOS[i];
    var ini = (i * fatia - 90 - fatia / 2) * Math.PI / 180;
    var fim = ((i + 1) * fatia - 90 - fatia / 2) * Math.PI / 180;
    var x1 = cx + R * Math.cos(ini), y1 = cy + R * Math.sin(ini);
    var x2 = cx + R * Math.cos(fim), y2 = cy + R * Math.sin(fim);
    var grande = fatia > 180 ? 1 : 0;

    partes.push('<path d="M' + cx + ' ' + cy + ' L' + x1.toFixed(2) + ' ' + y1.toFixed(2) +
      ' A' + R + ' ' + R + ' 0 ' + grande + ' 1 ' + x2.toFixed(2) + ' ' + y2.toFixed(2) + ' Z" ' +
      'fill="' + corDe(p) + '" stroke="rgba(11,6,22,.34)" stroke-width="0.7"/>');

    // O texto deitado ao longo do raio. Nas fatias da metade de baixo
    // a mesma rotacao deixaria a palavra de cabeca para baixo: por
    // isso giramos meia volta a mais e escrevemos do outro lado do
    // centro. Da no MESMO lugar na tela, so que legivel.
    var meio = i * fatia;
    var tinta = tintaDe(p);
    var deCabecaParaBaixo = meio > 90 && meio < 270;
    var giro = deCabecaParaBaixo ? meio + 180 : meio;
    var yTexto = deCabecaParaBaixo ? 170 : 30;
    var yIcone = deCabecaParaBaixo ? 150 : 38;

    var g = '<g transform="rotate(' + giro.toFixed(3) + ' ' + cx + ' ' + cy + ')">';
    g += '<text x="' + cx + '" y="' + yTexto + '" text-anchor="middle" fill="' + tinta + '" ' +
         'font-size="8.2" font-weight="800" letter-spacing="-0.2">' + esc(cabe(p.nome, 15)) + '</text>';
    if (ICONES_SVG[p.icone]) {
      g += '<g transform="translate(' + (cx - 7) + ' ' + yIcone + ') scale(0.58)" opacity="0.92">' +
           '<path d="' + ICONES_SVG[p.icone] + '" fill="none" stroke="' + tinta +
           '" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></g>';
    }
    g += '</g>';
    partes.push(g);
  }

  // um brilho de cima para dar volume, sem tapar as cores
  partes.push('<circle cx="100" cy="100" r="100" fill="url(#brilho)" pointer-events="none"/>');

  svg.innerHTML =
    '<defs><radialGradient id="brilho" cx="34%" cy="24%" r="78%">' +
    '<stop offset="0" stop-color="#fff" stop-opacity=".22"/>' +
    '<stop offset="55%" stop-color="#fff" stop-opacity="0"/>' +
    '<stop offset="100%" stop-color="#000" stop-opacity=".30"/></radialGradient></defs>' +
    partes.join('');
}

// As lâmpadas da borda, acesas em sequência na entrada.
function montaLampadas() {
  var aro = $('aro');
  aro.querySelectorAll('.lampada').forEach(function (x) { x.remove(); });
  var quantas = 24;
  for (var i = 0; i < quantas; i++) {
    var ang = (i / quantas) * Math.PI * 2 - Math.PI / 2;
    var l = document.createElement('i');
    l.className = 'lampada';
    l.style.transform = 'translate(' + (Math.cos(ang) * 49.2).toFixed(3) + 'vmin, ' +
                        (Math.sin(ang) * 49.2).toFixed(3) + 'vmin)';
    // posição em % do aro, para acompanhar o tamanho responsivo
    l.style.left = (50 + Math.cos(ang) * 49.2) + '%';
    l.style.top = (50 + Math.sin(ang) * 49.2) + '%';
    l.style.transform = 'none';
    aro.appendChild(l);
  }
}
function lampadas() { return $('aro').querySelectorAll('.lampada'); }

var giroLampadas = null;
function lampadasCorrendo(liga) {
  var ls = lampadas();
  if (giroLampadas) { clearInterval(giroLampadas); giroLampadas = null; }
  if (!liga) { ls.forEach(function (l) { l.classList.remove('acesa'); }); return; }
  var k = 0;
  giroLampadas = setInterval(function () {
    ls.forEach(function (l, i) { l.classList.toggle('acesa', (i + k) % 3 === 0); });
    k++;
  }, 110);
}

/* ============================================================
   O GIRO
   ============================================================ */
// Quantos graus a roda precisa girar para a fatia `indice` parar
// embaixo do ponteiro. O ponteiro aponta para o topo (0°).
function anguloPara(indice, total, voltas) {
  var fatia = 360 / total;
  // onde a roda tem que terminar, de 0 a 360
  var destino = (360 - indice * fatia) % 360;
  // uma sobrinha aleatória dentro da fatia, para não parar sempre
  // no milímetro do centro — isso é estética, não sorteio
  var folga = (Math.random() - 0.5) * (fatia * 0.52);
  var atual = ((ANGULO % 360) + 360) % 360;
  var falta = (destino - atual + 360) % 360;
  return ANGULO + voltas * 360 + falta + folga;
}

// Tranca a ALAVANCA (nao o cartao do nome: quem ainda nao disse o
// nome precisa justamente do botao LET'S PLAY funcionando).
function travaTela(travado) {
  $('alavanca').setAttribute('aria-disabled', travado ? 'true' : 'false');
  $('alavanca').classList.toggle('pronta', !travado && !!NOME);
  $('btn-play').disabled = GIRANDO;
  $('trocar').style.visibility = GIRANDO ? 'hidden' : 'visible';
  $('dica-puxa').textContent = travado ? (NOME ? 'aguarde' : 'diga seu nome') : 'puxe';
}

function etiquetaDeGiro() {
  try {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  } catch (e) { }
  return 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

async function girar() {
  if (GIRANDO) return;            // clique duplo morre aqui
  if (!NOME) { recado('Diga o seu nome antes de girar.'); return; }
  if (PREMIOS.length < 2) { recado('A roleta ainda não está pronta. Fale com a Start.'); return; }

  GIRANDO = true;
  travaTela(true);
  recado('');
  acordaSom();
  somAlavanca();

  var resposta;
  try {
    var r = await fetch('/api/play?action=play_girar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome: NOME, giro_id: etiquetaDeGiro() })
    });
    resposta = await r.json();
    if (!resposta.ok) throw new Error(resposta.error || 'não deu certo');
  } catch (e) {
    GIRANDO = false;
    travaTela(false);
    recado(/Failed|fetch|network/i.test(e.message)
      ? 'Sem internet agora. A roleta não girou — tente de novo.'
      : e.message);
    return;
  }

  var giro = resposta.giro;
  // O servidor pode ter devolvido um índice de uma roda com outro
  // tamanho (alguém mexeu nos prêmios nesse meio tempo). Se isso
  // acontecer, recarrega a roda antes de animar — senão a seta
  // pararia num prêmio diferente do que foi sorteado.
  if (giro.total !== PREMIOS.length) {
    await carregaRoleta();
    desenhaRoda();
  }

  var voltas = 5 + Math.floor(Math.random() * 5);      // 5 a 9 voltas
  var duracao = 4200 + Math.random() * 1500;           // 4,2 a 5,7 s
  var alvo = anguloPara(giro.indice, giro.total, voltas);

  $('aro').classList.add('quente');
  lampadasCorrendo(true);
  somLargada();
  anima(alvo, duracao, giro);
}

// A desaceleração. Uma curva só, do começo ao fim: arranca rápido,
// segura a expectativa e chega quase parando. Nada de linear.
function anima(alvo, duracao, giro) {
  var de = ANGULO;
  var delta = alvo - de;
  var t0 = performance.now();
  var fatia = 360 / giro.total;
  var ultimoTick = -1;
  var roda = $('roda');

  function passo(agora) {
    var t = Math.min(1, (agora - t0) / duracao);
    // começa forte e termina mansinho (ease-out quíntico)
    var e = 1 - Math.pow(1 - t, 5);
    var ang = de + delta * e;
    roda.style.transform = 'rotate(' + ang + 'deg)';

    // o ponteiro bate a cada divisão que passa
    var marca = Math.floor(ang / fatia);
    if (marca !== ultimoTick) {
      if (ultimoTick !== -1) {
        var pt = $('ponteiro');
        pt.classList.remove('bate');
        void pt.offsetWidth;
        pt.classList.add('bate');
        // no fim o tick fica raro; tocar todos no começo vira ruído
        if (t > 0.55) somTick();
      }
      ultimoTick = marca;
    }

    if (t < 1) { requestAnimationFrame(passo); return; }

    ANGULO = alvo;
    terminou(giro);
  }
  requestAnimationFrame(passo);
}

function terminou(giro) {
  lampadasCorrendo(false);
  lampadas().forEach(function (l) { l.classList.add('acesa'); });

  // meio segundo de respiro antes da janela, como pedido
  setTimeout(function () {
    lampadas().forEach(function (l) { l.classList.remove('acesa'); });
    $('aro').classList.remove('quente');
    abrePremio(giro);
    GIRANDO = false;
  }, 520);
}

/* ============================================================
   A JANELA DO PRÊMIO
   ============================================================ */
function primeiroNome(n) { return String(n || '').trim().split(' ')[0] || n; }

function abrePremio(giro) {
  $('parabens').textContent = 'PARABÉNS, ' + primeiroNome(NOME).toUpperCase() + '!';
  $('premio-nome').textContent = giro.premio;
  $('premio-nome').style.color = SLOTS_COR[giro.premio_cor] || '#fff';
  $('premio-desc').textContent = giro.premio_descricao || '';
  $('premio-pe').textContent = 'Registrado em nome de ' + NOME + '.';
  $('veu').classList.add('on');
  somVitoria();
  festa();
}

function fechaPremio() {
  $('veu').classList.remove('on');
  travaTela(false);
  recado('');
}

/* ============================================================
   CONFETES — desenhados na mão, sem biblioteca
   ============================================================ */
function festa() {
  var c = $('ceu');
  var ctx = c.getContext('2d');
  c.width = innerWidth; c.height = innerHeight;
  var cores = ['#7c3aed', '#a78bfa', '#ec4899', '#f5b301', '#10b981', '#3b82f6', '#f97316', '#fff'];
  var flocos = [];
  var quantos = innerWidth < 600 ? 110 : 180;
  for (var i = 0; i < quantos; i++) {
    flocos.push({
      x: Math.random() * c.width,
      y: -20 - Math.random() * c.height * 0.6,
      w: 6 + Math.random() * 7,
      h: 8 + Math.random() * 8,
      cor: cores[i % cores.length],
      vy: 2.2 + Math.random() * 3.6,
      vx: -1.5 + Math.random() * 3,
      giro: Math.random() * Math.PI,
      vgiro: -0.13 + Math.random() * 0.26
    });
  }
  var inicio = Date.now();
  (function anda() {
    ctx.clearRect(0, 0, c.width, c.height);
    var vivos = 0;
    for (var i = 0; i < flocos.length; i++) {
      var f = flocos[i];
      f.y += f.vy; f.x += f.vx; f.giro += f.vgiro;
      if (f.y < c.height + 30) vivos++;
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.giro);
      ctx.fillStyle = f.cor;
      ctx.fillRect(-f.w / 2, -f.h / 2, f.w, f.h * (0.4 + Math.abs(Math.sin(f.giro))));
      ctx.restore();
    }
    if (vivos > 0 && Date.now() - inicio < 5200) requestAnimationFrame(anda);
    else ctx.clearRect(0, 0, c.width, c.height);
  })();
}

/* ============================================================
   POEIRA LUMINOSA do fundo — discreta, de propósito
   ============================================================ */
function poeira() {
  var c = $('poeira');
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var ctx = c.getContext('2d');
  var pontos = [];
  function mede() {
    c.width = innerWidth; c.height = innerHeight;
    var quantos = Math.min(46, Math.round(innerWidth / 26));
    pontos = [];
    for (var i = 0; i < quantos; i++) {
      pontos.push({
        x: Math.random() * c.width, y: Math.random() * c.height,
        r: 0.6 + Math.random() * 1.5,
        vy: -0.09 - Math.random() * 0.26,
        vx: -0.07 + Math.random() * 0.14,
        a: 0.12 + Math.random() * 0.4
      });
    }
  }
  mede();
  addEventListener('resize', mede);
  (function anda() {
    ctx.clearRect(0, 0, c.width, c.height);
    for (var i = 0; i < pontos.length; i++) {
      var p = pontos[i];
      p.y += p.vy; p.x += p.vx;
      if (p.y < -8) { p.y = c.height + 8; p.x = Math.random() * c.width; }
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(221,214,254,' + p.a + ')';
      ctx.fill();
    }
    requestAnimationFrame(anda);
  })();
}

/* ============================================================
   A ALAVANCA — clique, toque ou arrasto
   ============================================================ */
function ligaAlavanca() {
  var al = $('alavanca');
  var caixa = $('haste-caixa');
  var MAX = 26;             // quanto ela deita, em graus
  var puxando = false, y0 = 0, grau = 0, soltouNoFim = false;

  function desenha(g) { caixa.style.transform = 'translateX(-50%) rotate(' + g + 'deg)'; }
  function liberada() { return al.getAttribute('aria-disabled') !== 'true'; }

  function comeca(ev) {
    if (!liberada() || GIRANDO) return;
    puxando = true; soltouNoFim = false;
    y0 = (ev.touches ? ev.touches[0].clientY : ev.clientY);
    al.classList.add('puxando');
    al.classList.remove('pronta');
    acordaSom();
  }
  function move(ev) {
    if (!puxando) return;
    var y = (ev.touches ? ev.touches[0].clientY : ev.clientY);
    var d = y - y0;
    // resistência: o fim do curso custa mais do que o começo
    grau = Math.max(0, Math.min(MAX, Math.pow(Math.max(0, d), 0.82) * 0.5));
    if (grau >= MAX - 0.6 && !soltouNoFim) { soltouNoFim = true; }
    desenha(grau);
    if (ev.cancelable) ev.preventDefault();
  }
  function solta() {
    if (!puxando) return;
    puxando = false;
    al.classList.remove('puxando');
    var valeu = grau > MAX * 0.55;
    desenha(0);                       // a mola devolve a alavanca
    grau = 0;
    if (valeu) girar(); else al.classList.add('pronta');
  }

  // clicar também vale: desce, sobe e gira
  function clique() {
    if (!liberada() || GIRANDO) return;
    al.classList.remove('pronta');
    desenha(MAX);
    setTimeout(function () { desenha(0); girar(); }, 190);
  }

  al.addEventListener('pointerdown', comeca);
  addEventListener('pointermove', move, { passive: false });
  addEventListener('pointerup', solta);
  addEventListener('pointercancel', solta);

  // um toque curto, sem arrastar, conta como clique
  var tDown = 0;
  al.addEventListener('pointerdown', function () { tDown = Date.now(); });
  addEventListener('pointerup', function () {
    if (tDown && Date.now() - tDown < 220 && grau === 0 && !GIRANDO) clique();
    tDown = 0;
  });

  al.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); clique(); }
  });
}

/* ============================================================
   O NOME
   ============================================================ */
function assume(nome) {
  NOME = nome;
  $('cartao-nome').style.display = 'none';
  $('jogador').classList.add('on');
  $('jogador-nome').textContent = nome;
  $('inicial').textContent = (nome.trim()[0] || '?').toUpperCase();
  travaTela(false);
  recado('');
  try { sessionStorage.setItem('startplay_nome', nome); } catch (e) { }
}

function pedeNome() {
  NOME = '';
  $('jogador').classList.remove('on');
  $('cartao-nome').style.display = '';
  travaTela(true);
  $('alavanca').classList.remove('pronta');
  setTimeout(function () { $('nome').focus(); }, 80);
  try { sessionStorage.removeItem('startplay_nome'); } catch (e) { }
}

function confirmaNome() {
  var v = $('nome').value.trim().replace(/\s+/g, ' ');
  if (v.length < 2) {
    $('nome').classList.add('ruim');
    recado('Escreva o seu nome para liberar a alavanca.');
    $('nome').focus();
    return;
  }
  $('nome').classList.remove('ruim');
  acordaSom();
  assume(v);
}

/* ============================================================
   CARREGAR E ABRIR
   ============================================================ */
async function carregaRoleta() {
  var r = await (await fetch('/api/play?action=play_roleta')).json();
  if (!r.ok) throw new Error(r.error || 'não deu para carregar a roleta');
  PREMIOS = r.premios || [];
  return r;
}

function entrada() {
  // 1) fundo (já está), 2) título, 3) roda, 4) lâmpadas acendem em
  // sequência, 5) alavanca acena. Tudo em menos de 2 segundos.
  var passos = [['e-marca', 60], ['e-cabeca', 180], ['e-mesa', 440]];
  passos.forEach(function (p) {
    setTimeout(function () { $(p[0]).classList.add('veio'); }, p[1]);
  });
  setTimeout(function () { $('cartao-nome').classList.add('veio'); }, 620);

  setTimeout(function () {
    var ls = lampadas();
    ls.forEach(function (l, i) {
      setTimeout(function () {
        l.classList.add('nasceu', 'acesa');
        setTimeout(function () { l.classList.remove('acesa'); }, 320);
      }, i * 26);
    });
  }, 760);
}

(async function iniciar() {
  pintaBotaoSom();
  poeira();
  montaLampadas();
  ligaAlavanca();

  $('som').addEventListener('click', function () {
    SOM_LIGADO = !SOM_LIGADO;
    pintaBotaoSom();
    if (SOM_LIGADO) { acordaSom(); bip(880, 0.1, 'triangle', 0.07); }
    try { localStorage.setItem('startplay_som', SOM_LIGADO ? '1' : '0'); } catch (e) { }
  });
  try {
    var g = localStorage.getItem('startplay_som');
    if (g === '0') { SOM_LIGADO = false; pintaBotaoSom(); }
  } catch (e) { }

  $('btn-play').addEventListener('click', confirmaNome);
  $('nome').addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') { ev.preventDefault(); confirmaNome(); }
  });
  $('nome').addEventListener('input', function () { this.classList.remove('ruim'); recado(''); });
  $('trocar').addEventListener('click', function () { if (!GIRANDO) pedeNome(); });

  $('btn-fechar').addEventListener('click', fechaPremio);
  $('btn-denovo').addEventListener('click', function () { fechaPremio(); setTimeout(girar, 220); });
  $('veu').addEventListener('click', function (ev) { if (ev.target === $('veu')) fechaPremio(); });
  addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && $('veu').classList.contains('on')) fechaPremio();
  });

  // Se a pessoa recarregar no meio da animação, o giro já está
  // gravado no servidor: a página volta limpa, sem prêmio pendurado.
  try {
    var salvo = sessionStorage.getItem('startplay_nome');
    if (salvo) assume(salvo); else travaTela(true);
  } catch (e) { travaTela(true); }

  try {
    await carregaRoleta();
    desenhaRoda();
    if (PREMIOS.length < 2) {
      recado('A roleta ainda não tem prêmios suficientes. Fale com a Start.');
      travaTela(true);
    }
  } catch (e) {
    recado('Não consegui carregar a roleta. Atualize a página.');
  }

  entrada();
})();
