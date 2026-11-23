/* ============================================================
   CONVITE DE COLABORADOR — a página que a pessoa abre pelo link

   Três telas dentro do mesmo cartão:

     1. Nome completo, CPF e e-mail
     2. "Você é Fulano da Silva?"  — Sim, sou eu / Não sou eu
     3. "Enviamos um e-mail" (ou a orientação de procurar o administrador)

   Esta página não decide nada. Ela só pergunta ao servidor e
   mostra a resposta: se o convite vale, se o CPF bate, de quem é.
   O que ela faz por conta própria é poupar a pessoa — mascarar o
   CPF enquanto digita, avisar o que faltou antes de enviar.

   O código do convite vem no endereço (/convite/colaborador/CODIGO)
   e NÃO é guardado em lugar nenhum do navegador.
   ============================================================ */
(function () {
  'use strict';

  var cartao = document.getElementById('cartao');
  var pe = document.getElementById('pe');

  // /convite/colaborador/CODIGO  (ou ?c=CODIGO, como alternativa)
  var CODIGO = (function () {
    var m = location.pathname.match(/\/convite\/colaborador\/([A-Za-z0-9_-]+)\/?$/);
    if (m) return m[1];
    return new URLSearchParams(location.search).get('c') || '';
  })();

  var guardado = { nome: '', cpf: '', email: '' };   // para não perder o que foi digitado
  var bilhete = '';

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function passos(n) {
    return '<div class="cv-passos" aria-hidden="true">' +
      [1, 2, 3].map(function (i) { return '<i class="' + (i <= n ? 'on' : '') + '"></i>'; }).join('') +
      '</div>';
  }

  var ICO_OK = '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
  var ICO_INFO = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.2v.1"/></svg>';

  async function chama(acao, corpo) {
    var opts = corpo
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo), cache: 'no-store' }
      : { cache: 'no-store' };
    var url = '/api/admin?action=' + acao + (corpo ? '' : '&c=' + encodeURIComponent(CODIGO));
    var res = await fetch(url, opts);
    var data = await res.json().catch(function () { return { ok: false, error: 'Não consegui falar com o servidor.' }; });
    data._status = res.status;
    return data;
  }

  /* ---------------- telas ---------------- */
  function telaAviso(titulo, texto) {
    cartao.innerHTML =
      '<div class="cv-centro">' +
        '<div class="cv-selo neutro">' + ICO_INFO + '</div>' +
        '<h1>' + esc(titulo) + '</h1>' +
        '<p>' + esc(texto) + '</p>' +
      '</div>';
    pe.textContent = '';
  }

  function telaForm(erro) {
    cartao.innerHTML =
      passos(1) +
      '<h1>Crie o seu acesso</h1>' +
      '<p class="sub">Você foi convidado(a) para o sistema da Start. Confirme quem você é para continuar.</p>' +
      '<div id="cv-erro">' + (erro ? '<div class="alert alert-erro">' + esc(erro) + '</div>' : '') + '</div>' +
      '<form id="cv-form" novalidate>' +
        '<div class="field"><label for="cv-nome">Nome completo</label>' +
          '<input type="text" id="cv-nome" autocomplete="name" maxlength="120" value="' + esc(guardado.nome) + '"></div>' +
        '<div class="field"><label for="cv-cpf">CPF</label>' +
          '<input type="text" id="cv-cpf" inputmode="numeric" autocomplete="off" maxlength="14" ' +
          'placeholder="000.000.000-00" value="' + esc(guardado.cpf) + '"></div>' +
        '<div class="field"><label for="cv-email">E-mail</label>' +
          '<input type="email" id="cv-email" autocomplete="email" maxlength="160" value="' + esc(guardado.email) + '">' +
          '<div class="hint">É para este e-mail que vai o link de criar a senha.</div></div>' +
        '<button class="btn btn-block" id="cv-continuar">Continuar</button>' +
      '</form>';
    pe.textContent = 'Seus dados são usados só para confirmar que você faz parte do time.';

    var cpf = document.getElementById('cv-cpf');
    // Máscara enquanto digita: 000.000.000-00. O servidor ignora os
    // pontos e o traço — com ou sem eles, é o mesmo CPF.
    cpf.addEventListener('input', function () {
      var d = cpf.value.replace(/\D/g, '').slice(0, 11);
      var v = d;
      if (d.length > 9) v = d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9);
      else if (d.length > 6) v = d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6);
      else if (d.length > 3) v = d.slice(0, 3) + '.' + d.slice(3);
      cpf.value = v;
    });

    document.getElementById('cv-form').addEventListener('submit', identifica);
    var foco = document.getElementById(guardado.nome ? 'cv-cpf' : 'cv-nome');
    if (foco) foco.focus();
  }

  function erroNoForm(msg) {
    var el = document.getElementById('cv-erro');
    if (el) el.innerHTML = '<div class="alert alert-erro">' + esc(msg) + '</div>';
  }

  var enviando = false;

  async function identifica(ev) {
    ev.preventDefault();
    if (enviando) return;

    guardado.nome = document.getElementById('cv-nome').value.trim();
    guardado.cpf = document.getElementById('cv-cpf').value.trim();
    guardado.email = document.getElementById('cv-email').value.trim();

    if (guardado.nome.split(/\s+/).filter(Boolean).length < 2) return erroNoForm('Escreva o seu nome completo.');
    if (guardado.cpf.replace(/\D/g, '').length !== 11) return erroNoForm('O CPF tem 11 números.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guardado.email)) return erroNoForm('O e-mail não parece certo.');

    var bt = document.getElementById('cv-continuar');
    enviando = true;
    bt.disabled = true;
    bt.innerHTML = '<span class="spinner"></span> Conferindo…';

    var r = await chama('cv_identificar', { c: CODIGO, nome: guardado.nome, cpf: guardado.cpf, email: guardado.email });
    enviando = false;

    if (r.ok && r.achou) { bilhete = r.bilhete; return telaConfirma(r.nome); }

    // Convite que morreu no meio (expirou, travou): tela de aviso.
    if (r._status === 410 || (r._status === 404 && /convite/i.test(r.error || ''))) {
      return telaAviso('Convite indisponível', r.error);
    }
    bt.disabled = false;
    bt.textContent = 'Continuar';
    erroNoForm(r.error || 'Não deu certo. Tente de novo.');
  }

  function telaConfirma(nome) {
    cartao.innerHTML =
      passos(2) +
      '<h1>Encontramos um cadastro correspondente.</h1>' +
      '<p class="sub">Só para ter certeza de que é você mesmo.</p>' +
      '<div class="cv-quem"><span>Você é</span><strong>' + esc(nome) + '?</strong></div>' +
      '<div id="cv-erro"></div>' +
      '<div class="cv-duo">' +
        '<button class="btn btn-ghost" id="cv-nao">Não sou eu</button>' +
        '<button class="btn" id="cv-sim">Sim, sou eu</button>' +
      '</div>';
    pe.textContent = '';
    document.getElementById('cv-sim').addEventListener('click', function () { confirma('sim'); });
    document.getElementById('cv-nao').addEventListener('click', function () { confirma('nao'); });
    document.getElementById('cv-sim').focus();
  }

  async function confirma(resposta) {
    if (enviando) return;
    enviando = true;
    var sim = document.getElementById('cv-sim');
    var nao = document.getElementById('cv-nao');
    sim.disabled = true; nao.disabled = true;
    if (resposta === 'sim') sim.innerHTML = '<span class="spinner"></span> Criando…';

    var r = await chama('cv_confirmar', { c: CODIGO, bilhete: bilhete, resposta: resposta });
    enviando = false;

    if (r.ok && r.encerrado) return telaAviso('Sem problema', r.mensagem);
    if (r.ok && r.criado) return telaPronto(r);
    if (r.recomecar) return telaForm(r.error);
    if (r._status === 410 || r._status === 404) return telaAviso('Convite indisponível', r.error);
    telaAviso('Não foi possível concluir', r.error || 'Fale com o administrador.');
  }

  function telaPronto(r) {
    // A partir daqui o link do convite já morreu. O que resta à
    // pessoa é abrir o e-mail.
    bilhete = '';
    cartao.innerHTML =
      passos(3) +
      '<div class="cv-centro">' +
        '<div class="cv-selo">' + ICO_OK + '</div>' +
        '<h1>Bem-vindo(a), ' + esc(r.primeiro_nome) + '!</h1>' +
        (r.enviado
          ? '<p>Enviamos um e-mail para <b>' + esc(r.email) + '</b>.</p>' +
            '<p>Abra a mensagem e clique em <b>Criar minha senha</b> para concluir o seu cadastro. ' +
            'Se não aparecer em alguns minutos, olhe a caixa de spam.</p>'
          : '<p>O seu acesso foi criado, mas <b>não conseguimos enviar o e-mail</b> agora.</p>' +
            '<p>Avise o administrador: ele consegue reenviar o link para você criar a senha.</p>') +
      '</div>';
    pe.textContent = 'Pode fechar esta página.';
  }

  /* ---------------- partida ---------------- */
  (async function () {
    if (!CODIGO) {
      return telaAviso('Convite indisponível', 'Este endereço não tem um convite. Peça o link ao administrador.');
    }
    var r = await chama('cv_abrir');
    if (!r.ok) return telaAviso('Convite indisponível', r.error || 'Este convite não vale mais.');
    telaForm('');
  })();
})();
