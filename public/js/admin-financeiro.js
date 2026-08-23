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
      '<div class="row row-wrap" style="gap:10px">' +
        '<button class="btn btn-sm btn-ghost" id="fin-baixar">Baixar relatório</button>' +
        '<button class="btn btn-sm btn-ghost" id="fin-importar">Importar clientes</button>' +
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
  document.getElementById('fin-importar').addEventListener('click', abreImportacao);
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

/* ============================================================
   IMPORTAÇÃO DE CLIENTES (CSV, XLS e XLSX)
   A leitura acontece aqui na tela: o arquivo vira uma tabela, você
   confere a prévia e diz qual coluna é o quê. Só então as linhas vão
   para o servidor, que valida de novo e barra duplicados.
   ============================================================ */

// Os campos que a planilha pode preencher. "cliente" é o único
// obrigatório; o resto entra se existir no arquivo.
const IMP_CAMPOS = [
  { chave: 'cliente', rotulo: 'Cliente (nome)', pistas: ['cliente', 'nome', 'empresa', 'razao'] },
  { chave: 'valor', rotulo: 'Mensalidade', pistas: ['valor', 'mensal', 'fee'] },
  { chave: 'setup', rotulo: 'Setup', pistas: ['setup'] },
  { chave: 'hospedagem', rotulo: 'Hospedagem', pistas: ['hosped', 'hosting'] },
  { chave: 'vencimento_dia', rotulo: 'Dia do vencimento', pistas: ['venc', 'dia'] },
  { chave: 'status', rotulo: 'Status', pistas: ['status', 'situa', 'pagament'] },
  { chave: 'responsavel', rotulo: 'Responsável', pistas: ['respons', 'contato'] },
  { chave: 'telefone', rotulo: 'Telefone', pistas: ['telefone', 'fone', 'celular', 'whats'] },
  { chave: 'observacao', rotulo: 'Observação', pistas: ['obs', 'nota', 'coment'] }
];

// CSV lido na mão: descobre o separador (; , ou tab), respeita aspas
// e ignora o BOM que o Excel poe na frente.
function leCsv(texto) {
  texto = String(texto || '').replace(/^﻿/, '');
  const primeira = (texto.split(/\r?\n/)[0] || '');
  let sep = ';';
  let melhor = -1;
  [';', ',', '\t'].forEach(function (s) {
    const n = primeira.split(s).length - 1;
    if (n > melhor) { melhor = n; sep = s; }
  });

  const linhas = [];
  let linha = [], celula = '', aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (aspas) {
      if (ch === '"' && texto[i + 1] === '"') { celula += '"'; i++; }
      else if (ch === '"') aspas = false;
      else celula += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === sep) { linha.push(celula); celula = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && texto[i + 1] === '\n') i++;
      linha.push(celula); celula = '';
      if (linha.some(function (c) { return String(c).trim() !== ''; })) linhas.push(linha);
      linha = [];
    } else celula += ch;
  }
  linha.push(celula);
  if (linha.some(function (c) { return String(c).trim() !== ''; })) linhas.push(linha);
  return linhas;
}

// XLS/XLSX precisam de um leitor de verdade (SheetJS). Ele só é
// baixado NA HORA em que alguém importa um .xls — o painel continua
// leve no dia a dia. Se o carregamento falhar, o CSV segue vivo.
let IMP_XLSX_PRONTO = null;
function carregaLeitorXlsx() {
  if (window.XLSX) return Promise.resolve(true);
  if (IMP_XLSX_PRONTO) return IMP_XLSX_PRONTO;
  IMP_XLSX_PRONTO = new Promise(function (ok, falhou) {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = function () { ok(true); };
    s.onerror = function () {
      IMP_XLSX_PRONTO = null;
      falhou(new Error('Não consegui baixar o leitor de planilhas. Salve o arquivo como CSV e tente de novo.'));
    };
    document.head.appendChild(s);
  });
  return IMP_XLSX_PRONTO;
}

function leArquivoImportacao(arq) {
  const nome = String(arq.name || '').toLowerCase();
  if (/\.csv$/.test(nome)) {
    return arq.text().then(leCsv);
  }
  if (/\.(xls|xlsx)$/.test(nome)) {
    return carregaLeitorXlsx().then(function () {
      return arq.arrayBuffer();
    }).then(function (buf) {
      const wb = window.XLSX.read(buf, { type: 'array' });
      const aba = wb.Sheets[wb.SheetNames[0]];
      return window.XLSX.utils.sheet_to_json(aba, { header: 1, raw: false, defval: '' });
    });
  }
  return Promise.reject(new Error('Use um arquivo .csv, .xls ou .xlsx.'));
}

// tenta adivinhar qual coluna do arquivo é cada campo, pelos títulos
function adivinhaColunas(cabecalho) {
  const palpite = {};
  const usadas = {};
  IMP_CAMPOS.forEach(function (c) {
    for (let i = 0; i < cabecalho.length; i++) {
      if (usadas[i]) continue;
      const t = String(cabecalho[i] || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      if (c.pistas.some(function (p) { return t.indexOf(p) >= 0; })) {
        palpite[c.chave] = i;
        usadas[i] = true;
        break;
      }
    }
  });
  return palpite;
}

let IMP_TABELA = null;

function abreImportacao() {
  IMP_TABELA = null;
  document.getElementById('g-nome').textContent = 'Importar clientes';
  document.getElementById('g-sub').textContent = 'CSV, XLS ou XLSX — você confere tudo antes de entrar.';
  document.getElementById('g-corpo').innerHTML =
    '<div class="anexo-aviso" id="imp-area" style="display:flex;gap:12px;align-items:center;' +
      'padding:16px;border:1.5px dashed var(--fio);border-radius:12px;cursor:pointer">' +
      '<svg width="22" height="22" viewBox="0 0 24 24" style="fill:none;stroke:var(--label-3);' +
        'stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;flex:none">' +
        '<path d="M12 16.5V4.8M7.8 9l4.2-4.2L16.2 9"/>' +
        '<path d="M4.5 15v2.7a1.8 1.8 0 0 0 1.8 1.8h11.4a1.8 1.8 0 0 0 1.8-1.8V15"/></svg>' +
      '<span style="flex:1"><b id="imp-nome" style="display:block;font-size:14px">Escolher arquivo</b>' +
      '<span class="small muted">A primeira linha deve ser o título das colunas</span></span>' +
      '<input type="file" id="imp-arquivo" accept=".csv,.xls,.xlsx" style="display:none">' +
    '</div>' +
    '<div id="imp-passo2"></div>' +
    '<div id="imp-saida"></div>';

  document.getElementById('fundo').style.display = 'block';
  document.getElementById('gaveta').style.display = 'flex';

  const area = document.getElementById('imp-area');
  const input = document.getElementById('imp-arquivo');
  area.addEventListener('click', function () { input.click(); });
  input.addEventListener('change', async function () {
    const arq = (this.files || [])[0];
    if (!arq) return;
    document.getElementById('imp-nome').textContent = arq.name;
    document.getElementById('imp-saida').innerHTML = '';
    document.getElementById('imp-passo2').innerHTML =
      '<div class="small muted" style="margin-top:14px"><span class="spinner"></span> Lendo o arquivo…</div>';
    try {
      const tabela = await leArquivoImportacao(arq);
      if (!tabela || tabela.length < 2) {
        throw new Error('O arquivo precisa ter a linha de títulos e pelo menos um cliente.');
      }
      IMP_TABELA = tabela;
      desenhaPreviaImportacao();
    } catch (e) {
      document.getElementById('imp-passo2').innerHTML = '';
      document.getElementById('imp-saida').innerHTML =
        '<div class="alert alert-erro" style="margin-top:14px">' + esc(e.message) + '</div>';
    }
  });
}

function desenhaPreviaImportacao() {
  const cab = IMP_TABELA[0].map(function (c) { return String(c || '').trim(); });
  const corpo = IMP_TABELA.slice(1);
  const palpite = adivinhaColunas(cab);

  document.getElementById('imp-passo2').innerHTML =
    '<h3 style="font-size:14px;margin:18px 0 4px">O que é cada coluna</h3>' +
    '<p class="small muted" style="margin:0 0 12px">Confira o palpite do sistema. Só o ' +
    '<strong>nome do cliente</strong> é obrigatório — o resto entra se existir.</p>' +
    '<div class="row row-wrap" style="gap:10px">' +
      IMP_CAMPOS.map(function (c) {
        return '<div class="field" style="margin:0;min-width:170px;flex:1">' +
          '<label>' + esc(c.rotulo) + (c.chave === 'cliente' ? ' *' : '') + '</label>' +
          '<select class="imp-mapa" data-campo="' + c.chave + '">' +
            '<option value="">— não tem —</option>' +
            cab.map(function (t, i) {
              return '<option value="' + i + '"' + (palpite[c.chave] === i ? ' selected' : '') + '>' +
                esc(t || ('coluna ' + (i + 1))) + '</option>';
            }).join('') +
          '</select></div>';
      }).join('') +
    '</div>' +

    '<h3 style="font-size:14px;margin:20px 0 8px">Prévia (' + corpo.length + ' cliente(s) no arquivo)</h3>' +
    '<div style="overflow-x:auto;border:1px solid var(--fio);border-radius:12px">' +
      '<table class="tbl" style="min-width:520px"><thead><tr>' +
        cab.map(function (t) { return '<th style="padding:10px">' + esc(t) + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      corpo.slice(0, 5).map(function (l) {
        return '<tr>' + cab.map(function (_, i) {
          return '<td class="small" style="padding:10px">' + esc(String(l[i] == null ? '' : l[i]).slice(0, 40)) + '</td>';
        }).join('') + '</tr>';
      }).join('') +
      '</tbody></table>' +
    '</div>' +
    (corpo.length > 5 ? '<div class="small muted" style="margin-top:6px">…e mais ' + (corpo.length - 5) + ' linha(s)</div>' : '') +

    '<div class="row" style="gap:12px;margin-top:18px">' +
      '<button class="btn" id="imp-confirmar">Importar ' + corpo.length + ' cliente(s)</button>' +
    '</div>';

  document.getElementById('imp-confirmar').addEventListener('click', async function () {
    const mapa = {};
    document.querySelectorAll('.imp-mapa').forEach(function (s) {
      if (s.value !== '') mapa[s.dataset.campo] = Number(s.value);
    });
    if (mapa.cliente === undefined) return toast('Diga qual coluna é o nome do cliente', true);

    const linhas = corpo.map(function (l, i) {
      const obj = { linha: i + 2 };   // +2: pula o título e conta como no Excel
      IMP_CAMPOS.forEach(function (c) {
        if (mapa[c.chave] !== undefined) obj[c.chave] = String(l[mapa[c.chave]] == null ? '' : l[mapa[c.chave]]).trim();
      });
      return obj;
    }).filter(function (o) {
      return Object.keys(o).some(function (k) { return k !== 'linha' && o[k] !== ''; });
    });

    this.disabled = true;
    this.innerHTML = '<span class="spinner"></span> Importando…';
    try {
      const r = await apiFin('fin_importar', { body: { linhas: linhas } });
      document.getElementById('imp-saida').innerHTML =
        '<div class="alert ' + (r.importados ? 'alert-ok' : 'alert-aviso') + '" style="margin-top:16px">' +
          '<strong>' + r.importados + ' cliente(s) importado(s).</strong>' +
          (r.total_pulados ? ' ' + r.total_pulados + ' ficaram de fora — veja o motivo abaixo.' : ' Nenhum ficou de fora.') +
        '</div>' +
        ((r.pulados || []).length
          ? '<div style="overflow-x:auto;margin-top:10px"><table class="tbl"><thead><tr>' +
            '<th>Linha</th><th>Cliente</th><th>Motivo</th></tr></thead><tbody>' +
            r.pulados.map(function (p) {
              return '<tr><td class="small muted">' + p.linha + '</td><td>' + esc(p.nome) + '</td>' +
                '<td class="small muted">' + esc(p.motivo) + '</td></tr>';
            }).join('') + '</tbody></table></div>'
          : '');
      if (r.importados) carregaFinanceiro();
    } catch (e) {
      document.getElementById('imp-saida').innerHTML =
        '<div class="alert alert-erro" style="margin-top:16px">' + esc(e.message) + '</div>';
      this.disabled = false;
      this.textContent = 'Importar ' + corpo.length + ' cliente(s)';
    }
  });
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
   erro vermelho na cara. E a Automação só aparece se estiver ligada
   nos Ajustes. Quem barra de verdade continua sendo o servidor —
   isto aqui só evita o clique inútil. */
async function escondeFinanceiroSeNaoPode() {
  try {
    const r = await (await fetch('/api/admin?action=usuarios_eu', {
      headers: { Authorization: 'Bearer ' + TOKEN }
    })).json();
    if (!r.ok) return;

    // Automação: escondida por padrão; a chave fica em Ajustes.
    if (r.mostrar_automacao !== true) {
      const auto = document.querySelector('#abas .nav-grupo[data-grupo="automacao"]');
      if (auto) auto.style.display = 'none';
    }

    if (!Array.isArray(r.menu) || r.menu.indexOf('financeiro') >= 0) return;
    const grupo = document.querySelector('#abas .nav-grupo[data-grupo="financeiro"]');
    if (grupo) grupo.style.display = 'none';
  } catch (e) { /* na dúvida, deixa o botão: o servidor barra */ }
}

/* ============================================================
   TELA 2 — o dashboard
   ============================================================ */
/* O período escolhido fica guardado entre um redesenho e outro. */
let FIN_PERIODO = { tipo: 'mes', de: '', ate: '' };

function finPeriodoDatas() {
  const hoje = new Date();
  function iso(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }
  if (FIN_PERIODO.tipo === 'hoje') return { de: iso(hoje), ate: iso(hoje) };
  if (FIN_PERIODO.tipo === 'ano') {
    return { de: hoje.getFullYear() + '-01-01', ate: hoje.getFullYear() + '-12-31' };
  }
  if (FIN_PERIODO.tipo === 'personalizado' && FIN_PERIODO.de && FIN_PERIODO.ate) {
    return { de: FIN_PERIODO.de, ate: FIN_PERIODO.ate };
  }
  // padrão: este mês
  return {
    de: iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)),
    ate: iso(new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0))
  };
}

async function carregaFinDash() {
  const alvo = document.getElementById('painel-findash');
  alvo.innerHTML = '<div class="spinner"></div>';
  try {
    const p = finPeriodoDatas();
    const d = await apiFin('fin_resumo', { params: { de: p.de, ate: p.ate } });
    desenhaFinDash(d.resumo || {}, d.cartoes || {});
  } catch (e) {
    alvo.innerHTML = '<div class="alert alert-erro">' + esc(e.message) + '</div>';
  }
}

/* Troca só os números quando o período muda — a página não pisca. */
async function atualizaFinCartoes() {
  const caixa = document.getElementById('fd2-cartoes');
  if (!caixa) return carregaFinDash();
  caixa.style.opacity = '.45';
  try {
    const p = finPeriodoDatas();
    const d = await apiFin('fin_resumo', { params: { de: p.de, ate: p.ate } });
    caixa.outerHTML = finCartoesHtml(d.cartoes || {});
  } catch (e) { toast(e.message, true); }
  const nova = document.getElementById('fd2-cartoes');
  if (nova) nova.style.opacity = '';
}

/* Os três cartões no padrão da referência: borda clara, canto bem
   arredondado, valor grande colorido, barrinha e o rodapé de clientes. */
function finCartoesHtml(c) {
  function cartao(chave, titulo, cor, corBarra, dados, listrada) {
    const d = dados || { valor: 0, clientes: 0 };
    const vazio = !d.clientes;
    return '<div class="fd2-carta">' +
      '<div class="fd2-tit">' + esc(titulo) + '</div>' +
      '<div class="fd2-val" style="color:' + cor + '">' + finDinheiro(d.valor) + '</div>' +
      '<div class="fd2-sub">' + d.clientes + ' cobrança(s) no período</div>' +
      '<div class="fd2-barra' + (vazio && listrada ? ' listras' : '') + '"' +
        (vazio && listrada ? '' : ' style="background:' + corBarra + '"') + '></div>' +
      '<button type="button" class="fd2-linha fd2-ver-clientes"' + (vazio ? ' disabled' : '') + '>' +
        '<span>' + d.clientes + ' cliente' + (d.clientes === 1 ? '' : 's') + '</span>' +
        '<svg width="13" height="13" viewBox="0 0 24 24" style="fill:none;stroke:currentColor;' +
        'stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round"><path d="m9 5 7 7-7 7"/></svg>' +
      '</button>' +
    '</div>';
  }
  return '<div class="fd2-grade" id="fd2-cartoes">' +
    cartao('recebidas', 'Recebidas', '#157347', '#1fbf6e', c.recebidas) +
    cartao('aguardando', 'Aguardando pagamento', '#b45309', '#f5c26b', c.aguardando, true) +
    cartao('vencidas', 'Vencidas', '#b02a20', '#d9453a', c.vencidas) +
  '</div>';
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

function desenhaFinDash(r, cartoes) {
  const semana = r.proxima_semana_lista || [];
  const depois = r.proximas_depois || [];
  const P = FIN_PERIODO;

  document.getElementById('painel-findash').innerHTML =
    '<div class="row row-wrap" style="justify-content:space-between;align-items:center;margin-bottom:16px;gap:12px">' +
      '<div class="small muted">' + (r.clientes || 0) + ' cliente(s) com contrato ativo</div>' +
      '<div class="row row-wrap" style="gap:8px;align-items:center">' +
        '<div class="fd2-filtro" id="fd2-filtro">' +
          ['hoje|Hoje', 'mes|Este mês', 'ano|Este ano', 'personalizado|Personalizado'].map(function (op) {
            const par = op.split('|');
            return '<button type="button" data-p="' + par[0] + '"' +
              (P.tipo === par[0] ? ' class="on"' : '') + '>' + par[1] + '</button>';
          }).join('') +
        '</div>' +
        '<button class="btn btn-sm" id="fd-baixar">Baixar relatório completo</button>' +
      '</div>' +
    '</div>' +

    '<div class="row row-wrap" id="fd2-datas" style="gap:10px;align-items:flex-end;margin:0 0 14px;' +
      (P.tipo === 'personalizado' ? '' : 'display:none') + '">' +
      '<div class="field" style="margin:0"><label for="fd2-de">Data inicial</label>' +
        '<input type="date" id="fd2-de" value="' + esc(P.de) + '"></div>' +
      '<div class="field" style="margin:0"><label for="fd2-ate">Data final</label>' +
        '<input type="date" id="fd2-ate" value="' + esc(P.ate) + '"></div>' +
      '<button class="btn btn-sm" id="fd2-aplicar">Aplicar</button>' +
    '</div>' +

    finCartoesHtml(cartoes || {}) +
    '<div style="height:10px"></div>' +

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

  // ---- o seletor de período ----
  document.querySelectorAll('#fd2-filtro button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      FIN_PERIODO.tipo = btn.dataset.p;
      document.querySelectorAll('#fd2-filtro button').forEach(function (x) {
        x.classList.toggle('on', x === btn);
      });
      const datas = document.getElementById('fd2-datas');
      if (FIN_PERIODO.tipo === 'personalizado') {
        datas.style.display = '';
        // só busca quando as duas datas estiverem escolhidas
        if (FIN_PERIODO.de && FIN_PERIODO.ate) atualizaFinCartoes();
      } else {
        datas.style.display = 'none';
        atualizaFinCartoes();
      }
    });
  });
  const aplicar = document.getElementById('fd2-aplicar');
  if (aplicar) aplicar.addEventListener('click', function () {
    const de = (document.getElementById('fd2-de') || {}).value;
    const ate = (document.getElementById('fd2-ate') || {}).value;
    if (!de || !ate) return toast('Escolha as duas datas', true);
    FIN_PERIODO.de = de;
    FIN_PERIODO.ate = ate;
    atualizaFinCartoes();
  });

  // os cartões levam para a lista de clientes
  document.querySelectorAll('.fd2-ver-clientes').forEach(function (b) {
    b.addEventListener('click', function () {
      const aba = document.querySelector('#abas button[data-aba="financeiro"]');
      if (aba) aba.click();
    });
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
