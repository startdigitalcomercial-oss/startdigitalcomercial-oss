/* ============================================================
   O link de Suporte das paginas de texto.

   Mesma historia da tela de login: o numero sai dos Ajustes, e
   sem numero salvo o link vira e-mail. Melhor um e-mail que
   funciona do que um link bonito que nao leva a lugar nenhum.
   ============================================================ */
(function () {
  var EMAIL = 'mailto:startdigitalcomercial@gmail.com'
    + '?subject=' + encodeURIComponent('Ajuda — StartDigital');

  var links = document.querySelectorAll('#link-suporte, .js-suporte');
  if (!links.length) return;

  function aponta(href, novaAba) {
    links.forEach(function (a) {
      a.href = href;
      if (!novaAba) a.removeAttribute('target');
    });
  }

  aponta(EMAIL, false);          // o e-mail ja vale desde o primeiro instante

  fetch('/api/admin?action=dica_senha')
    .then(function (r) { return r.json(); })
    .then(function (r) { if (r && r.ok && r.suporte) aponta(r.suporte, true); })
    .catch(function () { /* fica o e-mail */ });
})();
