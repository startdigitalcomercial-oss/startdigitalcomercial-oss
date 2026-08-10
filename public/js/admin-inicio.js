/* ============================================================
   inicio
   ============================================================ */
async function iniciar() {
  document.getElementById('tela-login').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  escondeFinanceiroSeNaoPode();
  try { await carregaBoard(); await carregaDashboard(); }
  catch (e) { if (e.message !== 'sessao expirada') toast(e.message, true); }
}

if (TOKEN) iniciar(); else document.getElementById('tela-login').style.display = 'block';
