/* ============================================================
   SPACE COLABORADOR (painel)
   Aqui a gente define o voucher, libera para quem quiser e
   acompanha o saque. O dinheiro sai pelo Asaas.
   ============================================================ */

let SP = { vouchers: [], colaboradores: [], historico: [], asaas: {} };
let SP_MARCADOS = {};

async function apiSpace(action, opts) {
  opts = opts || {};
  const qs = new URLSearchParams(Object.assign({ action: action }, opts.params || {}));
  const res = await fetch('/api/space?' + qs.toString(), {
    method: opts.body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json().catch(function () { return { ok: false, error: 'resposta invalida' }; });
  if (res.status === 401) { sair(); throw new Error('sessao expirada'); }
  if (!data.ok) throw new Error(data.error || 'erro');
  return data;
}

function spDinheiro(v) {
  return 'R$ ' + Number(v || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
}

/* Janela de confirmação DENTRO da tela — nada de confirm() do navegador.
   Usa o mesmo véu/gaveta de fundo do painel. */
function spJanela(html) {
  let veu = document.getElementById('sp-veu');
  if (!veu) {
    veu = document.createElement('div');
    veu.id = 'sp-veu';
    veu.style.cssText = 'position:fixed;inset:0;background:rgba(9,12,24,.55);backdrop-filter:blur(3px);' +
      'z-index:120;display:flex;align-items:center;justify-content:center;padding:22px';
    veu.innerHTML = '<div id="sp-janela" style="background:var(--surface);border-radius:18px;' +
      'padding:24px;width:min(430px,100%);box-shadow:0 24px 70px rgba(0,0,0,.4)"></div>';
    document.body.appendChild(veu);
    veu.addEventListener('click', function (ev) { if (ev.target === veu) spFechaJanela(); });
  }
  veu.style.display = 'flex';
  document.getElementById('sp-janela').innerHTML = html;
}
function spFechaJanela() {
  const v = document.getElementById('sp-veu');
  if (v) v.style.display = 'none';
}
function spConfirma(titulo, corpo, aoConfirmar, rotulo) {
  spJanela('<h3 style="margin:0 0 8px;font-size:16.5px">' + titulo + '</h3>' +
    '<div class="small" style="color:var(--label-2);line-height:1.55">' + corpo + '</div>' +
    '<div class="row" style="gap:10px;margin-top:20px">' +
      '<button class="btn btn-ghost" id="spj-nao" style="flex:1">Voltar</button>' +
      '<button class="btn" id="spj-sim" style="flex:1">' + (rotulo || 'Confirmar') + '</button>' +
    '</div>');
  document.getElementById('spj-nao').addEventListener('click', spFechaJanela);
  document.getElementById('spj-sim').addEventListener('click', function () {
    spFechaJanela();
    aoConfirmar();
  });
}

async function carregaSpace() {
  const alvo = document.getElementById('painel-space');
  alvo.innerHTML = '<div class="spinner"></div>';
  try {
    SP = await apiSpace('sp_painel');
    SP_MARCADOS = {};
    desenhaSpace();
  } catch (e) {
    alvo.innerHTML = '<div class="alert alert-erro">' + esc(e.message) + '</div>';
  }
}

function spAvisoLigacao(a) {
  if (!a.ligado) {
    return '<div class="alert alert-erro" style="margin-bottom:18px">' +
      '<strong>O Asaas ainda não está ligado.</strong> Ninguém consegue sacar. ' +
      'Crie a variável <code>ASAAS_API_KEY</code> na Vercel com a sua chave e faça o Redeploy.</div>';
  }
  const sandbox = a.ambiente !== 'producao';
  return '<div class="alert ' + (sandbox ? 'alert-info' : 'alert-ok') + '" style="margin-bottom:18px">' +
    (sandbox
      ? '<strong>Modo teste (sandbox).</strong> O dinheiro é de mentira — dá para testar à vontade. ' +
        'Quando estiver tudo certo, crie <code>ASAAS_AMBIENTE</code> com o valor <code>producao</code> na Vercel.'
      : '<strong>Modo produção.</strong> Daqui em diante o dinheiro sai de verdade.') +
    '<br><span class="muted small">Chave ' + esc(a.chave) + ' · limite por saque ' + spDinheiro(a.teto) +
    (a.saldo !== null && a.saldo !== undefined ? ' · saldo no Asaas ' + spDinheiro(a.saldo) : '') +
    (a.webhook_pronto ? '' : ' · <strong>webhook não configurado</strong>') + '</span></div>';
}

function desenhaSpace() {
  const a = SP.asaas || {};
  const v = SP.vouchers || [];
  const pessoas = SP.colaboradores || [];
  const emAberto = pessoas.filter(function (p) { return p.aberta; });

  document.getElementById('painel-space').innerHTML =
    spAvisoLigacao(a) +

    /* ---- o voucher ---- */
    '<div class="card" style="padding:18px;margin-bottom:18px">' +
      '<div class="row row-wrap" style="justify-content:space-between;align-items:center;gap:12px;margin-bottom:6px">' +
        '<h3 style="font-size:15px;margin:0">O que a gente libera</h3>' +
        '<button class="btn btn-sm btn-ghost" id="sp-novo-voucher">Novo voucher</button>' +
      '</div>' +
      '<p class="small muted" style="margin:0 0 14px">O nome e o valor que o colaborador vai ver e sacar.</p>' +
      (v.length ? v.map(function (x) {
        return '<div class="item" style="margin-bottom:8px"><div class="topo">' +
          '<div class="t">' + esc(x.nome) +
            (x.ativo ? '' : ' <span class="tag">desligado</span>') +
            '<div class="small muted" style="font-weight:400;margin-top:2px">' +
            spDinheiro(x.valor) + (x.descricao ? ' · ' + esc(x.descricao) : '') + '</div></div>' +
          '<button class="btn btn-sm btn-ghost sp-edit-v" data-id="' + esc(x.id) + '">Editar</button>' +
        '</div></div>';
      }).join('') : '<div class="small muted">Nenhum voucher cadastrado.</div>') +
    '</div>' +

    /* ---- liberar ---- */
    '<div class="card" style="padding:18px;margin-bottom:18px">' +
      '<h3 style="font-size:15px;margin:0 0 6px">Liberar para o time</h3>' +
      '<p class="small muted" style="margin:0 0 14px">Marque quem vai receber e clique em liberar. ' +
      'Cada liberação vale <strong>um saque</strong>: depois que a pessoa sacar, ela só saca de novo ' +
      'quando você liberar outra vez.</p>' +
      '<div class="row row-wrap" style="gap:12px;align-items:flex-end;margin-bottom:12px">' +
        '<div class="field" style="flex:1;min-width:220px;margin:0"><label for="sp-voucher">Voucher</label>' +
          '<select id="sp-voucher">' +
            v.filter(function (x) { return x.ativo; }).map(function (x) {
              return '<option value="' + esc(x.id) + '">' + esc(x.nome) + ' — ' + spDinheiro(x.valor) + '</option>';
            }).join('') +
          '</select></div>' +
        '<button class="btn" id="sp-liberar">Liberar para os marcados</button>' +
      '</div>' +
      '<div class="row row-wrap small" style="gap:16px;align-items:center;margin-bottom:14px;color:var(--label-2)">' +
        '<span style="font-weight:600">Avisar a pessoa por:</span>' +
        '<label class="row" style="gap:6px;align-items:center"><input type="checkbox" id="sp-av-zap" checked ' +
          'style="width:15px;height:15px"> WhatsApp</label>' +
        '<label class="row" style="gap:6px;align-items:center"><input type="checkbox" id="sp-av-sms" checked ' +
          'style="width:15px;height:15px"> SMS</label>' +
        '<label class="row" style="gap:6px;align-items:center"><input type="checkbox" id="sp-av-mail" checked ' +
          'style="width:15px;height:15px"> E-mail</label>' +
        '<span class="muted">— com o link de resgate já dentro</span>' +
      '</div>' +
      '<div class="row" style="gap:10px;margin-bottom:10px">' +
        '<button class="btn btn-sm btn-ghost" id="sp-todos">Marcar todos</button>' +
        '<button class="btn btn-sm btn-ghost" id="sp-nenhum">Desmarcar</button>' +
      '</div>' +
      '<div class="cp-lista" id="sp-pessoas">' +
        (pessoas.length ? pessoas.map(spPessoa).join('')
          : '<div class="small muted">Nenhum colaborador ativo cadastrado.</div>') +
      '</div>' +
    '</div>' +

    /* ---- em aberto ---- */
    (emAberto.length ?
      '<div class="card" style="padding:18px;margin-bottom:18px">' +
        '<h3 style="font-size:15px;margin:0 0 6px">Esperando o saque</h3>' +
        '<p class="small muted" style="margin:0 0 12px">Já liberado, ainda não sacado.</p>' +
        emAberto.map(function (p) {
          const l = p.aberta;
          const travado = l.status === 'processando';
          return '<div class="fd-sem-linha" style="border-top:1px solid var(--fio)">' +
            '<span class="fd-sem-nome">' + esc(p.nome) + '</span>' +
            '<span class="fd-pino ' + (travado ? 'inadimplente' : 'aguardando') + '">' + esc(l.situacao) + '</span>' +
            '<span class="fd-sem-val">' + esc(l.valor_br) + '</span>' +
            (travado
              ? '<button class="btn btn-sm btn-ghost sp-conferir" data-id="' + esc(l.id) + '">Conferir no Asaas</button>'
              : '<button class="btn btn-sm btn-ghost sp-cancelar" data-id="' + esc(l.id) + '">Cancelar</button>') +
          '</div>' +
          (l.falha_motivo ? '<div class="small" style="color:var(--red);padding:0 16px 10px">' +
            esc(l.falha_motivo) + '</div>' : '');
        }).join('') +
      '</div>' : '') +

    /* ---- aviso de saque para o chefe ---- */
    '<div class="card" style="padding:18px;margin-bottom:18px">' +
      '<h3 style="font-size:15px;margin:0 0 6px">Aviso de saque no seu celular</h3>' +
      '<p class="small muted" style="margin:0 0 12px">Toda vez que alguém sacar, chega um SMS neste número ' +
      'com o nome da pessoa e o benefício. Deixe vazio para desligar.</p>' +
      '<div class="row row-wrap" style="gap:10px;align-items:flex-end">' +
        '<div class="field" style="flex:1;min-width:220px;margin:0">' +
          '<label for="sp-aviso-fone">Celular com DDD</label>' +
          '<input id="sp-aviso-fone" placeholder="(13) 99999-9999" value="' +
            esc((SP.config || {}).aviso_sms_para || '') + '">' +
        '</div>' +
        '<button class="btn btn-sm" id="sp-aviso-salvar">Salvar</button>' +
      '</div>' +
    '</div>' +

    /* ---- historico ---- */
    '<div class="card" style="padding:18px">' +
      '<h3 style="font-size:15px;margin:0 0 12px">Histórico</h3>' +
      (SP.historico && SP.historico.length ?
        '<table class="tbl"><thead><tr><th>Colaborador</th><th>Voucher</th><th>Valor</th>' +
        '<th>Situação</th><th>Quando</th><th></th></tr></thead><tbody>' +
        SP.historico.map(function (h) {
          return '<tr><td>' + esc(h.colaborador) + '</td><td>' + esc(h.voucher) + '</td>' +
            '<td>' + esc(h.valor_br) + '</td>' +
            '<td><span class="fd-pino ' + (h.status === 'pago' ? 'aguardando' : h.status === 'falhou' ? 'inadimplente' : 'aguardando') + '">' +
              esc(h.situacao) + '</span></td>' +
            '<td class="small muted">' + dataBr(h.pago_em || h.solicitado_em || h.liberado_em) + '</td>' +
            '<td>' + (h.comprovante_url
              ? '<a href="' + esc(h.comprovante_url) + '" target="_blank" rel="noopener" class="small">comprovante</a>'
              : '') + '</td></tr>';
        }).join('') + '</tbody></table>'
        : '<div class="small muted">Nada aconteceu ainda.</div>') +
    '</div>';

  ligaSpace();
}

function spPessoa(p) {
  const bloqueado = !!p.aberta;
  return '<label class="cp-item' + (SP_MARCADOS[p.id] ? ' on' : '') + (bloqueado ? ' cp-off' : '') + '">' +
    '<input type="checkbox" class="sp-check" value="' + esc(p.id) + '"' +
      (SP_MARCADOS[p.id] ? ' checked' : '') + (bloqueado ? ' disabled' : '') + '>' +
    '<span><strong>' + esc(p.nome) + '</strong>' +
    '<em>' + (p.cargo ? esc(p.cargo) + ' · ' : '') +
      (bloqueado ? 'já tem ' + esc(p.aberta.situacao.toLowerCase())
        : (p.total_pago ? 'já recebeu ' + spDinheiro(p.total_pago) : 'nunca recebeu')) +
    '</em></span>' +
    '<button type="button" class="btn btn-sm btn-ghost sp-link" data-link="' + esc(p.link) + '">Link</button>' +
  '</label>';
}

function ligaSpace() {
  document.querySelectorAll('.sp-check').forEach(function (c) {
    c.addEventListener('change', function () {
      SP_MARCADOS[c.value] = c.checked;
      c.closest('.cp-item').classList.toggle('on', c.checked);
    });
  });

  // o link pessoal do colaborador — é por ele que a pessoa entra
  document.querySelectorAll('.sp-link').forEach(function (b) {
    b.addEventListener('click', function (ev) {
      ev.preventDefault();
      const l = b.dataset.link;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(l).then(function () { toast('Link copiado'); },
          function () { prompt('Copie o link:', l); });
      } else { prompt('Copie o link:', l); }
    });
  });

  document.getElementById('sp-todos').addEventListener('click', function () {
    (SP.colaboradores || []).forEach(function (p) { if (!p.aberta) SP_MARCADOS[p.id] = true; });
    desenhaSpace();
  });
  document.getElementById('sp-nenhum').addEventListener('click', function () {
    SP_MARCADOS = {}; desenhaSpace();
  });

  document.getElementById('sp-aviso-salvar').addEventListener('click', async function () {
    this.disabled = true;
    try {
      await apiSpace('sp_config_save', {
        body: { aviso_sms_para: (document.getElementById('sp-aviso-fone') || {}).value || '' }
      });
      toast('Aviso de saque salvo');
    } catch (e) { toast(e.message, true); }
    this.disabled = false;
  });

  document.getElementById('sp-novo-voucher').addEventListener('click', function () { abreVoucher(null); });
  document.querySelectorAll('.sp-edit-v').forEach(function (b) {
    b.addEventListener('click', function () { abreVoucher(b.dataset.id); });
  });

  document.getElementById('sp-liberar').addEventListener('click', function () {
    const botao = this;
    const escolhidos = Object.keys(SP_MARCADOS).filter(function (k) { return SP_MARCADOS[k]; });
    if (!escolhidos.length) return toast('Marque pelo menos uma pessoa', true);
    const vid = (document.getElementById('sp-voucher') || {}).value;
    if (!vid) return toast('Escolha o voucher', true);

    const vch = (SP.vouchers || []).filter(function (x) { return x.id === vid; })[0] || {};
    const avisar = {
      whatsapp: (document.getElementById('sp-av-zap') || {}).checked === true,
      sms: (document.getElementById('sp-av-sms') || {}).checked === true,
      email: (document.getElementById('sp-av-mail') || {}).checked === true
    };
    const canais = ['whatsapp', 'sms', 'email'].filter(function (c) { return avisar[c]; });

    spConfirma('Liberar o benefício?',
      '<strong>' + esc(vch.nome) + '</strong> de <strong>' + spDinheiro(vch.valor) + '</strong> para ' +
      '<strong>' + escolhidos.length + ' pessoa(s)</strong>. Cada uma vai poder sacar esse valor uma vez.' +
      (canais.length ? '<br><br>Elas serão avisadas por: <strong>' +
        canais.join(', ').replace('whatsapp', 'WhatsApp').replace('sms', 'SMS').replace('email', 'e-mail') +
        '</strong>, com o link de resgate.' : '<br><br>Ninguém será avisado — você mesmo manda os links.'),
      async function () {
        botao.disabled = true;
        botao.innerHTML = '<span class="spinner"></span> Liberando…';
        try {
          const r = await apiSpace('sp_liberar', {
            body: { voucher_id: vid, colaboradores: escolhidos, avisar: avisar }
          });
          const n = (r.liberados || []).length;
          toast(n + ' liberação(ões)' +
            (r.avisos_enviados ? ' · ' + r.avisos_enviados + ' aviso(s) enviado(s)' : '') +
            ((r.pulados || []).length ? ' · ' + r.pulados.length + ' pulada(s)' : ''));
          if ((r.pulados || []).length) {
            spJanela('<h3 style="margin:0 0 10px;font-size:16.5px">Estas ficaram de fora</h3>' +
              '<div class="small" style="line-height:1.8;color:var(--label-2)">' +
              r.pulados.map(function (p) {
                return '• <strong>' + esc(p.nome || p.id) + '</strong> — ' + esc(p.motivo);
              }).join('<br>') + '</div>' +
              '<div class="row" style="margin-top:18px"><button class="btn" id="spj-ok" style="flex:1">Entendi</button></div>');
            document.getElementById('spj-ok').addEventListener('click', spFechaJanela);
          }
          carregaSpace();
        } catch (e) {
          toast(e.message, true);
          botao.disabled = false;
          botao.textContent = 'Liberar para os marcados';
        }
      }, 'Liberar');
  });

  document.querySelectorAll('.sp-cancelar').forEach(function (b) {
    b.addEventListener('click', function () {
      spConfirma('Cancelar esta liberação?', 'A pessoa deixa de poder sacar este benefício.', async function () {
        try { await apiSpace('sp_cancelar', { body: { id: b.dataset.id } }); toast('Cancelado'); carregaSpace(); }
        catch (e) { toast(e.message, true); }
      }, 'Cancelar liberação');
    });
  });

  // Para o saque que ficou no escuro: pergunta ao Asaas o que houve.
  document.querySelectorAll('.sp-conferir').forEach(function (b) {
    b.addEventListener('click', async function () {
      b.disabled = true; b.innerHTML = '<span class="spinner"></span>';
      try { const r = await apiSpace('sp_conferir', { body: { id: b.dataset.id } }); toast(r.aviso); carregaSpace(); }
      catch (e) { toast(e.message, true); b.disabled = false; b.textContent = 'Conferir no Asaas'; }
    });
  });
}

function abreVoucher(id) {
  const novo = !id;
  const d = novo ? { valor: '', ativo: true }
    : ((SP.vouchers || []).filter(function (x) { return x.id === id; })[0] || {});

  document.getElementById('g-nome').textContent = novo ? 'Novo voucher' : (d.nome || 'Voucher');
  document.getElementById('g-sub').textContent = 'É isto que o colaborador vê e saca.';

  document.getElementById('g-corpo').innerHTML =
    '<div class="field"><label for="sv-nome">Nome do voucher</label>' +
      '<span class="hint">Ex.: Amazon Prime</span>' +
      '<input id="sv-nome" value="' + esc(d.nome || '') + '"></div>' +
    '<div class="field"><label for="sv-valor">Valor</label>' +
      '<span class="hint">Quanto o colaborador vai receber por Pix. Ex.: 50</span>' +
      '<input id="sv-valor" value="' + esc(d.valor === '' ? '' : d.valor) + '"></div>' +
    '<div class="field"><label for="sv-desc">Descrição</label>' +
      '<span class="hint">Uma linha explicando o benefício.</span>' +
      '<input id="sv-desc" value="' + esc(d.descricao || '') + '"></div>' +
    '<div class="row row-wrap" style="gap:18px;align-items:center;margin-top:8px">' +
      '<label class="row small" style="gap:7px;align-items:center"><input type="checkbox" id="sv-ativo" ' +
      (d.ativo !== false ? 'checked' : '') + ' style="width:16px;height:16px"> voucher no ar</label>' +
    '</div>' +
    '<div class="row" style="gap:12px;margin-top:20px">' +
      '<button class="btn" id="sv-salvar">' + (novo ? 'Criar' : 'Salvar') + '</button>' +
    '</div>' +
    '<div id="sv-saida"></div>';

  document.getElementById('fundo').style.display = 'block';
  document.getElementById('gaveta').style.display = 'flex';

  document.getElementById('sv-salvar').addEventListener('click', async function () {
    const corpo = {
      nome: document.getElementById('sv-nome').value,
      valor: document.getElementById('sv-valor').value,
      descricao: document.getElementById('sv-desc').value,
      ativo: document.getElementById('sv-ativo').checked
    };
    if (!novo) corpo.id = d.id;
    if (!corpo.nome.trim()) return toast('Escreva o nome', true);

    this.disabled = true;
    this.innerHTML = '<span class="spinner"></span> Salvando…';
    try {
      await apiSpace('sp_voucher_salvar', { body: corpo });
      toast(novo ? 'Voucher criado' : 'Voucher salvo');
      fechaGaveta();
      carregaSpace();
    } catch (e) {
      document.getElementById('sv-saida').innerHTML =
        '<div class="alert alert-erro" style="margin-top:14px">' + esc(e.message) + '</div>';
      this.disabled = false;
      this.textContent = novo ? 'Criar' : 'Salvar';
    }
  });
}
