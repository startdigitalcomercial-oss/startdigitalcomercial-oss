/* ============================================================
   WHATSAPP — conectar por QR code
   ============================================================ */
let WA_TIMER = null;

async function carregaWhatsApp() {
  const box = document.getElementById('wa-area');
  if (!box) return;
  let d;
  try { d = await api('wa_status'); }
  catch (e) { box.innerHTML = '<div class="alert alert-erro" style="margin:0">' + esc(e.message) + '</div>'; return; }

  if (!d.configurada) {
    box.innerHTML = '<div class="alert alert-aviso" style="margin:0">' +
      'Faltam as variáveis <code>EVOLUTION_API_URL</code> e <code>EVOLUTION_API_KEY</code> na Vercel. ' +
      'Depois de colocar, faça Redeploy e volte aqui.</div>';
    return;
  }

  const conectada = d.estado && d.estado.conectada;
  const inst = d.escolhida || '';
  const rotEstado = { open: ['tag-verde', 'conectado'], connecting: ['tag-ambar', 'conectando'], close: ['tag-vermelho', 'desconectado'] };
  const e = d.estado ? (rotEstado[d.estado.estado] || ['tag', d.estado.estado]) : null;

  box.innerHTML =
    '<div class="row row-wrap" style="gap:10px;margin-bottom:16px">' +
      (inst ? '<span class="tag">instância: <strong style="margin-left:4px">' + esc(inst) + '</strong></span>' : '') +
      (e ? '<span class="tag ' + e[0] + '">' + e[1] + '</span>' : '') +
    '</div>' +

    (conectada
      ? '<div class="alert alert-ok"><strong>WhatsApp conectado.</strong> A Aurea já pode falar com os candidatos por este número.</div>' +
        '<div class="field" style="max-width:340px"><label>Mandar uma mensagem de teste</label>' +
        '<span class="hint">Coloque o número com DDD para conferir se chega.</span>' +
        '<input type="tel" id="wa-teste-fone" placeholder="(11) 91234-5678"></div>' +
        '<div class="row row-wrap" style="gap:10px;margin-top:14px">' +
          '<button class="btn btn-sm" id="wa-testar">Enviar teste</button>' +
          '<button class="btn btn-sm btn-ghost" id="wa-diag">Diagnóstico completo</button>' +
          '<span style="flex:1"></span>' +
          '<button class="btn btn-sm btn-ghost" id="wa-webhook">Reconfigurar webhook</button>' +
          '<button class="btn btn-sm btn-ghost" id="wa-sair">Desconectar</button>' +
        '</div><div id="wa-teste-res"></div>'

      : '<p class="small muted" style="margin:0 0 14px">Abra o WhatsApp no celular → <strong>Aparelhos conectados</strong> → ' +
        '<strong>Conectar um aparelho</strong> e aponte para o código. ' +
        'O código vence em poucos segundos — o sistema troca por um novo sozinho, você não precisa clicar de novo.</p>' +
        '<div class="row row-wrap" style="gap:10px;align-items:center">' +
          '<button class="btn" id="wa-conectar">Gerar QR code</button>' +
          '<button class="btn btn-ghost btn-sm" id="wa-recriar">Recomeçar do zero</button>' +
          '<input type="hidden" id="wa-nome" value="' + esc(inst || 'start-rh') + '">' +
        '</div><div id="wa-qr"></div>') +

    '<hr class="sep">' +
    '<p class="small muted" style="margin:0">Endereço do webhook (o sistema configura sozinho, isto é só para conferência):<br>' +
    '<span style="font-family:ui-monospace,monospace;font-size:12px;word-break:break-all">' + esc(d.webhook_url) + '</span></p>' +

    ((d.sobrando || []).length
      ? '<hr class="sep"><div class="alert alert-aviso" style="margin:0">' +
        '<strong>Sobrou ' + d.sobrando.length + ' instância' + (d.sobrando.length > 1 ? 's' : '') + ' antiga' + (d.sobrando.length > 1 ? 's' : '') + ' na Evolution.</strong> ' +
        'O sistema usa só uma. As outras ficam ocupando espaço: ' +
        d.sobrando.map(function (i) { return '<code>' + esc(i.name) + '</code>'; }).join(', ') +
        '<div style="margin-top:10px"><button class="btn btn-sm" id="wa-limpar">Apagar as outras</button></div></div>'
      : '');

  ligaWhatsApp(inst);
}

function ligaWhatsApp(inst) {
  const b = function (id) { return document.getElementById(id); };

  async function abreQr(acao, btn, rotulo) {
    const nome = b('wa-nome') ? b('wa-nome').value.trim() : inst;
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Gerando…';
    try {
      const r = await api(acao, { body: { instance: nome } });
      if (r.ja_conectada) { toast('Este número já está conectado'); return carregaWhatsApp(); }
      if (!r.base64) throw new Error('A Evolution não devolveu o QR code. Clique em "Recomeçar do zero".');
      desenhaQr(r);
      vigiaConexao(nome);
    } catch (e) {
      b('wa-qr').innerHTML = '<div class="alert alert-erro" style="margin-top:14px">' + esc(e.message) + '</div>';
    }
    btn.disabled = false; btn.textContent = rotulo;
  }

  if (b('wa-conectar')) {
    b('wa-conectar').addEventListener('click', function () {
      abreQr('wa_conectar', this, 'Gerar QR code');
    });
  }

  if (b('wa-recriar')) {
    b('wa-recriar').addEventListener('click', function () {
      if (!confirm('Isto apaga a instância na Evolution e cria uma nova, limpinha. É o que resolve quando o QR code não conecta de jeito nenhum. Continuar?')) return;
      abreQr('wa_recriar', this, 'Recomeçar do zero');
    });
  }

  if (b('wa-limpar')) {
    b('wa-limpar').addEventListener('click', async function () {
      if (!confirm('Apagar as outras instâncias da Evolution? Só a que o sistema usa continua.')) return;
      this.disabled = true; this.innerHTML = '<span class="spinner"></span> Apagando…';
      try {
        const r = await api('wa_limpar', { body: {} });
        toast(r.apagadas.length + ' instância(s) apagada(s)');
        if (r.falhas && r.falhas.length) toast('Não deu para apagar: ' + r.falhas.map(function (f) { return f.nome; }).join(', '), true);
        carregaWhatsApp();
      } catch (e) { toast(e.message, true); this.disabled = false; this.textContent = 'Apagar as outras'; }
    });
  }

  if (b('wa-testar')) {
    b('wa-testar').addEventListener('click', async function () {
      const fone = b('wa-teste-fone').value.trim();
      if (!fone) return toast('Coloque um número', true);
      this.disabled = true;
      try {
        await api('wa_teste', { body: { phone: fone } });
        b('wa-teste-res').innerHTML = '<div class="alert alert-ok" style="margin-top:14px">Mensagem enviada. Confira o celular.</div>';
      } catch (e) {
        b('wa-teste-res').innerHTML = '<div class="alert alert-erro" style="margin-top:14px">' + esc(e.message) + '</div>';
      }
      this.disabled = false;
    });
  }

  if (b('wa-diag')) {
    b('wa-diag').addEventListener('click', async function () {
      const fone = b('wa-teste-fone').value.trim();
      if (!fone) return toast('Coloque o número que está dando problema', true);
      this.disabled = true; this.textContent = 'Checando…';
      b('wa-teste-res').innerHTML = '<div class="loading-page" style="padding:20px">Rodando os testes…</div>';
      try {
        const d = await api('wa_diagnostico', { body: { phone: fone } });
        b('wa-teste-res').innerHTML =
          '<div class="card" style="margin-top:14px"><h3 style="font-size:13.5px;margin:0 0 12px">Resultado do diagnóstico</h3>' +
          d.passos.map(function (p) {
            return '<div class="row" style="gap:10px;padding:7px 0;border-top:1px solid var(--hairline)">' +
              '<span style="font-weight:600;color:' + (p.ok ? 'var(--ok,#00a15c)' : 'var(--erro,#d13b3b)') + '">' +
              (p.ok ? '✓' : '✕') + '</span>' +
              '<span style="min-width:170px">' + esc(p.passo) + '</span>' +
              '<span class="small muted" style="word-break:break-all">' + esc(String(p.detalhe)) + '</span></div>';
          }).join('') +
          '<p class="small muted" style="margin:12px 0 0">Endereço que o sistema está usando nos links: <strong>' +
          esc(d.base || '(não descoberto)') + '</strong></p></div>';
      } catch (e) {
        b('wa-teste-res').innerHTML = '<div class="alert alert-erro" style="margin-top:14px">' + esc(e.message) + '</div>';
      }
      this.disabled = false; this.textContent = 'Diagnóstico completo';
    });
  }

  if (b('wa-webhook')) {
    b('wa-webhook').addEventListener('click', async function () {
      try { await api('wa_webhook', { body: {} }); toast('Webhook reconfigurado'); }
      catch (e) { toast(e.message, true); }
    });
  }

  if (b('wa-sair')) {
    b('wa-sair').addEventListener('click', async function () {
      if (!confirm('Desconectar este número do sistema? A Aurea para de mandar mensagem até você conectar de novo.')) return;
      try { await api('wa_desconectar', { body: {} }); toast('Desconectado'); carregaWhatsApp(); }
      catch (e) { toast(e.message, true); }
    });
  }

}

// desenha (ou troca) a imagem do QR code na tela
function desenhaQr(r) {
  const alvo = document.getElementById('wa-qr');
  if (!alvo) return;
  const img = r.base64.indexOf('data:') === 0 ? r.base64 : 'data:image/png;base64,' + r.base64;
  const antiga = document.getElementById('wa-qr-img');

  // se o QR já está na tela, só troca a figura — sem piscar o resto
  if (antiga) {
    antiga.src = img;
    const p = document.getElementById('wa-pairing');
    if (p && r.pairingCode) p.innerHTML = 'Se preferir, use o código de pareamento: <strong style="font-size:16px;letter-spacing:2px">' + esc(r.pairingCode) + '</strong>';
    return;
  }

  alvo.innerHTML =
    '<div class="qr-box">' +
      '<img id="wa-qr-img" src="' + img + '" alt="QR code do WhatsApp">' +
      '<div class="qr-passos">' +
        '<h4>Escaneie com o WhatsApp do número da Start</h4>' +
        '<ol>' +
          '<li>Abra o WhatsApp no celular</li>' +
          '<li>Toque nos três pontinhos → <strong>Aparelhos conectados</strong></li>' +
          '<li>Toque em <strong>Conectar um aparelho</strong></li>' +
          '<li>Aponte a câmera para este código</li>' +
        '</ol>' +
        '<p class="small" id="wa-pairing">' + (r.pairingCode ? 'Se preferir, use o código de pareamento: <strong style="font-size:16px;letter-spacing:2px">' + esc(r.pairingCode) + '</strong>' : '') + '</p>' +
        '<p class="small muted" id="wa-espera">Esperando você escanear… o código se renova sozinho, pode ficar com a câmera apontada.</p>' +
        (r.webhook_ok === false
          ? '<p class="small" style="color:var(--orange)">Não consegui configurar o webhook sozinho: ' + esc(r.webhook_erro || '') + '</p>'
          : '<p class="small" style="color:var(--accent)">Webhook configurado automaticamente.</p>') +
      '</div>' +
    '</div>';
}

// Fica olhando se conectou. E, o mais importante: TROCA O QR sozinho.
// O código da Evolution vence em menos de 1 minuto — era por isso que
// escanear não funcionava: a pessoa lia um código já morto.
function vigiaConexao(nome) {
  clearInterval(WA_TIMER);
  let tentativas = 0;
  WA_TIMER = setInterval(async function () {
    tentativas++;

    // 5 minutos de paciência (100 voltas de 3s)
    if (tentativas > 100) {
      clearInterval(WA_TIMER);
      const el = document.getElementById('wa-espera');
      if (el) {
        el.innerHTML = 'Passaram 5 minutos sem conectar. Clique em <strong>Recomeçar do zero</strong> — ' +
          'isso apaga a instância travada e cria uma nova.';
      }
      return;
    }

    // a cada 8 voltas (24 segundos) pede um código novo
    if (tentativas % 8 === 0) {
      try {
        const q = await api('wa_qr', { params: { instance: nome } });
        if (q.ja_conectada) {
          clearInterval(WA_TIMER); toast('WhatsApp conectado!'); return carregaWhatsApp();
        }
        if (q.base64) desenhaQr(q);
      } catch (e) { /* tenta na proxima volta */ }
    }

    try {
      const r = await api('wa_estado', { params: { instance: nome } });
      if (r.conectada) {
        clearInterval(WA_TIMER);
        toast('WhatsApp conectado!');
        carregaWhatsApp();
      }
    } catch (e) { /* segue tentando */ }
  }, 3000);
}
