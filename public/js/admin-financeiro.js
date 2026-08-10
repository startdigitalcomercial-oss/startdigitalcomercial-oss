/* ============================================================
   FINANCEIRO
   Duas telas: a planilha de clientes (igual à que o time já usa)
   e o dashboard com os números do mês.
   Falam com /api/financeiro, que tem a mesma porta do painel.
   ============================================================ */

let FIN_CLIENTES = [];

async function apiFin(action, opts) {
  opts = opts || {};
  const qs = new URLSearchParams(Object.assign({ action: action }, opts.params || {}));
  const res = await fetch('/api/financeiro?' + qs.toString(), {
    method: opts.body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json().catch(function () { return { ok: false, error: 'resposta invalida' }; });
  if (res.status === 401) { sair(); throw new Error('sessao expirada'); }
  if (!data.ok) throw new Error(data.error || 'erro');
  return data;
}

function finDinheiro(v) {
  return 'R$ ' + Number(v || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
}

/* ============================================================
   TELA 1 — a planilha
   ============================================================ */
async function carregaFinanceiro() {
  const alvo = document.getElementById('painel-financeiro');
  alvo.innerHTML = '<div class="spinner"></div>';
  try {
    const d = await apiFin('fin_lista');
    FIN_CLIENTES = d.clientes || [];
    desenhaFinanceiro();
  } catch (e) {
    alvo.innerHTML = '<div class="alert alert-erro">' + esc(e.message) + '</div>';
  }
}

function desenhaFinanceiro() {
  const linhas = FIN_CLIENTES;
  const soma = function (campo) {
    return linhas.reduce(function (a, r) { return a + Number(r[campo] || 0); }, 0);
  };

  document.getElementById('painel-financeiro').innerHTML =
    '<div class="row row-wrap" style="justify-content:space-between;align-items:center;margin-bottom:16px;gap:12px">' +
      '<div class="small muted">' + linhas.length + ' cliente(s) na carteira · ' +
      'mensalidades ' + finDinheiro(soma('valor')) + '</div>' +
      '<div class="row" style="gap:10px">' +
        '<button class="btn btn-sm btn-ghost" id="fin-baixar">Baixar relatório</button>' +
        '<button class="btn btn-sm" id="fin-novo">Novo cliente</button>' +
      '</div>' +
    '</div>' +

    '<div class="fin-quadro">' +
      '<div class="fin-topo">' +
        '<div class="fin-marca"><img src="/favicon-32.png" alt="">' +
          '<span><b>StartDigital</b><small>Assessoria de Marketing</small></span></div>' +
        '<div class="fin-titulo">FINANCEIRO START DIGITAL</div>' +
      '</div>' +
      '<div style="overflow-x:auto">' +
      '<table class="fin-tab"><thead><tr>' +
        '<th>Clientes</th><th>Valor</th><th>Setup</th><th>Hospedagem</th>' +
        '<th>Vencimento</th><th>Status</th><th>Responsável</th><th>Observação</th><th></th>' +
      '</tr></thead><tbody>' +
      (linhas.length ? linhas.map(finLinha).join('')
        : '<tr><td colspan="9" style="padding:26px">Nenhum cliente cadastrado ainda.</td></tr>') +
      '</tbody></table>' +
      '</div>' +
    '</div>';

  document.getElementById('fin-novo').addEventListener('click', function () { abreFinCliente(null); });
  document.getElementById('fin-baixar').addEventListener('click', baixaRelatorioFin);
  document.querySelectorAll('.fin-editar').forEach(function (b) {
    b.addEventListener('click', function () { abreFinCliente(b.dataset.id); });
  });
}

function finLinha(r) {
  return '<tr>' +
    '<td class="fin-nome' + (r.destaque ? ' on' : '') + '">' + esc(r.cliente) + '</td>' +
    '<td class="fin-val">' + finDinheiro(r.valor) + '</td>' +
    '<td class="fin-val">' + (r.setup ? finDinheiro(r.setup) : '') + '</td>' +
    '<td class="fin-val">' + (r.hospedagem ? finDinheiro(r.hospedagem) : '') + '</td>' +
    '<td>' + String(r.vencimento_dia).padStart(2, '0') + '/mês</td>' +
    '<td><span class="fin-st ' + esc(r.status) + '">' + esc(r.status_nome) + '</span></td>' +
    '<td class="fin-resp">' + esc(r.responsavel || '') +
      (r.telefone ? ' <span class="muted">' + esc(r.telefone) + '</span>' : '') + '</td>' +
    '<td class="fin-obs">' + esc(r.observacao || '') + '</td>' +
    '<td><button class="fin-editar" data-id="' + esc(r.id) + '">editar</button></td>' +
  '</tr>';
}

/* ---------------------------------------------- a gaveta de edição */
function abreFinCliente(id) {
  const novo = !id;
  const d = novo ? { status: 'aguardando', vencimento_dia: 10 }
    : (FIN_CLIENTES.filter(function (x) { return x.id === id; })[0] || {});

  document.getElementById('g-nome').textContent = novo ? 'Novo cliente' : (d.cliente || 'Cliente');
  document.getElementById('g-sub').textContent = novo
    ? 'Entra na planilha e já conta no dashboard.'
    : 'Alterou aqui, o dashboard muda junto.';

  const campo = function (id2, rot, valor, dica, tipo) {
    return '<div class="field"><label for="' + id2 + '">' + rot + '</label>' +
      (dica ? '<span class="hint">' + dica + '</span>' : '') +
      '<input id="' + id2 + '" type="' + (tipo || 'text') + '" value="' + esc(valor == null ? '' : valor) + '"></div>';
  };

  document.getElementById('g-corpo').innerHTML =
    campo('fc-cliente', 'Nome do cliente', d.cliente, 'Como aparece na planilha.') +
    '<div class="row row-wrap" style="gap:14px">' +
      '<div style="flex:1;min-width:150px">' + campo('fc-valor', 'Mensalidade', d.valor, 'Só o número. Ex.: 2500') + '</div>' +
      '<div style="flex:1;min-width:150px">' + campo('fc-setup', 'Setup', d.setup, 'Deixe 0 se não tem.') + '</div>' +
      '<div style="flex:1;min-width:150px">' + campo('fc-hosp', 'Hospedagem', d.hospedagem, 'Valor mensal.') + '</div>' +
    '</div>' +
    '<div class="row row-wrap" style="gap:14px">' +
      '<div style="flex:1;min-width:150px">' + campo('fc-dia', 'Dia do vencimento', d.vencimento_dia, 'De 1 a 31.', 'number') + '</div>' +
      '<div style="flex:1;min-width:180px"><div class="field"><label for="fc-status">Status</label>' +
        '<span class="hint">É isto que o dashboard soma.</span>' +
        '<select id="fc-status">' +
          ['pago', 'aguardando', 'inadimplente'].map(function (s) {
            const nome = { pago: 'Pago', aguardando: 'Aguardando', inadimplente: 'Inadimplente' }[s];
            return '<option value="' + s + '"' + (d.status === s ? ' selected' : '') + '>' + nome + '</option>';
          }).join('') +
        '</select></div></div>' +
    '</div>' +
    '<div class="row row-wrap" style="gap:14px">' +
      '<div style="flex:1;min-width:180px">' + campo('fc-resp', 'Responsável', d.responsavel, 'Quem fala com a gente.') + '</div>' +
      '<div style="flex:1;min-width:180px">' + campo('fc-fone', 'Telefone', d.telefone, '') + '</div>' +
    '</div>' +
    campo('fc-obs', 'Observação', d.observacao, 'Aparece na última coluna.') +

    '<label class="cp-item cp-chave' + (d.destaque ? ' on' : '') + '" id="fc-dest-cx" style="margin-top:14px">' +
      '<input type="checkbox" id="fc-destaque"' + (d.destaque ? ' checked' : '') + '>' +
      '<span><strong>Pintar o nome na planilha</strong>' +
      '<em>Para os clientes que você quer achar de longe.</em></span>' +
    '</label>' +

    '<div class="row row-wrap" style="gap:18px;align-items:center;margin-top:14px">' +
      '<label class="row small" style="gap:7px;align-items:center"><input type="checkbox" id="fc-ativo" ' +
      (d.ativo !== false ? 'checked' : '') + ' style="width:16px;height:16px"> contrato ativo</label>' +
    '</div>' +

    '<div class="row" style="gap:12px;margin-top:20px">' +
      '<button class="btn" id="fc-salvar">' + (novo ? 'Adicionar' : 'Salvar') + '</button>' +
      (novo ? '' : '<button class="btn btn-ghost" id="fc-excluir" style="color:var(--red)">Excluir</button>') +
    '</div>' +
    '<div id="fc-saida"></div>';

  document.getElementById('fundo').style.display = 'block';
  document.getElementById('gaveta').style.display = 'flex';

  const cxDest = document.getElementById('fc-destaque');
  cxDest.addEventListener('change', function () {
    document.getElementById('fc-dest-cx').classList.toggle('on', cxDest.checked);
  });

  const val = function (i) { return (document.getElementById(i) || {}).value || ''; };

  document.getElementById('fc-salvar').addEventListener('click', async function () {
    const corpo = {
      cliente: val('fc-cliente'), valor: val('fc-valor'), setup: val('fc-setup'),
      hospedagem: val('fc-hosp'), vencimento_dia: val('fc-dia'), status: val('fc-status'),
      responsavel: val('fc-resp'), telefone: val('fc-fone'), observacao: val('fc-obs'),
      destaque: cxDest.checked,
      ativo: document.getElementById('fc-ativo').checked
    };
    if (!novo) corpo.id = d.id;
    if (!corpo.cliente.trim()) return toast('Escreva o nome do cliente', true);

    this.disabled = true;
    this.innerHTML = '<span class="spinner"></span> Salvando…';
    try {
      await apiFin('fin_salvar', { body: corpo });
      toast(novo ? 'Cliente adicionado' : 'Cliente salvo');
      fechaGaveta();
      carregaFinanceiro();
    } catch (e) {
      document.getElementById('fc-saida').innerHTML =
        '<div class="alert alert-erro" style="margin-top:14px">' + esc(e.message) + '</div>';
      this.disabled = false;
      this.textContent = novo ? 'Adicionar' : 'Salvar';
    }
  });

  const btnEx = document.getElementById('fc-excluir');
  if (btnEx) {
    btnEx.addEventListener('click', async function () {
      if (!confirm('Tirar ' + (d.cliente || 'este cliente') + ' da planilha?')) return;
      try {
        await apiFin('fin_excluir', { body: { id: d.id } });
        toast('Cliente removido');
        fechaGaveta();
        carregaFinanceiro();
      } catch (e) { toast(e.message, true); }
    });
  }
}

/* ---------------------------------------------- o relatório
   Vem pronto do servidor, com a linha de total no fim. Baixa
   com o crachá no cabeçalho, então não dá para abrir o endereço
   direto no navegador e vazar a carteira. */
async function baixaRelatorioFin() {
  const b = document.getElementById('fin-baixar');
  const antes = b ? b.textContent : '';
  if (b) { b.disabled = true; b.textContent = 'Gerando…'; }
  try {
    const res = await fetch('/api/financeiro?action=fin_relatorio', {
      headers: { Authorization: 'Bearer ' + TOKEN }
    });
    if (!res.ok) throw new Error('Não deu para gerar o relatório agora.');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const hoje = new Date();
    a.href = url;
    a.download = 'financeiro-startdigital-' + hoje.getFullYear() +
      String(hoje.getMonth() + 1).padStart(2, '0') +
      String(hoje.getDate()).padStart(2, '0') + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    toast('Relatório baixado');
  } catch (e) {
    toast(e.message, true);
  }
  if (b) { b.disabled = false; b.textContent = antes || 'Baixar relatório'; }
}

/* ---------------------------------------------- gentileza com o menu
   Quem não enxerga o financeiro não precisa ver o botão e levar um
   erro vermelho na cara. Quem barra de verdade continua sendo o
   servidor — isto aqui só evita o clique inútil. */
async function escondeFinanceiroSeNaoPode() {
  try {
    const r = await (await fetch('/api/admin?action=usuarios_eu', {
      headers: { Authorization: 'Bearer ' + TOKEN }
    })).json();
    if (!r.ok || !Array.isArray(r.menu)) return;
    if (r.menu.indexOf('financeiro') >= 0) return;
    const grupo = document.querySelector('#abas .nav-grupo[data-grupo="financeiro"]');
    if (grupo) grupo.style.display = 'none';
  } catch (e) { /* na dúvida, deixa o botão: o servidor barra */ }
}

/* ============================================================
   TELA 2 — o dashboard
   ============================================================ */
async function carregaFinDash() {
  const alvo = document.getElementById('painel-findash');
  alvo.innerHTML = '<div class="spinner"></div>';
  try {
    const d = await apiFin('fin_resumo');
    desenhaFinDash(d.resumo || {});
  } catch (e) {
    alvo.innerHTML = '<div class="alert alert-erro">' + esc(e.message) + '</div>';
  }
}

function fdTile(rot, valor, pe, classe) {
  return '<div class="fd-tile' + (classe ? ' ' + classe : '') + '">' +
    '<div class="rot">' + esc(rot) + '</div>' +
    '<div class="num">' + finDinheiro(valor) + '</div>' +
    '<div class="pe">' + esc(pe || '') + '</div>' +
  '</div>';
}

function fdFila(s) {
  return '<div class="fd-sem-linha">' +
    '<span class="fd-sem-dia">' + esc(s.quando) + '</span>' +
    '<span class="fd-sem-nome">' + esc(s.cliente) + '</span>' +
    '<span class="fd-pino ' + esc(s.status) + '">' + esc(s.status_nome) + '</span>' +
    '<span class="fd-sem-val">' + finDinheiro(s.valor) + '</span>' +
  '</div>';
}

function desenhaFinDash(r) {
  const semana = r.proxima_semana_lista || [];
  const depois = r.proximas_depois || [];

  document.getElementById('painel-findash').innerHTML =
    '<div class="row row-wrap" style="justify-content:space-between;align-items:center;margin-bottom:16px;gap:12px">' +
      '<div class="small muted">' + (r.clientes || 0) + ' cliente(s) com contrato ativo</div>' +
      '<button class="btn btn-sm" id="fd-baixar">Baixar relatório completo</button>' +
    '</div>' +

    '<div class="fd-grade">' +
      fdTile('Total — Setup', r.total_setup, 'Cobrado uma vez, na entrada.') +
      fdTile('Total — Mensalidade', r.total_mensalidade, 'O que entra todo mês.') +
      fdTile('Total — Hospedagem', r.total_hospedagem, 'Somado por mês.') +
      fdTile('Inadimplentes', r.inadimplente,
        (r.inadimplente_qtd || 0) + ' cliente(s) atrasado(s).', 'ruim') +
      fdTile('A receber — aguardando', r.aguardando,
        (r.aguardando_qtd || 0) + ' cliente(s) na fila.', 'espera') +
      fdTile('Já recebido', r.recebido,
        (r.recebido_qtd || 0) + ' cliente(s) em dia.', 'ok') +
    '</div>' +

    '<hr class="sep" style="margin:26px 0 18px">' +
    '<h3 style="font-size:15px;margin:0 0 4px">Previsão de recebimento — próxima semana</h3>' +
    '<p class="small muted" style="margin:0 0 14px">De hoje até ' + esc(r.proxima_semana_ate || '') +
      '. Total previsto: <strong>' + finDinheiro(r.proxima_semana) + '</strong> ' +
      'em ' + (r.proxima_semana_qtd || 0) + ' cobrança(s).</p>' +

    '<div class="fd-sem">' +
      (semana.length ? semana.map(fdFila).join('')
        : '<div class="fd-sem-linha"><span class="muted">Nada vence nos próximos 7 dias.</span></div>') +
    '</div>' +

    (semana.length || !depois.length ? '' :
      '<p class="small muted" style="margin:18px 0 8px">O que vem depois:</p>' +
      '<div class="fd-sem">' + depois.map(fdFila).join('') + '</div>') +

    '<hr class="sep" style="margin:26px 0 18px">' +
    '<div class="card" style="padding:18px">' +
      '<h3 style="font-size:15px;margin:0 0 6px">Relatório para bater com o time</h3>' +
      '<p class="small muted" style="margin:0 0 14px">Uma planilha com todas as colunas — cliente, ' +
      'mensalidade, setup, hospedagem, total, vencimento, status, responsável, telefone e observação — ' +
      'e a linha de total no fim. Abre direto no Excel.</p>' +
      '<button class="btn" id="fd-baixar2">Baixar relatório completo</button>' +
    '</div>';

  ['fd-baixar', 'fd-baixar2'].forEach(function (id) {
    const b = document.getElementById(id);
    if (b) b.addEventListener('click', baixaRelatorioFinDash);
  });
}

// mesma coisa do outro botão, mas mexendo no botão daqui
async function baixaRelatorioFinDash() {
  const b = this;
  const antes = b.textContent;
  b.disabled = true; b.textContent = 'Gerando…';
  try {
    const res = await fetch('/api/financeiro?action=fin_relatorio', {
      headers: { Authorization: 'Bearer ' + TOKEN }
    });
    if (!res.ok) throw new Error('Não deu para gerar o relatório agora.');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const hoje = new Date();
    a.href = url;
    a.download = 'financeiro-startdigital-' + hoje.getFullYear() +
      String(hoje.getMonth() + 1).padStart(2, '0') +
      String(hoje.getDate()).padStart(2, '0') + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    toast('Relatório baixado');
  } catch (e) { toast(e.message, true); }
  b.disabled = false; b.textContent = antes;
}
