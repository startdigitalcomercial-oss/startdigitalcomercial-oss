/* ============================================================
   ONBOARDING — a entrada de cliente novo, acompanhada.

   Duas formas de ver a mesma coisa: Lista e Quadro. Os dados são
   os mesmos; muda só o jeito de olhar.

   A regra que mais importa está no servidor, não aqui: a SITUAÇÃO
   (a iniciar / em andamento / concluído) é o que a equipe decide,
   e as colunas de prazo (atrasado, a vencer, em dia) são contas
   feitas com a data de hoje. Por isso arrastar um card muda a
   situação, mas nunca "desatrasa" ninguém.
   ============================================================ */

let OB = null;
let OB_VISTA = 'lista';          // lista | quadro
let OB_BUSCA = '', OB_GESTOR = '', OB_SIT = '';

async function apiOb(action, opts) {
  opts = opts || {};
  const qs = new URLSearchParams(Object.assign({ action: action }, opts.params || {}));
  const res = await fetch('/api/operacao?' + qs.toString(), {
    method: opts.body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json().catch(function () { return { ok: false, error: 'resposta invalida' }; });
  if (res.status === 401) { sair(); throw new Error('sessao expirada'); }
  if (!data.ok) throw new Error(data.error || 'erro');
  return data;
}

/* Busca a lista de novo e repinta SÓ a área dos cards. Os filtros,
   a busca e a escolha entre Lista e Quadro ficam onde estavam —
   antes isto era "OB = null" + redesenhar tudo, que acendia o
   spinner e devolvia a pessoa para o topo da página. */
async function obRecarrega() {
  const area = document.getElementById('ob-area');
  if (!area) { OB = null; carregaOnboarding(); return; }
  area.classList.add('ob-esperando');
  try {
    OB = await apiOb('ob_lista');
    obPinta();
  } catch (e) {
    toast(e.message, true);
  }
  const depois = document.getElementById('ob-area');
  if (depois) depois.classList.remove('ob-esperando');
}

async function carregaOnboarding() {
  const alvo = document.getElementById('painel-oponboarding');
  if (!OB) alvo.innerHTML = '<div class="spinner"></div>';
  try {
    OB = await apiOb('ob_lista');
    desenhaOnboarding();
  } catch (e) {
    alvo.innerHTML = '<div class="alert alert-erro">' + esc(e.message) + '</div>';
  }
}

function obDataBr(iso) {
  if (!iso) return '—';
  const p = String(iso).slice(0, 10).split('-');
  return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso;
}

function obFiltrados() {
  let l = OB.onboardings || [];
  const b = opChave(OB_BUSCA);
  if (b) l = l.filter(function (o) { return opChave(o.cliente).indexOf(b) >= 0; });
  if (OB_GESTOR) l = l.filter(function (o) { return o.gestor_id === OB_GESTOR; });
  if (OB_SIT) l = l.filter(function (o) { return o.situacao === OB_SIT; });
  return l;
}

function obPino(o) {
  if (o.situacao === 'concluido') return '<span class="op-pino ativo">Concluído</span>';
  if (o.situacao === 'cancelado') return '<span class="op-pino cancelado">Cancelado</span>';
  if (o.atrasado) return '<span class="op-pino flopado">Atrasado</span>';
  if (o.situacao === 'a_iniciar') return '<span class="op-pino cancelado">A iniciar</span>';
  if (o.dias_para_o_prazo !== null && o.dias_para_o_prazo <= 7) {
    return '<span class="op-pino suspenso">Vence em ' + o.dias_para_o_prazo + 'd</span>';
  }
  return '<span class="op-pino ativo">Em dia</span>';
}

function desenhaOnboarding() {
  const vazio = (OB.onboardings || []).length === 0;

  document.getElementById('painel-oponboarding').innerHTML =
    '<div class="op">' +
    '<div class="op-cab">' +
      '<div><div class="small muted">Acompanhamento e gestão da entrada de novos clientes.</div></div>' +
      '<div class="row row-wrap" style="gap:10px;align-items:center">' +
        '<div class="fd2-filtro" id="ob-vista">' +
          '<button type="button" data-v="lista"' + (OB_VISTA === 'lista' ? ' class="on"' : '') + '>Lista</button>' +
          '<button type="button" data-v="quadro"' + (OB_VISTA === 'quadro' ? ' class="on"' : '') + '>Quadro</button>' +
        '</div>' +
        '<button class="btn btn-sm" id="ob-novo">+ Iniciar Onboarding</button>' +
      '</div>' +
    '</div>' +

    (vazio ? obVazio() : (
      '<div class="row row-wrap ob-filtros" style="gap:10px;align-items:flex-end;margin-bottom:14px">' +
        buscaHtml('ob-busca', 'Buscar cliente…', OB_BUSCA) +
        '<div class="field" style="margin:0"><label for="ob-gestor">Gestor</label>' +
          '<select id="ob-gestor"><option value="">Todos</option>' +
            (OB.gestores || []).map(function (g) {
              return '<option value="' + esc(g.id) + '"' + (OB_GESTOR === g.id ? ' selected' : '') + '>' +
                esc(g.nome) + '</option>';
            }).join('') + '</select></div>' +
        '<div class="field" style="margin:0"><label for="ob-sit">Situação</label>' +
          '<select id="ob-sit"><option value="">Todas</option>' +
            [['a_iniciar', 'A iniciar'], ['em_andamento', 'Em andamento'],
             ['concluido', 'Concluído'], ['cancelado', 'Cancelado']].map(function (o) {
              return '<option value="' + o[0] + '"' + (OB_SIT === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
            }).join('') + '</select></div>' +
        '<span style="flex:1"></span><span class="small muted" id="ob-conta"></span>' +
      '</div>' +
      '<div id="ob-area"></div>'
    )) + '</div>';

  if (!vazio) obPinta();
  ligaOnboarding();
}

function obVazio() {
  return '<div class="card" style="text-align:center;padding:48px 24px">' +
    '<div style="font-size:15.5px;font-weight:600;margin-bottom:6px">Nenhum onboarding ainda</div>' +
    '<div class="small muted" style="max-width:430px;margin:0 auto 18px;line-height:1.6">' +
      'Quando um cliente novo entrar, use <strong>+ Iniciar Onboarding</strong> para acompanhar a entrada dele. ' +
      'Os clientes vêm da Gestão — ninguém precisa ser cadastrado duas vezes.</div></div>';
}

function obPinta() {
  const lista = obFiltrados();
  const conta = document.getElementById('ob-conta');
  if (conta) conta.textContent = lista.length + (lista.length === 1 ? ' processo' : ' processos');
  document.getElementById('ob-area').innerHTML =
    OB_VISTA === 'lista' ? obComoLista(lista) : obComoQuadro(lista);
  obLigaCards();
}

/* ---------------- lista ---------------- */
function obComoLista(lista) {
  return '<div class="card" style="padding:0;overflow:hidden"><div style="overflow-x:auto">' +
    '<table class="tbl" style="min-width:800px"><thead><tr>' +
      '<th style="padding:12px 16px 10px">Cliente</th><th>Gestor</th><th>Início</th>' +
      '<th>Prazo</th><th>Situação</th><th>Conclusão</th><th></th>' +
    '</tr></thead><tbody>' +
    (lista.length ? lista.map(function (o) {
      return '<tr>' +
        '<td style="padding-left:16px;font-weight:600">' + esc(o.cliente) +
          (o.categoria ? '<div class="small muted" style="font-weight:400">' + esc(o.categoria) + '</div>' : '') +
        '</td>' +
        '<td><span class="op-fase"><i style="background:' + opCor(o.cor) + '"></i>' + esc(o.gestor) + '</span></td>' +
        '<td class="small muted" style="white-space:nowrap">' + obDataBr(o.iniciado_em || o.inicio_previsto) + '</td>' +
        '<td class="small muted" style="white-space:nowrap">' + obDataBr(o.prazo) + '</td>' +
        '<td>' + obPino(o) + '</td>' +
        '<td class="small muted" style="white-space:nowrap">' + obDataBr(o.concluido_em) + '</td>' +
        '<td style="text-align:right;padding-right:14px"><button class="btn btn-sm btn-ghost ob-abrir" ' +
          'data-id="' + esc(o.id) + '">Abrir</button></td>' +
      '</tr>';
    }).join('')
      : '<tr><td colspan="7" style="padding:26px" class="muted">Nenhum processo com esses filtros.</td></tr>') +
    '</tbody></table></div></div>';
}

/* ---------------- quadro ---------------- */
function obComoQuadro(lista) {
  const porColuna = {};
  lista.forEach(function (o) { (porColuna[o.coluna] || (porColuna[o.coluna] = [])).push(o); });

  return '<div class="small muted" style="margin-bottom:10px">' +
      'Cada processo aparece em <strong>uma coluna só</strong>. Concluído no mês vem primeiro, ' +
      'depois A iniciar, Atrasados, A vencer, Em dia e, por último, os que ainda não têm prazo marcado.' +
    '</div>' +
    '<div class="ob-quadro">' +
    (OB.colunas || []).map(function (col) {
      const itens = porColuna[col.chave] || [];
      return '<div class="ob-coluna" data-col="' + col.chave + '">' +
        '<div class="ob-cab"><span>' + esc(col.nome) + '</span>' +
          '<b>' + itens.length + '</b></div>' +
        '<div class="ob-pilha">' +
          (itens.length ? itens.map(obCard).join('')
            : '<div class="ob-nada">—</div>') +
        '</div></div>';
    }).join('') +
    '</div>';
}

function obCard(o) {
  return '<div class="ob-card ob-abrir" data-id="' + esc(o.id) + '" draggable="true">' +
    '<div class="ob-cliente">' + esc(o.cliente) + '</div>' +
    '<div class="ob-linha"><span class="op-fase"><i style="background:' + opCor(o.cor) + '"></i>' +
      esc(o.gestor) + '</span></div>' +
    '<div class="ob-linha ob-pe">' +
      '<span class="small muted" style="white-space:nowrap">' +
        (o.prazo ? 'prazo ' + obDataBr(o.prazo) : 'sem prazo') + '</span>' +
      obPino(o) +
    '</div></div>';
}

/* ============================================================
   ONDE O CARD CAI

   Isto é um ESPELHO da regra que está em api/operacao.js, no
   ob_lista. Precisa existir aqui porque, ao arrastar, a tela
   mostra o resultado na hora, antes de o servidor responder.

   Quem manda continua sendo o servidor: quando ele responde, a
   gente recalcula com os campos que vieram dele e, se o card
   tiver que ficar noutro lugar, ele anda sozinho. O espelho só
   adianta o que quase sempre vai acontecer.

   Se a regra mudar lá, muda aqui. O tools/test-kanban.js compara
   os dois lado a lado e quebra se eles discordarem.
   ============================================================ */
function obDiasAte(prazo, hoje) {
  if (!prazo) return null;
  return Math.round((new Date(prazo + 'T12:00:00Z') - new Date(hoje + 'T12:00:00Z')) / 86400000);
}

function obRecalcula(o, hoje, periodo) {
  o.atrasado = o.situacao === 'em_andamento' && !!o.prazo && o.prazo < hoje;
  o.dias_para_o_prazo = obDiasAte(o.prazo, hoje);
  o.situacao_nome = { a_iniciar: 'A iniciar', em_andamento: 'Em andamento',
    concluido: 'Concluído', cancelado: 'Cancelado' }[o.situacao] || o.situacao;

  const em7 = new Date(hoje + 'T12:00:00Z');
  em7.setUTCDate(em7.getUTCDate() + 7);
  const limite7 = em7.toISOString().slice(0, 10);

  if (o.situacao === 'concluido') {
    o.coluna = (o.concluido_em && periodo && o.concluido_em >= periodo.de && o.concluido_em <= periodo.ate)
      ? 'concluidos_mes' : 'fora_do_mes';
  } else if (o.situacao === 'cancelado') {
    o.coluna = 'fora_do_mes';
  } else if (o.situacao === 'a_iniciar') {
    o.coluna = 'a_iniciar';
  } else if (o.atrasado) {
    o.coluna = 'atrasados';
  } else if (o.prazo && o.prazo <= limite7) {
    o.coluna = 'a_vencer';
  } else if (o.prazo) {
    o.coluna = 'em_dia';
  } else {
    o.coluna = 'em_andamento';
  }
  return o;
}

/* O que o servidor faz com as datas quando a situação muda — mesmo
   espelho, mesma razão. Aplica no objeto e devolve ele. */
function obAplicaSituacao(o, para, hoje) {
  o.situacao = para;
  if (para === 'em_andamento' && !o.iniciado_em) o.iniciado_em = hoje;
  if (para === 'concluido') o.concluido_em = hoje;
  else o.concluido_em = null;
  if (para === 'a_iniciar') o.iniciado_em = null;
  return o;
}

/* ---------------- mexer no quadro sem redesenhar ---------------- */

// Acha o card na memória pelo id.
function obAchaPorId(id) {
  return (OB.onboardings || []).filter(function (o) { return o.id === id; })[0] || null;
}

// Põe o nó na pilha da coluna certa (ou tira do quadro, se a coluna
// nem existe por lá). Cuida do travessão de coluna vazia e da conta
// do cabeçalho. Nada disso redesenha o quadro.
function obPoeNaColuna(no, chave) {
  const col = document.querySelector('.ob-coluna[data-col="' + chave + '"]');
  const antiga = no.parentElement;
  if (!col) { no.remove(); obContaColunas(); return false; }
  const pilha = col.querySelector('.ob-pilha');
  const nada = pilha.querySelector('.ob-nada');
  if (nada) nada.remove();
  pilha.appendChild(no);
  // recomeça a animação de pouso na mão: mover um nó no DOM não
  // faz o navegador tocar de novo uma animação que já tocou.
  no.classList.remove('pousou');
  void no.offsetWidth;
  no.classList.add('pousou');
  if (antiga && antiga !== pilha && !antiga.querySelector('.ob-card')) {
    antiga.insertAdjacentHTML('beforeend', '<div class="ob-nada">—</div>');
  }
  obContaColunas();
  return true;
}

// Reconta o número no topo de cada coluna.
function obContaColunas() {
  document.querySelectorAll('.ob-coluna').forEach(function (col) {
    const n = col.querySelectorAll('.ob-card').length;
    const b = col.querySelector('.ob-cab b');
    if (b) b.textContent = n;
    const pilha = col.querySelector('.ob-pilha');
    if (pilha && !n && !pilha.querySelector('.ob-nada')) {
      pilha.insertAdjacentHTML('beforeend', '<div class="ob-nada">—</div>');
    }
  });
  const conta = document.getElementById('ob-conta');
  if (conta) {
    const l = obFiltrados();
    conta.textContent = l.length + (l.length === 1 ? ' processo' : ' processos');
  }
}

// Troca só a etiqueta de situação dentro do card, sem refazer o card.
function obAtualizaPino(no, o) {
  const pe = no.querySelector('.ob-pe');
  if (!pe) return;
  const velho = pe.querySelector('.op-pino');
  if (velho) velho.outerHTML = obPino(o);
}

function obLigaCards() {
  document.querySelectorAll('#ob-area .ob-abrir').forEach(function (x) {
    x.addEventListener('click', function (ev) {
      ev.stopPropagation();
      abreOnboarding(x.dataset.id);
    });
  });

  // Arrastar entre as colunas que são DECISÃO da equipe. As colunas
  // de prazo não aceitam: elas são conta, não escolha.
  if (OB_VISTA !== 'quadro') return;
  const manuais = { a_iniciar: 'a_iniciar', em_andamento: 'em_andamento', concluidos_mes: 'concluido' };
  let pego = null;

  document.querySelectorAll('.ob-card').forEach(function (c) {
    c.addEventListener('dragstart', function (ev) {
      pego = c;
      c.classList.add('arrastando');
      // sem isto o Firefox nem começa a arrastar
      if (ev.dataTransfer) { ev.dataTransfer.effectAllowed = 'move'; try { ev.dataTransfer.setData('text/plain', c.dataset.id); } catch (e) { } }
    });
    c.addEventListener('dragend', function () { c.classList.remove('arrastando'); pego = null; });
  });

  document.querySelectorAll('.ob-coluna').forEach(function (col) {
    const destino = manuais[col.dataset.col];
    col.addEventListener('dragover', function (ev) {
      if (!pego || !destino) return;
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
      col.classList.add('alvo');
    });
    col.addEventListener('dragleave', function (ev) {
      if (col.contains(ev.relatedTarget)) return;
      col.classList.remove('alvo');
    });
    col.addEventListener('drop', function (ev) {
      col.classList.remove('alvo');
      if (!pego || !destino) return;
      ev.preventDefault();
      obSolta(pego, destino);
    });
  });
}

/* ============================================================
   SOLTAR UM CARD

   O jeito antigo era: pede ao servidor, espera, joga TODO o
   onboarding fora e desenha a tela de novo. Dava a sensação de
   F5 — piscava, voltava para o topo, perdia o scroll.

   Agora:
     1. o card anda na hora;
     2. o pedido vai por baixo;
     3. deu certo → confere com a resposta do servidor e, se
        precisar, ajeita;
     4. deu errado → o card volta exatamente para onde estava,
        com a etiqueta de antes, e o erro aparece.

   Nada é redesenhado. O scroll fica onde o usuário deixou.
   ============================================================ */
async function obSolta(no, destino) {
  const id = no.dataset.id;
  const o = obAchaPorId(id);
  if (!o) return;
  if (o.situacao === destino) return;              // soltou na mesma coluna: nada a fazer

  const hoje = (OB && OB.hoje) || new Date().toISOString().slice(0, 10);
  const periodo = OB && OB.periodo;

  // a fotografia do antes, para conseguir desfazer
  const antes = {
    situacao: o.situacao, iniciado_em: o.iniciado_em, concluido_em: o.concluido_em,
    coluna: o.coluna, atrasado: o.atrasado, dias: o.dias_para_o_prazo,
    pai: no.parentElement, vizinho: no.nextElementSibling
  };

  // 1 e 2: anda na hora
  obAplicaSituacao(o, destino, hoje);
  obRecalcula(o, hoje, periodo);
  obAtualizaPino(no, o);
  const ficou = obPoeNaColuna(no, o.coluna);
  no.classList.add('salvando');

  function desfaz() {
    o.situacao = antes.situacao; o.iniciado_em = antes.iniciado_em;
    o.concluido_em = antes.concluido_em; o.coluna = antes.coluna;
    o.atrasado = antes.atrasado; o.dias_para_o_prazo = antes.dias;
    o.situacao_nome = { a_iniciar: 'A iniciar', em_andamento: 'Em andamento',
      concluido: 'Concluído', cancelado: 'Cancelado' }[o.situacao] || o.situacao;
    obAtualizaPino(no, o);
    if (antes.pai) {
      const nada = antes.pai.querySelector('.ob-nada');
      if (nada) nada.remove();
      antes.pai.insertBefore(no, antes.vizinho && antes.vizinho.parentElement === antes.pai ? antes.vizinho : null);
    }
    no.classList.remove('salvando');
    obContaColunas();
  }

  try {
    const r = await apiOb('ob_mover', { body: { id: id, situacao: destino } });

    // 3: o servidor é quem manda. Se ele devolveu datas diferentes
    // das que a gente chutou, vale a dele — e o card se ajeita.
    const linha = r && r.onboarding;
    if (linha) {
      o.situacao = linha.situacao;
      o.iniciado_em = linha.iniciado_em;
      o.concluido_em = linha.concluido_em;
      const coluna = obRecalcula(o, hoje, periodo).coluna;
      if (coluna !== o.coluna || !ficou) obPoeNaColuna(no, coluna);
      obAtualizaPino(no, o);
    }
    no.classList.remove('salvando');
    toast(ficou ? 'Onboarding atualizado' : 'Onboarding atualizado — saiu do quadro deste mês');
  } catch (e) {
    // 4: voltou tudo como estava
    desfaz();
    toast(e.message, true);
  }
}

function ligaOnboarding() {
  const b = function (id) { return document.getElementById(id); };

  document.querySelectorAll('#ob-vista button').forEach(function (bt) {
    bt.addEventListener('click', function () {
      OB_VISTA = bt.dataset.v;
      document.querySelectorAll('#ob-vista button').forEach(function (x) {
        x.classList.toggle('on', x === bt);
      });
      if (b('ob-area')) obPinta();
    });
  });
  b('ob-novo').addEventListener('click', function () { abreOnboarding(null); });

  if (!b('ob-busca')) return;
  // A lista inteira já está na memória (veio no ob_lista). Filtrar não
  // custa nada, então o resultado aparece na mesma tecla — esperar aqui
  // só faria a tela parecer lenta de graça.
  ligaBusca('ob-busca', function (texto) { OB_BUSCA = texto; obPinta(); }, 0);
  b('ob-gestor').addEventListener('change', function () { OB_GESTOR = this.value; obPinta(); });
  b('ob-sit').addEventListener('change', function () { OB_SIT = this.value; obPinta(); });
}

/* ---------------- a ficha ---------------- */
function abreOnboarding(id) {
  const novo = !id;
  const o = novo ? {} : ((OB.onboardings || []).filter(function (x) { return x.id === id; })[0] || {});

  document.getElementById('g-nome').textContent = novo ? 'Iniciar onboarding' : (o.cliente || 'Onboarding');
  document.getElementById('g-sub').textContent = novo
    ? 'O cliente vem da Gestão — ninguém é cadastrado duas vezes.'
    : o.situacao_nome + (o.atrasado ? ' · atrasado' : '');

  const hoje = OB.hoje;

  document.getElementById('g-corpo').innerHTML =
    (novo
      ? '<div class="field"><label for="ob-f-cliente">Cliente</label>' +
          '<span class="hint">Só aparecem os clientes que ainda não têm um onboarding em aberto.</span>' +
          '<select id="ob-f-cliente"><option value="">— escolha —</option>' +
            (OB.disponiveis || []).map(function (c) {
              return '<option value="' + esc(c.id) + '" data-g="' + esc(c.gestor_id || '') + '">' +
                esc(c.nome) + '</option>';
            }).join('') + '</select>' +
          ((OB.disponiveis || []).length ? ''
            : '<span class="hint" style="color:var(--orange)">Todos os clientes da Gestão já têm ' +
              'onboarding em aberto. Cadastre o cliente em Operação → Gestão primeiro.</span>') +
        '</div>'
      : '<div class="field"><label>Cliente</label>' +
          '<div style="font-size:15px;font-weight:600">' + esc(o.cliente) + '</div></div>') +

    '<div class="field"><label for="ob-f-gestor">Gestor responsável</label>' +
      '<select id="ob-f-gestor">' +
        (OB.gestores || []).map(function (g) {
          return '<option value="' + esc(g.id) + '"' + (o.gestor_id === g.id ? ' selected' : '') + '>' +
            esc(g.nome) + '</option>';
        }).join('') + '</select></div>' +

    '<div class="row row-wrap" style="gap:14px">' +
      '<div class="field" style="flex:1;min-width:150px"><label for="ob-f-inicio">Início previsto</label>' +
        '<input type="date" id="ob-f-inicio" value="' + esc(o.inicio_previsto || (novo ? hoje : '')) + '"></div>' +
      '<div class="field" style="flex:1;min-width:150px"><label for="ob-f-prazo">Prazo de conclusão</label>' +
        '<input type="date" id="ob-f-prazo" value="' + esc(o.prazo || '') + '"></div>' +
    '</div>' +

    '<div class="field"><label for="ob-f-obs">Observação</label>' +
      '<input id="ob-f-obs" maxlength="400" value="' + esc(o.observacao || '') + '"></div>' +

    (novo ? '' :
      '<dl class="kv" style="margin:18px 0 0">' +
        '<dt>Criado em</dt><dd>' + obDataBr(o.criado_em) + '</dd>' +
        '<dt>Iniciado em</dt><dd>' + obDataBr(o.iniciado_em) + '</dd>' +
        '<dt>Concluído em</dt><dd>' + obDataBr(o.concluido_em) + '</dd>' +
      '</dl>') +

    '<div class="row row-wrap" style="gap:12px;margin-top:20px">' +
      '<button class="btn" id="ob-f-salvar">' + (novo ? 'Salvar' : 'Salvar alterações') + '</button>' +
      (novo
        ? '<button class="btn btn-ghost" id="ob-f-iniciar">Salvar e iniciar agora</button>'
        : (o.situacao === 'a_iniciar' ? '<button class="btn btn-sm btn-ghost" id="ob-f-comecar">Iniciar</button>' : '') +
          (o.situacao === 'em_andamento' ? '<button class="btn btn-sm btn-ghost" id="ob-f-concluir">Marcar concluído</button>' : '') +
          (o.situacao === 'concluido' ? '<button class="btn btn-sm btn-ghost" id="ob-f-reabrir">Reabrir</button>' : '') +
          (o.situacao !== 'cancelado' ? '<button class="btn btn-sm btn-ghost" id="ob-f-cancelar" style="color:var(--red)">Cancelar</button>' : '')
      ) +
    '</div>' +
    '<div id="ob-f-saida"></div>';

  document.getElementById('fundo').style.display = 'block';
  document.getElementById('gaveta').style.display = 'flex';

  const selC = document.getElementById('ob-f-cliente');
  if (selC) {
    // escolher o cliente já sugere o gestor que cuida dele
    selC.addEventListener('change', function () {
      const g = this.options[this.selectedIndex].dataset.g;
      if (g) document.getElementById('ob-f-gestor').value = g;
    });
  }

  const salvar = async function (iniciar) {
    const corpo = {
      id: novo ? undefined : o.id,
      cliente_id: selC ? selC.value : o.cliente_id,
      gestor_id: document.getElementById('ob-f-gestor').value,
      inicio_previsto: document.getElementById('ob-f-inicio').value,
      prazo: document.getElementById('ob-f-prazo').value,
      observacao: document.getElementById('ob-f-obs').value,
      iniciar: !!iniciar
    };
    if (!corpo.cliente_id) { toast('Escolha o cliente', true); return false; }
    try {
      await apiOb('ob_salvar', { body: corpo });
      toast(novo ? (iniciar ? 'Onboarding iniciado' : 'Onboarding criado') : 'Onboarding salvo');
      fechaGaveta();
      obRecarrega();
      return true;
    } catch (e) {
      document.getElementById('ob-f-saida').innerHTML =
        '<div class="alert alert-erro" style="margin-top:14px">' + esc(e.message) + '</div>';
      return false;
    }
  };

  document.getElementById('ob-f-salvar').addEventListener('click', function () { salvar(false); });
  const bi = document.getElementById('ob-f-iniciar');
  if (bi) bi.addEventListener('click', function () { salvar(true); });

  const move = async function (situacao, recado) {
    try {
      await apiOb('ob_mover', { body: { id: o.id, situacao: situacao } });
      toast(recado);
      fechaGaveta();
      obRecarrega();
    } catch (e) { toast(e.message, true); }
  };
  const liga = function (id, situacao, recado) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', function () { move(situacao, recado); });
  };
  liga('ob-f-comecar', 'em_andamento', 'Onboarding iniciado');
  liga('ob-f-concluir', 'concluido', 'Onboarding concluído');
  liga('ob-f-reabrir', 'em_andamento', 'Onboarding reaberto');
  liga('ob-f-cancelar', 'cancelado', 'Onboarding cancelado');
}
