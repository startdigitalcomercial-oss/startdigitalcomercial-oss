/* ============================================================
   START PLAY — a área do painel.
   Três coisas: os 7 prêmios da roda, a ordem deles (arrastando)
   e o histórico de quem jogou.

   Uma regra aparece escrita na tela de propósito: mudar a ordem
   ou o nome de um prêmio NÃO muda a chance de ninguém, e não
   reescreve o que já foi ganho.
   ============================================================ */

let PLAY = { premios: [], giros: [], link: '' };
let PL_FILTRO = { nome: '', premio_id: '', de: '', ate: '' };

const PL_CORES = {
  roxo: '#7c3aed', lilas: '#a78bfa', azul: '#3b82f6', rosa: '#ec4899',
  amarelo: '#f5b301', verde: '#10b981', laranja: '#f97316'
};
const PL_CORES_NOME = {
  roxo: 'Roxo', lilas: 'Lilás', azul: 'Azul', rosa: 'Rosa',
  amarelo: 'Amarelo', verde: 'Verde', laranja: 'Laranja'
};
const PL_ICONES_NOME = {
  dinheiro: 'Dinheiro', presente: 'Presente', comida: 'Comida', folga: 'Folga',
  estrela: 'Estrela', sorte: 'Sorte', troreu: 'Troféu'
};

async function apiPlay(action, opts) {
  opts = opts || {};
  const qs = new URLSearchParams(Object.assign({ action: action }, opts.params || {}));
  const res = await fetch('/api/play?' + qs.toString(), {
    method: opts.body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json().catch(function () { return { ok: false, error: 'resposta invalida' }; });
  if (res.status === 401) { sair(); throw new Error('sessao expirada'); }
  if (!data.ok) throw new Error(data.error || 'erro');
  return data;
}

async function carregaPlay() {
  const alvo = document.getElementById('painel-play');
  alvo.innerHTML = '<div class="spinner"></div>';
  try {
    const d = await apiPlay('pl_painel');
    PLAY = d;
    desenhaPlay();
  } catch (e) {
    alvo.innerHTML = '<div class="alert alert-erro">' + esc(e.message) + '</div>';
  }
}

function plDataHora(iso) {
  if (!iso) return { data: '—', hora: '—' };
  const d = new Date(iso);
  return {
    data: d.toLocaleDateString('pt-BR'),
    hora: d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  };
}

function plChance(ativos) {
  if (!ativos) return '—';
  return (100 / ativos).toFixed(2).replace('.', ',') + '%';
}

function desenhaPlay() {
  const premios = PLAY.premios || [];
  const ativos = premios.filter(function (p) { return p.ativo; }).length;
  const faltam = (PLAY.slots || 7) - premios.length;

  document.getElementById('painel-play').innerHTML =
    // ---------- o link da roleta ----------
    '<div class="card" style="margin-bottom:16px">' +
      '<div class="row row-wrap" style="justify-content:space-between;align-items:center;gap:12px">' +
        '<div>' +
          '<h2 style="margin:0 0 3px;font-size:16px">Link da roleta</h2>' +
          '<div class="small muted">Mande para quem bateu a meta. A pessoa abre, escreve o nome e gira.</div>' +
        '</div>' +
        '<div class="row row-wrap" style="gap:8px">' +
          '<code class="small" style="padding:8px 12px;background:var(--fill-1);border-radius:var(--r-ctl)">' +
            esc(PLAY.link || '') + '</code>' +
          '<button class="btn btn-sm btn-ghost" id="pl-copiar">Copiar</button>' +
          '<button class="btn btn-sm btn-ghost" id="pl-abrir">Abrir</button>' +
        '</div>' +
      '</div>' +
    '</div>' +

    // ---------- os prêmios ----------
    '<div class="card" style="margin-bottom:16px">' +
      '<div class="row row-wrap" style="justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:4px">' +
        '<div>' +
          '<h2 style="margin:0 0 3px;font-size:16px">Prêmios da roda</h2>' +
          '<div class="small muted">Arraste pela alça para mudar a ordem. ' +
            'Trocar a ordem muda só o desenho — <strong>a chance de cada prêmio continua a mesma</strong>.</div>' +
        '</div>' +
        (faltam > 0
          ? '<button class="btn btn-sm" id="pl-novo">+ Novo prêmio</button>'
          : '<span class="tag">' + premios.length + ' de ' + (PLAY.slots || 7) + ' lugares</span>') +
      '</div>' +

      '<div class="alert alert-info small" style="margin:12px 0 14px">' +
        'Com <strong>' + ativos + '</strong> prêmio(s) ligado(s), cada um sai <strong>' + plChance(ativos) + '</strong> ' +
        'das vezes. O sorteio acontece no servidor e é igual para todos — ' +
        'não existe prêmio raro nem prêmio por horário.</div>' +

      '<div id="pl-lista">' + premios.map(linhaPremio).join('') + '</div>' +
      (premios.length ? '' : '<div class="muted small" style="padding:18px 0">Nenhum prêmio cadastrado ainda.</div>') +
    '</div>' +

    // ---------- histórico ----------
    '<div class="card" style="padding:0;overflow:hidden">' +
      '<div style="padding:18px 20px 0">' +
        '<h2 style="margin:0 0 3px;font-size:16px">Histórico de jogadas</h2>' +
        '<div class="small muted" style="margin-bottom:14px">O resultado de cada giro é guardado como saiu. ' +
          'Nem o painel nem o banco deixam reescrever uma jogada.</div>' +

        '<div class="row row-wrap" style="gap:10px;align-items:flex-end;margin-bottom:14px">' +
          '<div class="field" style="margin:0;min-width:180px;flex:1;max-width:260px">' +
            '<label for="pl-busca">Nome</label>' +
            buscaHtml('pl-busca', 'Procurar quem jogou…', PL_FILTRO.nome) + '</div>' +
          '<div class="field" style="margin:0;min-width:170px"><label for="pl-premio">Prêmio</label>' +
            '<select id="pl-premio"><option value="">Todos</option>' +
              premios.map(function (p) {
                return '<option value="' + esc(p.id) + '"' +
                  (PL_FILTRO.premio_id === p.id ? ' selected' : '') + '>' + esc(p.nome) + '</option>';
              }).join('') +
            '</select></div>' +
          '<div class="field" style="margin:0"><label for="pl-de">De</label>' +
            '<input type="date" id="pl-de" value="' + esc(PL_FILTRO.de) + '"></div>' +
          '<div class="field" style="margin:0"><label for="pl-ate">Até</label>' +
            '<input type="date" id="pl-ate" value="' + esc(PL_FILTRO.ate) + '"></div>' +
          '<button class="btn btn-sm btn-ghost" id="pl-limpar">Limpar</button>' +
        '</div>' +
      '</div>' +

      '<div style="overflow-x:auto"><table class="tbl" style="min-width:560px"><thead><tr>' +
        '<th style="padding:10px 16px 10px">Nome</th><th>Prêmio</th><th>Data</th><th>Horário</th>' +
      '</tr></thead><tbody id="pl-corpo"></tbody></table></div>' +
    '</div>';

  pintaHistorico(PLAY.giros || []);
  ligaPlay();
}

function linhaPremio(p) {
  const cor = PL_CORES[p.cor] || PL_CORES.roxo;
  return '<div class="pl-item" data-id="' + esc(p.id) + '"' + (p.ativo ? '' : ' data-off="1"') + '>' +
    '<span class="pl-pega" title="Arraste para mudar a ordem">' +
      '<svg width="14" height="14" viewBox="0 0 24 24"><path d="M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01" ' +
      'stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg></span>' +
    '<span class="pl-cor" style="background:' + cor + '"></span>' +
    '<span class="pl-nome">' + esc(p.nome) +
      (p.ativo ? '' : ' <span class="tag" style="margin-left:6px">desligado</span>') +
      '<span class="pl-desc">' + esc(p.descricao || 'sem descrição') + '</span></span>' +
    '<span class="small muted pl-saiu">' + (p.saiu || 0) + 'x</span>' +
    '<button class="btn btn-sm btn-ghost pl-editar" data-id="' + esc(p.id) + '">Editar</button>' +
  '</div>';
}

function pintaHistorico(giros) {
  const corpo = document.getElementById('pl-corpo');
  if (!corpo) return;
  corpo.innerHTML = giros.length
    ? giros.map(function (g) {
        const q = plDataHora(g.quando);
        const cor = PL_CORES[g.premio_cor] || PL_CORES.roxo;
        return '<tr>' +
          '<td style="padding-left:16px;font-weight:600">' + esc(g.participante) + '</td>' +
          '<td><span class="pl-cor" style="background:' + cor + ';vertical-align:-2px"></span> ' +
            esc(g.premio) + '</td>' +
          '<td class="small muted" style="white-space:nowrap">' + q.data + '</td>' +
          '<td class="small muted" style="white-space:nowrap">' + q.hora + '</td>' +
        '</tr>';
      }).join('')
    : '<tr><td colspan="4" style="padding:26px" class="muted">' +
      (plTemFiltro() ? 'Nenhuma jogada com esses filtros.' : 'Ninguém jogou ainda.') + '</td></tr>';
}

function plTemFiltro() {
  return !!(PL_FILTRO.nome || PL_FILTRO.premio_id || PL_FILTRO.de || PL_FILTRO.ate);
}

async function buscaHistorico() {
  try {
    const d = await apiPlay('pl_historico', { params: PL_FILTRO });
    pintaHistorico(d.giros || []);
  } catch (e) { toast(e.message, true); }
}

function ligaPlay() {
  const b = function (id) { return document.getElementById(id); };

  b('pl-copiar').addEventListener('click', function () {
    navigator.clipboard.writeText(PLAY.link).then(function () { toast('Link copiado'); });
  });
  b('pl-abrir').addEventListener('click', function () { window.open(PLAY.link, '_blank'); });

  const novo = b('pl-novo');
  if (novo) novo.addEventListener('click', function () { abrePremioPlay(null); });

  document.querySelectorAll('.pl-editar').forEach(function (x) {
    x.addEventListener('click', function (ev) {
      ev.stopPropagation();
      abrePremioPlay(x.dataset.id);
    });
  });

  // ---- filtros do histórico ----
  // Esta busca vai ao SERVIDOR (o histórico pode ser grande demais para
  // caber na memória), então espera a pessoa parar de digitar antes de
  // perguntar. Sem isso seriam dez pedidos para escrever um nome.
  ligaBusca('pl-busca', function (texto) { PL_FILTRO.nome = texto; buscaHistorico(); }, 280);
  b('pl-premio').addEventListener('change', function () { PL_FILTRO.premio_id = this.value; buscaHistorico(); });
  b('pl-de').addEventListener('change', function () { PL_FILTRO.de = this.value; buscaHistorico(); });
  b('pl-ate').addEventListener('change', function () { PL_FILTRO.ate = this.value; buscaHistorico(); });
  b('pl-limpar').addEventListener('click', function () {
    PL_FILTRO = { nome: '', premio_id: '', de: '', ate: '' };
    b('pl-busca').value = '';
    b('pl-busca').dispatchEvent(new Event('input'));
    b('pl-premio').value = '';
    b('pl-de').value = ''; b('pl-ate').value = '';
    buscaHistorico();
  });

  ligaArrastoPlay();
}

/* ---------------------------------------------- arrastar a ordem */
function ligaArrastoPlay() {
  const lista = document.getElementById('pl-lista');
  if (!lista) return;
  let pegou = null;

  lista.querySelectorAll('.pl-item').forEach(function (it) {
    const pega = it.querySelector('.pl-pega');
    if (!pega) return;
    pega.addEventListener('mousedown', function () { it.draggable = true; });
    pega.addEventListener('touchstart', function () { it.draggable = true; }, { passive: true });
    it.addEventListener('mouseup', function () { it.draggable = false; });

    it.addEventListener('dragstart', function () { pegou = it; it.classList.add('arrastando'); });
    it.addEventListener('dragend', function () {
      it.classList.remove('arrastando');
      it.draggable = false;
      lista.querySelectorAll('.pl-item').forEach(function (x) { x.classList.remove('alvo'); });
      salvaOrdemPlay();
    });
    it.addEventListener('dragover', function (ev) {
      ev.preventDefault();
      if (!pegou || pegou === it) return;
      it.classList.add('alvo');
      const meio = it.getBoundingClientRect().top + it.offsetHeight / 2;
      if (ev.clientY < meio) lista.insertBefore(pegou, it);
      else lista.insertBefore(pegou, it.nextSibling);
    });
    it.addEventListener('dragleave', function () { it.classList.remove('alvo'); });
  });
}

async function salvaOrdemPlay() {
  const ids = Array.from(document.querySelectorAll('#pl-lista .pl-item')).map(function (x) { return x.dataset.id; });
  const igual = ids.every(function (id, i) { return PLAY.premios[i] && PLAY.premios[i].id === id; });
  if (igual) return;
  try {
    await apiPlay('pl_ordem', { body: { ids: ids } });
    toast('Ordem salva — a chance de cada prêmio continua igual');
    carregaPlay();
  } catch (e) {
    toast(e.message, true);
    carregaPlay();
  }
}

/* ---------------------------------------------- editar um prêmio */
function abrePremioPlay(id) {
  const novo = !id;
  const p = novo
    ? { nome: '', descricao: '', valor: '', icone: 'presente', cor: 'roxo', ativo: true }
    : (PLAY.premios.filter(function (x) { return x.id === id; })[0] || {});

  document.getElementById('g-nome').textContent = novo ? 'Novo prêmio' : (p.nome || 'Prêmio');
  document.getElementById('g-sub').textContent =
    'Entra na roda na hora. O histórico de quem já ganhou não muda.';

  const cores = Object.keys(PL_CORES).map(function (c) {
    return '<button type="button" class="pl-opt-cor' + (p.cor === c ? ' on' : '') + '" data-c="' + c + '" ' +
      'style="background:' + PL_CORES[c] + '" title="' + PL_CORES_NOME[c] + '"></button>';
  }).join('');

  const icones = Object.keys(PL_ICONES_NOME).map(function (i) {
    return '<button type="button" class="pl-opt-ico' + (p.icone === i ? ' on' : '') + '" data-i="' + i + '">' +
      PL_ICONES_NOME[i] + '</button>';
  }).join('');

  document.getElementById('g-corpo').innerHTML =
    '<div class="field"><label for="pl-f-nome">Nome do prêmio</label>' +
      '<span class="hint">É o que aparece escrito na fatia da roda. Curto fica melhor: até 15 letras.</span>' +
      '<input id="pl-f-nome" maxlength="60" value="' + esc(p.nome || '') + '"></div>' +

    '<div class="field"><label for="pl-f-desc">Descrição</label>' +
      '<span class="hint">Aparece na janela de parabéns. Ex.: "Cai na sua chave Pix".</span>' +
      '<input id="pl-f-desc" maxlength="160" value="' + esc(p.descricao || '') + '"></div>' +

    '<div class="field"><label for="pl-f-valor">Valor (opcional)</label>' +
      '<span class="hint">Só para você acompanhar. Não aparece para quem joga e não paga nada sozinho.</span>' +
      '<input id="pl-f-valor" value="' + esc(p.valor == null ? '' : p.valor) + '"></div>' +

    '<div class="field"><label>Cor da fatia</label>' +
      '<div class="pl-cores" id="pl-f-cores">' + cores + '</div>' +
      '<input type="hidden" id="pl-f-cor" value="' + esc(p.cor || 'roxo') + '"></div>' +

    '<div class="field"><label>Ícone</label>' +
      '<div class="pl-icos" id="pl-f-icos">' + icones + '</div>' +
      '<input type="hidden" id="pl-f-ico" value="' + esc(p.icone || 'presente') + '"></div>' +

    '<label class="row small" style="gap:8px;margin-top:4px">' +
      '<input type="checkbox" id="pl-f-ativo" ' + (p.ativo !== false ? 'checked' : '') +
      ' style="width:16px;height:16px"> está na roda' +
    '</label>' +
    '<div class="hint" style="margin-top:4px">Desligar tira a fatia da roda. ' +
      'Quem já ganhou este prêmio continua no histórico.</div>' +

    '<div class="row" style="gap:12px;margin-top:20px">' +
      '<button class="btn" id="pl-f-salvar">' + (novo ? 'Adicionar' : 'Salvar') + '</button>' +
    '</div>' +
    '<div id="pl-f-saida"></div>';

  document.getElementById('fundo').style.display = 'block';
  document.getElementById('gaveta').style.display = 'flex';

  document.querySelectorAll('#pl-f-cores .pl-opt-cor').forEach(function (bt) {
    bt.addEventListener('click', function () {
      document.querySelectorAll('#pl-f-cores .pl-opt-cor').forEach(function (x) { x.classList.remove('on'); });
      bt.classList.add('on');
      document.getElementById('pl-f-cor').value = bt.dataset.c;
    });
  });
  document.querySelectorAll('#pl-f-icos .pl-opt-ico').forEach(function (bt) {
    bt.addEventListener('click', function () {
      document.querySelectorAll('#pl-f-icos .pl-opt-ico').forEach(function (x) { x.classList.remove('on'); });
      bt.classList.add('on');
      document.getElementById('pl-f-ico').value = bt.dataset.i;
    });
  });

  document.getElementById('pl-f-salvar').addEventListener('click', async function () {
    const corpo = {
      nome: (document.getElementById('pl-f-nome') || {}).value || '',
      descricao: (document.getElementById('pl-f-desc') || {}).value || '',
      valor: (document.getElementById('pl-f-valor') || {}).value || '',
      cor: (document.getElementById('pl-f-cor') || {}).value || 'roxo',
      icone: (document.getElementById('pl-f-ico') || {}).value || 'presente',
      ativo: document.getElementById('pl-f-ativo').checked
    };
    if (!novo) corpo.id = p.id;
    if (!corpo.nome.trim()) return toast('Escreva o nome do prêmio', true);

    this.disabled = true;
    this.innerHTML = '<span class="spinner"></span> Salvando…';
    try {
      await apiPlay('pl_premio_salvar', { body: corpo });
      toast(novo ? 'Prêmio adicionado' : 'Prêmio salvo');
      fechaGaveta();
      carregaPlay();
    } catch (e) {
      document.getElementById('pl-f-saida').innerHTML =
        '<div class="alert alert-erro" style="margin-top:14px">' + esc(e.message) + '</div>';
      this.disabled = false;
      this.textContent = novo ? 'Adicionar' : 'Salvar';
    }
  });
}
