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
  // Recarrega para a tela de login se montar do zero: assim ela sempre sabe
  // se ainda estamos no primeiro acesso (senha mestra) ou ja e por e-mail.
  setTimeout(function () { location.reload(); }, 60);
}
document.getElementById('btn-sair').addEventListener('click', sair);

// Enquanto durar a fase de testes, a senha aparece na tela e o campo ja vem
// preenchido. Isso vem LIGADO de fabrica. Para desligar, e so criar a
// variavel MOSTRAR_SENHA_LOGIN com o valor false na Vercel + Redeploy.
let PRIMEIRO_ACESSO = false;

(async function dicaDaSenha() {
  try {
    const r = await (await fetch('/api/admin?action=dica_senha')).json();
    if (!r.ok) return;
    const alvo = document.getElementById('login-erro');

    // Enquanto nao existe nenhum Dono cadastrado, quem entra e a senha mestra —
    // e ela SO funciona com o campo de e-mail vazio. Entao o campo some da tela,
    // para o navegador nao preencher sozinho e travar a entrada.
    PRIMEIRO_ACESSO = r.primeiro_acesso === true;
    if (PRIMEIRO_ACESSO) {
      const campoEmail = document.getElementById('campo-email');
      const inputEmail = document.getElementById('email-login');
      if (inputEmail) { inputEmail.value = ''; inputEmail.disabled = true; }
      if (campoEmail) campoEmail.style.display = 'none';
      const sub = document.getElementById('login-sub');
      if (sub) sub.textContent = 'Primeiro acesso: entre com a senha do painel.';
      const senhaEl = document.getElementById('senha');
      if (senhaEl) senhaEl.focus();
      if (alvo) {
        alvo.insertAdjacentHTML('beforebegin',
          '<div class="alert alert-info small" style="margin-bottom:16px">' +
          '<strong>Ninguém foi cadastrado ainda.</strong> Por isso a entrada é só pela senha do painel. ' +
          'Depois de entrar, vá em <strong>Usuários</strong> e crie o seu acesso de Dono — ' +
          'a partir daí cada pessoa entra com o próprio e-mail.</div>');
      }
    }

    if (!r.mostrar || !r.senha) return;
    const campo = document.getElementById('senha');
    if (campo && !campo.value) campo.value = r.senha;
    if (!alvo) return;
    alvo.insertAdjacentHTML('beforebegin',
      '<div class="alert alert-info small" style="margin-bottom:16px">' +
      'Fase de testes — senha: <code>' + esc(r.senha) + '</code><br>' +
      '<span class="muted">O campo já vem preenchido, é só clicar em Entrar. ' +
      'Para esconder isto quando os testes acabarem: crie a variável ' +
      '<code>MOSTRAR_SENHA_LOGIN</code> com o valor <code>false</code> na Vercel + Redeploy.</span></div>');
  } catch (e) { /* se nao der, a tela de login funciona igual */ }
})();

document.getElementById('form-login').addEventListener('submit', async function (ev) {
  ev.preventDefault();
  const btn = document.getElementById('btn-login');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Entrando…';
  try {
    const res = await fetch('/api/admin?action=login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: (document.getElementById('email-login') || {}).value || '',
        password: document.getElementById('senha').value
      })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    TOKEN = data.token;
    localStorage.setItem(LS, TOKEN);
    document.getElementById('login-erro').innerHTML = '';
    if (data.trocar_senha) {
      alert('Esta é a sua senha inicial. Peça ao Dono do painel para trocá-la assim que puder — ' +
        'ou combine uma senha nova com ele.');
    }
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
  dashboard: 'Dashboard', vagas: 'Vagas abertas', triagem: 'Triagem', candidatos: 'Candidatos',
  prequalificacao: 'Pré Qualificação', aurea: 'Aurea', preonboarding: 'Pré Onboarding',
  conteudo: 'Aulas da integração', quiz: 'Quiz de seleção',
  colaboradores: 'Colaboradores', avisos: 'Avisos para o time', usuarios: 'Usuários do painel',
  mensagens: 'Modelos de mensagem', ajustes: 'Ajustes',
  financeiro: 'Cobranças', findash: 'Dashboard financeiro', fingastos: 'Outros Gastos',
  space: 'Benefícios'
};
/* ---------------------------------------------- sanfona do menu
   Um grupo aberto por vez. O grupo da página em que você está abre
   sozinho; os outros ficam fechados, com um pontinho verde quando
   escondem a página ativa. A escolha fica salva no navegador, então
   ao voltar o menu está do jeito que você deixou. */
const LS_MENU = 'start_rh_menu_aberto';

function grupoDaAba(aba) {
  const b = document.querySelector('#abas button[data-aba="' + aba + '"]');
  return b ? b.closest('.nav-grupo') : null;
}

function abreGrupo(g, guardar) {
  if (!g) return;
  document.querySelectorAll('#abas .nav-grupo').forEach(function (x) {
    x.classList.toggle('on', x === g);
  });
  if (guardar !== false) {
    try { localStorage.setItem(LS_MENU, g.dataset.grupo || ''); } catch (e) { }
  }
}

function marcaGrupoAtivo() {
  document.querySelectorAll('#abas .nav-grupo').forEach(function (g) {
    g.classList.toggle('tem-ativa', !!g.querySelector('button[data-aba].on'));
  });
}

document.getElementById('abas').addEventListener('click', function (ev) {
  const cab = ev.target.closest('.nav-cab');
  if (cab) {
    const g = cab.closest('.nav-grupo');
    // clicou no que já estava aberto? então fecha e não sobra nenhum.
    if (g.classList.contains('on')) {
      g.classList.remove('on');
      try { localStorage.setItem(LS_MENU, ''); } catch (e) { }
    } else {
      abreGrupo(g);
    }
    return;
  }

  const b = ev.target.closest('button[data-aba]');
  if (!b) return;
  abreGrupo(b.closest('.nav-grupo'));
  document.querySelectorAll('#abas button').forEach(function (x) { x.classList.toggle('on', x === b); });
  document.getElementById('titulo-pagina').textContent = TITULOS[b.dataset.aba] || '';
  document.querySelectorAll('section[data-painel]').forEach(function (s) {
    const ativa = s.dataset.painel === b.dataset.aba;
    s.style.display = ativa ? 'block' : 'none';
    s.classList.remove('enter');
    if (ativa) { void s.offsetWidth; s.classList.add('enter'); }
  });
  const carregar = {
    dashboard: carregaDashboard, vagas: carregaVagas, triagem: carregaBoard, candidatos: carregaCandidatos,
    prequalificacao: carregaPrequal, aurea: carregaAurea, preonboarding: carregaBoasVindas,
    colaboradores: carregaColaboradores, avisos: carregaAvisos, usuarios: carregaUsuarios,
    conteudo: carregaConteudo, quiz: carregaQuiz, mensagens: carregaTemplates, ajustes: carregaAjustes,
    financeiro: carregaFinanceiro, findash: carregaFinDash, fingastos: carregaFinGastos,
    space: carregaSpace
  };
  marcaGrupoAtivo();
  if (carregar[b.dataset.aba]) carregar[b.dataset.aba]();
});

// Ao abrir o painel: o grupo salvo, ou o da página em que a gente está.
(function menuInicial() {
  let salvo = null;
  try { salvo = localStorage.getItem(LS_MENU); } catch (e) { }

  // salvo === '' quer dizer "eu fechei tudo de propósito". Respeita.
  if (salvo === '') { marcaGrupoAtivo(); return; }

  const pelaMemoria = salvo && document.querySelector('#abas .nav-grupo[data-grupo="' + salvo + '"]');
  const ativa = document.querySelector('#abas button[data-aba].on');
  abreGrupo(pelaMemoria || grupoDaAba(ativa ? ativa.dataset.aba : 'dashboard'), false);
  marcaGrupoAtivo();
})();
