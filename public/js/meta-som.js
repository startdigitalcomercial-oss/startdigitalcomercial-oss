/* ============================================================
   O SOM DA VENDA

   Cinco segundos de festa, montados no navegador na hora de tocar.
   Não existe MP3 neste sistema — e isso foi escolha, não limitação
   contornada:

     · nenhum arquivo para baixar, nenhuma pasta para publicar,
       nenhum CDN que pode sair do ar numa segunda-feira;
     · nenhuma licença de banco de áudio tocando o dia inteiro na
       parede de uma empresa;
     · 20 KB de código em vez de 105 KB por som, e os três cabem
       no mesmo espaço;
     · e o sistema inteiro continua sem uma única dependência.

   O som foi desenhado primeiro em Python (tools/faz-som-da-venda.py,
   que continua no repositório e gera os MP3 de referência) e depois
   portado para cá nota por nota. O arquivo de lá serve para ouvir e
   comparar; o que toca na televisão é este aqui.

   ------------------------------------------------------------
   O QUE FAZ UM SOM PARECER CARO

   1. TRANSIENTE. Os primeiros 20 milissegundos decidem tudo. Um
      estalo curto de ruído filtrado faz o som "cortar" o barulho do
      escritório. Sem ele, qualquer nota soa mole.

   2. PARCIAIS INARMÔNICOS. Sino de verdade não vibra em múltiplos
      exatos da fundamental. Usar 2,76× e 5,40× — razões medidas em
      sinos de bronze — é o que separa "sino" de "flauta".

   3. CADA PARCIAL COM O SEU TEMPO. O agudo some rápido, o grave
      sustenta. Se todos caem juntos, o ouvido ouve órgão.

   4. ALGO QUE SE SUSTENTA. Só com sinos, o som morre em dois
      segundos — medimos isso na primeira versão: sobrava 1% de
      energia aos 4s, ou seja, cinco segundos de arquivo para dois
      de celebração. Por baixo dos sinos existe um acorde segurando.

   5. REVERB. Som seco parece alarme de celular. Uma sala curta já
      resolve, e aqui ela é feita com ruído que decai — o jeito
      clássico de fabricar uma reverberação sem ter gravado nenhuma.
   ============================================================ */
'use strict';

var MetaSom = (function () {

  var ctx = null;
  var sala = null;        // o impulso do reverb, feito uma vez só
  var mestre = null;      // volume geral
  var envio = null;       // quanto vai para a sala

  /* ------------------------------------------------------------
     AS NOTAS
     Dó maior: a escolha óbvia, e óbvia por um motivo — é o acorde
     que o ouvido lê como "deu certo" sem precisar de contexto.
     ------------------------------------------------------------ */
  var C3 = 130.81, C4 = 261.63, G4 = 392.00;
  var C5 = 523.25, E5 = 659.25, G5 = 783.99;
  var C6 = 1046.50, E6 = 1318.51, G6 = 1567.98, C7 = 2093.00;

  function contexto() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch (e) { return null; }

    mestre = ctx.createGain();
    mestre.gain.value = 0.9;

    // Um compressor de pico bem suave no fim da cadeia. Não é para
    // "esmagar": é o cinto de segurança para quando trinta
    // osciladores somam no mesmo instante e estouram o alto-falante.
    var trava = ctx.createDynamicsCompressor();
    trava.threshold.value = -8;
    trava.knee.value = 6;
    trava.ratio.value = 6;
    trava.attack.value = 0.003;
    trava.release.value = 0.12;

    mestre.connect(trava);
    trava.connect(ctx.destination);

    // A sala: ruído que decai. É assim que se fabrica uma
    // reverberação quando não se gravou nenhuma — e para dois
    // segundos de cauda, ninguém distingue da gravada.
    var conv = ctx.createConvolver();
    conv.buffer = fazSala(2.1, 2.6);
    envio = ctx.createGain();
    envio.gain.value = 0.34;
    envio.connect(conv);
    conv.connect(mestre);
    sala = conv;

    return ctx;
  }

  function fazSala(segundos, curva) {
    var n = Math.floor(ctx.sampleRate * segundos);
    var buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (var c = 0; c < 2; c++) {
      var d = buf.getChannelData(c);
      for (var i = 0; i < n; i++) {
        // Os dois lados com ruído diferente: é o que faz a sala
        // soar larga em vez de sair de um ponto só.
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, curva);
      }
    }
    return buf;
  }

  // Todo mundo passa por aqui: um pouco direto, um pouco pela sala.
  function liga(no) {
    no.connect(mestre);
    if (envio) no.connect(envio);
  }

  function ruido(segundos) {
    var n = Math.floor(ctx.sampleRate * segundos);
    var buf = ctx.createBuffer(1, n, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /* ------------------------------------------------------------
     QUEDA EXPONENCIAL

     exponentialRampToValueAtTime não aceita zero — é a pegadinha
     clássica do WebAudio: passar 0 faz a rampa ser ignorada em
     silêncio e a nota fica tocando para sempre. Por isso todas as
     quedas terminam em 0,0001 e só então o oscilador é desligado.
     ------------------------------------------------------------ */
  function cai(g, t0, pico, dur, ataque) {
    ataque = ataque === undefined ? 0.006 : ataque;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(pico, 0.0002), t0 + ataque);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }

  /* ------------------------------------------------------------
     O SINO

     Parciais inarmônicos, cada um com a sua amplitude e o seu
     tempo de vida. As razões vêm de sinos de bronze de verdade.
     ------------------------------------------------------------ */
  var PARCIAIS = [
    [0.50, 0.30, 1.70], [1.00, 1.00, 1.00], [2.00, 0.32, 0.70],
    [2.76, 0.26, 0.52], [4.07, 0.14, 0.36], [5.40, 0.09, 0.26]
  ];

  function sino(t0, freq, dur, amp) {
    for (var i = 0; i < PARCIAIS.length; i++) {
      var p = PARCIAIS[i];
      var f = freq * p[0];
      if (f > ctx.sampleRate / 2.2) continue;

      var g = ctx.createGain();
      cai(g, t0, amp * p[1] * 0.5, dur * p[2], 0.004);
      liga(g);

      // Dois osciladores quase iguais por parcial: o batimento
      // entre eles é o que faz o sino "tremer" em vez de ficar
      // parado como uma nota de teclado.
      for (var k = 0; k < 2; k++) {
        var o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f * (k ? 1.003 : 1);
        o.connect(g);
        o.start(t0);
        o.stop(t0 + dur * p[2] + 0.1);
      }
    }
  }

  /* ------------------------------------------------------------
     SINO FM — mais metálico e brilhante, por bem menos nós
     ------------------------------------------------------------ */
  function fm(t0, freq, dur, amp, razao, indice) {
    var port = ctx.createOscillator();
    port.type = 'sine';
    port.frequency.value = freq;

    var mod = ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.value = freq * (razao || 1.41);

    var profundidade = ctx.createGain();
    var ind = (indice || 5) * freq;
    profundidade.gain.setValueAtTime(ind, t0);
    profundidade.gain.exponentialRampToValueAtTime(Math.max(ind * 0.02, 1), t0 + dur * 0.3);

    mod.connect(profundidade);
    profundidade.connect(port.frequency);

    var g = ctx.createGain();
    cai(g, t0, amp, dur, 0.004);
    port.connect(g);
    liga(g);

    port.start(t0); mod.start(t0);
    port.stop(t0 + dur + 0.1); mod.stop(t0 + dur + 0.1);
  }

  /* ------------------------------------------------------------
     O ACORDE QUE SEGURA

     Três osciladores levemente desafinados por nota — o truque do
     "coro". Um oscilador sozinho soa sintetizador barato; três
     brigando de leve entre si soam instrumento.
     ------------------------------------------------------------ */
  function pad(t0, freqs, dur, amp, ataque, brilho) {
    ataque = ataque || 0.16;
    var solta = Math.min(1.6, dur * 0.38);

    var filtro = ctx.createBiquadFilter();
    filtro.type = 'lowpass';
    filtro.frequency.value = 1400 * (brilho || 1);
    filtro.Q.value = 0.7;

    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(amp, t0 + ataque);
    g.gain.setValueAtTime(amp, t0 + dur - solta);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    filtro.connect(g);
    liga(g);

    // A respiração: sem ela, um acorde parado por três segundos
    // vira zumbido de geladeira.
    var lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.85;
    var prof = ctx.createGain();
    prof.gain.value = amp * 0.16;
    lfo.connect(prof);
    prof.connect(g.gain);
    lfo.start(t0);
    lfo.stop(t0 + dur + 0.1);

    for (var j = 0; j < freqs.length; j++) {
      var peso = 1 / (j + 1.7);
      for (var k = -1; k <= 1; k++) {
        var o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = freqs[j];
        o.detune.value = k * 7;            // ~7 cents: o bastante para encorpar
        var gv = ctx.createGain();
        gv.gain.value = peso * 0.33;
        o.connect(gv);
        gv.connect(filtro);
        o.start(t0);
        o.stop(t0 + dur + 0.1);
      }
    }
  }

  /* O transiente: ruído com passa-altas e queda muito rápida. */
  function estalo(t0, dur, amp, corte) {
    var src = ctx.createBufferSource();
    src.buffer = ruido(dur + 0.02);

    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = corte || 2200;

    var g = ctx.createGain();
    cai(g, t0, amp, dur, 0.001);

    src.connect(hp); hp.connect(g); liga(g);
    src.start(t0); src.stop(t0 + dur + 0.05);
  }

  /* Corpo grave: dá peso sem precisar de volume. A frequência cai,
     que é o que faz soar "bumbo" em vez de "nota". */
  function thump(t0, freq, dur, amp) {
    var o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq * 2.6, t0);
    o.frequency.exponentialRampToValueAtTime(freq, t0 + 0.09);

    var g = ctx.createGain();
    cai(g, t0, amp, dur, 0.004);
    o.connect(g); liga(g);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  /* Ruído subindo: prepara o ouvido para o golpe que vem. */
  function riser(t0, dur, amp, de, ate) {
    var src = ctx.createBufferSource();
    src.buffer = ruido(dur + 0.05);

    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(de, t0);
    bp.frequency.exponentialRampToValueAtTime(ate, t0 + dur);

    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(amp, t0 + dur * 0.92);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.08);

    src.connect(bp); bp.connect(g); liga(g);
    src.start(t0); src.stop(t0 + dur + 0.15);
  }

  /* ============================================================
     OS TRÊS SONS
     ============================================================ */

  // FANFARRA — cha-ching, subida, acorde que abre e segura.
  //   0,0s  o golpe        1,8s  realce na quinta
  //   0,2s  a subida       2,7s  realce uma oitava acima
  //   0,6s  o acorde       3,5s  a resolução e a cauda
  function fanfarra(t0) {
    estalo(t0, 0.05, 0.30, 3000);
    thump(t0, 85, 0.5, 0.34);
    sino(t0, 2100, 0.22, 0.42);
    sino(t0 + 0.055, 2640, 0.28, 0.32);

    var subida = [C5, E5, G5, C6];
    for (var i = 0; i < subida.length; i++) {
      fm(t0 + 0.18 + i * 0.10, subida[i], 1.0 + i * 0.25, 0.26 - i * 0.015, 1.41, 5.2);
    }

    pad(t0 + 0.55, [C4, G4, C5, E5, G5, C6], 4.3, 0.44, 0.14, 1.0);
    sino(t0 + 0.56, C4, 2.4, 0.26);
    sino(t0 + 0.56, C5, 2.4, 0.24);
    sino(t0 + 0.57, E5, 2.0, 0.17);

    sino(t0 + 1.80, G5, 2.4, 0.30);
    fm(t0 + 1.84, E6, 1.7, 0.13, 2.01, 3.0);

    sino(t0 + 2.70, C6, 2.3, 0.29);
    fm(t0 + 2.76, G6, 1.6, 0.12, 2.01, 2.6);

    sino(t0 + 3.50, C5, 2.4, 0.40);
    sino(t0 + 3.50, C4, 2.3, 0.26);
    fm(t0 + 3.58, C7, 1.2, 0.07, 3.01, 2.0);
    return 5.2;
  }

  // CONQUISTA — murro, subida rápida, riser e segundo golpe.
  function conquista(t0) {
    estalo(t0, 0.07, 0.40, 1800);
    thump(t0, 62, 0.7, 0.46);

    var arp = [G4, C5, E5, G5, C6];
    for (var i = 0; i < arp.length; i++) {
      fm(t0 + i * 0.078, arp[i], 0.85, 0.25 - i * 0.012, 2.0, 4.0);
    }

    estalo(t0 + 0.40, 0.04, 0.24, 4000);
    sino(t0 + 0.41, C4, 2.8, 0.23);
    sino(t0 + 0.41, C5, 2.8, 0.24);
    sino(t0 + 0.42, G5, 2.2, 0.16);
    pad(t0 + 0.44, [C4, G4, C5, E5, G5], 3.1, 0.38, 0.10, 1.25);

    riser(t0 + 1.55, 0.95, 0.17, 260, 3200);

    estalo(t0 + 2.52, 0.06, 0.34, 2400);
    thump(t0 + 2.52, 58, 0.7, 0.35);
    sino(t0 + 2.54, C4, 2.5, 0.21);
    sino(t0 + 2.54, C5, 2.5, 0.23);
    sino(t0 + 2.55, C6, 2.0, 0.15);
    pad(t0 + 2.55, [C4, G4, C5, E5, G5, C6], 2.6, 0.38, 0.06, 1.3);

    var faiscas = [[C6, 3.15], [E6, 3.45], [G6, 3.75], [C7, 4.05]];
    for (var k = 0; k < faiscas.length; k++) {
      fm(t0 + faiscas[k][1], faiscas[k][0], 1.3, 0.11, 3.01, 2.2);
    }
    return 5.2;
  }

  // PREGÃO — badalada de abertura de bolsa. O mais sóbrio.
  function pregao(t0) {
    estalo(t0, 0.09, 0.28, 1200);
    thump(t0, 55, 0.9, 0.34);

    sino(t0, C4, 4.2, 0.52);
    sino(t0 + 0.012, G4, 3.4, 0.24);
    sino(t0 + 0.03, C5, 2.8, 0.15);

    pad(t0 + 0.20, [C3, C4, G4, C5, E5], 4.5, 0.40, 0.55, 0.95);

    sino(t0 + 1.70, C4, 3.4, 0.42);
    sino(t0 + 1.72, G4, 2.6, 0.14);

    sino(t0 + 3.30, C4, 2.8, 0.36);
    sino(t0 + 3.33, C5, 2.2, 0.15);

    fm(t0 + 0.10, E5, 2.2, 0.08, 1.5, 2.6);
    fm(t0 + 1.78, G5, 1.8, 0.06, 1.5, 2.0);
    return 5.4;
  }

  var RECEITAS = { fanfarra: fanfarra, conquista: conquista, pregao: pregao };

  /* ------------------------------------------------------------
     TOCAR
     ------------------------------------------------------------ */
  function toca(qual) {
    var c = contexto();
    if (!c) return false;

    // Aba que ficou escondida suspende o contexto. Acordar é barato
    // e não dá erro se ele já estava acordado.
    if (c.state === 'suspended') { try { c.resume(); } catch (e) { } }
    if (c.state === 'suspended') return false;   // o navegador ainda não liberou

    var receita = RECEITAS[qual] || RECEITAS.fanfarra;
    try {
      // +0,04s: dá uma folga para o navegador agendar tudo antes do
      // primeiro som. Sem ela, o estalo inicial às vezes sai cortado.
      receita(c.currentTime + 0.04);
      return true;
    } catch (e) { return false; }
  }

  // Deixa o contexto pronto antes da primeira venda. Chamado no
  // clique de "Ativar som", que é o gesto que o navegador exige.
  function acorda() {
    var c = contexto();
    if (!c) return false;
    if (c.state === 'suspended') { try { c.resume(); } catch (e) { } }
    return c.state === 'running';
  }

  function nomes() { return Object.keys(RECEITAS); }
  function existe(qual) { return !!RECEITAS[qual]; }
  function duracao(qual) { return qual === 'pregao' ? 5.4 : 5.2; }

  /* ------------------------------------------------------------
     RENDERIZAR SEM TOCAR

     Existe para o teste poder MEDIR o som em vez de confiar nele.
     Monta o mesmo som num contexto "offline" (que calcula as
     amostras o mais rápido que a máquina aguentar, sem mandar nada
     para o alto-falante) e devolve as amostras prontas.

     Com isso o teste consegue perguntar coisas que ouvido nenhum
     responde com precisão: o som dura mesmo cinco segundos? Ainda
     tem energia aos três? O pico está abaixo de zero? É assim que
     uma mudança no som deixa de ser "achei que ficou bom".
     ------------------------------------------------------------ */
  function renderiza(qual, aoTerminar) {
    var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OAC) return aoTerminar(null);

    var dur = duracao(qual) + 0.4;
    var off = new OAC(2, Math.ceil(44100 * dur), 44100);

    // Os construtores de voz falam com as variáveis do módulo.
    // Apontamos elas para o contexto offline, montamos, e
    // devolvemos tudo para o lugar — sem duplicar uma linha da
    // receita, que é justamente o ponto: o teste mede o som que
    // toca, não uma cópia dele que pode divergir.
    var guardaCtx = ctx, guardaMestre = mestre, guardaEnvio = envio, guardaSala = sala;
    ctx = off;

    mestre = off.createGain();
    mestre.gain.value = 0.9;
    var trava = off.createDynamicsCompressor();
    trava.threshold.value = -8; trava.knee.value = 6; trava.ratio.value = 6;
    trava.attack.value = 0.003; trava.release.value = 0.12;
    mestre.connect(trava); trava.connect(off.destination);

    var conv = off.createConvolver();
    conv.buffer = fazSala(2.1, 2.6);
    envio = off.createGain();
    envio.gain.value = 0.34;
    envio.connect(conv); conv.connect(mestre);
    sala = conv;

    (RECEITAS[qual] || RECEITAS.fanfarra)(0.02);

    ctx = guardaCtx; mestre = guardaMestre; envio = guardaEnvio; sala = guardaSala;

    off.startRendering().then(function (buf) { aoTerminar(buf); })
      .catch(function () { aoTerminar(null); });
  }

  return {
    toca: toca, acorda: acorda, nomes: nomes,
    existe: existe, duracao: duracao,
    renderiza: renderiza,
    _receitas: RECEITAS,
    _contexto: contexto
  };
})();
