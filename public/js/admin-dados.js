/* ============================================================
   GRÁFICOS — SVG à mão, um tom só (o trabalho aqui é magnitude,
   não identidade), rótulos diretos e eixos discretos.
   ============================================================ */
function graficoLinha(serie, id) {
  const W = 720, H = 190, mE = 34, mD = 12, mT = 14, mB = 26;
  const larg = W - mE - mD, alt = H - mT - mB;
  const max = Math.max(1, ...serie.map(function (p) { return p.total; }));
  const passo = serie.length > 1 ? larg / (serie.length - 1) : larg;
  const x = function (i) { return mE + i * passo; };
  const y = function (v) { return mT + alt - (v / max) * alt; };

  const pontos = serie.map(function (p, i) { return x(i) + ',' + y(p.total); });
  const area = 'M' + x(0) + ',' + (mT + alt) + ' L' + pontos.join(' L') +
               ' L' + x(serie.length - 1) + ',' + (mT + alt) + ' Z';

  // grade discreta: 3 linhas
  let grade = '';
  for (let g = 0; g <= 2; g++) {
    const v = Math.round((max / 2) * g);
    const yy = y(v);
    grade += '<line x1="' + mE + '" y1="' + yy + '" x2="' + (W - mD) + '" y2="' + yy +
      '" stroke="var(--hairline)" stroke-width="1"/>' +
      '<text x="' + (mE - 8) + '" y="' + (yy + 4) + '" text-anchor="end" font-size="10.5" fill="var(--label-3)">' + v + '</text>';
  }

  const marcas = serie.map(function (p, i) {
    const mostrar = i === 0 || i === serie.length - 1 || i === Math.floor(serie.length / 2);
    if (!mostrar) return '';
    const d = p.dia.slice(8, 10) + '/' + p.dia.slice(5, 7);
    return '<text x="' + x(i) + '" y="' + (H - 7) + '" text-anchor="middle" font-size="10.5" fill="var(--label-3)">' + d + '</text>';
  }).join('');

  // camada de hover
  const hits = serie.map(function (p, i) {
    const d = p.dia.slice(8, 10) + '/' + p.dia.slice(5, 7);
    return '<rect x="' + (x(i) - passo / 2) + '" y="' + mT + '" width="' + passo + '" height="' + alt +
      '" fill="transparent" class="hit" data-x="' + x(i) + '" data-y="' + y(p.total) +
      '" data-txt="' + d + ' · ' + p.total + (p.total === 1 ? ' candidato' : ' candidatos') + '"/>';
  }).join('');

  const ultimo = serie[serie.length - 1];
  return '<div class="gr-wrap" id="' + id + '">' +
    '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" class="gr-svg">' +
    '<defs><linearGradient id="g-' + id + '" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0%" stop-color="var(--accent)" stop-opacity=".18"/>' +
    '<stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>' +
    grade +
    '<path d="' + area + '" fill="url(#g-' + id + ')"/>' +
    '<polyline points="' + pontos.join(' ') + '" fill="none" stroke="var(--accent)" stroke-width="2" ' +
    'stroke-linejoin="round" stroke-linecap="round"/>' +
    '<circle cx="' + x(serie.length - 1) + '" cy="' + y(ultimo.total) + '" r="4" fill="var(--accent)" ' +
    'stroke="var(--surface)" stroke-width="2"/>' +
    marcas +
    '<line class="cross" x1="0" y1="' + mT + '" x2="0" y2="' + (mT + alt) + '" stroke="var(--label-3)" ' +
    'stroke-width="1" stroke-dasharray="3 3" style="display:none"/>' +
    '<circle class="dot" r="4.5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2" style="display:none"/>' +
    hits + '</svg><div class="gr-tip"></div></div>';
}

function ligaHoverLinha(id) {
  const wrap = document.getElementById(id);
  if (!wrap) return;
  const svg = wrap.querySelector('svg');
  const tip = wrap.querySelector('.gr-tip');
  const cross = wrap.querySelector('.cross');
  const dot = wrap.querySelector('.dot');
  wrap.querySelectorAll('.hit').forEach(function (h) {
    h.addEventListener('mouseenter', function () {
      const px = parseFloat(h.dataset.x), py = parseFloat(h.dataset.y);
      cross.setAttribute('x1', px); cross.setAttribute('x2', px);
      cross.style.display = ''; dot.style.display = '';
      dot.setAttribute('cx', px); dot.setAttribute('cy', py);
      const r = svg.getBoundingClientRect();
      tip.textContent = h.dataset.txt;
      tip.style.left = (px / 720 * r.width) + 'px';
      tip.style.top = (py / 190 * r.height - 10) + 'px';
      tip.classList.add('on');
    });
  });
  wrap.addEventListener('mouseleave', function () {
    cross.style.display = 'none'; dot.style.display = 'none'; tip.classList.remove('on');
  });
}

function graficoBarras(itens, opts) {
  opts = opts || {};
  const max = Math.max(1, ...itens.map(function (i) { return i.total; }));
  return '<div class="barras">' + itens.map(function (i) {
    const pct = Math.round((i.total / max) * 100);
    return '<div class="barra-linha" title="' + esc(i.nome) + ': ' + i.total + '">' +
      '<span class="barra-rot">' +
      (i.cor ? '<i class="pt" style="background:' + esc(i.cor) + '"></i>' : '') +
      esc(i.nome) + '</span>' +
      '<span class="barra-trilho"><i style="width:' + Math.max(pct, i.total ? 2 : 0) + '%"></i></span>' +
      '<span class="barra-val">' + i.total + '</span></div>';
  }).join('') + '</div>';
}

/* ============================================================
   DASHBOARD
   ============================================================ */
async function carregaDashboard() {
  const box = document.getElementById('painel-dashboard');
  let d;
  try { d = await api('dashboard'); }
  catch (e) { box.innerHTML = '<div class="card"><div class="alert alert-erro" style="margin:0">' + esc(e.message) + '</div></div>'; return; }

  const k = d.indicadores;
  const varia = k.variacao_7d === null ? ''
    : '<span class="var ' + (k.variacao_7d >= 0 ? 'sobe' : 'desce') + '">' +
      (k.variacao_7d >= 0 ? '+' : '') + k.variacao_7d + '% vs. 7 dias antes</span>';

  function tile(rotulo, valor, extra) {
    return '<div class="kpi"><div class="kpi-rot">' + rotulo + '</div>' +
      '<div class="kpi-num">' + valor + '</div>' +
      '<div class="kpi-extra">' + (extra || '&nbsp;') + '</div></div>';
  }

  box.innerHTML =
    '<div class="kpis">' +
      tile('Candidatos ativos', k.ativos, k.novos_7d + ' novos nos últimos 7 dias') +
      tile('Concluíram o processo', k.concluidos, 'aprovados e liberados para a integração') +
      tile('Pré-qualificações da Aurea', k.prequal_concluidas,
           k.prequal_em_andamento + ' conversa(s) em andamento') +
    '</div>' +

    '<div class="grid grid-2" style="margin-top:16px;align-items:start">' +
      '<div class="card"><h2>Candidatos por dia</h2>' +
      '<p class="sub">Últimos 14 dias. ' + (varia || 'Sem base de comparação ainda.') + '</p>' +
      graficoLinha(d.serie_novos, 'gr-novos') + '</div>' +

      '<div class="card"><h2>Onde estão os candidatos</h2>' +
      '<p class="sub">Quantos em cada etapa do funil, agora.</p>' +
      graficoBarras(d.funil) + '</div>' +
    '</div>' +

    '<div class="grid grid-2" style="margin-top:16px;align-items:start">' +
      '<div class="card"><h2>De onde eles vêm</h2>' +
      '<p class="sub">Origem dos candidatos cadastrados.</p>' +
      (d.origens.length ? graficoBarras(d.origens) : '<p class="muted small" style="margin:0">Ainda sem dados.</p>') +
      '</div>' +

      '<div class="card"><h2>Qualidade da pré-qualificação</h2>' +
      '<p class="sub">O que a Aurea achou de quem já conversou com ela.</p>' +
      '<div class="kpis kpis-2">' +
        tile('Nota média', k.prequal_nota_media === null ? '—' : k.prequal_nota_media, 'de 0 a 10, dada pela Aurea') +
        tile('Recomendados', k.prequal_recomendados, 'ela sugeriu avançar') +
      '</div></div>' +
    '</div>';

  ligaHoverLinha('gr-novos');
}

/* ============================================================
   CANDIDATOS (lista)
   ============================================================ */
let CANDS_FILTRO = { busca: '', etapa: '', origem: '' };

async function carregaCandidatos() {
  const box = document.getElementById('painel-candidatos');
  if (!BOARD.candidates.length) { try { await carregaBoard(); } catch (e) { } }
  let dados;
  try { dados = await api('board'); } catch (e) { box.innerHTML = '<div class="card">' + esc(e.message) + '</div>'; return; }

  const etapas = dados.stages;
  const origens = {};
  dados.candidates.forEach(function (c) { origens[c.source_detail || c.source || 'Formulário do site'] = 1; });

  box.innerHTML =
    '<div class="card"><div class="row row-wrap" style="gap:10px">' +
      '<input type="text" id="cl-busca" placeholder="Buscar por nome, e-mail, telefone ou vaga…" style="flex:1;min-width:240px">' +
      '<select id="cl-etapa" style="width:180px"><option value="">Todas as etapas</option>' +
        etapas.map(function (e) { return '<option value="' + e.key + '">' + esc(e.name) + '</option>'; }).join('') +
      '</select>' +
      '<select id="cl-origem" style="width:180px"><option value="">Todas as origens</option>' +
        Object.keys(origens).sort().map(function (o) { return '<option>' + esc(o) + '</option>'; }).join('') +
      '</select>' +
      '<button class="btn btn-sm btn-ghost" id="cl-csv">Baixar CSV</button>' +
    '</div>' +
    '<div class="row row-wrap" style="gap:8px;margin-top:12px;align-items:center">' +
      '<label class="row small" style="gap:6px"><input type="checkbox" id="cl-marcar" style="width:16px;height:16px"> selecionar todos</label>' +
      '<span class="small muted" id="cl-conta-sel"></span>' +
      '<span style="flex:1"></span>' +
      '<button class="btn btn-sm btn-ghost" id="cl-arquivar" disabled>Arquivar</button>' +
      '<button class="btn btn-sm btn-ghost" id="cl-excluir" disabled style="color:var(--red)">Excluir</button>' +
    '</div></div>' +
    '<div class="card" style="margin-top:14px"><div id="cl-tabela"></div></div>';

  function desenha() {
    const q = (document.getElementById('cl-busca').value || '').trim().toLowerCase();
    const et = document.getElementById('cl-etapa').value;
    const og = document.getElementById('cl-origem').value;
    const lista = dados.candidates.filter(function (c) {
      if (et && c.stage_key !== et) return false;
      if (og && (c.source_detail || c.source || 'Formulário do site') !== og) return false;
      if (!q) return true;
      return [c.name, c.email, c.phone, c.role_applied, c.city].join(' ').toLowerCase().indexOf(q) >= 0;
    });
    const nomeEtapa = {}; etapas.forEach(function (e) { nomeEtapa[e.key] = e; });

    document.getElementById('cl-tabela').innerHTML = lista.length
      ? '<table class="tbl"><thead><tr><th style="width:34px"></th><th>Nome</th><th>Vaga</th><th>Contato</th><th>Origem</th><th>Etapa</th><th>Entrou em</th></tr></thead><tbody>' +
        lista.map(function (c) {
          const e = nomeEtapa[c.stage_key] || {};
          return '<tr class="linha-cand" data-id="' + c.id + '">' +
            '<td><input type="checkbox" class="cl-check" data-id="' + c.id + '" style="width:16px;height:16px;cursor:pointer"></td>' +
            '<td class="abre" style="cursor:pointer"><strong>' + esc(c.name) + '</strong>' +
            (c.disc ? '<div class="small muted">DISC ' + esc(c.disc) + '</div>' : '') + '</td>' +
            '<td class="abre" style="cursor:pointer">' + esc(c.role_applied || '—') + '<div class="small muted">' + esc(c.city || '') + '</div></td>' +
            '<td class="small abre" style="cursor:pointer">' + esc(c.email || '') + '<div class="muted">' + esc(c.phone || '') + '</div></td>' +
            '<td class="small abre" style="cursor:pointer">' + esc(c.source_detail || c.source || '—') + '</td>' +
            '<td class="abre" style="cursor:pointer"><span class="tag"><i class="pt" style="background:' + esc(e.color || '#999') + '"></i>' + esc(e.name || c.stage_key) + '</span></td>' +
            '<td class="small muted abre" style="white-space:nowrap;cursor:pointer">' + dataBr(c.created_at) + '</td></tr>';
        }).join('') + '</tbody></table>' +
        '<p class="small muted" style="margin:14px 0 0">' + lista.length + ' de ' + dados.candidates.length +
        ' candidatos. Clique numa linha para abrir a ficha, ou marque a caixinha para arquivar e excluir em lote.</p>'
      : '<p class="muted small" style="margin:0">Nenhum candidato com esses filtros. ' +
        'Confira a busca e os filtros de etapa e origem.</p>';

    document.querySelectorAll('.linha-cand .abre').forEach(function (td) {
      td.addEventListener('click', function () { abreCandidato(td.closest('.linha-cand').dataset.id); });
    });
    document.querySelectorAll('.cl-check').forEach(function (ch) {
      ch.addEventListener('change', atualizaSelecao);
    });
    const marcarTodos = document.getElementById('cl-marcar');
    if (marcarTodos) marcarTodos.checked = false;
    atualizaSelecao();
  }

  function selecionados() {
    return [].slice.call(document.querySelectorAll('.cl-check:checked')).map(function (c) { return c.dataset.id; });
  }

  function atualizaSelecao() {
    const n = selecionados().length;
    document.getElementById('cl-conta-sel').textContent = n ? n + ' selecionado' + (n > 1 ? 's' : '') : '';
    document.getElementById('cl-arquivar').disabled = !n;
    document.getElementById('cl-excluir').disabled = !n;
  }

  // roda a mesma acao em cada selecionado, um de cada vez
  async function emLote(ids, acao, corpo) {
    let feitos = 0, erros = 0;
    for (const id of ids) {
      try { await api(acao, { body: Object.assign({ id: id }, corpo || {}) }); feitos++; }
      catch (e) { erros++; }
    }
    return { feitos: feitos, erros: erros };
  }

  ['cl-busca', 'cl-etapa', 'cl-origem'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', desenha);
    document.getElementById(id).addEventListener('change', desenha);
  });

  document.getElementById('cl-marcar').addEventListener('change', function () {
    const marcar = this.checked;
    document.querySelectorAll('.cl-check').forEach(function (c) { c.checked = marcar; });
    atualizaSelecao();
  });

  document.getElementById('cl-arquivar').addEventListener('click', async function () {
    const ids = selecionados();
    if (!ids.length) return;
    if (!confirm('Arquivar ' + ids.length + ' candidato(s)? Eles saem do quadro mas continuam guardados em Arquivados.')) return;
    this.disabled = true;
    const r = await emLote(ids, 'update_candidate', { archived: true });
    toast(r.feitos + ' arquivado(s)' + (r.erros ? ' · ' + r.erros + ' falharam' : ''), !!r.erros);
    await carregaBoard();
    carregaCandidatos();
  });

  document.getElementById('cl-excluir').addEventListener('click', async function () {
    const ids = selecionados();
    if (!ids.length) return;
    const nomes = ids.map(function (id) {
      const c = dados.candidates.filter(function (x) { return x.id === id; })[0];
      return c ? c.name : id;
    });
    const lista = nomes.slice(0, 6).join('\n· ') + (nomes.length > 6 ? '\n· e mais ' + (nomes.length - 6) : '');
    if (!confirm('EXCLUIR PARA SEMPRE ' + ids.length + ' candidato(s)?\n\n· ' + lista +
      '\n\nIsso apaga a ficha, o teste DISC, o quiz e o histórico. Não tem como desfazer.\n' +
      'Se você só quer tirar do quadro, use Arquivar.')) return;
    this.disabled = true;
    this.innerHTML = '<span class="spinner"></span> Excluindo…';
    const r = await emLote(ids, 'delete_candidate');
    toast(r.feitos + ' excluído(s)' + (r.erros ? ' · ' + r.erros + ' falharam' : ''), !!r.erros);
    await carregaBoard();
    carregaCandidatos();
  });
  document.getElementById('cl-csv').addEventListener('click', function () {
    const linhas = [['Nome', 'E-mail', 'Telefone', 'Vaga', 'Cidade', 'Origem', 'Etapa', 'Entrou em']];
    dados.candidates.forEach(function (c) {
      linhas.push([c.name, c.email, c.phone, c.role_applied, c.city,
        c.source_detail || c.source, c.stage_key, c.created_at]);
    });
    const csv = linhas.map(function (l) {
      return l.map(function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }).join(';');
    }).join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,﻿' + encodeURIComponent(csv);
    a.download = 'candidatos-startdigital.csv';
    a.click();
    toast('CSV gerado');
  });
  desenha();
}
