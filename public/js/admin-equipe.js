/* ============================================================
   COLABORADORES — o time interno
   ============================================================ */
let EQUIPE = [];
let EQUIPE_BUSCA = '';

async function carregaColaboradores() {
  const box = document.getElementById('painel-colaboradores');
  box.innerHTML = '<div class="loading-page">Carregando…</div>';
  let d;
  try { d = await api('team', { params: { q: EQUIPE_BUSCA } }); }
  catch (e) { box.innerHTML = '<div class="alert alert-erro">' + esc(e.message) + '</div>'; return; }

  EQUIPE = d.colaboradores || [];
  const camisas = Object.keys(d.camisas || {}).sort();

  box.innerHTML =
    // link para divulgar
    '<div class="card">' +
      '<div class="row row-wrap" style="justify-content:space-between;align-items:flex-start;gap:14px">' +
        '<div style="flex:1;min-width:240px">' +
          '<h2 style="margin:0 0 4px">Cadastro do time</h2>' +
          '<p class="sub" style="margin:0">Mande este link para o colaborador preencher o próprio cadastro. ' +
          'No fim ele recebe a confirmação por e-mail, WhatsApp e SMS.</p>' +
          '<p style="margin:12px 0 0"><a href="' + esc(d.link) + '" target="_blank" style="font-size:14.5px">' + esc(d.link) + '</a></p>' +
        '</div>' +
        '<div class="row" style="gap:8px">' +
          '<button class="btn btn-sm" id="eq-copiar">Copiar link</button>' +
          '<button class="btn btn-sm btn-ghost" id="eq-csv">Baixar CSV</button>' +
        '</div>' +
      '</div>' +
    '</div>' +

    // indicadores
    '<div class="grid grid-3" style="margin-bottom:16px">' +
      '<div class="stat"><div class="n">' + d.total + '</div><div class="l">no time</div></div>' +
      '<div class="stat"><div class="n">' + d.aniversarios.length + '</div><div class="l">aniversários nos próximos 30 dias</div></div>' +
      '<div class="stat"><div class="n">' + (camisas.length ? camisas.map(function (c) { return c + ':' + d.camisas[c]; }).join('  ') : '—') +
        '</div><div class="l">camisas por tamanho</div></div>' +
    '</div>' +

    // aniversariantes
    (d.aniversarios.length
      ? '<div class="card"><h2 style="font-size:15px;margin:0 0 12px">Aniversários chegando</h2>' +
        '<div class="row row-wrap" style="gap:8px">' +
        d.aniversarios.map(function (a) {
          const quando = a.dias === 0 ? 'hoje' : (a.dias === 1 ? 'amanhã' : 'em ' + a.dias + ' dias');
          return '<span class="tag ' + (a.dias <= 7 ? 'tag-verde' : '') + '">' +
            esc(a.name) + ' · ' + esc(a.dia) + ' · ' + quando + '</span>';
        }).join('') + '</div></div>'
      : '') +

    // busca
    '<div class="row row-wrap" style="gap:10px;margin-bottom:14px">' +
      '<input type="search" id="eq-busca" placeholder="Buscar por nome, e-mail, cargo ou cidade…" ' +
      'value="' + esc(EQUIPE_BUSCA) + '" style="width:100%;max-width:380px">' +
    '</div>' +

    // lista
    (EQUIPE.length
      ? '<div class="card" style="padding:0;overflow:hidden">' +
        '<table class="tbl" style="margin:0"><thead><tr>' +
          '<th style="padding-left:18px">Pessoa</th><th>Área / cargo</th><th>Aniversário</th>' +
          '<th>Camisa</th><th>Pé</th><th></th></tr></thead><tbody>' +
        EQUIPE.map(function (c) {
          return '<tr class="eq-linha" data-id="' + esc(c.id) + '" style="cursor:pointer">' +
            '<td style="padding-left:18px"><strong>' + esc(c.nickname || c.name.split(' ')[0]) + '</strong>' +
              '<div class="small muted">' + esc(c.email) + '</div></td>' +
            '<td>' + esc(c.area || '—') + '<div class="small muted">' + esc(c.role_title || '') + '</div></td>' +
            '<td>' + (c.birth_date ? esc(dataCurta(c.birth_date)) : '—') + '</td>' +
            '<td>' + esc(c.shirt_size || '—') + '</td>' +
            '<td>' + esc(c.shoe_size || '—') + '</td>' +
            '<td style="padding-right:18px">' + (c.active === false ? '<span class="tag">inativo</span>' : '') + '</td>' +
          '</tr>';
        }).join('') +
        '</tbody></table></div>'
      : '<div class="card"><p class="sub" style="margin:0">' +
        (EQUIPE_BUSCA ? 'Ninguém encontrado com esse termo.' : 'Ninguém cadastrado ainda. Mande o link acima para o time.') +
        '</p></div>');

  ligaColaboradores(d);
}

function dataCurta(iso) {
  const p = String(iso).split('-');
  return p.length === 3 ? p[2] + '/' + p[1] : iso;
}

function ligaColaboradores(d) {
  const b = function (id) { return document.getElementById(id); };

  b('eq-copiar').addEventListener('click', function () {
    navigator.clipboard.writeText(d.link).then(function () { toast('Link copiado'); });
  });

  b('eq-csv').addEventListener('click', function () {
    const cols = ['name', 'nickname', 'email', 'phone', 'birth_date', 'cpf', 'area', 'role_title',
      'started_on', 'shirt_size', 'shoe_size', 'cep', 'street', 'number', 'complement',
      'district', 'city', 'state'];
    const cabec = ['Nome', 'Como chamar', 'E-mail', 'Telefone', 'Nascimento', 'CPF', 'Área', 'Cargo',
      'Entrou em', 'Camisa', 'Pé', 'CEP', 'Rua', 'Número', 'Complemento', 'Bairro', 'Cidade', 'UF'];
    const linhas = [cabec].concat(EQUIPE.map(function (c) {
      return cols.map(function (k) { return c[k] == null ? '' : String(c[k]); });
    }));
    const csv = '﻿' + linhas.map(function (l) {
      return l.map(function (v) { return '"' + v.replace(/"/g, '""') + '"'; }).join(';');
    }).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'colaboradores-startdigital.csv';
    a.click();
  });

  let timer = null;
  b('eq-busca').addEventListener('input', function () {
    const v = this.value;
    clearTimeout(timer);
    timer = setTimeout(function () { EQUIPE_BUSCA = v; carregaColaboradores(); }, 350);
  });

  document.querySelectorAll('.eq-linha').forEach(function (tr) {
    tr.addEventListener('click', function () { abreColaborador(tr.dataset.id); });
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
      '<button class="btn btn-sm btn-ghost" id="eq-excluir">Excluir cadastro</button>' +
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
