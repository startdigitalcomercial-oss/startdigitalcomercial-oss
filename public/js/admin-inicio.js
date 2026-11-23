/* ============================================================
   inicio
   ============================================================ */
async function iniciar() {
  document.getElementById('tela-login').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  // Primeiro descobre o que esta pessoa pode ver. Antes isto rodava
  // em paralelo com o Dashboard; agora o Dashboard espera, porque para
  // quem não tem o módulo Vagas ele nem deve ser pedido.
  const eu = await escondeFinanceiroSeNaoPode();

  // Quem tem módulos restritos e NÃO tem o Dashboard cai direto na
  // primeira tela que pode ver, em vez de num erro de "sem acesso".
  if (eu && Array.isArray(eu.modulos) && eu.menu.indexOf('dashboard') < 0) {
    const primeira = Array.prototype.filter.call(
      document.querySelectorAll('#abas button[data-aba]'),
      function (b) { return b.style.display !== 'none' && eu.menu.indexOf(b.dataset.aba) >= 0; })[0];
    if (primeira) { primeira.click(); return; }
    document.querySelector('section[data-painel="dashboard"]').innerHTML =
      '<div class="card"><div class="alert alert-info"><strong>O seu acesso ainda não inclui nenhuma área.</strong> ' +
      'Fale com o administrador para liberar os módulos de que você precisa.</div></div>';
    return;
  }

  try { await carregaBoard(); await carregaDashboard(); }
  catch (e) { if (e.message !== 'sessao expirada') toast(e.message, true); }
}

if (TOKEN) iniciar(); else document.getElementById('tela-login').style.display = 'grid';
