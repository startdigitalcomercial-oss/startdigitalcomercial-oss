/* ============================================================
   O BOTAO DE CLAREAR A TELA

   O sistema abre escuro. Quem preferir claro aperta o botao, e a
   escolha fica guardada no proprio navegador (localStorage) — na
   proxima vez a tela ja abre do jeito que a pessoa deixou, em
   qualquer tela do sistema.

   Como funciona, em uma frase: tudo que o tema claro precisa esta
   dentro de :root[data-tema="claro"] no ui.css, entao a unica
   coisa que este arquivo faz e por e tirar esse atributo do <html>.

   Quem pinta a tela ANTES de ela aparecer e um pedacinho de script
   no <head> de cada pagina — se fosse aqui, daria o flash branco.
   ============================================================ */
(function () {
  var CHAVE = 'tema';

  function lido() {
    try { return localStorage.getItem(CHAVE) === 'claro' ? 'claro' : 'escuro'; }
    catch (e) { return 'escuro'; }
  }

  // o sol = "pode clarear"; a lua = "pode escurecer"
  var SOL = '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2'
          + 'M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4"/>';
  var LUA = '<path d="M20 14.5A8 8 0 0 1 9.5 4a8.3 8.3 0 1 0 10.5 10.5z"/>';

  function pinta(b) {
    var claro = lido() === 'claro';
    b.setAttribute('aria-pressed', claro ? 'true' : 'false');
    b.setAttribute('title', claro ? 'Escurecer a tela' : 'Clarear a tela');
    var desenho = b.querySelector('[data-tema-icone]');
    if (desenho) desenho.innerHTML = claro ? LUA : SOL;
    var palavra = b.querySelector('[data-tema-palavra]');
    if (palavra) palavra.textContent = claro ? 'Escurecer' : 'Clarear';
  }

  function aplica(qual) {
    if (qual === 'claro') document.documentElement.setAttribute('data-tema', 'claro');
    else document.documentElement.removeAttribute('data-tema');
    try { localStorage.setItem(CHAVE, qual); } catch (e) {}
    botoes().forEach(pinta);
  }

  function botoes() {
    return Array.prototype.slice.call(document.querySelectorAll('[data-tema-botao]'));
  }

  function liga() {
    botoes().forEach(function (b) {
      if (b.dataset.temaLigado) return;
      b.dataset.temaLigado = '1';
      b.addEventListener('click', function () {
        aplica(lido() === 'claro' ? 'escuro' : 'claro');
      });
      pinta(b);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', liga);
  else liga();

  // deixa a mao: outra tela do sistema pode chamar depois de desenhar
  window.temaLigarBotoes = liga;
})();
