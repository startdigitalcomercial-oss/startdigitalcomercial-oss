/* ============================================================
   AVISOS — uma mensagem para o time inteiro
   ============================================================ */
let AVISO_CANAIS = { email: true, whatsapp: true, sms: false };
let AVISO_INFO = null;
let AVISO_FORA = {};      // quem foi tirado do disparo
let AVISO_FILTRO = 'todos';
const MODO_NOME = { presencial: 'Presencial', remoto: 'Remoto', hibrido: 'Híbrido', '': 'não informou' };

// quem sobra depois do filtro de modo de trabalho
function avisoElegiveis() {
  const pes = (AVISO_INFO && AVISO_INFO.pessoas) || [];
  if (AVISO_FILTRO === 'todos') return pes;
  if (AVISO_FILTRO === 'sem') return pes.filter(function (p) { return !p.modo; });
  return pes.filter(function (p) { return p.modo === AVISO_FILTRO; });
}
function avisoSelecionados() {
  return avisoElegiveis().filter(function (p) { return !AVISO_FORA[p.id]; });
}

async function carregaAvisos() {
  const box = document.getElementById('painel-avisos');
  box.innerHTML = '<div class="loading-page">Carregando…</div>';
  let d;
  try { d = await api('broadcast_info'); }
  catch (e) { box.innerHTML = '<div class="alert alert-erro">' + esc(e.message) + '</div>'; return; }
  AVISO_INFO = d;

  const canal = function (id, nome, desc, disponivel) {
    return '<button type="button" class="canal-op' + (AVISO_CANAIS[id] ? ' on' : '') + '" data-canal="' + id + '"' +
      (disponivel ? '' : ' disabled title="canal não configurado"') + '>' +
      '<strong>' + nome + '</strong><span>' + desc + '</span></button>';
  };

  box.innerHTML =
    '<div class="card">' +
      '<h2 style="margin:0 0 4px">Novo aviso</h2>' +
      '<p class="sub" style="margin:0 0 18px">Escreva uma vez e mande para todo o time nos canais que você escolher. ' +
      'Serve para evento, novidade, mudança de rotina — o que for.</p>' +

      '<div class="field"><label for="av-titulo">Título</label>' +
      '<span class="hint">Vira o assunto do e-mail e o negrito do WhatsApp.</span>' +
      '<input type="text" id="av-titulo" maxlength="90" placeholder="Confraternização de fim de ano"></div>' +

      '<div class="field" style="margin-top:14px"><label for="av-msg">Mensagem</label>' +
      '<span class="hint">Pode usar <code>{{primeiro_nome}}</code> para chamar cada um pelo nome.</span>' +
      '<textarea id="av-msg" style="min-height:150px" placeholder="Oi {{primeiro_nome}}! Nossa confraternização vai ser dia 15/12, às 19h…"></textarea>' +
      '<span class="hint" id="av-conta"></span></div>' +

      '<div class="field" style="margin-top:22px"><label>Quem vai receber</label>' +
      '<span class="hint">Filtre pelo jeito de trabalhar e desmarque quem não deve receber.</span>' +
      '<div class="row row-wrap" style="gap:7px;margin:10px 0 12px" id="av-filtros"></div>' +
      '<div class="av-pessoas" id="av-pessoas"></div>' +
      '<div class="row row-wrap" style="gap:12px;margin-top:10px;align-items:center">' +
        '<button type="button" class="btn btn-sm btn-ghost" id="av-todos">Marcar todos</button>' +
        '<button type="button" class="btn btn-sm btn-ghost" id="av-nenhum">Desmarcar todos</button>' +
        '<span class="small muted" id="av-quantos"></span>' +
      '</div></div>' +

      '<div class="field" style="margin-top:20px"><label>Por onde enviar</label>' +
      '<div class="canais-op" style="margin-top:8px">' +
        canal('email', 'E-mail', d.com_email + ' com e-mail', d.providers.email) +
        canal('whatsapp', 'WhatsApp', d.com_telefone + ' com telefone', d.providers.whatsapp) +
        canal('sms', 'SMS', 'custa crédito', d.providers.sms) +
      '</div></div>' +

      '<div class="row row-wrap" style="gap:10px;margin-top:20px;align-items:center">' +
        '<button class="btn btn-sm btn-ghost" id="av-ver">Ver como fica</button>' +
        '<span style="flex:1"></span>' +
        '<span class="small muted" id="av-resumo"></span>' +
        '<button class="btn btn-lg" id="av-enviar">Disparar aviso</button>' +
      '</div>' +
      '<div id="av-saida"></div>' +
    '</div>' +

    (d.historico.length
      ? '<div class="card"><h2 style="font-size:15px;margin:0 0 12px">Avisos já enviados</h2>' +
        '<table class="tbl"><thead><tr><th>Quando</th><th>Título</th><th>Canais</th><th>Resultado</th></tr></thead><tbody>' +
        d.historico.map(function (h) {
          return '<tr><td class="small muted" style="white-space:nowrap">' + dataBr(h.created_at) + '</td>' +
            '<td><strong>' + esc(h.title) + '</strong></td>' +
            '<td class="small">' + (h.channels || []).join(' · ') + '</td>' +
            '<td><span class="tag ' + (h.failed ? 'tag-ambar' : 'tag-verde') + '">' +
            h.sent + ' enviados' + (h.failed ? ' · ' + h.failed + ' falharam' : '') + '</span></td></tr>';
        }).join('') + '</tbody></table></div>'
      : '');

  ligaAvisos(d);
}

function ligaAvisos(d) {
  const b = function (id) { return document.getElementById(id); };

  function resumo() {
    const escolhidos = Object.keys(AVISO_CANAIS).filter(function (k) { return AVISO_CANAIS[k]; });
    const n = avisoSelecionados().length;
    b('av-resumo').textContent = !escolhidos.length
      ? 'escolha um canal'
      : (!n ? 'ninguém marcado' : 'vai para ' + n + (n === 1 ? ' pessoa' : ' pessoas'));
    b('av-enviar').disabled = !escolhidos.length || !n;
  }

  // ---- lista de quem recebe ----
  function desenhaFiltros() {
    const c = [
      ['todos', 'Todos', (d.pessoas || []).length],
      ['presencial', 'Presencial', d.presencial],
      ['remoto', 'Remoto', d.remoto],
      ['hibrido', 'Híbrido', d.hibrido],
      ['sem', 'Não informou', d.sem_modo]
    ].filter(function (x) { return x[0] === 'todos' || x[2] > 0; });
    b('av-filtros').innerHTML = c.map(function (x) {
      return '<button type="button" class="av-filtro' + (AVISO_FILTRO === x[0] ? ' on' : '') + '" ' +
        'data-f="' + x[0] + '">' + esc(x[1]) + ' <b>' + x[2] + '</b></button>';
    }).join('');
    b('av-filtros').querySelectorAll('.av-filtro').forEach(function (bt) {
      bt.addEventListener('click', function () {
        AVISO_FILTRO = bt.dataset.f;
        desenhaFiltros(); desenhaPessoas(); resumo();
      });
    });
  }

  function desenhaPessoas() {
    const lista = avisoElegiveis();
    b('av-pessoas').innerHTML = lista.length
      ? lista.map(function (p) {
          const dentro = !AVISO_FORA[p.id];
          const semContato = !p.email && !p.phone;
          return '<label class="av-pessoa' + (dentro ? ' on' : '') + '">' +
            '<input type="checkbox" data-id="' + esc(p.id) + '"' + (dentro ? ' checked' : '') + '>' +
            '<span class="av-pessoa-nome">' + esc(p.nome) +
              (semContato ? ' <span class="tag tag-ambar">sem contato</span>' : '') + '</span>' +
            '<span class="av-pessoa-tag">' + esc(MODO_NOME[p.modo || '']) +
              (p.area ? ' · ' + esc(p.area) : '') + '</span>' +
          '</label>';
        }).join('')
      : '<p class="small muted" style="margin:0">Ninguém com esse filtro.</p>';

    b('av-pessoas').querySelectorAll('input[type=checkbox]').forEach(function (ch) {
      ch.addEventListener('change', function () {
        if (ch.checked) delete AVISO_FORA[ch.dataset.id];
        else AVISO_FORA[ch.dataset.id] = true;
        ch.closest('.av-pessoa').classList.toggle('on', ch.checked);
        contaPessoas(); resumo();
      });
    });
    contaPessoas();
  }

  function contaPessoas() {
    const n = avisoSelecionados().length, t = avisoElegiveis().length;
    b('av-quantos').textContent = n + ' de ' + t + ' marcado' + (n === 1 ? '' : 's');
  }

  desenhaFiltros();
  desenhaPessoas();

  b('av-todos').addEventListener('click', function () {
    avisoElegiveis().forEach(function (p) { delete AVISO_FORA[p.id]; });
    desenhaPessoas(); resumo();
  });
  b('av-nenhum').addEventListener('click', function () {
    avisoElegiveis().forEach(function (p) { AVISO_FORA[p.id] = true; });
    desenhaPessoas(); resumo();
  });

  function conta() {
    const t = b('av-titulo').value, m = b('av-msg').value;
    if (!AVISO_CANAIS.sms) { b('av-conta').textContent = m.length + ' caracteres'; return; }
    const sms = (t + ': ' + m).replace(/\s+/g, ' ').trim();
    const creditos = sms.length <= 160 ? 1 : Math.ceil(sms.length / 153);
    b('av-conta').innerHTML = m.length + ' caracteres · <strong>no SMS vira ' + sms.length +
      ' caracteres = ' + creditos + ' crédito' + (creditos > 1 ? 's' : '') + ' por pessoa</strong>';
  }

  document.querySelectorAll('.canal-op').forEach(function (bt) {
    bt.addEventListener('click', function () {
      if (bt.disabled) return;
      AVISO_CANAIS[bt.dataset.canal] = !AVISO_CANAIS[bt.dataset.canal];
      bt.classList.toggle('on', AVISO_CANAIS[bt.dataset.canal]);
      resumo(); conta();
    });
  });
  b('av-titulo').addEventListener('input', conta);
  b('av-msg').addEventListener('input', conta);
  resumo(); conta();

  b('av-ver').addEventListener('click', async function () {
    const canais = Object.keys(AVISO_CANAIS).filter(function (k) { return AVISO_CANAIS[k]; });
    try {
      const r = await api('broadcast_preview', {
        body: { title: b('av-titulo').value, message: b('av-msg').value, channels: canais }
      });
      const nomes = { email: 'E-mail', whatsapp: 'WhatsApp', sms: 'SMS' };
      b('av-saida').innerHTML = '<div style="margin-top:18px">' +
        r.itens.map(function (i) {
          return '<div class="caixa-msg" style="margin-bottom:12px">' +
            '<div class="cab-msg"><strong>' + esc(nomes[i.channel]) + '</strong>' +
            (i.subject ? '<span class="small muted">assunto: ' + esc(i.subject) + '</span>' : '') +
            '<span style="flex:1"></span><span class="tag">' + i.body.length + ' caracteres</span></div>' +
            '<div style="white-space:pre-wrap;font-size:14px;line-height:1.55">' + esc(i.body) + '</div></div>';
        }).join('') + '</div>';
    } catch (e) {
      b('av-saida').innerHTML = '<div class="alert alert-erro" style="margin-top:16px">' + esc(e.message) + '</div>';
    }
  });

  b('av-enviar').addEventListener('click', async function () {
    const canais = Object.keys(AVISO_CANAIS).filter(function (k) { return AVISO_CANAIS[k]; });
    const titulo = b('av-titulo').value.trim();
    if (!titulo) return toast('Escreva um título', true);
    if (!b('av-msg').value.trim()) return toast('Escreva a mensagem', true);

    const escolhidas = avisoSelecionados();
    if (!escolhidas.length) return toast('Marque pelo menos uma pessoa', true);

    const nomes = { email: 'e-mail', whatsapp: 'WhatsApp', sms: 'SMS' };
    const primeiros = escolhidas.slice(0, 5).map(function (p) { return p.nome; }).join(', ') +
      (escolhidas.length > 5 ? ' e mais ' + (escolhidas.length - 5) : '');
    const aviso = 'Enviar "' + titulo + '" por ' + canais.map(function (c) { return nomes[c]; }).join(' e ') +
      ' para ' + escolhidas.length + ' pessoa(s)?\n\n' + primeiros +
      (AVISO_CANAIS.sms ? '\n\nO SMS gasta crédito — um por pessoa, no mínimo.' : '');
    if (!confirm(aviso)) return;

    this.disabled = true;
    this.innerHTML = '<span class="spinner"></span> Enviando…';
    b('av-saida').innerHTML = '';
    try {
      const r = await api('broadcast_send', {
        body: {
          title: titulo, message: b('av-msg').value, channels: canais,
          ids: escolhidas.map(function (p) { return p.id; })
        }
      });
      b('av-saida').innerHTML =
        '<div class="alert ' + (r.falhas ? 'alert-aviso' : 'alert-ok') + '" style="margin-top:18px">' +
        '<strong>' + r.enviados + ' mensagem(ns) enviada(s)</strong> para ' + r.pessoas + ' pessoa(s).' +
        (r.falhas ? ' ' + r.falhas + ' não saíram — veja abaixo.' : '') +
        '</div>' +
        (r.falhas
          ? '<table class="tbl" style="margin-top:12px"><thead><tr><th>Pessoa</th><th>Canal</th><th>Motivo</th></tr></thead><tbody>' +
            r.detalhe.filter(function (x) { return x.status !== 'enviado'; }).map(function (x) {
              return '<tr><td>' + esc(x.pessoa) + '</td><td>' + esc(x.canal) + '</td>' +
                '<td class="small muted">' + esc(x.erro || '—') + '</td></tr>';
            }).join('') + '</tbody></table>'
          : '');
      b('av-titulo').value = '';
      b('av-msg').value = '';
      setTimeout(carregaAvisos, 2500);
    } catch (e) {
      b('av-saida').innerHTML = '<div class="alert alert-erro" style="margin-top:16px">' + esc(e.message) + '</div>';
    }
    this.disabled = false;
    this.textContent = 'Disparar aviso';
  });
}
