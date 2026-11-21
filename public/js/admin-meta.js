/* ============================================================
   META EM TEMPO REAL — as duas telas do painel

     Comercial → Meta                 o mesmo placar da televisão
     Comercial → Gerenciador de Meta  onde a equipe lança o valor

   O placar aqui não é uma segunda versão do placar da TV: é o
   MESMO código (meta-placar.js). A única diferença é de onde vêm
   os dados — aqui com o crachá de quem está logado, na televisão
   com o código dela.

   Quem lança um valor vê o número subir na própria tela no mesmo
   instante, porque o servidor devolve o placar já somado junto com
   a confirmação. A televisão descobre sozinha em até quatro
   segundos. Ninguém aperta F5 em lugar nenhum.
   ============================================================ */

let MT_VIVO = null;          // o placar do painel, enquanto a aba está aberta
let MG = null;               // o que veio do servidor no Gerenciador
let MG_TIPO = 'comercial';   // qual aba do formulário está escolhida
let MG_EDITANDO = null;      // id do lançamento em correção, se houver
let MG_SALVANDO = false;     // tranca contra duplo clique

async function apiMt(action, opts) {
  opts = opts || {};
  const qs = new URLSearchParams(Object.assign({ action: action }, opts.params || {}));
  const res = await fetch('/api/comercial?' + qs.toString(), {
    method: opts.body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json().catch(function () { return { ok: false, error: 'resposta invalida' }; });
  if (res.status === 401) { sair(); throw new Error('sessao expirada'); }
  if (!data.ok) throw new Error(data.error || 'erro');
  return data;
}

/* ============================================================
   COMERCIAL → META  (o placar dentro do painel)
   ============================================================ */
function carregaMeta() {
  const painel = document.getElementById('painel-meta');

  // Trocar de aba e voltar não pode deixar dois placares perguntando
  // ao servidor ao mesmo tempo. O antigo para antes do novo nascer.
  if (MT_VIVO) { MT_VIVO.para(); MT_VIVO = null; }

  painel.innerHTML =
    '<div class="card">' +
      '<div class="mt" id="mt-painel"><p class="muted">Abrindo o placar…</p></div>' +
    '</div>' +
    '<div class="card" id="mt-ajuda"></div>';

  MT_VIVO = MetaPlacar.monta(document.getElementById('mt-painel'), {
    buscar: async function (selo) {
      const d = await apiMt('mt_placar', { params: selo ? { selo: selo } : {} });
      if (d && !d.igual) pintaAjudaMeta(d);
      return d;
    },
    canvas: document.getElementById('confete-meta'),
    pop: document.getElementById('pop-meta'),
    comSom: true,
    comTela: true
  });
}

// O cartão de baixo: o link da televisão e o atalho para lançar.
function pintaAjudaMeta(d) {
  const el = document.getElementById('mt-ajuda');
  if (!el) return;

  const link = d.tv_codigo ? location.origin + '/meta?tv=' + d.tv_codigo : '';

  el.innerHTML =
    '<h2>Colocar na televisão</h2>' +
    '<p class="sub">Este link abre só o placar, em tela cheia, sem login e sem acesso ao ' +
      'resto do painel. Pode deixar aberto o dia inteiro.</p>' +
    (link
      ? '<div class="mg-tv">' +
          '<div class="mg-link" id="mt-link-tv">' + esc(link) + '</div>' +
          '<button class="btn btn-sm" id="mt-copiar">Copiar link</button>' +
          '<a class="btn btn-sm btn-ghost" href="' + esc(link) + '" target="_blank" rel="noopener">Abrir</a>' +
        '</div>'
      : '<div class="alert alert-info">Nenhum link da TV foi criado ainda. ' +
        'Vá em <strong>Gerenciador de Meta</strong> e clique em <strong>Gerar link da TV</strong>.</div>') +
    (d.pode_lancar
      ? '<p class="sub" style="margin-top:16px">Para registrar um valor, abra ' +
        '<strong>Comercial → Gerenciador de Meta</strong>.</p>'
      : '');

  const bt = document.getElementById('mt-copiar');
  if (bt) {
    bt.addEventListener('click', function () {
      copia(link, bt);
    });
  }
}

/* O navigator.clipboard só existe em página segura (https) e pode
   ser negado pelo navegador. Quando falta, selecionar o texto para
   a pessoa é mais honesto do que avisar que não deu. */
function copia(texto, botao) {
  const pronto = function () {
    const antes = botao.textContent;
    botao.textContent = 'Copiado!';
    setTimeout(function () { botao.textContent = antes; }, 1600);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(texto).then(pronto).catch(function () { seleciona(); });
  } else { seleciona(); }

  function seleciona() {
    const alvo = document.getElementById('mt-link-tv') || document.getElementById('mg-link-tv');
    if (!alvo) { toast('Copie o link na mão: ' + texto); return; }
    const faixa = document.createRange();
    faixa.selectNodeContents(alvo);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(faixa);
    toast('Aperte Ctrl+C para copiar o link selecionado.');
  }
}

/* ============================================================
   COMERCIAL → GERENCIADOR DE META
   ============================================================ */
async function carregaMetaGerente() {
  const painel = document.getElementById('painel-metagerente');
  painel.innerHTML = '<div class="card"><p class="muted">Carregando…</p></div>';
  try {
    MG = await apiMt('mt_lista');
    desenhaGerente();
  } catch (e) {
    painel.innerHTML = '<div class="card"><div class="alert alert-erro">' + esc(e.message) + '</div></div>';
  }
}

function desenhaGerente() {
  const painel = document.getElementById('painel-metagerente');
  const d = MG;

  painel.innerHTML =
    resumoGerente(d) +
    (d.pode_lancar ? formGerente(d) : avisoSoLeitura()) +
    historicoGerente(d) +
    (d.pode_lancar ? ajustesGerente(d) : '');

  ligaGerente();
}

/* ---------------------------------------------- os três números */
function resumoGerente(d) {
  const tot = Number(d.total) || 0;
  const alvo = Number(d.alvo_centavos) || 0;
  const pct = alvo > 0 ? Math.min(100, Math.round((tot / alvo) * 100)) : null;

  // O ano junto do mes: num historico que vai durar anos, "Novembro"
  // sozinho e ambiguo na primeira vez que alguem olhar para tras.
  const titulo = esc(d.mes_nome) + ' de ' + esc(String(d.mes || '').slice(0, 4));

  return '<div class="card">' +
    '<h2>' + titulo + '</h2>' +
    '<p class="sub">O que já entrou na meta deste mês. ' +
      (alvo > 0 ? 'Alvo: <strong>' + esc(MetaPlacar.moedaCurta(alvo)) + '</strong>' +
        (pct !== null ? ' — <strong>' + pct + '%</strong> atingido.' : '')
        : 'Nenhum alvo definido ainda.') + '</p>' +
    '<div class="mt-duo" style="margin-top:4px">' +
      '<div class="mt-meia cm"><div class="mt-meia-cab"><span class="mt-pingo"></span>Comercial</div>' +
        '<div class="mt-meia-valor">' + esc(MetaPlacar.moeda(d.comercial)) + '</div></div>' +
      '<div class="mt-meia op"><div class="mt-meia-cab"><span class="mt-pingo"></span>Operacional</div>' +
        '<div class="mt-meia-valor">' + esc(MetaPlacar.moeda(d.operacional)) + '</div></div>' +
    '</div>' +
    '<p class="sub" style="margin-top:14px;margin-bottom:0">Total geral: ' +
      '<strong style="font-size:17px">' + esc(MetaPlacar.moeda(tot)) + '</strong>' +
      ' — a soma dos dois. Nunca é um número guardado à parte: é sempre a conta dos ' +
      'lançamentos vivos, então corrigir ou apagar um deles já arruma o placar.</p>' +
    '</div>';
}

function avisoSoLeitura() {
  return '<div class="card"><div class="alert alert-info">' +
    '<strong>Você só acompanha por aqui.</strong> Registrar valor na meta é coisa de ' +
    'Dono ou RH, a mesma tranca do Financeiro.</div></div>';
}

/* ---------------------------------------------- o formulário */
function formGerente(d) {
  const editando = !!MG_EDITANDO;

  return '<div class="card" id="mg-form-card">' +
    '<h2>' + (editando ? 'Corrigir lançamento' : 'Registrar valor') + '</h2>' +
    '<p class="sub">' + (editando
      ? 'Mudou o valor? O placar se corrige sozinho na hora, inclusive na televisão.'
      : 'Escolha de onde veio o dinheiro e preencha. Vai direto para o placar.') + '</p>' +

    '<div class="mg-abas" id="mg-abas" role="tablist">' +
      aba('comercial', 'Comercial') +
      aba('operacional', 'Operacional') +
    '</div>' +

    '<div class="mg-grade">' +
      '<div class="field"><label for="mg-resp">Responsável <span class="req">*</span></label>' +
        '<input id="mg-resp" maxlength="80" placeholder="Quem fechou" autocomplete="off">' +
        '<div class="hint">Quem fez a venda — não precisa ser você.</div></div>' +

      '<div class="field"><label for="mg-cliente">Cliente <span class="req">*</span></label>' +
        '<input id="mg-cliente" maxlength="120" placeholder="Nome do cliente" autocomplete="off"></div>' +

      '<div class="field"><label for="mg-servico">Serviço</label>' +
        '<input id="mg-servico" maxlength="120" placeholder="Assessoria, Tráfego Pago, Website…" ' +
        'list="mg-servicos" autocomplete="off">' +
        '<datalist id="mg-servicos">' +
          ['Assessoria de Marketing', 'Tráfego Pago', 'Website', 'Landing Page',
            'Social Media', 'Podcast', 'Setup', 'Consultoria']
            .map(function (s) { return '<option value="' + esc(s) + '">'; }).join('') +
        '</datalist></div>' +

      '<div class="field"><label for="mg-valor">Valor que entrou <span class="req">*</span></label>' +
        '<input id="mg-valor" inputmode="decimal" placeholder="3.500,00" autocomplete="off">' +
        '<div class="hint" id="mg-valor-dica">Pode escrever 3500 ou 3.500,00 — eu entendo os dois.</div></div>' +

      '<div class="field largo"><label for="mg-obs">Observações</label>' +
        '<textarea id="mg-obs" rows="2" maxlength="600" ' +
        'placeholder="Entrada do contrato + setup"></textarea></div>' +
    '</div>' +

    '<div id="mg-erro"></div>' +

    '<div class="row row-wrap" style="margin-top:4px">' +
      '<button class="btn" id="mg-salvar">' + (editando ? 'Salvar correção' : 'Registrar valor') + '</button>' +
      (editando ? '<button class="btn btn-ghost" id="mg-cancelar">Cancelar</button>' : '') +
    '</div>' +
    '</div>';
}

function aba(tipo, rotulo) {
  return '<button type="button" data-tipo="' + tipo + '" role="tab" ' +
    'aria-selected="' + (MG_TIPO === tipo ? 'true' : 'false') + '" ' +
    'class="' + (MG_TIPO === tipo ? 'on' : '') + '">' +
    '<span class="mt-pingo"></span>' + esc(rotulo) + '</button>';
}

/* ---------------------------------------------- o histórico */
function historicoGerente(d) {
  const linhas = d.lancamentos || [];

  if (!linhas.length) {
    return '<div class="card">' +
      '<h2>Últimos lançamentos</h2>' +
      '<p class="sub">Nada lançado em ' + esc(d.mes_nome.toLowerCase()) + ' ainda. ' +
      'O placar está em R$ 0,00 — e isso é o número de verdade, não um erro.</p>' +
      '</div>';
  }

  return '<div class="card">' +
    '<h2>Últimos lançamentos</h2>' +
    '<p class="sub">' + linhas.length + ' em ' + esc(d.mes_nome.toLowerCase()) +
      '. Serve para conferir se o que você digitou entrou certo.</p>' +
    '<div style="overflow-x:auto">' +
    '<table class="tabela"><thead><tr>' +
      '<th>Data</th><th>Responsável</th><th>Origem</th><th>Cliente</th>' +
      '<th>Serviço</th><th style="text-align:right">Valor</th>' +
      (d.pode_lancar ? '<th></th>' : '') +
    '</tr></thead><tbody>' +
    linhas.map(function (l) { return linhaHist(l, d.pode_lancar); }).join('') +
    '</tbody></table></div></div>';
}

function linhaHist(l, podeMexer) {
  const cl = l.tipo === 'operacional' ? 'op' : 'cm';
  return '<tr data-id="' + esc(l.id) + '">' +
    '<td style="white-space:nowrap">' + esc(dataCurta(l.created_at)) + '</td>' +
    '<td>' + esc(l.responsavel) +
      (l.user_nome && l.user_nome !== l.responsavel
        ? '<div class="muted small">lançado por ' + esc(l.user_nome) + '</div>' : '') +
    '</td>' +
    '<td><span class="mg-selo ' + cl + '"><span class="mt-pingo"></span>' + esc(l.tipo_nome) + '</span></td>' +
    '<td>' + esc(l.cliente) + '</td>' +
    '<td>' + (l.servico ? esc(l.servico) : '<span class="muted">—</span>') +
      (l.observacao ? '<div class="muted small">' + esc(l.observacao) + '</div>' : '') + '</td>' +
    '<td style="text-align:right"><span class="mg-linha-valor ' + cl + '">' +
      esc(MetaPlacar.moeda(l.valor_centavos)) + '</span></td>' +
    (podeMexer
      ? '<td style="white-space:nowrap;text-align:right">' +
          '<button class="btn btn-sm btn-ghost mg-editar" data-id="' + esc(l.id) + '">Corrigir</button> ' +
          '<button class="btn btn-sm btn-danger mg-apagar" data-id="' + esc(l.id) + '">Apagar</button>' +
        '</td>'
      : '') +
    '</tr>';
}

function dataCurta(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit',
      hour: '2-digit', minute: '2-digit'
    }).replace(',', '');
  } catch (e) { return String(iso).slice(0, 10); }
}

/* ---------------------------------------------- alvo e link da TV */
function ajustesGerente(d) {
  const link = d.tv_codigo ? location.origin + '/meta?tv=' + d.tv_codigo : '';

  return '<div class="card">' +
    '<h2>Alvo do mês</h2>' +
    '<p class="sub">O número que a equipe está perseguindo. A barra do placar enche em ' +
      'relação a ele. Deixe em 0 para mostrar só o acumulado, sem barra.</p>' +
    '<div class="row row-wrap">' +
      '<div class="field" style="flex:1;min-width:200px;margin:0">' +
        '<label for="mg-alvo">Alvo (R$)</label>' +
        '<input id="mg-alvo" inputmode="decimal" value="' +
          esc(d.alvo_centavos ? MetaPlacar.moeda(d.alvo_centavos).replace('R$ ', '') : '0') + '">' +
      '</div>' +
      '<button class="btn btn-sm" id="mg-alvo-salvar" style="align-self:flex-end">Salvar alvo</button>' +
    '</div>' +

    '<h2 style="margin-top:28px">Som da venda</h2>' +
    '<p class="sub">O que toca na televisão quando um valor entra. São cinco segundos — ' +
      'a ideia é a sala inteira ouvir. Clique em <strong>Ouvir</strong> para testar antes de escolher.</p>' +
    '<div class="mg-sons">' +
      Object.keys(d.sons || {}).map(function (k) { return cartaoSom(k, d.sons[k], d.som); }).join('') +
    '</div>' +

    '<h2 style="margin-top:28px">Link da televisão</h2>' +
    '<p class="sub">Abre só o placar, sem login, em tela cheia. Quem tiver este link vê o ' +
      'placar e <strong>nada mais</strong> — nem Financeiro, nem Clientes, nem Usuários. ' +
      'Se ele vazar, gere outro: o antigo morre na hora.</p>' +
    (link
      ? '<div class="mg-tv">' +
          '<div class="mg-link" id="mg-link-tv">' + esc(link) + '</div>' +
          '<button class="btn btn-sm" id="mg-copiar">Copiar</button>' +
          '<a class="btn btn-sm btn-ghost" href="' + esc(link) + '" target="_blank" rel="noopener">Abrir</a>' +
          '<button class="btn btn-sm btn-ghost" id="mg-novo-codigo">Gerar outro</button>' +
        '</div>' +
        (d.tv_criado_em
          ? '<p class="sub" style="margin-top:10px;margin-bottom:0">Criado em ' +
            esc(dataCurta(d.tv_criado_em)) + '.</p>'
          : '')
      : '<button class="btn btn-sm" id="mg-novo-codigo">Gerar link da TV</button>') +
    '</div>';
}

function cartaoSom(chave, som, escolhido) {
  const on = chave === escolhido;
  return '<div class="mg-som' + (on ? ' on' : '') + '" data-som="' + esc(chave) + '">' +
    '<div class="mg-som-cab">' +
      '<span class="mg-som-bola"></span>' +
      '<strong>' + esc(som.nome) + '</strong>' +
      (on ? '<span class="mg-som-tag">tocando hoje</span>' : '') +
    '</div>' +
    '<p>' + esc(som.descricao) + '</p>' +
    '<div class="row" style="gap:8px">' +
      '<button class="btn btn-sm btn-ghost mg-ouvir" data-som="' + esc(chave) + '">Ouvir</button>' +
      (on ? '' : '<button class="btn btn-sm mg-usar" data-som="' + esc(chave) + '">Usar este</button>') +
    '</div>' +
    '</div>';
}

/* ---------------------------------------------- comportamento */
function ligaGerente() {
  // abas Comercial / Operacional
  const abas = document.getElementById('mg-abas');
  if (abas) {
    abas.addEventListener('click', function (ev) {
      const bt = ev.target.closest('button[data-tipo]');
      if (!bt || bt.dataset.tipo === MG_TIPO) return;
      MG_TIPO = bt.dataset.tipo;
      abas.querySelectorAll('button').forEach(function (x) {
        const on = x.dataset.tipo === MG_TIPO;
        x.classList.toggle('on', on);
        x.setAttribute('aria-selected', on ? 'true' : 'false');
      });
    });
  }

  // O responsável já vem com o nome de quem está logado — é o caso
  // mais comum. Fica editável porque quem lança não é sempre quem
  // vendeu.
  const resp = document.getElementById('mg-resp');
  if (resp && !resp.value && !MG_EDITANDO) resp.value = MG.eu_nome || '';

  const btSalvar = document.getElementById('mg-salvar');
  if (btSalvar) btSalvar.addEventListener('click', salvaLancamento);

  const btCancelar = document.getElementById('mg-cancelar');
  if (btCancelar) {
    btCancelar.addEventListener('click', function () {
      MG_EDITANDO = null;
      desenhaGerente();
    });
  }

  // Enter no valor registra. Dinheiro entrando é a ação mais comum
  // desta tela; obrigar a pessoa a ir até o botão é atrito à toa.
  const valor = document.getElementById('mg-valor');
  if (valor) {
    valor.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); salvaLancamento(); }
    });
  }

  document.querySelectorAll('.mg-editar').forEach(function (bt) {
    bt.addEventListener('click', function () { abreCorrecao(bt.dataset.id); });
  });
  document.querySelectorAll('.mg-apagar').forEach(function (bt) {
    bt.addEventListener('click', function () { apagaLancamento(bt.dataset.id, bt); });
  });

  const btAlvo = document.getElementById('mg-alvo-salvar');
  if (btAlvo) btAlvo.addEventListener('click', salvaAlvo);

  const btCopiar = document.getElementById('mg-copiar');
  if (btCopiar) {
    btCopiar.addEventListener('click', function () {
      copia(location.origin + '/meta?tv=' + MG.tv_codigo, btCopiar);
    });
  }

  const btNovo = document.getElementById('mg-novo-codigo');
  if (btNovo) btNovo.addEventListener('click', function () { geraCodigo(btNovo); });

  // OUVIR: toca o arquivo de verdade, aqui no painel. O clique no
  // botão é também o que libera o áudio neste navegador — então,
  // depois de ouvir uma vez, o placar desta aba já toca sozinho.
  document.querySelectorAll('.mg-ouvir').forEach(function (bt) {
    bt.addEventListener('click', function () { ouveSom(bt); });
  });
  document.querySelectorAll('.mg-usar').forEach(function (bt) {
    bt.addEventListener('click', function () { escolheSom(bt); });
  });
}

let MG_PREVIA = null;

function ouveSom(bt) {
  if (!window.MetaSom) { toast('O seu navegador não toca o som da venda.', true); return; }

  // O clique neste botão é também o gesto que libera áudio neste
  // navegador. Depois de ouvir uma vez, o placar desta aba toca
  // sozinho — não é truque, é como o navegador funciona.
  const deu = MetaSom.acorda() && MetaSom.toca(bt.dataset.som);
  if (!deu) { toast('O navegador bloqueou o som. Clique de novo.', true); return; }

  // Um de cada vez na aparência: o botão avisa que está tocando e
  // volta sozinho quando o som acaba.
  if (MG_PREVIA) clearTimeout(MG_PREVIA);
  document.querySelectorAll('.mg-ouvir').forEach(function (x) { x.textContent = 'Ouvir'; });
  bt.textContent = 'Tocando…';
  MG_PREVIA = setTimeout(function () { bt.textContent = 'Ouvir'; },
    MetaSom.duracao(bt.dataset.som) * 1000);
}

async function escolheSom(bt) {
  bt.disabled = true;
  bt.textContent = 'Salvando…';
  try {
    await apiMt('mt_config', { body: { som: bt.dataset.som } });
    toast('Som trocado. A televisão pega o novo sozinha.');
    MG = await apiMt('mt_lista');
    desenhaGerente();
  } catch (e) {
    toast(e.message, true);
    bt.disabled = false;
    bt.textContent = 'Usar este';
  }
}

function erroForm(msg) {
  const el = document.getElementById('mg-erro');
  if (el) {
    el.innerHTML = msg ? '<div class="alert alert-erro">' + esc(msg) + '</div>' : '';
  }
  if (msg) toast(msg, true);
}

async function salvaLancamento() {
  // A TRANCA DO DUPLO CLIQUE.
  //
  // São duas, e as duas precisam existir. Esta variável barra o
  // segundo clique mesmo se ele chegar no mesmo milésimo de segundo,
  // antes de o navegador ter desenhado o botão desabilitado. O
  // botão desabilitado é o que a pessoa VÊ; a variável é o que de
  // fato impede dois lançamentos iguais no banco.
  if (MG_SALVANDO) return;

  const bt = document.getElementById('mg-salvar');
  const corpo = {
    tipo: MG_TIPO,
    responsavel: (document.getElementById('mg-resp') || {}).value || '',
    cliente: (document.getElementById('mg-cliente') || {}).value || '',
    servico: (document.getElementById('mg-servico') || {}).value || '',
    valor: (document.getElementById('mg-valor') || {}).value || '',
    observacao: (document.getElementById('mg-obs') || {}).value || ''
  };
  if (MG_EDITANDO) corpo.id = MG_EDITANDO;

  // Confere aqui também, só para a pessoa não esperar uma viagem ao
  // servidor para descobrir que faltou o cliente. Quem manda é o
  // servidor — a tela é educação, não segurança.
  if (!corpo.responsavel.trim()) return erroForm('Diga quem é o responsável por esse valor.');
  if (!corpo.cliente.trim()) return erroForm('Diga de qual cliente é esse valor.');
  if (!corpo.valor.trim()) return erroForm('Falta o valor que entrou.');

  MG_SALVANDO = true;
  const antes = bt ? bt.innerHTML : '';
  if (bt) { bt.disabled = true; bt.innerHTML = '<span class="spinner"></span> Registrando…'; }
  erroForm('');

  try {
    const r = await apiMt('mt_salvar', { body: corpo });
    const editou = !!MG_EDITANDO;
    MG_EDITANDO = null;

    toast(editou ? 'Lançamento corrigido. O placar já mudou.' : 'Valor registrado! 🚀');

    // Recarrega o histórico e os totais desta tela.
    MG = await apiMt('mt_lista');
    desenhaGerente();

    // E, se o placar também estiver aberto no painel, ele recebe o
    // número novo sem esperar a próxima pergunta ao servidor.
    if (MT_VIVO && r.placar) MT_VIVO.recebe(r.placar);
  } catch (e) {
    erroForm(e.message);
    if (bt) { bt.disabled = false; bt.innerHTML = antes; }
  } finally {
    MG_SALVANDO = false;
  }
}

function abreCorrecao(id) {
  const l = (MG.lancamentos || []).filter(function (x) { return x.id === id; })[0];
  if (!l) return;

  MG_EDITANDO = id;
  MG_TIPO = l.tipo;
  desenhaGerente();

  const poe = function (campo, v) { const el = document.getElementById(campo); if (el) el.value = v || ''; };
  poe('mg-resp', l.responsavel);
  poe('mg-cliente', l.cliente);
  poe('mg-servico', l.servico);
  poe('mg-valor', MetaPlacar.moeda(l.valor_centavos).replace('R$ ', ''));
  poe('mg-obs', l.observacao);

  const card = document.getElementById('mg-form-card');
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function apagaLancamento(id, bt) {
  const l = (MG.lancamentos || []).filter(function (x) { return x.id === id; })[0];
  const quanto = l ? MetaPlacar.moeda(l.valor_centavos) : 'esse valor';
  if (!confirm('Apagar o lançamento de ' + quanto + (l ? ' do cliente ' + l.cliente : '') + '?\n\n' +
    'O placar vai cair esse valor na hora, inclusive na televisão.')) return;

  if (bt) { bt.disabled = true; bt.textContent = 'Apagando…'; }
  try {
    const r = await apiMt('mt_excluir', { body: { id: id } });
    toast('Lançamento apagado. O placar já reflete isso.');
    MG = await apiMt('mt_lista');
    desenhaGerente();
    if (MT_VIVO && r.placar) MT_VIVO.recebe(r.placar);
  } catch (e) {
    toast(e.message, true);
    if (bt) { bt.disabled = false; bt.textContent = 'Apagar'; }
  }
}

async function salvaAlvo() {
  const bt = document.getElementById('mg-alvo-salvar');
  const v = (document.getElementById('mg-alvo') || {}).value || '0';
  if (bt) { bt.disabled = true; bt.textContent = 'Salvando…'; }
  try {
    await apiMt('mt_config', { body: { alvo: v } });
    toast('Alvo salvo.');
    MG = await apiMt('mt_lista');
    desenhaGerente();
  } catch (e) {
    toast(e.message, true);
    if (bt) { bt.disabled = false; bt.textContent = 'Salvar alvo'; }
  }
}

async function geraCodigo(bt) {
  if (MG.tv_codigo && !confirm('Gerar um link novo faz o link antigo parar de funcionar na hora.\n\n' +
    'A televisão vai precisar do link novo. Continuar?')) return;

  if (bt) { bt.disabled = true; bt.textContent = 'Gerando…'; }
  try {
    await apiMt('mt_config', { body: { novo_codigo: true } });
    toast('Link da TV criado. Copie e abra na televisão.');
    MG = await apiMt('mt_lista');
    desenhaGerente();
  } catch (e) {
    toast(e.message, true);
    if (bt) { bt.disabled = false; bt.textContent = 'Gerar link da TV'; }
  }
}

/* ============================================================
   SAIR DA ABA DO PLACAR

   O placar pergunta ao servidor a cada poucos segundos enquanto
   está na tela. Se a pessoa for para Financeiro e esquecer o painel
   aberto, essas perguntas continuariam a tarde inteira sem ninguém
   olhando. Então, ao clicar em qualquer OUTRA aba, o placar para.

   Isto vive aqui, e não no admin-core.js, de propósito: o roteador
   do painel não precisa saber que existe um placar. Quem tem a
   necessidade cuida dela.
   ============================================================ */
(function desligaPlacarAoSair() {
  const abas = document.getElementById('abas');
  if (!abas) return;
  abas.addEventListener('click', function (ev) {
    const bt = ev.target.closest('button[data-aba]');
    if (!bt || bt.dataset.aba === 'meta') return;
    if (MT_VIVO) { MT_VIVO.para(); MT_VIVO = null; }
  });
})();
