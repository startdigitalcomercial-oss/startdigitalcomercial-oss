/* ============================================================
   PEÇAS DE INTERFACE COMPARTILHADAS

   Duas coisas moram aqui: o cartão de boas-vindas e a busca.
   As duas são usadas por várias telas, então ficam num lugar só —
   assim não existem três buscas diferentes espalhadas pelo sistema.
   ============================================================ */

/* ---------------------------------------------- boas-vindas

   A regra: uma vez por ENTRADA, não uma vez na vida.

   Quem lembra disso é o sessionStorage, que é a memória da aba.
   Ele vive enquanto a aba estiver aberta — então apertar F5 ou
   trocar de página não mostra de novo. Ao sair do sistema a
   marca é apagada, e o próximo login cumprimenta outra vez.

   Nada disso vai para o banco: é enfeite de tela, não dado. */
const BV_MARCA = 'start_rh_ja_saudou';

function bvEsquece() {
  try { sessionStorage.removeItem(BV_MARCA); } catch (e) { }
}

function bvIniciais(nome) {
  const partes = String(nome || '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '👋';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

function bvPrimeiroNome(nome) {
  const p = String(nome || '').trim().split(/\s+/).filter(Boolean);
  return p.length ? p[0] : '';
}

function daBoasVindas(usuario) {
  // já cumprimentou nesta aba? então fica quieto.
  try { if (sessionStorage.getItem(BV_MARCA)) return; } catch (e) { return; }
  try { sessionStorage.setItem(BV_MARCA, '1'); } catch (e) { }

  usuario = usuario || {};
  // "Senha mestra" não é nome de gente — nesse caso cumprimenta sem nome.
  const bruto = usuario.mestra ? '' : (usuario.nome || '');
  const nome = bvPrimeiroNome(bruto);
  const titulo = nome ? 'Olá, ' + esc(nome) + ' 👋' : 'Olá 👋';
  const papel = usuario.papel_nome ? esc(usuario.papel_nome) : '';

  const cartao = document.createElement('div');
  cartao.className = 'bemvindo';
  cartao.id = 'bemvindo';
  cartao.setAttribute('role', 'status');
  cartao.setAttribute('aria-live', 'polite');
  cartao.innerHTML =
    '<div class="bv-avatar" aria-hidden="true">' + esc(bvIniciais(bruto)) + '</div>' +
    '<div class="bv-texto"><b>' + titulo + '</b>' +
      '<span>Bem-vindo de volta à Start.' + (papel ? ' · ' + papel : '') + '</span></div>' +
    '<button type="button" class="bv-x" aria-label="Fechar">×</button>';
  document.body.appendChild(cartao);

  let saiu = false;
  function sai() {
    if (saiu) return;
    saiu = true;
    cartao.classList.remove('on');
    setTimeout(function () { cartao.remove(); }, 260);
  }
  cartao.querySelector('.bv-x').addEventListener('click', sai);

  // o requestAnimationFrame é o que faz a animação acontecer: sem ele
  // o navegador junta "nasceu" e "entrou" num quadro só, e o cartão
  // simplesmente aparece, sem deslizar.
  requestAnimationFrame(function () {
    requestAnimationFrame(function () { cartao.classList.add('on'); });
  });
  setTimeout(sai, 5200);
}

/* ---------------------------------------------- busca

   Monta sempre a mesma caixa de busca. Quem chama passa o que
   fazer quando o texto muda; o resto (lupa, botão de limpar,
   atalho do Esc) é igual em toda tela.

   O `espera` existe para busca que vai ao servidor: nesse caso
   250ms sem digitar antes de perguntar. Quando a lista já está
   na memória, passe 0 — filtrar 500 nomes é instantâneo e
   esperar só faria a tela parecer lenta de graça. */
function buscaHtml(id, placeholder, valor) {
  return '<div class="busca" data-busca-de="' + esc(id) + '">' +
    '<svg class="busca-lupa" viewBox="0 0 24 24" aria-hidden="true">' +
      '<circle cx="10.6" cy="10.6" r="6.4"/><path d="m15.4 15.4 4.2 4.2"/></svg>' +
    '<input type="search" id="' + esc(id) + '" autocomplete="off" spellcheck="false" ' +
      'placeholder="' + esc(placeholder) + '" value="' + esc(valor || '') + '">' +
    '<button type="button" class="busca-x" tabindex="-1" aria-label="Limpar a busca">×</button>' +
    '</div>';
}

function ligaBusca(id, aoMudar, espera) {
  const campo = document.getElementById(id);
  if (!campo) return;
  const caixa = campo.closest('.busca');
  const limpar = caixa ? caixa.querySelector('.busca-x') : null;
  let timer = null;

  function pinta() {
    if (caixa) caixa.classList.toggle('tem-texto', campo.value.length > 0);
  }
  function avisa() {
    pinta();
    clearTimeout(timer);
    const atraso = espera === undefined ? 0 : espera;
    if (!atraso) { aoMudar(campo.value); return; }
    timer = setTimeout(function () { aoMudar(campo.value); }, atraso);
  }

  campo.addEventListener('input', avisa);
  campo.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape' || !campo.value) return;
    campo.value = '';
    avisa();
  });
  if (limpar) {
    limpar.addEventListener('click', function () {
      campo.value = '';
      avisa();
      campo.focus();
    });
  }
  pinta();
}
