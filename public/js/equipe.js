// ============================================================
// Cadastro do time — formulario em etapas.
// Sem biblioteca nenhuma. So o navegador.
// ============================================================
'use strict';

var CFG = {};
var passo = 0;
var TOTAL = 7;

function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ---------------- mascaras ---------------- */
function mascaraTelefone(v) {
  var d = String(v || '').replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d.length ? '(' + d : '';
  if (d.length <= 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
  if (d.length <= 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
  return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
}
function mascaraCpf(v) {
  var d = String(v || '').replace(/\D/g, '').slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return d.slice(0, 3) + '.' + d.slice(3);
  if (d.length <= 9) return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6);
  return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9);
}
function mascaraCep(v) {
  var d = String(v || '').replace(/\D/g, '').slice(0, 8);
  return d.length <= 5 ? d : d.slice(0, 5) + '-' + d.slice(5);
}

/* ---------------- validacoes ---------------- */
// mesma conta do servidor: dois digitos verificadores
function cpfValido(bruto) {
  var d = String(bruto || '').replace(/\D/g, '');
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;
  for (var volta = 0; volta < 2; volta++) {
    var ate = 9 + volta, soma = 0;
    for (var i = 0; i < ate; i++) soma += Number(d[i]) * (ate + 1 - i);
    var dig = (soma * 10) % 11;
    if (dig === 10) dig = 0;
    if (dig !== Number(d[ate])) return false;
  }
  return true;
}

function marcaRuim(el, ruim) {
  var campo = el.closest('.field');
  if (campo) campo.classList.toggle('ruim', !!ruim);
}

// devolve true se o passo esta preenchido do jeito certo
function passoValido(n) {
  var ok = true;
  function exige(id, cond) {
    var el = $(id);
    var bom = cond(el.value.trim());
    marcaRuim(el, !bom);
    if (!bom && ok) { ok = false; setTimeout(function () { el.focus(); }, 80); }
  }
  if (n === 0) {
    exige('name', function (v) { return v.length >= 3 && v.indexOf(' ') > 0; });
    exige('birth_date', function (v) { return !!v; });
  }
  if (n === 1) {
    exige('email', function (v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); });
    exige('phone', function (v) { return v.replace(/\D/g, '').length >= 10; });
  }
  if (n === 3) {
    exige('cpf', function (v) { return !v || cpfValido(v); });
  }
  return ok;
}

/* ---------------- navegacao entre passos ---------------- */
function mostra(n, tras) {
  var secoes = document.querySelectorAll('.passo');
  for (var i = 0; i < secoes.length; i++) {
    secoes[i].classList.remove('on', 'entrando', 'entrando-tras');
  }
  var alvo = document.querySelector('.passo[data-passo="' + n + '"]');
  alvo.classList.add('on', tras ? 'entrando-tras' : 'entrando');

  // os campos entram um atrás do outro
  var campos = alvo.querySelectorAll('.field, .revisao, .dica-lgpd');
  for (var j = 0; j < campos.length; j++) {
    campos[j].classList.remove('campo-anim');
    void campos[j].offsetWidth; // reinicia a animacao
    campos[j].style.animationDelay = (60 + j * 55) + 'ms';
    campos[j].classList.add('campo-anim');
  }

  passo = n;
  $('barra').style.width = Math.round((n / (TOTAL - 1)) * 100) + '%';
  $('passo-n').textContent = 'Passo ' + (n + 1) + ' de ' + TOTAL;
  $('btn-voltar').style.display = n === 0 ? 'none' : '';
  $('btn-seguir').textContent = n === TOTAL - 1 ? 'Enviar cadastro' : 'Continuar';

  if (n === TOTAL - 1) desenhaRevisao();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function segue() {
  if (!passoValido(passo)) return;
  if (passo === TOTAL - 1) return envia();
  mostra(passo + 1, false);
}

/* ---------------- revisao ---------------- */
function desenhaRevisao() {
  var linhas = [
    ['Nome', $('name').value, 0],
    ['Chamamos de', $('nickname').value || $('name').value.split(' ')[0], 0],
    ['Aniversário', dataBonita($('birth_date').value), 0],
    ['E-mail', $('email').value, 1],
    ['WhatsApp', $('phone').value, 1],
    ['Área', $('area').value, 2],
    ['Cargo', $('role_title').value, 2],
    ['Na Start desde', dataBonita($('started_on').value), 2],
    ['CPF', $('cpf').value, 3],
    ['Endereço', montaEndereco(), 4],
    ['Camisa', $('shirt_size').value, 5],
    ['Número do pé', $('shoe_size').value, 5]
  ];
  $('revisao').innerHTML = linhas.map(function (l) {
    return '<div class="rev-linha"><dt>' + esc(l[0]) + '</dt>' +
      '<dd>' + (l[1] ? esc(l[1]) : '<span class="muted">não informado</span>') + '</dd>' +
      '<button type="button" class="rev-editar" data-ir="' + l[2] + '">alterar</button></div>';
  }).join('');
  var bts = $('revisao').querySelectorAll('.rev-editar');
  for (var i = 0; i < bts.length; i++) {
    bts[i].addEventListener('click', function () { mostra(Number(this.dataset.ir), true); });
  }
}

function dataBonita(iso) {
  if (!iso) return '';
  var p = iso.split('-');
  return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso;
}

function montaEndereco() {
  var rua = $('street').value, num = $('number').value, comp = $('complement').value;
  var bai = $('district').value, cid = $('city').value, uf = $('state').value;
  if (!rua && !cid) return '';
  var t = rua + (num ? ', ' + num : '') + (comp ? ' — ' + comp : '');
  if (bai) t += ' · ' + bai;
  if (cid) t += ' · ' + cid + (uf ? '/' + uf : '');
  return t;
}

/* ---------------- envio ---------------- */
function envia() {
  var btn = $('btn-seguir');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Enviando…';
  $('erro-geral').innerHTML = '';

  var dados = {};
  ['name', 'nickname', 'birth_date', 'cpf', 'email', 'phone', 'role_title', 'area',
    'started_on', 'cep', 'street', 'number', 'complement', 'district', 'city', 'state',
    'shirt_size', 'shoe_size'].forEach(function (c) {
      var el = $(c);
      if (el && el.value.trim()) dados[c] = el.value.trim();
    });

  fetch('/api/equipe?action=cadastrar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dados)
  }).then(function (r) { return r.json(); }).then(function (r) {
    btn.disabled = false;
    btn.textContent = 'Enviar cadastro';
    if (!r.ok) {
      $('erro-geral').innerHTML = '<div class="alert alert-erro" style="margin-top:16px">' + esc(r.error) + '</div>';
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      return;
    }
    terminou(r);
  }).catch(function () {
    btn.disabled = false;
    btn.textContent = 'Enviar cadastro';
    $('erro-geral').innerHTML = '<div class="alert alert-erro" style="margin-top:16px">' +
      'Não consegui enviar. Confira a sua internet e tente de novo.</div>';
  });
}

function terminou(r) {
  $('form').style.display = 'none';
  $('pronto').style.display = 'block';
  $('barra').style.width = '100%';
  $('passo-n').textContent = 'Concluído';
  $('fim-titulo').textContent = 'Pronto, ' + (r.nome || '') + '!';

  var nomes = { email: 'E-mail', whatsapp: 'WhatsApp', sms: 'SMS' };
  var certo = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8.4 12.3 2.4 2.4 4.8-5.4"/></svg>';
  var relogio = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/></svg>';

  var envios = r.envios || [];
  $('canais').innerHTML = envios.length
    ? envios.map(function (e, i) {
        var foi = e.status === 'enviado';
        return '<div class="canal" style="animation-delay:' + (200 + i * 110) + 'ms">' +
          '<span class="' + (foi ? 'ok' : 'pend') + '">' + (foi ? certo : relogio) + '</span>' +
          '<span>' + esc(nomes[e.canal] || e.canal) +
          (foi ? ' enviado' : ' — vai chegar em instantes') + '</span></div>';
      }).join('')
    : '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------------- escolhas em cartao ---------------- */
function montaEscolhas(caixaId, campoId, itens) {
  var caixa = $(caixaId);
  caixa.innerHTML = itens.map(function (i) {
    return '<button type="button" class="escolha" data-v="' + esc(i) + '">' + esc(i) + '</button>';
  }).join('');
  var bts = caixa.querySelectorAll('.escolha');
  for (var k = 0; k < bts.length; k++) {
    bts[k].addEventListener('click', function () {
      for (var j = 0; j < bts.length; j++) bts[j].classList.remove('on');
      this.classList.add('on');
      $(campoId).value = this.dataset.v;
    });
  }
}

/* ---------------- CEP: preenche o endereco sozinho ---------------- */
function buscaCep() {
  var d = $('cep').value.replace(/\D/g, '');
  var aviso = $('cep-status');
  if (d.length !== 8) { aviso.textContent = ''; return; }
  aviso.textContent = 'procurando…';
  fetch('https://viacep.com.br/ws/' + d + '/json/')
    .then(function (r) { return r.json(); })
    .then(function (e) {
      if (e.erro) { aviso.textContent = 'CEP não encontrado — pode preencher à mão'; return; }
      aviso.textContent = 'encontrado';
      if (e.logradouro) $('street').value = e.logradouro;
      if (e.bairro) $('district').value = e.bairro;
      if (e.localidade) $('city').value = e.localidade;
      if (e.uf) $('state').value = e.uf;
      $('number').focus();
    })
    .catch(function () { aviso.textContent = 'não deu para buscar — preencha à mão'; });
}

/* ---------------- inicio ---------------- */
(function iniciar() {
  fetch('/api/equipe?action=config').then(function (r) { return r.json(); }).then(function (c) {
    $('carregando').style.display = 'none';
    CFG = c;
    if (c.empresa) $('marca-nome').textContent = c.empresa;
    if (!c.aberto) { $('fechado').style.display = 'block'; return; }

    $('form').style.display = 'block';
    montaEscolhas('areas', 'area', c.areas || []);
    montaEscolhas('camisas', 'shirt_size', c.camisas || ['P', 'M', 'G', 'GG']);

    document.querySelector('.passo[data-passo="0"] h1').textContent = c.titulo || 'Vamos começar pelo básico';
    document.querySelector('.passo[data-passo="0"] .apoio').textContent =
      c.texto || 'Só o essencial para a gente saber quem é você.';

    mostra(0, false);
    $('btn-seguir').textContent = 'Continuar';
  }).catch(function () {
    $('carregando').textContent = 'Não consegui carregar. Atualize a página.';
  });

  $('btn-seguir').addEventListener('click', segue);
  $('btn-voltar').addEventListener('click', function () { if (passo > 0) mostra(passo - 1, true); });

  // Enter avanca, menos dentro de textarea
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter') return;
    if (ev.target && ev.target.tagName === 'TEXTAREA') return;
    if ($('form').style.display === 'none') return;
    ev.preventDefault();
    segue();
  });

  $('phone').addEventListener('input', function () { this.value = mascaraTelefone(this.value); });
  $('cpf').addEventListener('input', function () { this.value = mascaraCpf(this.value); marcaRuim(this, false); });
  $('cep').addEventListener('input', function () { this.value = mascaraCep(this.value); if (this.value.replace(/\D/g, '').length === 8) buscaCep(); });
  $('cep').addEventListener('blur', buscaCep);

  // tira o aviso de erro assim que a pessoa comeca a corrigir
  ['name', 'birth_date', 'email', 'phone'].forEach(function (id) {
    $(id).addEventListener('input', function () { marcaRuim(this, false); });
  });

  // numero do pe
  function mudaPe(delta) {
    var atual = Number($('shoe_size').value) || 40;
    var novo = Math.min(50, Math.max(30, atual + delta));
    $('shoe_size').value = novo;
    var mostrador = $('pe-num');
    mostrador.textContent = novo;
    mostrador.classList.remove('mudou');
    void mostrador.offsetWidth;
    mostrador.classList.add('mudou');
  }
  $('pe-menos').addEventListener('click', function () { mudaPe(-1); });
  $('pe-mais').addEventListener('click', function () { mudaPe(1); });
})();
