/* ============================================================
   AJUSTES
   ============================================================ */
/* ---------- teste de SMS (Ajustes) ---------- */
function ligaTesteSms() {
  const b = function (id) { return document.getElementById(id); };
  if (!b('sms-enviar')) return;

  // conta os caracteres e avisa quanto vai custar
  function conta() {
    const t = b('sms-texto').value;
    const n = t.length;
    const creditos = n <= 160 ? 1 : Math.ceil(n / 153);
    const acento = /[àáâãéêíóôõúüç]/i.test(t);
    b('sms-conta').innerHTML = n + ' caracteres · ' + creditos + ' crédito' + (creditos > 1 ? 's' : '') +
      (acento ? ' · <strong style="color:var(--orange)">tem acento — o sistema tira sozinho antes de enviar</strong>' : '');
  }
  b('sms-texto').addEventListener('input', conta);
  conta();

  b('sms-enviar').addEventListener('click', async function () {
    const fone = b('sms-fone').value.trim();
    if (!fone) return toast('Coloque um número com DDD', true);
    this.disabled = true; this.innerHTML = '<span class="spinner"></span> Enviando…';
    b('sms-res').innerHTML = '';
    try {
      const d = await api('sms_teste', { body: { phone: fone, text: b('sms-texto').value } });
      b('sms-res').innerHTML = '<div class="alert alert-ok" style="margin-top:14px">' +
        '<strong>SMS enviado.</strong> Confira o celular — costuma chegar em alguns segundos.' +
        '<div class="small" style="margin-top:6px">Número: <strong>' + esc(String(d.numero || fone)) + '</strong>' +
        (d.rota ? ' · Rota: <strong>' + esc(String(d.rota_nome || d.rota)) + '</strong>' : '') +
        ' · ' + d.creditos + ' crédito' + (d.creditos > 1 ? 's' : '') + '</div></div>';
    } catch (e) {
      b('sms-res').innerHTML = '<div class="alert alert-erro" style="margin-top:14px">' + esc(e.message) + '</div>';
    }
    this.disabled = false; this.textContent = 'Enviar SMS de teste';
  });

  b('sms-entregas').addEventListener('click', async function () {
    this.disabled = true; this.textContent = 'Consultando…';
    try {
      const d = await api('sms_entregas', { params: { dias: 3, limite: 40 } });
      const cor = function (s) {
        const t = String(s || '').toLowerCase();
        if (/entregue|delivered|sucesso/.test(t)) return 'tag-verde';
        if (/fila|pend|enviado|sent|queue/.test(t)) return 'tag-ambar';
        return 'tag-vermelho';
      };
      b('sms-res').innerHTML = '<div class="card" style="margin-top:14px">' +
        '<div class="row" style="justify-content:space-between;align-items:baseline">' +
          '<h3 style="font-size:13.5px;margin:0">O que a Comtele diz sobre a entrega</h3>' +
          (d.saldo !== null && d.saldo !== undefined
            ? '<span class="small muted">saldo: <strong>R$ ' + String(d.saldo).replace('.', ',') + '</strong></span>' : '') +
        '</div>' +
        (d.mensagens.length
          ? '<table class="tbl" style="margin-top:12px"><thead><tr><th>Quando</th><th>Número</th>' +
            '<th>Situação</th><th>Motivo</th></tr></thead><tbody>' +
            d.mensagens.map(function (m) {
              return '<tr><td class="small muted">' + esc(m.quando ? dataBr(m.quando) : '—') + '</td>' +
                '<td>' + esc(m.numero) + '</td>' +
                '<td><span class="tag ' + cor(m.situacao) + '">' + esc(m.situacao) + '</span></td>' +
                '<td class="small muted">' + esc(m.detalhe || '—') + '</td></tr>';
            }).join('') + '</tbody></table>'
          : '<p class="small muted" style="margin:12px 0 0">A Comtele não tem nenhum envio registrado desde ' +
            esc(d.desde) + '. Se o sistema disse "enviado" e aqui não aparece nada, a mensagem foi descartada ' +
            'antes de entrar na fila deles.</p>') +
        '</div>';
    } catch (e) {
      b('sms-res').innerHTML = '<div class="alert alert-erro" style="margin-top:14px">' + esc(e.message) + '</div>';
    }
    this.disabled = false; this.textContent = 'Ver entregas';
  });

  b('sms-rotas').addEventListener('click', async function () {
    this.disabled = true;
    try {
      const d = await api('sms_rotas');
      b('sms-res').innerHTML = '<div class="card" style="margin-top:14px">' +
        '<h3 style="font-size:13.5px;margin:0 0 10px">Rotas liberadas na sua conta</h3>' +
        '<table class="tbl"><thead><tr><th>Rota</th><th>Preço</th><th>Nº</th><th></th></tr></thead><tbody>' +
        d.rotas.map(function (r) {
          const usada = r.id === d.escolhida;
          return '<tr><td>' + esc(r.displayName || r.productName || '—') + '</td>' +
            '<td>R$ ' + Number(r.farePrice || 0).toFixed(4).replace('.', ',') + '</td>' +
            '<td class="muted">' + esc(String(r.id)) + '</td>' +
            '<td>' + (usada ? '<span class="tag tag-verde">em uso</span>' : '') + '</td></tr>';
        }).join('') + '</tbody></table>' +
        '<p class="small muted" style="margin:12px 0 0">O sistema usa a rota <strong>Premium</strong> por padrão — ' +
        'entrega melhor, e mensagem de processo seletivo não pode sumir. Para forçar outra, crie a variável ' +
        '<code>COMTELE_ROUTE</code> na Vercel com o número da rota.</p></div>';
    } catch (e) {
      b('sms-res').innerHTML = '<div class="alert alert-erro" style="margin-top:14px">' + esc(e.message) + '</div>';
    }
    this.disabled = false;
  });
}

async function carregaAjustes() {
  const box = document.getElementById('painel-ajustes');
  box.innerHTML = '<div class="loading-page">Carregando…</div>';
  const d = await api('settings');
  const f = d.form || {}, c = d.company || {}, w = d.whatsapp || {}, L = d.landing || {};
  const p = d.providers || {};
  box.innerHTML =
    '<div class="card"><h2>Formulário público</h2>' +
    '<p class="sub">Endereço para divulgar: <a href="' + esc((d.app_url || location.origin) + '/vaga') + '" target="_blank">' + esc((d.app_url || location.origin) + '/vaga') + '</a></p>' +
    '<div class="field"><label>Título</label><input type="text" id="f-head" value="' + esc(f.headline || '') + '"></div>' +
    '<div class="field" style="margin-top:10px"><label>Texto de apoio</label><textarea id="f-sub" style="min-height:70px">' + esc(f.subhead || '') + '</textarea></div>' +
    '<div class="field" style="margin-top:10px"><label>Vagas disponíveis</label><span class="hint">Uma por linha.</span>' +
    '<textarea id="f-roles" style="min-height:110px">' + esc((f.roles || []).join('\n')) + '</textarea></div>' +
    '<div class="row" style="margin-top:12px"><button class="btn btn-sm" id="btn-form-salvar">Salvar</button>' +
    '<label class="row small" style="gap:6px"><input type="checkbox" id="f-open" ' + (f.open !== false ? 'checked' : '') + ' style="width:16px;height:16px"> inscrições abertas</label></div>' +
    '</div>' +

    // ---------- landing page ----------
    '<div class="card"><h2>Landing page de vagas</h2>' +
    '<p class="sub">É a página que você divulga: <a href="' + esc((d.app_url || location.origin) + '/vagas') +
      '" target="_blank">' + esc((d.app_url || location.origin) + '/vagas') + '</a><br>' +
      'As vagas em si você cadastra no menu <strong>Vagas</strong>.</p>' +

    '<div class="field"><label>WhatsApp que recebe os candidatos</label>' +
    '<span class="hint">Só números, com DDI e DDD. Ex.: 5513996003897. É para este número que o botão da vaga leva — ' +
    'e é nele que a Aurea precisa estar conectada.</span>' +
    '<input type="text" id="l-zap" value="' + esc(L.whatsapp || '') + '" placeholder="5513996003897"></div>' +

    '<hr class="sep"><h3 style="font-size:14px;margin:0 0 4px">Topo da página</h3>' +
    '<p class="small muted" style="margin:0 0 12px">O título fica em três pedaços. O do meio sai colorido.</p>' +
    '<div class="field"><label>Selo</label><input type="text" id="l-badge" value="' + esc(L.badge || '') + '" placeholder="Estamos contratando"></div>' +
    '<div class="grid grid-3" style="gap:12px;margin-top:12px">' +
      '<div class="field"><label>Título — 1ª linha</label><input type="text" id="l-h1" value="' + esc(L.headline_1 || '') + '"></div>' +
      '<div class="field"><label>Palavra colorida</label><input type="text" id="l-hd" value="' + esc(L.headline_destaque || '') + '"></div>' +
      '<div class="field"><label>Título — última linha</label><input type="text" id="l-h2" value="' + esc(L.headline_2 || '') + '"></div>' +
    '</div>' +
    '<div class="field" style="margin-top:12px"><label>Frase de apoio</label>' +
    '<input type="text" id="l-sub" value="' + esc(L.sub || '') + '"></div>' +

    '<hr class="sep"><h3 style="font-size:14px;margin:0 0 12px">Bloco "Sobre a Start"</h3>' +
    '<div class="grid grid-3" style="gap:12px">' +
      '<div class="field"><label>1ª parte</label><input type="text" id="l-s1" value="' + esc(L.sobre_titulo_1 || '') + '"></div>' +
      '<div class="field"><label>Parte colorida</label><input type="text" id="l-sd" value="' + esc(L.sobre_destaque || '') + '"></div>' +
      '<div class="field"><label>Última parte</label><input type="text" id="l-s2" value="' + esc(L.sobre_titulo_2 || '') + '"></div>' +
    '</div>' +
    '<div class="field" style="margin-top:12px"><label>Texto</label>' +
    '<span class="hint">Deixe uma linha em branco entre um parágrafo e outro.</span>' +
    '<textarea id="l-stexto" style="min-height:130px">' + esc(L.sobre_texto || '') + '</textarea></div>' +
    '<div class="row" style="margin-top:14px"><button class="btn btn-sm" id="btn-landing-salvar">Salvar a landing</button></div>' +
    '</div>' +

    '<div class="card"><h2>Canais de envio</h2>' +
    '<table class="tbl"><tbody>' +
    '<tr><td>E-mail (Resend)</td><td><span class="tag ' + (p.email ? 'tag-verde' : 'tag-ambar') + '">' + (p.email ? 'configurado' : 'falta RESEND_API_KEY') + '</span></td></tr>' +
    '<tr><td>WhatsApp (Evolution)</td><td><span class="tag ' + (p.whatsapp ? 'tag-verde' : 'tag-ambar') + '">' + (p.whatsapp ? 'configurado' : 'faltam EVOLUTION_API_URL / KEY') + '</span></td></tr>' +
    '<tr><td>SMS' + (p.sms_provider ? ' (' + esc(p.sms_provider) + ')' : '') + '</td><td><span class="tag ' + (p.sms ? 'tag-verde' : 'tag-ambar') + '">' +
      (p.sms ? 'configurado' : 'sem provedor — envio manual') + '</span></td></tr>' +
    '</tbody></table>' +
    (p.sms
      ? '<hr class="sep">' +
        '<h3 style="font-size:13.5px;margin:0 0 4px">Testar o SMS</h3>' +
        '<p class="small muted" style="margin:0 0 12px">Manda uma mensagem de verdade e gasta 1 crédito. ' +
        'Use o seu próprio número.</p>' +
        '<div class="field" style="max-width:340px"><label>Número com DDD</label>' +
        '<input type="tel" id="sms-fone" placeholder="(13) 99600-3897"></div>' +
        '<div class="field" style="margin-top:10px"><label>Mensagem</label>' +
        '<span class="hint">Sem acento, até 160 caracteres. Acima disso, cada 153 caracteres custa 1 crédito a mais.</span>' +
        '<textarea id="sms-texto" style="min-height:64px" maxlength="460">StartDigital: teste do sistema de RH. Se voce recebeu, o SMS esta funcionando.</textarea>' +
        '<span class="hint" id="sms-conta"></span></div>' +
        '<div class="row row-wrap" style="gap:10px;margin-top:12px">' +
          '<button class="btn btn-sm" id="sms-enviar">Enviar SMS de teste</button>' +
          '<button class="btn btn-sm btn-ghost" id="sms-entregas">Ver entregas</button>' +
          '<button class="btn btn-sm btn-ghost" id="sms-rotas">Ver rotas da conta</button>' +
        '</div><div id="sms-res"></div>'
      : '<p class="small muted" style="margin:12px 0 0">Para ligar o SMS: coloque <code>COMTELE_API_KEY</code> nas variáveis ' +
        'de ambiente da Vercel e faça <strong>Redeploy</strong>. Esta linha vira verde sozinha quando o sistema enxergar a chave.') +
    '</div>' +

    '<div class="card"><h2>Segurança</h2>' +
    '<p class="sub" style="margin:2px 0 16px">A sessão de quem entra no painel vale 12 horas. ' +
    'Depois de 5 senhas erradas seguidas, o sistema trava aquela origem por 15 minutos.</p>' +
    '<div class="row row-wrap" style="gap:10px;align-items:center">' +
      '<button class="btn btn-sm btn-ghost" id="btn-sair-todos" style="color:var(--red)">Encerrar todas as sessões</button>' +
      '<span class="small muted">Desconecta todo mundo, inclusive você. Use se uma senha vazar ou alguém sair do time.</span>' +
    '</div></div>' +

    '<div class="card" id="card-wa"><h2>WhatsApp</h2>' +
    '<p class="sub">Conecte o número escaneando o QR code aqui mesmo. O sistema também liga o webhook sozinho, ' +
    'para a Aurea conseguir <strong>receber</strong> as respostas.</p>' +
    '<div id="wa-area"><div class="loading-page" style="padding:30px">Verificando…</div></div></div>' +

    '<div class="card"><h2>Últimos envios</h2><div id="tab-logs" class="small muted">carregando…</div></div>';

  document.getElementById('btn-form-salvar').addEventListener('click', async function () {
    try {
      await api('settings_save', {
        body: {
          key: 'form', value: {
            headline: document.getElementById('f-head').value,
            subhead: document.getElementById('f-sub').value,
            roles: document.getElementById('f-roles').value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean),
            open: document.getElementById('f-open').checked
          }
        }
      });
      toast('Formulário salvo');
    } catch (e) { toast(e.message, true); }
  });
  document.getElementById('btn-landing-salvar').addEventListener('click', async function () {
    const v = function (i) { return document.getElementById(i).value.trim(); };
    const zap = v('l-zap').replace(/\D/g, '');
    if (zap && zap.length < 12) return toast('O WhatsApp precisa do DDI e do DDD. Ex.: 5513996003897', true);
    this.disabled = true;
    try {
      await api('settings_save', {
        body: {
          key: 'landing', value: {
            whatsapp: zap, badge: v('l-badge'),
            headline_1: v('l-h1'), headline_destaque: v('l-hd'), headline_2: v('l-h2'), sub: v('l-sub'),
            sobre_titulo_1: v('l-s1'), sobre_destaque: v('l-sd'), sobre_titulo_2: v('l-s2'),
            sobre_texto: document.getElementById('l-stexto').value
          }
        }
      });
      toast('Landing salva');
    } catch (e) { toast(e.message, true); }
    this.disabled = false;
  });

  document.getElementById('btn-sair-todos').addEventListener('click', async function () {
    if (!confirm('Encerrar TODAS as sessões abertas?\n\nTodo mundo que está usando o painel agora vai ' +
      'cair na tela de login, inclusive você. Ninguém perde dado nenhum — é só precisar entrar de novo.')) return;
    try {
      await api('logout_todos', { body: {} });
      alert('Pronto. Todas as sessões foram encerradas.');
      sair();
    } catch (e) { toast(e.message, true); }
  });

  ligaTesteSms();
  carregaWhatsApp();

  try {
    const l = await api('logs', { params: { limit: 40 } });
    document.getElementById('tab-logs').innerHTML = l.logs.length
      ? '<table class="tbl"><thead><tr><th>Quando</th><th>Candidato</th><th>Canal</th><th>Situação</th></tr></thead><tbody>' +
        l.logs.map(function (g) {
          const cls = g.status === 'enviado' ? 'tag-verde' : (g.status === 'erro' ? 'tag-vermelho' : 'tag-ambar');
          return '<tr><td style="white-space:nowrap">' + dataBr(g.created_at) + '</td><td>' + esc(g.candidate_name) + '</td>' +
            '<td>' + esc(g.channel) + '</td><td><span class="tag ' + cls + '">' + esc(g.status) + '</span>' +
            (g.error ? '<div class="small muted">' + esc(g.error) + '</div>' : '') + '</td></tr>';
        }).join('') + '</tbody></table>'
      : 'Nenhum envio ainda.';
  } catch (e) { document.getElementById('tab-logs').textContent = e.message; }
}
