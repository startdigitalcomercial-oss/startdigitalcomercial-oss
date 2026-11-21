/* ============================================================
   META EM TEMPO REAL — o motor do placar

   Um arquivo só, usado por DUAS telas:

     public/meta.html          a televisão da sala
     Comercial → Meta          o mesmo placar dentro do painel

   Por que um só: se o placar da TV e o placar do painel fossem
   dois códigos, um dia eles mostrariam números diferentes do mesmo
   mês — e aí ninguém sabe em qual acreditar. Quem usa este arquivo
   só precisa dizer DE ONDE vêm os dados; o resto é igual nos dois.

   As quatro coisas difíceis daqui, em ordem de malícia:

   1) NÃO CELEBRAR VENDA ANTIGA.
      A TV vai recarregar, perder wi-fi e voltar, ser desligada no
      fim do dia. Em todas essas horas ela recebe a lista inteira do
      mês de novo. Se "chegou um lançamento" significasse "celebra",
      a TV soltaria vinte confetes às oito da manhã. Então a PRIMEIRA
      resposta que o placar recebe nunca celebra: ela só anota quais
      lançamentos já existiam. Festa só para id que apareceu depois
      disso, e cada id celebra uma vez na vida.

   2) O NAVEGADOR NÃO DEIXA TOCAR SOM SOZINHO.
      Som sem alguém ter clicado em algo é bloqueado, e é regra boa:
      imagine abrir uma aba e ela gritar. Por isso existe o botão
      "Ativar som": ele vale como o clique que o navegador exige, e
      a partir dali o sino toca sozinho a cada venda. A escolha fica
      guardada naquela TV.

   3) O SINO NÃO É UM ARQUIVO.
      Não existe .mp3 em lugar nenhum: o sino é feito na hora, com
      três senoides que decaem. Som sintetizado não precisa ser
      baixado, não tem direito autoral, não quebra quando um CDN sai
      do ar e pesa zero byte. São umas quarenta linhas de código em
      vez de 40 KB de download.

   4) O RITMO DAS PERGUNTAS.
      A TV pergunta "mudou algo?" o dia inteiro. Perguntar a cada
      segundo seria desperdício; a cada minuto não pareceria ao
      vivo. Então o ritmo é elástico: 4 segundos quando a casa está
      quente, afrouxando até 30 quando nada acontece há tempo, e de
      volta para 4 no instante em que algo muda. Aba escondida
      pergunta de minuto em minuto. Perto de 95% das perguntas são
      respondidas com "igual" — algumas dezenas de bytes.
   ============================================================ */
'use strict';

var MetaPlacar = (function () {

  /* ------------------------------------------------------------
     DINHEIRO NA TELA

     O servidor manda centavos (número inteiro). Aqui vira texto.
     Nunca o contrário: conta de dinheiro não se faz no navegador.
     ------------------------------------------------------------ */
  var fmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function moeda(centavos) {
    return 'R$ ' + fmt.format((Number(centavos) || 0) / 100);
  }

  // A versão do número grande: os centavos ficam pequenos e
  // apagados, para não disputar atenção com os reais.
  function moedaRica(centavos) {
    var txt = fmt.format((Number(centavos) || 0) / 100);
    var corte = txt.lastIndexOf(',');
    var reais = corte < 0 ? txt : txt.slice(0, corte);
    var cent = corte < 0 ? '' : txt.slice(corte);
    return '<span class="mt-moeda">R$</span>' + esc(reais) +
      (cent ? '<span class="mt-cent">' + esc(cent) + '</span>' : '');
  }

  // Valor curto, para o rodapé e a barra: sem centavos, que ali não
  // mudam nada e só fazem a linha ficar comprida.
  function moedaCurta(centavos) {
    return 'R$ ' + new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })
      .format(Math.round((Number(centavos) || 0) / 100));
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function calado() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* ------------------------------------------------------------
     O SOM DA VENDA

     Cinco segundos de verdade, montados na hora pelo meta-som.js.
     Não existe arquivo de áudio neste sistema — o porquê está
     explicado lá, com a receita de cada som.

     Aqui ficam só os dois cuidados de quem CHAMA o som:

     1. O NAVEGADOR BLOQUEIA ÁUDIO AUTOMÁTICO, e é regra boa:
        imagine abrir uma aba e ela gritar. O botão "Ativar som"
        vale como o clique que o navegador exige, e a partir dali
        a televisão toca sozinha a cada venda.

     2. SE NÃO DER PARA TOCAR, A VENDA NÃO PASSA MUDA. Navegador
        velho sem WebAudio, áudio ainda bloqueado, qualquer coisa:
        entra o sino simples, feito com três senoides. Som pior é
        muito melhor que silêncio no dia em que a equipe fechou a
        maior venda do mês.
     ------------------------------------------------------------ */
  var ctxReserva = null;

  function contextoReserva() {
    if (ctxReserva) return ctxReserva;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctxReserva = new AC(); } catch (e) { ctxReserva = null; }
    return ctxReserva;
  }

  /* O SINO DE EMERGÊNCIA

     Três senoides afinadas em oitava e quinta (880, 1320 e 2640 Hz)
     caindo juntas: a receita mais simples de "sino". O agudo some
     rápido, o grave sustenta. Não é o hit e nem tenta ser — é o que
     garante que uma venda nunca passe despercebida. */
  function sinoSimples() {
    var c = contextoReserva();
    if (!c) return;
    if (c.state === 'suspended') { try { c.resume(); } catch (e) { } }

    var t0 = c.currentTime + 0.01;
    [{ hz: 880, vol: 0.30, dur: 1.5 },
     { hz: 1320, vol: 0.16, dur: 1.1 },
     { hz: 2640, vol: 0.07, dur: 0.6 }].forEach(function (p) {
      var osc = c.createOscillator();
      var g = c.createGain();
      osc.type = 'sine';
      osc.frequency.value = p.hz;
      // Ataque curtíssimo e queda exponencial: é isso que faz o
      // ouvido entender "badalada" em vez de "apito".
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(p.vol, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + p.dur);
      osc.connect(g); g.connect(c.destination);
      osc.start(t0); osc.stop(t0 + p.dur + 0.05);
    });
  }

  function tocaHit(qual) {
    var deu = false;
    if (window.MetaSom) {
      try { deu = MetaSom.toca(qual || 'fanfarra'); } catch (e) { deu = false; }
    }
    if (!deu) sinoSimples();
  }

  /* ------------------------------------------------------------
     O CONFETE

     Canvas, uns 110 papelzinhos, gravidade e giro. Dura 2,6
     segundos e então o laço PARA: nada de requestAnimationFrame
     girando para sempre numa tela que fica ligada doze horas.
     ------------------------------------------------------------ */
  function confete(canvas) {
    if (!canvas || calado()) return;

    var ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Numa tela cheia de 1920 com devicePixelRatio 2, o canvas
    // teria 8 milhões de pixels para pintar 60 vezes por segundo.
    // Travar em 1,5 mantém a nitidez e não faz a TV suar.
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    var L = canvas.clientWidth || window.innerWidth;
    var A = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(L * dpr);
    canvas.height = Math.round(A * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var cores = ['#4F7CFF', '#8B5CF6', '#38BDF8', '#34D399', '#E9EDFB'];
    var pecas = [];
    for (var i = 0; i < 150; i++) {
      pecas.push({
        x: L * (0.06 + Math.random() * 0.88),
        // Nascem logo acima da borda, não meia tela acima: espalhar
        // demais faz metade do confete gastar a vida inteira voando
        // num lugar onde ninguém vê.
        y: -14 - Math.random() * A * 0.16,
        // CADA PAPEL TEM A SUA HORA.
        //
        // Soltando todos de uma vez, a chuva acaba em um segundo e
        // meio e sobram três segundos e meio de som tocando numa
        // tela parada. Espalhando o nascimento (com peso para o
        // começo, pelo quadrado do sorteio), a primeira leva cai
        // forte e as retardatárias seguram o espetáculo até o som
        // terminar.
        nasce: Math.pow(Math.random(), 2) * 2100,
        l: 5 + Math.random() * 5,
        a: 8 + Math.random() * 7,
        vx: (Math.random() - 0.5) * 1.7,
        vy: 2.1 + Math.random() * 2.6,
        giro: Math.random() * Math.PI,
        dgiro: (Math.random() - 0.5) * 0.22,
        cor: cores[(Math.random() * cores.length) | 0]
      });
    }

    var inicio = null;
    var anterior = null;
    // Dura quase tanto quanto o som. Confete que acaba em dois
    // segundos com um hit de cinco tocando faz a festa parecer que
    // deu defeito no meio.
    var VIDA = 4600;
    var pedido = 0;

    function quadro(agora) {
      if (inicio === null) { inicio = agora; anterior = agora; }
      var passado = agora - inicio;

      // O TEMPO MANDA, NÃO O QUADRO.
      //
      // A primeira versão disto somava "mais 2 pixels por quadro", o
      // que só funciona se o navegador entregar 60 quadros por
      // segundo. Medimos num navegador que entregava 6: o confete
      // caía dez vezes mais devagar e o tempo acabava com os papéis
      // ainda no alto da tela — a festa acontecia fora do quadro.
      //
      // Agora cada passo é multiplicado por quanto tempo passou de
      // verdade. Em 60 quadros por segundo o fator é 1; em 20, é 3;
      // numa TV velha engasgando, é o que tiver de ser. O confete
      // leva os mesmos 2,6 segundos para cair em qualquer máquina,
      // que é o que a pessoa olhando enxerga.
      var dt = Math.min((agora - anterior) / 16.67, 4);   // teto: travada não teleporta
      anterior = agora;

      ctx.clearRect(0, 0, L, A);

      // Sumir no fim em vez de desaparecer de uma vez.
      ctx.globalAlpha = passado > VIDA - 600 ? Math.max(0, (VIDA - passado) / 600) : 1;

      for (var i = 0; i < pecas.length; i++) {
        var p = pecas[i];
        if (passado < p.nasce) continue;      // esse ainda não foi solto
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 0.035 * dt;                // gravidade
        p.vx *= Math.pow(0.995, dt);       // o ar freia de lado
        p.giro += p.dgiro * dt;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.giro);
        ctx.fillStyle = p.cor;
        ctx.fillRect(-p.l / 2, -p.a / 2, p.l, p.a);
        ctx.restore();
      }

      if (passado < VIDA) {
        pedido = requestAnimationFrame(quadro);
      } else {
        // Limpa e solta o laço. A partir daqui o canvas não custa
        // mais nada — é um elemento transparente parado.
        cancelAnimationFrame(pedido);
        ctx.clearRect(0, 0, L, A);
        ctx.globalAlpha = 1;
      }
    }

    pedido = requestAnimationFrame(quadro);
  }

  /* ------------------------------------------------------------
     A CONTAGEM DO NÚMERO

     Trocar R$ 50.000 por R$ 55.000 num piscar não conta história
     nenhuma. Subir em 1,4 segundo, desacelerando no fim, conta.

     O easeOutCubic é o que dá a sensação de "chegou": rápido no
     começo, quase parando no alvo. E qualquer animação anterior é
     cancelada antes de começar outra — duas contagens no mesmo
     elemento brigariam pelo texto e o número tremeria.
     ------------------------------------------------------------ */
  var animacoes = {};

  function anima(el, de, para, chave) {
    if (!el) return;
    if (animacoes[chave]) cancelAnimationFrame(animacoes[chave]);

    de = Number(de) || 0;
    para = Number(para) || 0;

    // Sem movimento pedido, ou diferença pequena: põe o valor e sai.
    if (calado() || de === para) {
      el.innerHTML = moedaRica(para);
      return;
    }

    var DUR = 1400;
    var t0 = null;

    function passo(agora) {
      if (t0 === null) t0 = agora;
      var f = Math.min(1, (agora - t0) / DUR);
      var e = 1 - Math.pow(1 - f, 3);
      el.innerHTML = moedaRica(Math.round(de + (para - de) * e));
      if (f < 1) animacoes[chave] = requestAnimationFrame(passo);
      else {
        delete animacoes[chave];
        el.innerHTML = moedaRica(para);   // fecha exato, sem erro de arredondamento
      }
    }
    animacoes[chave] = requestAnimationFrame(passo);
  }

  /* ------------------------------------------------------------
     O DESENHO DO PLACAR
     ------------------------------------------------------------ */
  function html(d, opts) {
    opts = opts || {};
    var alvo = Number(d.alvo_centavos) || 0;
    var total = Number(d.total) || 0;
    var pct = alvo > 0 ? Math.min(100, (total / alvo) * 100) : 0;
    var bateu = alvo > 0 && total >= alvo;

    var acoes = '';
    if (opts.comSom) {
      acoes += '<button type="button" class="mt-botao" id="mt-som" aria-pressed="false">' +
        '<span id="mt-som-ico">🔇</span><span id="mt-som-txt">Ativar som</span></button>';
    }
    if (opts.comTela) {
      acoes += '<button type="button" class="mt-botao" id="mt-tela" title="Tela cheia">' +
        '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>' +
        '<span class="mt-tela-txt">Tela cheia</span></button>';
    }

    return '' +
      '<div class="mt-topo">' +
        '<div class="mt-titulo">Meta <b>' + esc(d.mes_nome || '') + ' ' + esc(d.ano || '') + '</b></div>' +
        '<div class="mt-acoes">' +
          '<span class="mt-ao-vivo" id="mt-vivo"><span class="mt-bolha"></span><span id="mt-vivo-txt">Ao vivo</span></span>' +
          acoes +
        '</div>' +
      '</div>' +

      '<div class="mt-palco">' +
        '<div class="mt-rotulo">Total acumulado</div>' +
        '<span class="mt-valor" id="mt-total">' + moedaRica(total) + '</span>' +
        (alvo > 0
          ? '<div class="mt-barra-fora">' +
              '<div class="mt-trilho">' +
                '<div class="mt-fita' + (bateu ? ' bateu' : '') + '" id="mt-fita" style="width:' + pct.toFixed(1) + '%"></div>' +
              '</div>' +
              '<div class="mt-barra-pe">' +
                '<span id="mt-pct">' + (bateu
                  ? '<span class="ok">Meta batida! ' + Math.round(pct) + '%</span>'
                  : '<b>' + Math.round(pct) + '%</b> da meta') + '</span>' +
                '<span id="mt-falta">' + (bateu
                  ? 'Alvo: ' + esc(moedaCurta(alvo))
                  : 'Faltam <b>' + esc(moedaCurta(alvo - total)) + '</b> de ' + esc(moedaCurta(alvo))) + '</span>' +
              '</div>' +
            '</div>'
          : '') +
      '</div>' +

      '<div class="mt-duo">' +
        metade('cm', 'Comercial', d.comercial) +
        metade('op', 'Operacional', d.operacional) +
      '</div>' +

      '<div class="mt-pe">' +
        '<span><b>' + (Number(d.quantidade) || 0) + '</b> ' +
          ((Number(d.quantidade) || 0) === 1 ? 'lançamento este mês' : 'lançamentos este mês') + '</span>' +
        (d.anterior && d.anterior.total
          ? '<span>' + esc(d.anterior.mes_nome) + ' fechou em <b>' + esc(moedaCurta(d.anterior.total)) + '</b></span>'
          : '') +
      '</div>';
  }

  function metade(classe, rotulo, centavos) {
    return '<div class="mt-meia ' + classe + '">' +
      '<div class="mt-meia-cab"><span class="mt-pingo"></span>' + esc(rotulo) + '</div>' +
      '<div class="mt-meia-valor" id="mt-' + classe + '">' + esc(moeda(centavos)) + '</div>' +
      '</div>';
  }

  /* ------------------------------------------------------------
     O POPUP DE CELEBRAÇÃO
     ------------------------------------------------------------ */
  function popup(caixa, l) {
    if (!caixa) return;

    var operacional = l.tipo === 'operacional';
    var quem = l.responsavel || l.user_nome || 'Alguém';
    var frase = operacional ? ' adicionou resultado!' : ' fechou mais uma!';

    caixa.className = 'mt-pop' + (operacional ? ' op' : '');
    caixa.innerHTML =
      '<div class="mt-pop-cab"><span class="mt-pop-foguete">🚀</span>' + esc(quem) + esc(frase) + '</div>' +
      '<div class="mt-pop-valor">+ ' + esc(moeda(l.valor_centavos)) + '</div>' +
      '<div class="mt-pop-pe">' + esc(l.cliente || '') +
        (l.servico ? '<span class="sep">·</span>' + esc(l.servico) : '') + '</div>';

    // O void offsetWidth força o navegador a enxergar o estado "sem
    // .on" antes de ligar a classe. Sem isso ele junta as duas
    // mudanças num só passo e a animação de entrada não acontece.
    caixa.classList.remove('on');
    void caixa.offsetWidth;
    caixa.classList.add('on');
  }

  /* ------------------------------------------------------------
     O PLACAR
     ------------------------------------------------------------ */
  function monta(alvoEl, opts) {
    opts = opts || {};
    if (!alvoEl) return null;

    var buscar = opts.buscar;            // função que devolve os dados
    var LS_SOM = 'start_meta_som';

    var estado = {
      d: null,
      selo: '',
      vistos: null,                      // null = ainda não vi nada (primeira carga)
      celebrando: false,
      fila: [],
      som: false,
      qualSom: 'fanfarra',          // qual som tocar, escolhido no Gerenciador
      vivo: true,
      falhas: 0,
      passo: 0,
      timer: null,
      parado: false
    };

    // O ritmo elástico. O índice sobe a cada resposta "igual" e
    // volta a zero assim que algo muda.
    var RITMO = [4000, 4000, 6000, 8000, 12000, 20000, 30000];
    var RITMO_ESCONDIDO = 60000;

    try { estado.som = localStorage.getItem(LS_SOM) === '1'; } catch (e) { }

    /* ---------------- desenho ---------------- */
    function desenha(d) {
      alvoEl.innerHTML = html(d, { comSom: !!opts.comSom, comTela: !!opts.comTela });
      ligaBotoes();
      pintaVivo();
    }

    // Repintar o placar inteiro a cada atualização apagaria a
    // animação no meio e piscaria a tela. Então, depois da primeira
    // vez, só os números trocam de valor — o resto fica onde está.
    function atualiza(d) {
      var antes = estado.d;
      estado.d = d;

      // Qual som tocar vem junto com o placar: a televisão não tem
      // login para perguntar isso ao painel. Trocar o som no
      // Gerenciador vale a partir da próxima pergunta — ou seja, em
      // poucos segundos, sem ninguém mexer na TV.
      if (d.som && d.som !== estado.qualSom) estado.qualSom = d.som;

      if (!antes) { desenha(d); return; }

      var elTotal = document.getElementById('mt-total');
      if (elTotal) anima(elTotal, antes.total, d.total, 'total');

      var elCm = document.getElementById('mt-cm');
      if (elCm) elCm.textContent = moeda(d.comercial);
      var elOp = document.getElementById('mt-op');
      if (elOp) elOp.textContent = moeda(d.operacional);

      // Mês virou (ou o alvo mudou de 0 para algum valor): aí a
      // estrutura da tela é outra e vale redesenhar de fato.
      if (antes.mes !== d.mes || (!antes.alvo_centavos) !== (!d.alvo_centavos)) {
        desenha(d);
        return;
      }

      var alvo = Number(d.alvo_centavos) || 0;
      if (alvo > 0) {
        var pct = Math.min(100, (d.total / alvo) * 100);
        var bateu = d.total >= alvo;
        var fita = document.getElementById('mt-fita');
        if (fita) {
          fita.style.width = pct.toFixed(1) + '%';
          fita.classList.toggle('bateu', bateu);
        }
        var elPct = document.getElementById('mt-pct');
        if (elPct) {
          elPct.innerHTML = bateu
            ? '<span class="ok">Meta batida! ' + Math.round(pct) + '%</span>'
            : '<b>' + Math.round(pct) + '%</b> da meta';
        }
        var elFalta = document.getElementById('mt-falta');
        if (elFalta) {
          elFalta.innerHTML = bateu
            ? 'Alvo: ' + esc(moedaCurta(alvo))
            : 'Faltam <b>' + esc(moedaCurta(alvo - d.total)) + '</b> de ' + esc(moedaCurta(alvo));
        }
      }

      var pe = alvoEl.querySelector('.mt-pe');
      if (pe) {
        var n = Number(d.quantidade) || 0;
        pe.innerHTML = '<span><b>' + n + '</b> ' +
          (n === 1 ? 'lançamento este mês' : 'lançamentos este mês') + '</span>' +
          (d.anterior && d.anterior.total
            ? '<span>' + esc(d.anterior.mes_nome) + ' fechou em <b>' +
              esc(moedaCurta(d.anterior.total)) + '</b></span>'
            : '');
      }
    }

    /* ---------------- botões ---------------- */
    function ligaBotoes() {
      var bSom = document.getElementById('mt-som');
      if (bSom) {
        bSom.addEventListener('click', function () {
          estado.som = !estado.som;
          try { localStorage.setItem(LS_SOM, estado.som ? '1' : '0'); } catch (e) { }

          // Ligar o som é o clique que o navegador estava esperando.
          // Aproveitamos ELE para tocar o hit inteiro uma vez: assim a
          // pessoa ajusta o volume da TV na hora, ouvindo exatamente o
          // que vai tocar na próxima venda, em vez de descobrir que
          // estava baixo demais no momento errado.
          if (estado.som) {
            if (window.MetaSom) { try { MetaSom.acorda(); } catch (e) { } }
            tocaHit(estado.qualSom);
          }
          pintaSom();
        });
        pintaSom();
      }

      var bTela = document.getElementById('mt-tela');
      if (bTela) {
        bTela.addEventListener('click', function () {
          var raiz = document.documentElement;
          if (document.fullscreenElement) {
            (document.exitFullscreen || function () { }).call(document);
          } else if (raiz.requestFullscreen) {
            raiz.requestFullscreen().catch(function () { });
          }
        });
      }
    }

    function pintaSom() {
      var ico = document.getElementById('mt-som-ico');
      var txt = document.getElementById('mt-som-txt');
      var bt = document.getElementById('mt-som');
      if (ico) ico.textContent = estado.som ? '🔊' : '🔇';
      if (txt) txt.textContent = estado.som ? 'Som ligado' : 'Ativar som';
      if (bt) bt.setAttribute('aria-pressed', estado.som ? 'true' : 'false');
    }

    function pintaVivo() {
      var el = document.getElementById('mt-vivo');
      var txt = document.getElementById('mt-vivo-txt');
      if (el) el.classList.toggle('caiu', !estado.vivo);
      if (txt) txt.textContent = estado.vivo ? 'Ao vivo' : 'Reconectando…';
    }

    /* ---------------- celebração ----------------
       Uma fila, e uma de cada vez. Se três vendas entrarem juntas,
       a tela não pode virar um desfile de trinta segundos: a partir
       de três, viram um popup só. */
    function enfileira(novos) {
      if (!novos.length) return;

      if (novos.length > 2) {
        var soma = novos.reduce(function (t, l) { return t + (Number(l.valor_centavos) || 0); }, 0);
        estado.fila.push({
          tipo: novos[0].tipo,
          responsavel: 'A Start',
          cliente: novos.length + ' novos lançamentos',
          servico: '',
          valor_centavos: soma
        });
      } else {
        novos.forEach(function (l) { estado.fila.push(l); });
      }
      passaFila();
    }

    function passaFila() {
      if (estado.celebrando || !estado.fila.length || estado.parado) return;
      estado.celebrando = true;

      var l = estado.fila.shift();
      popup(opts.pop, l);
      confete(opts.canvas);
      if (estado.som) tocaHit(estado.qualSom);

      setTimeout(function () {
        if (opts.pop) opts.pop.classList.remove('on');
        estado.celebrando = false;
        // Uma pausa curta entre duas celebrações, para a segunda não
        // começar enquanto a primeira ainda está saindo da tela.
        setTimeout(passaFila, 450);
      }, 5200);
    }

    /* ---------------- o laço de perguntas ---------------- */
    async function pergunta() {
      if (estado.parado) return;

      try {
        var d = await buscar(estado.selo);
        estado.falhas = 0;
        if (!estado.vivo) { estado.vivo = true; pintaVivo(); }

        if (d && d.igual) {
          // Nada mudou. Afrouxa o ritmo e vai embora.
          estado.passo = Math.min(estado.passo + 1, RITMO.length - 1);
          return agenda();
        }

        estado.selo = d.selo || '';
        estado.passo = 0;                       // algo mudou: volta a ficar atento

        var lista = d.lancamentos || [];

        if (estado.vistos === null) {
          // PRIMEIRA carga desta tela. Só anota o que já existia.
          // É esta linha que impede a TV de festejar o mês inteiro
          // quando volta de uma queda de internet.
          estado.vistos = {};
          lista.forEach(function (l) { estado.vistos[l.id] = true; });
          atualiza(d);
          return agenda();
        }

        var novos = [];
        lista.forEach(function (l) {
          if (!estado.vistos[l.id]) {
            estado.vistos[l.id] = true;          // marca ANTES de celebrar:
            novos.push(l);                       // id celebra uma vez, e ponto
          }
        });

        atualiza(d);
        // Os mais antigos primeiro, para a ordem da festa ser a
        // ordem em que as vendas aconteceram.
        enfileira(novos.reverse());
        agenda();
      } catch (e) {
        estado.falhas++;
        // Uma falha pode ser o wi-fi piscando. Só a partir da
        // segunda a tela admite que caiu — assim o aviso não fica
        // acendendo e apagando sem motivo.
        if (estado.falhas >= 2 && estado.vivo) { estado.vivo = false; pintaVivo(); }
        agenda(true);
      }
    }

    // Reconexão controlada: espera mais a cada tentativa, com teto
    // de 30 segundos. Sem teto, uma queda longa viraria espera de
    // horas; sem o aumento, viraria tempestade de pedidos.
    function agenda(falhou) {
      if (estado.parado) return;
      if (estado.timer) clearTimeout(estado.timer);

      var ms;
      if (falhou) ms = Math.min(30000, 2000 * Math.pow(1.6, Math.min(estado.falhas, 8)));
      else if (document.hidden) ms = RITMO_ESCONDIDO;
      else ms = RITMO[estado.passo];

      estado.timer = setTimeout(pergunta, ms);
    }

    // Voltar para a aba deve mostrar o número certo na hora, não no
    // próximo minuto.
    function aoVoltar() {
      if (document.hidden || estado.parado) return;
      estado.passo = 0;
      if (estado.timer) clearTimeout(estado.timer);
      estado.timer = setTimeout(pergunta, 150);
    }
    document.addEventListener('visibilitychange', aoVoltar);

    /* ---------------- partida ---------------- */
    var api = {
      // Chamado por quem lança um valor no Gerenciador: o placar do
      // painel já sabe o número novo, não precisa esperar a próxima
      // pergunta. A TV descobre em até quatro segundos.
      recebe: function (d) {
        if (!d || estado.parado) return;
        estado.selo = d.selo || estado.selo;
        if (estado.vistos === null) {
          estado.vistos = {};
          (d.lancamentos || []).forEach(function (l) { estado.vistos[l.id] = true; });
          atualiza(d);
          return;
        }
        var novos = [];
        (d.lancamentos || []).forEach(function (l) {
          if (!estado.vistos[l.id]) { estado.vistos[l.id] = true; novos.push(l); }
        });
        atualiza(d);
        enfileira(novos.reverse());
      },
      para: function () {
        estado.parado = true;
        if (estado.timer) clearTimeout(estado.timer);
        document.removeEventListener('visibilitychange', aoVoltar);
        if (opts.pop) opts.pop.classList.remove('on');
      },
      estado: estado
    };

    pergunta();
    return api;
  }

  return {
    monta: monta,
    moeda: moeda,
    moedaCurta: moedaCurta,
    moedaRica: moedaRica,
    tocaHit: tocaHit,
    sinoSimples: sinoSimples,
    confete: confete,
    html: html
  };
})();
