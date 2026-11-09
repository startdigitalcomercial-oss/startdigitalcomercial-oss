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
      '<div class="row row-wrap" style="gap:10px;align-items:flex-end;margin-bottom:14px">' +
        '<div class="field" style="margin:0;min-width:190px;flex:1;max-width:290px">' +
          '<label for="ob-busca">Cliente</label>' +
          '<input id="ob-busca" placeholder="Procurar pelo nome…" value="' + esc(OB_BUSCA) + '" autocomplete="off"></div>' +
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
      '<span class="small muted">' + (o.prazo ? 'prazo ' + obDataBr(o.prazo) : 'sem prazo') + '</span>' +
      obPino(o) +
    '</div></div>';
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
    c.addEventListener('dragstart', function () { pego = c; c.classList.add('arrastando'); });
    c.addEventListener('dragend', function () { c.classList.remove('arrastando'); pego = null; });
  });
  document.querySelectorAll('.ob-coluna').forEach(function (col) {
    const destino = manuais[col.dataset.col];
    col.addEventListener('dragover', function (ev) {
      if (!pego || !destino) return;
      ev.preventDefault();
      col.classList.add('alvo');
    });
    col.addEventListener('dragleave', function () { col.classList.remove('alvo'); });
    col.addEventListener('drop', async function (ev) {
      col.classList.remove('alvo');
      if (!pego || !destino) return;
      ev.preventDefault();
      const id = pego.dataset.id;
      try {
        await apiOb('ob_mover', { body: { id: id, situacao: destino } });
        toast('Onboarding atualizado');
        OB = null; carregaOnboarding();
      } catch (e) { toast(e.message, true); }
    });
  });
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
  let timer = null;
  b('ob-busca').addEventListener('input', function () {
    OB_BUSCA = this.value; clearTimeout(timer); timer = setTimeout(obPinta, 140);
  });
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
      OB = null; carregaOnboarding();
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
      OB = null; carregaOnboarding();
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
