/* ============================================================
   COLABORADORES — o time interno
   ============================================================ */
let EQUIPE = [];
let EQUIPE_DADOS = null;
let EQUIPE_BUSCA = '';
let EQUIPE_MODO = 'todos';
const MODOS_NOME = { presencial: 'Presencial', remoto: 'Remoto', hibrido: 'Híbrido', sem: 'Não informou' };

// iniciais para o circulinho: "Maria Souza" -> MS
function iniciais(nome) {
  const p = String(nome || '').trim().split(/\s+/);
  const a = (p[0] || '')[0] || '';
  const b = p.length > 1 ? (p[p.length - 1] || '')[0] || '' : '';
  return (a + b).toUpperCase();
}

function quandoFaz(dias) {
  if (dias === 0) return 'é hoje';
  if (dias === 1) return 'é amanhã';
  if (dias <= 7) return 'em ' + dias + ' dias';
  if (dias <= 30) return 'em ' + dias + ' dias';
  return 'em ' + Math.round(dias / 7) + ' semanas';
}

async function carregaColaboradores() {
  const box = document.getElementById('painel-colaboradores');
  box.innerHTML = '<div class="loading-page">Carregando…</div>';
  let d;
  try { d = await api('team'); }
  catch (e) { box.innerHTML = '<div class="alert alert-erro">' + esc(e.message) + '</div>'; return; }

  EQUIPE_DADOS = d;
  EQUIPE = d.colaboradores || [];
  const camisas = Object.keys(d.camisas || {});
  const ordemCamisa = ['PP', 'P', 'M', 'G', 'GG', 'XG', 'XGG'];
  camisas.sort(function (a, b) { return ordemCamisa.indexOf(a) - ordemCamisa.indexOf(b); });

  const proximos = (d.aniversarios || []).slice(0, 6);
  const comAniversario = (d.aniversarios || []).length;

  box.innerHTML =
    // ---------- destaque: tamanho do time + aniversários ----------
    '<div class="eq-topo">' +

      '<div class="card eq-time">' +
        '<div class="eq-time-n">' + d.ativos + '</div>' +
        '<div class="eq-time-l">' + (d.ativos === 1 ? 'pessoa no time' : 'pessoas no time') + '</div>' +
        (d.total !== d.ativos
          ? '<div class="small muted" style="margin-top:8px">' + (d.total - d.ativos) + ' inativo(s)</div>' : '') +
        '<div class="eq-chips">' +
          (d.modos && (d.modos.presencial || d.modos.remoto || d.modos.hibrido)
            ? '<span class="eq-chip"><b>' + (d.modos.presencial || 0) + '</b> presencial</span>' +
              '<span class="eq-chip"><b>' + (d.modos.remoto || 0) + '</b> remoto</span>' +
              (d.modos.hibrido ? '<span class="eq-chip"><b>' + d.modos.hibrido + '</b> híbrido</span>' : '')
            : '') +
          (camisas.length
            ? camisas.map(function (c) {
                return '<span class="eq-chip"><b>' + esc(c) + '</b> ' + d.camisas[c] + '</span>';
              }).join('')
            : '<span class="small muted">tamanhos de camisa aparecem aqui</span>') +
        '</div>' +
      '</div>' +

      '<div class="card eq-niver">' +
        '<div class="row" style="align-items:baseline;gap:8px;margin-bottom:14px">' +
          '<h2 style="font-size:15px;margin:0">Próximos aniversários</h2>' +
          '<span class="small muted">' + (comAniversario ? 'nos próximos 60 dias' : '') + '</span>' +
        '</div>' +
        (proximos.length
          ? '<div class="eq-niver-lista">' + proximos.map(function (a) {
              const perto = a.dias <= 7;
              return '<div class="eq-pessoa' + (perto ? ' perto' : '') + '" data-id="' + esc(a.id) + '">' +
                '<span class="eq-av">' + esc(iniciais(a.nome_completo || a.name)) + '</span>' +
                '<span class="eq-pessoa-txt">' +
                  '<strong>' + esc(a.name) + '</strong>' +
                  '<span class="small muted">' + esc(a.area || 'time') + '</span>' +
                '</span>' +
                '<span class="eq-data">' +
                  '<strong>' + esc(a.dia) + '</strong>' +
                  '<span class="small ' + (perto ? 'destaque' : 'muted') + '">' + quandoFaz(a.dias) + '</span>' +
                '</span>' +
              '</div>';
            }).join('') + '</div>'
          : '<p class="small muted" style="margin:0">Nenhum aniversário nos próximos 60 dias. ' +
            'Quem ainda não preencheu a data não aparece aqui.</p>') +
      '</div>' +

    '</div>' +

    // ---------- link do cadastro ----------
    '<div class="card">' +
      '<div class="row row-wrap" style="justify-content:space-between;align-items:center;gap:14px">' +
        '<div style="flex:1;min-width:250px">' +
          '<strong style="font-size:14.5px">Link do cadastro</strong>' +
          '<div class="small muted" style="margin-top:3px">Mande para quem ainda não preencheu. ' +
          'No fim, a pessoa recebe a confirmação nos três canais.</div>' +
          '<div style="margin-top:8px;font-family:ui-monospace,monospace;font-size:12.5px;word-break:break-all">' +
            esc(d.link) + '</div>' +
        '</div>' +
        '<div class="row" style="gap:8px">' +
          '<button class="btn btn-sm" id="eq-copiar">Copiar</button>' +
          '<button class="btn btn-sm btn-ghost" id="eq-abrir">Abrir</button>' +
          '<button class="btn btn-sm btn-ghost" id="eq-csv">CSV</button>' +
        '</div>' +
      '</div>' +
    '</div>' +

    // ---------- filtro por modo de trabalho ----------
    '<div class="row row-wrap" style="gap:7px;margin-bottom:10px" id="eq-modos"></div>' +

    // ---------- busca ----------
    '<div class="eq-busca-wrap">' +
      '<svg class="eq-lupa" width="18" height="18" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.6"/><path d="m16 16 4.2 4.2"/></svg>' +
      '<input type="search" id="eq-busca" autocomplete="off" ' +
        'placeholder="Buscar por nome, apelido, e-mail, cargo, área, cidade ou tamanho…" ' +
        'value="' + esc(EQUIPE_BUSCA) + '">' +
      '<button type="button" class="eq-limpar" id="eq-limpar" title="Limpar" style="display:none">✕</button>' +
    '</div>' +
    '<div class="small muted" id="eq-contagem" style="margin:0 0 12px 4px"></div>' +

    '<div id="eq-tabela"></div>';

  ligaColaboradores(d);
  desenhaTabela();
}

function filtrados() {
  let base = EQUIPE;
  if (EQUIPE_MODO === 'sem') base = base.filter(function (c) { return !c.work_mode; });
  else if (EQUIPE_MODO !== 'todos') base = base.filter(function (c) { return c.work_mode === EQUIPE_MODO; });

  const q = EQUIPE_BUSCA.trim().toLowerCase();
  if (!q) return base;
  // cada palavra digitada precisa aparecer em algum campo
  const termos = q.split(/\s+/);
  return base.filter(function (c) {
    const alvo = [c.name, c.nickname, c.email, c.phone, c.role_title, c.area,
      c.city, c.state, c.district, c.shirt_size, c.shoe_size, c.work_mode]
      .filter(Boolean).join(' ').toLowerCase();
    return termos.every(function (t) { return alvo.indexOf(t) >= 0; });
  });
}

function desenhaTabela() {
  const lista = filtrados();
  const cont = document.getElementById('eq-contagem');
  const filtrando = !!EQUIPE_BUSCA || EQUIPE_MODO !== 'todos';
  cont.textContent = filtrando
    ? lista.length + ' de ' + EQUIPE.length + (EQUIPE.length === 1 ? ' pessoa' : ' pessoas')
    : EQUIPE.length + (EQUIPE.length === 1 ? ' pessoa cadastrada' : ' pessoas cadastradas');

  document.getElementById('eq-tabela').innerHTML = lista.length
    ? '<div class="card" style="padding:0;overflow:hidden">' +
      '<table class="tbl" style="margin:0"><thead><tr>' +
        '<th style="padding-left:18px">Pessoa</th><th>Área e cargo</th><th>Trabalho</th><th>Aniversário</th>' +
        '<th>Camisa</th><th>Pé</th><th></th></tr></thead><tbody>' +
      lista.map(function (c) {
        return '<tr class="eq-linha" data-id="' + esc(c.id) + '">' +
          '<td style="padding-left:18px">' +
            '<div class="row" style="gap:11px;align-items:center">' +
              '<span class="eq-av eq-av-sm">' + esc(iniciais(c.name)) + '</span>' +
              '<span><strong>' + esc(c.nickname || c.name.split(' ')[0]) + '</strong>' +
              '<div class="small muted">' + esc(c.email) + '</div></span>' +
            '</div></td>' +
          '<td>' + esc(c.area || '—') + '<div class="small muted">' + esc(c.role_title || '') + '</div></td>' +
          '<td>' + (c.work_mode ? '<span class="tag">' + esc(MODOS_NOME[c.work_mode] || c.work_mode) + '</span>' : '—') + '</td>' +
          '<td>' + (c.birth_date ? esc(dataCurta(c.birth_date)) : '—') + '</td>' +
          '<td>' + (c.shirt_size ? '<span class="tag">' + esc(c.shirt_size) + '</span>' : '—') + '</td>' +
          '<td>' + esc(c.shoe_size || '—') + '</td>' +
          '<td style="padding-right:18px">' + (c.active === false ? '<span class="tag">inativo</span>' : '') + '</td>' +
        '</tr>';
      }).join('') +
      '</tbody></table></div>'
    : '<div class="card"><p class="sub" style="margin:0">' +
      (EQUIPE_BUSCA
        ? 'Ninguém encontrado para <strong>' + esc(EQUIPE_BUSCA) + '</strong>. Tente outra palavra.'
        : 'Ninguém cadastrado ainda. Mande o link acima para o time.') +
      '</p></div>';

  document.querySelectorAll('.eq-linha').forEach(function (tr) {
    tr.addEventListener('click', function () { abreColaborador(tr.dataset.id); });
  });
}

function dataCurta(iso) {
  const p = String(iso).split('-');
  return p.length === 3 ? p[2] + '/' + p[1] : iso;
}

function ligaColaboradores(d) {
  const b = function (id) { return document.getElementById(id); };
  const busca = b('eq-busca');
  const limpar = b('eq-limpar');

  b('eq-copiar').addEventListener('click', function () {
    navigator.clipboard.writeText(d.link).then(function () { toast('Link copiado'); });
  });
  b('eq-abrir').addEventListener('click', function () { window.open(d.link, '_blank'); });

  b('eq-csv').addEventListener('click', function () {
    const cols = ['name', 'nickname', 'email', 'phone', 'birth_date', 'cpf', 'area', 'role_title',
      'started_on', 'shirt_size', 'shoe_size', 'cep', 'street', 'number', 'complement',
      'district', 'city', 'state'];
    const cabec = ['Nome', 'Como chamar', 'E-mail', 'Telefone', 'Nascimento', 'CPF', 'Área', 'Cargo',
      'Entrou em', 'Camisa', 'Pé', 'CEP', 'Rua', 'Número', 'Complemento', 'Bairro', 'Cidade', 'UF'];
    const linhas = [cabec].concat(filtrados().map(function (c) {
      return cols.map(function (k) { return c[k] == null ? '' : String(c[k]); });
    }));
    const csv = '﻿' + linhas.map(function (l) {
      return l.map(function (v) { return '"' + v.replace(/"/g, '""') + '"'; }).join(';');
    }).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'colaboradores-startdigital.csv';
    a.click();
    toast('CSV com ' + filtrados().length + ' pessoa(s)');
  });

  // filtro por jeito de trabalhar
  function desenhaModos() {
    const conta = function (m) {
      if (m === 'todos') return EQUIPE.length;
      if (m === 'sem') return EQUIPE.filter(function (c) { return !c.work_mode; }).length;
      return EQUIPE.filter(function (c) { return c.work_mode === m; }).length;
    };
    const opcoes = [['todos', 'Todos'], ['presencial', 'Presencial'], ['remoto', 'Remoto'],
      ['hibrido', 'Híbrido'], ['sem', 'Não informou']]
      .filter(function (o) { return o[0] === 'todos' || conta(o[0]) > 0; });
    b('eq-modos').innerHTML = opcoes.map(function (o) {
      return '<button type="button" class="av-filtro' + (EQUIPE_MODO === o[0] ? ' on' : '') + '" ' +
        'data-m="' + o[0] + '">' + o[1] + ' <b>' + conta(o[0]) + '</b></button>';
    }).join('');
    b('eq-modos').querySelectorAll('.av-filtro').forEach(function (bt) {
      bt.addEventListener('click', function () {
        EQUIPE_MODO = bt.dataset.m;
        desenhaModos(); desenhaTabela();
      });
    });
  }
  desenhaModos();

  // busca instantanea, sem ida e volta no servidor
  function aplicaBusca() {
    EQUIPE_BUSCA = busca.value;
    limpar.style.display = busca.value ? 'flex' : 'none';
    desenhaTabela();
  }
  busca.addEventListener('input', aplicaBusca);
  busca.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') { busca.value = ''; aplicaBusca(); }
  });
  limpar.addEventListener('click', function () { busca.value = ''; busca.focus(); aplicaBusca(); });
  limpar.style.display = busca.value ? 'flex' : 'none';

  // clicar no aniversariante abre a ficha dele
  document.querySelectorAll('.eq-pessoa').forEach(function (el) {
    el.addEventListener('click', function () { abreColaborador(el.dataset.id); });
  });
}

function abreColaborador(id) {
  const c = EQUIPE.filter(function (x) { return x.id === id; })[0];
  if (!c) return;

  const linha = function (rot, val) {
    return '<dt>' + esc(rot) + '</dt><dd>' + (val ? esc(val) : '<span class="muted">não informado</span>') + '</dd>';
  };
  const endereco = [c.street, c.number].filter(Boolean).join(', ') +
    (c.complement ? ' — ' + c.complement : '') +
    (c.district ? ' · ' + c.district : '') +
    (c.city ? ' · ' + c.city + (c.state ? '/' + c.state : '') : '') +
    (c.cep ? ' · CEP ' + c.cep : '');

  document.getElementById('g-nome').textContent = c.name;
  document.getElementById('g-sub').textContent =
    [c.role_title, c.area].filter(Boolean).join(' · ') || 'Colaborador';
  document.getElementById('g-corpo').innerHTML =
    '<dl class="kv">' +
      linha('Como chamar', c.nickname) +
      linha('E-mail', c.email) +
      linha('WhatsApp', c.phone) +
      linha('Como trabalha', MODOS_NOME[c.work_mode] || '') +
      linha('Aniversário', c.birth_date ? dataBr(c.birth_date) : '') +
      linha('CPF', c.cpf) +
      linha('Na Start desde', c.started_on ? dataBr(c.started_on) : '') +
      linha('Endereço', endereco.trim()) +
      linha('Camisa', c.shirt_size) +
      linha('Número do pé', c.shoe_size) +
      linha('Cadastrado em', dataBr(c.created_at)) +
    '</dl>' +
    '<hr class="sep">' +
    '<div class="field"><label>Anotações internas</label>' +
    '<textarea id="eq-notas" style="min-height:90px">' + esc(c.notes || '') + '</textarea></div>' +
    '<div class="row row-wrap" style="gap:10px;margin-top:14px">' +
      '<button class="btn btn-sm" id="eq-salvar">Salvar anotação</button>' +
      '<label class="row small" style="gap:6px"><input type="checkbox" id="eq-ativo" ' +
      (c.active !== false ? 'checked' : '') + ' style="width:16px;height:16px"> está no time</label>' +
      '<span style="flex:1"></span>' +
      '<button class="btn btn-sm btn-ghost" id="eq-excluir" style="color:var(--red)">Excluir cadastro</button>' +
    '</div>';

  document.getElementById('fundo').style.display = 'block';
  document.getElementById('gaveta').style.display = 'flex';

  document.getElementById('eq-salvar').addEventListener('click', async function () {
    try {
      await api('team_save', {
        body: {
          id: c.id,
          notes: document.getElementById('eq-notas').value,
          active: document.getElementById('eq-ativo').checked
        }
      });
      toast('Salvo');
      fechaGaveta();
      carregaColaboradores();
    } catch (e) { toast(e.message, true); }
  });

  document.getElementById('eq-excluir').addEventListener('click', async function () {
    if (!confirm('Excluir o cadastro de ' + c.name + '? Isso não tem volta.')) return;
    try {
      await api('team_delete', { body: { id: c.id } });
      toast('Excluído');
      fechaGaveta();
      carregaColaboradores();
    } catch (e) { toast(e.message, true); }
  });
}
