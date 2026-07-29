/* ============================================================
   estado + utilidades
   ============================================================ */
const LS = 'start_rh_token';
let TOKEN = localStorage.getItem(LS) || '';
let BOARD = { stages: [], candidates: [] };
let APP_URL = '';
let atualCand = null;
let bvItens = [];

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function toast(msg, erro) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast on' + (erro ? ' erro' : '');
  setTimeout(function () { t.className = 'toast' + (erro ? ' erro' : ''); }, 3000);
}
const ICO = (function () {
  function s(p, sz) {
    return '<svg class="ico" width="' + (sz || 15) + '" height="' + (sz || 15) + '" viewBox="0 0 24 24">' + p + '</svg>';
  }
  return {
    mail: function (sz) { return s('<rect x="3.6" y="5.4" width="16.8" height="13.2" rx="2"/><path d="m4.6 7 7.4 5.8L19.4 7"/>', sz); },
    chat: function (sz) { return s('<path d="M20.4 11.6a8.4 8.4 0 0 1-8.4 8.4c-1.5 0-2.9-.4-4.1-1L3.4 20l1.1-4.4a8.4 8.4 0 1 1 15.9-4z"/>', sz); },
    fone: function (sz) { return s('<rect x="7.4" y="2.8" width="9.2" height="18.4" rx="2.2"/><path d="M11 17.8h2"/>', sz); },
    lixo: function (sz) { return s('<path d="M4.6 7h14.8M9.6 7V5.2A1.6 1.6 0 0 1 11.2 3.6h1.6a1.6 1.6 0 0 1 1.6 1.6V7M6.6 7l.8 11.7a1.7 1.7 0 0 0 1.7 1.6h5.8a1.7 1.7 0 0 0 1.7-1.6L17.4 7"/>', sz); },
    alerta: function (sz) { return s('<path d="M12 4.4 3.2 18.8h17.6z"/><path d="M12 10.2v3.6M12 16.6v.2"/>', sz); },
    pessoas: function (sz) { return s('<circle cx="9" cy="8.6" r="3.4"/><path d="M3.6 19.4c.6-3 2.9-4.5 5.4-4.5s4.8 1.5 5.4 4.5"/><path d="M15.4 5.7a3.4 3.4 0 0 1 0 6M16.9 15.2c1.9.6 3.1 2 3.5 4.2"/>', sz); },
    grafico: function (sz) { return s('<path d="M4 19.6h16"/><path d="M7.2 19.6v-7.2M12 19.6V7.2M16.8 19.6v-9.6"/>', sz); },
    check: function (sz) { return s('<circle cx="12" cy="12" r="8.8"/><path d="m8.4 12.3 2.4 2.4 4.8-5.4"/>', sz); }
  };
})();

function dataBr(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

async function api(action, opts) {
  opts = opts || {};
  const qs = new URLSearchParams(Object.assign({ action: action }, opts.params || {}));
  const res = await fetch('/api/admin?' + qs.toString(), {
    method: opts.body ? 'POST' : (opts.method || 'GET'),
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json().catch(function () { return { ok: false, error: 'resposta invalida' }; });
  if (res.status === 401) { sair(); throw new Error('sessao expirada'); }
  if (!data.ok) throw new Error(data.error || 'erro');
  return data;
}

/* ============================================================
   login
   ============================================================ */
function sair() {
  localStorage.removeItem(LS);
  TOKEN = '';
  document.getElementById('app').style.display = 'none';
  document.getElementById('tela-login').style.display = 'block';
}
document.getElementById('btn-sair').addEventListener('click', sair);

document.getElementById('form-login').addEventListener('submit', async function (ev) {
  ev.preventDefault();
  const btn = document.getElementById('btn-login');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Entrando…';
  try {
    const res = await fetch('/api/admin?action=login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: document.getElementById('senha').value })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    TOKEN = data.token;
    localStorage.setItem(LS, TOKEN);
    document.getElementById('login-erro').innerHTML = '';
    iniciar();
  } catch (e) {
    document.getElementById('login-erro').innerHTML = '<div class="alert alert-erro">' + esc(e.message) + '</div>';
  }
  btn.disabled = false; btn.textContent = 'Entrar';
});

/* ============================================================
   abas
   ============================================================ */
const TITULOS = {
  dashboard: 'Dashboard', triagem: 'Triagem', candidatos: 'Candidatos',
  prequalificacao: 'Pré Qualificação', aurea: 'Aurea', preonboarding: 'Pré Onboarding',
  conteudo: 'Aulas da integração', quiz: 'Quiz de seleção',
  colaboradores: 'Colaboradores', avisos: 'Avisos para o time',
  mensagens: 'Modelos de mensagem', ajustes: 'Ajustes'
};
document.getElementById('abas').addEventListener('click', function (ev) {
  const b = ev.target.closest('button[data-aba]');
  if (!b) return;
  document.querySelectorAll('#abas button').forEach(function (x) { x.classList.toggle('on', x === b); });
  document.getElementById('titulo-pagina').textContent = TITULOS[b.dataset.aba] || '';
  document.querySelectorAll('section[data-painel]').forEach(function (s) {
    const ativa = s.dataset.painel === b.dataset.aba;
    s.style.display = ativa ? 'block' : 'none';
    s.classList.remove('enter');
    if (ativa) { void s.offsetWidth; s.classList.add('enter'); }
  });
  const carregar = {
    dashboard: carregaDashboard, triagem: carregaBoard, candidatos: carregaCandidatos,
    prequalificacao: carregaPrequal, aurea: carregaAurea, preonboarding: carregaBoasVindas,
    colaboradores: carregaColaboradores, avisos: carregaAvisos,
    conteudo: carregaConteudo, quiz: carregaQuiz, mensagens: carregaTemplates, ajustes: carregaAjustes
  };
  if (carregar[b.dataset.aba]) carregar[b.dataset.aba]();
});
