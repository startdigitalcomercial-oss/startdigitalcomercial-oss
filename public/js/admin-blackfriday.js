/* ============================================================
   COMERCIAL > BLACK FRIDAY

   A tela da campanha Black Week Start 2026 dentro do painel:
   o link da landing page, os leads que chegaram pelo formulário
   e a mensagem automática de WhatsApp que cada lead recebe.

   Fala só com /api/blackweek. Não toca em nenhuma outra tela.
   ============================================================ */
let BW = null;

async function bwApi(action, body) {
  const res = await fetch('/api/blackweek?action=' + encodeURIComponent(action), {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(function () { return { ok: false, error: 'resposta invalida' }; });
  if (res.status === 401) { sair(); throw new Error('sessao expirada'); }
  if (!data.ok) throw new Error(data.error || 'erro');
  return data;
}

function bwFone(d) {
  d = String(d || '').replace(/\D/g, '');
  if (d.indexOf('55') === 0 && d.length >= 12) d = d.slice(2);
  if (d.length === 11) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
  if (d.length === 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
  return d;
}

function bwEnvioTag(l) {
  if (l.wa_status === 'enviado') return '<span class="tag tag-verde">Enviada</span>';
  if (l.wa_status === 'repetido') return '<span class="tag tag-azul" title="Este número já tinha recebido a mensagem nas últimas 24h">Já tinha recebido</span>';
  if (l.wa_status === 'desligado') return '<span class="tag">Envio desligado</span>';
  if (l.wa_status === 'pendente_manual') return '<span class="tag tag-ambar" title="' + esc(l.wa_erro || '') + '">Enviar manualmente</span>';
  if (l.wa_status === 'erro') return '<span class="tag tag-vermelho" title="' + esc(l.wa_erro || '') + '">Falhou</span>';
  return '<span class="tag">—</span>';
}

function bwOrigem(o) {
  o = o || {};
  const partes = [o.utm_source, o.utm_campaign].filter(Boolean);
  return partes.length ? esc(partes.join(' · ')) : '<span class="muted">direto</span>';
}

function bwKpi(rotulo, valor, classe) {
  return '<div class="op-kpi ' + (valor ? (classe || '') : '') + '">' +
    '<div class="rot"><span>' + rotulo + '</span></div>' +
    '<div class="num">' + valor + '</div></div>';
}

function bwDesenha() {
  const r = BW;
  const el = document.getElementById('painel-cmblackfriday');
  if (!el || !r) return;
  const cfg = r.config || {};

  const linhas = r.leads.map(function (l) {
    const podeReenviar = l.wa_status === 'erro' || l.wa_status === 'pendente_manual' || l.wa_status === 'desligado';
    return '<tr>' +
      '<td class="small" style="white-space:nowrap">' + esc(dataBr(l.created_at)) + '</td>' +
      '<td><strong>' + esc(l.nome) + '</strong></td>' +
      '<td style="white-space:nowrap"><a href="https://wa.me/' + esc(l.whatsapp) + '" target="_blank" rel="noopener">' + esc(bwFone(l.whatsapp)) + '</a></td>' +
      '<td class="small">' + esc(l.email) + '</td>' +
      '<td class="small">' + bwOrigem(l.origem) + '</td>' +
      '<td>' + bwEnvioTag(l) +
        (podeReenviar ? ' <button type="button" class="btn btn-sm btn-ghost bw-reenviar" data-id="' + esc(l.id) + '">Enviar agora</button>' : '') + '</td>' +
      '<td><select class="bw-status" data-id="' + esc(l.id) + '" aria-label="Situação de ' + esc(l.nome) + '" style="min-width:132px">' +
        r.status.map(function (s) {
          return '<option value="' + s + '"' + (s === l.status ? ' selected' : '') + '>' + esc(r.status_nome[s]) + '</option>';
        }).join('') + '</select></td>' +
      '</tr>';
  }).join('');

  el.innerHTML =
    (r.aberta ? '' :
      '<div class="alert alert-aviso" style="margin-bottom:16px"><strong>Campanha encerrada.</strong> ' +
      'O prazo terminou em 30/11/2026: a página mostra "Black Week Start encerrada" e o formulário não aceita novos envios.</div>') +
    (r.whatsapp_pronto ? '' :
      '<div class="alert alert-aviso" style="margin-bottom:16px"><strong>WhatsApp não configurado.</strong> ' +
      'Sem a Evolution API ligada, os leads são guardados normalmente, mas a mensagem automática fica como "Enviar manualmente".</div>') +

    '<div class="card">' +
      '<h2>Landing page Black Week Start 2026</h2>' +
      '<p class="sub">É este o link para divulgar nos anúncios e nas redes. Cada formulário enviado aparece na lista abaixo.</p>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">' +
        '<input type="text" id="bw-link" readonly value="' + esc(r.link) + '" style="flex:1 1 280px;min-width:0">' +
        '<button type="button" class="btn btn-sm" id="bw-copiar">Copiar link</button>' +
        '<a class="btn btn-sm btn-ghost" href="/black-week" target="_blank" rel="noopener">Abrir a página</a>' +
      '</div>' +
    '</div>' +

    '<div class="op-kpis" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin-top:16px">' +
      bwKpi('Leads no total', r.totais.total) +
      bwKpi('Leads hoje', r.totais.hoje) +
      bwKpi('Mensagens enviadas', r.totais.wa_enviados) +
      bwKpi('Envios pendentes', r.totais.wa_pendentes) +
    '</div>' +

    '<div class="card" style="margin-top:16px">' +
      '<h2>Mensagem automática de WhatsApp</h2>' +
      '<p class="sub">Enviada para o lead assim que ele preenche o formulário. Use <code>{{primeiro_nome}}</code> ou <code>{{nome}}</code> para personalizar.</p>' +
      '<label class="small" for="bw-msg" style="display:block;margin-bottom:6px">Texto da mensagem</label>' +
      '<textarea id="bw-msg" rows="8" maxlength="2000" style="width:100%">' + esc(cfg.mensagem || '') + '</textarea>' +
      '<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end;margin-top:14px">' +
        '<div style="flex:1 1 240px;min-width:0">' +
          '<label class="small" for="bw-zap" style="display:block;margin-bottom:6px">WhatsApp comercial (aparece no botão "Falar agora" depois do envio)</label>' +
          '<input type="tel" id="bw-zap" placeholder="(13) 99999-9999" value="' + esc(bwFone(cfg.whatsapp_comercial)) + '">' +
        '</div>' +
        '<label style="display:flex;gap:8px;align-items:center;min-height:44px">' +
          '<input type="checkbox" id="bw-ligado"' + (cfg.enviar_whatsapp !== false ? ' checked' : '') + '> Enviar a mensagem automaticamente</label>' +
      '</div>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px">' +
        '<button type="button" class="btn btn-sm" id="bw-salvar">Salvar</button>' +
        '<button type="button" class="btn btn-sm btn-ghost" id="bw-padrao">Voltar ao texto padrão</button>' +
      '</div>' +
    '</div>' +

    '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin:24px 0 10px">' +
      '<div style="font-weight:600">Leads recebidos</div>' +
      '<div style="display:flex;gap:8px">' +
        '<button type="button" class="btn btn-sm btn-ghost" id="bw-atualizar">Atualizar</button>' +
        (r.leads.length ? '<button type="button" class="btn btn-sm btn-ghost" id="bw-csv">Baixar planilha (CSV)</button>' : '') +
      '</div>' +
    '</div>' +
    (r.leads.length
      ? '<div class="card" style="padding:0;overflow:hidden"><div style="overflow-x:auto">' +
          '<table class="tbl" style="min-width:920px"><thead><tr>' +
          '<th>Quando</th><th>Nome</th><th>WhatsApp</th><th>E-mail</th><th>Origem</th><th>Mensagem</th><th>Situação</th>' +
          '</tr></thead><tbody>' + linhas + '</tbody></table></div></div>'
      : '<div class="card" style="text-align:center;padding:44px 24px">' +
          '<div style="font-weight:600;margin-bottom:6px">Nenhum lead ainda</div>' +
          '<div class="small muted">Quando alguém preencher o formulário da página, aparece aqui.</div></div>');

  document.getElementById('bw-copiar').addEventListener('click', function () {
    const campo = document.getElementById('bw-link');
    const feito = function () { toast('Link copiado'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(campo.value).then(feito, function () { campo.select(); });
    } else { campo.select(); document.execCommand('copy'); feito(); }
  });
  document.getElementById('bw-atualizar').addEventListener('click', carregaCmBlackFriday);
  document.getElementById('bw-padrao').addEventListener('click', function () {
    document.getElementById('bw-msg').value = r.mensagem_padrao || '';
  });
  document.getElementById('bw-salvar').addEventListener('click', async function () {
    const btn = this; btn.disabled = true;
    try {
      const s = await bwApi('cm_bw_config', {
        mensagem: document.getElementById('bw-msg').value,
        whatsapp_comercial: document.getElementById('bw-zap').value,
        enviar_whatsapp: document.getElementById('bw-ligado').checked
      });
      BW.config = s.config;
      toast('Configuração salva');
    } catch (e) { toast(e.message, true); }
    btn.disabled = false;
  });
  const csv = document.getElementById('bw-csv');
  if (csv) csv.addEventListener('click', bwBaixaCsv);

  el.querySelectorAll('.bw-status').forEach(function (sel) {
    sel.addEventListener('change', async function () {
      try {
        const s = await bwApi('cm_bw_lead_status', { id: sel.dataset.id, status: sel.value });
        BW.leads = BW.leads.map(function (l) { return l.id === s.lead.id ? s.lead : l; });
        toast('Situação atualizada');
      } catch (e) { toast(e.message, true); carregaCmBlackFriday(); }
    });
  });
  el.querySelectorAll('.bw-reenviar').forEach(function (b) {
    b.addEventListener('click', async function () {
      b.disabled = true;
      try {
        const s = await bwApi('cm_bw_reenviar', { id: b.dataset.id });
        toast(s.envio.status === 'enviado' ? 'Mensagem enviada' : ('Não foi enviada: ' + (s.envio.error || s.envio.status)), s.envio.status !== 'enviado');
        carregaCmBlackFriday();
      } catch (e) { toast(e.message, true); b.disabled = false; }
    });
  });
}

function bwBaixaCsv() {
  // Célula que começa com = + - @ vira fórmula no Excel: um lead
  // malicioso poderia usar o próprio nome para isso. A aspa simples
  // na frente faz a planilha tratar como texto.
  const cel = function (v) {
    let t = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
    return '"' + t.replace(/"/g, '""') + '"';
  };
  const linhas = [['Data', 'Nome', 'WhatsApp', 'E-mail', 'Origem', 'Campanha', 'Botão', 'Mensagem', 'Situação']];
  BW.leads.forEach(function (l) {
    const o = l.origem || {};
    linhas.push([dataBr(l.created_at), l.nome, l.whatsapp, l.email, o.utm_source || '', o.utm_campaign || '',
      o.botao || '', l.wa_status || '', l.status_nome]);
  });
  const texto = '﻿' + linhas.map(function (ln) { return ln.map(cel).join(';'); }).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }));
  a.download = 'leads-black-week-start.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
}

async function carregaCmBlackFriday() {
  const el = document.getElementById('painel-cmblackfriday');
  if (!el) return;
  if (!BW) el.innerHTML = '<div class="card" style="text-align:center;padding:44px 24px"><span class="spinner"></span></div>';
  try {
    BW = await bwApi('cm_bw_leads');
    bwDesenha();
  } catch (e) {
    el.innerHTML = '<div class="alert alert-erro">' + esc(e.message) + '</div>';
  }
}
