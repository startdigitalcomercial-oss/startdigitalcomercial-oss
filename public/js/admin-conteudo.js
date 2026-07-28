/* ============================================================
   CONTEUDO (modulos e aulas)
   ============================================================ */
// lembra quais módulos estão abertos na sanfona
const ABERTOS_MOD = {};

async function carregaConteudo() {
  const box = document.getElementById('lista-conteudo');
  box.innerHTML = '<div class="loading-page">Carregando…</div>';
  const d = await api('content');
  box.innerHTML = d.modules.map(function (m) {
    const aberto = ABERTOS_MOD[m.id] === true;
    const n = m.lessons.length;
    return '<div class="card sanfona' + (aberto ? ' aberto' : '') + '" data-mod="' + esc(m.id) + '">' +
      '<div class="row" style="align-items:flex-start">' +
      '<button type="button" class="mod-pega" title="Arraste para mudar a ordem (ou use as setas ↑ ↓ do teclado)" aria-label="Mudar a ordem deste módulo">' +
        '<svg viewBox="0 0 24 24" width="17" height="17" style="fill:currentColor;stroke:none">' +
          '<circle cx="9.5" cy="6.5" r="1.5"/><circle cx="14.5" cy="6.5" r="1.5"/>' +
          '<circle cx="9.5" cy="12" r="1.5"/><circle cx="14.5" cy="12" r="1.5"/>' +
          '<circle cx="9.5" cy="17.5" r="1.5"/><circle cx="14.5" cy="17.5" r="1.5"/>' +
        '</svg>' +
      '</button>' +
      '<button type="button" class="mod-toggle" aria-expanded="' + (aberto ? 'true' : 'false') + '" title="abrir/fechar módulo">' +
        '<svg class="seta" viewBox="0 0 24 24" width="16" height="16" style="stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><path d="m9 6 6 6-6 6"/></svg>' +
      '</button>' +
      '<div style="flex:1"><input type="text" class="mod-titulo" data-id="' + m.id + '" value="' + esc(m.title) + '" style="font-weight:700;font-size:15px;border-color:transparent;background:transparent;padding:4px 6px">' +
      '<input type="text" class="mod-desc" data-id="' + m.id + '" value="' + esc(m.description || '') + '" placeholder="descrição do módulo" style="font-size:13px;color:var(--cinza);border-color:transparent;background:transparent;padding:4px 6px">' +
      '</div>' +
      '<span class="tag" style="align-self:center">' + n + (n === 1 ? ' aula' : ' aulas') + '</span>' +
      '<button class="btn btn-sm btn-ghost salvar-mod" data-id="' + m.id + '">Salvar</button>' +
      '<button class="btn btn-sm btn-ghost del-mod" data-id="' + m.id + '" title="excluir módulo">' + ICO.lixo(14) + '</button>' +
      '</div>' +
      '<div class="mod-corpo"><div>' +
        '<hr class="sep" style="margin:14px 0">' +
        (n ? m.lessons.map(aulaHtml).join('') : '<p class="small muted" style="margin:0 0 12px">Nenhuma aula neste módulo ainda.</p>') +
        '<button class="btn btn-sm nova-aula" data-mod="' + m.id + '">+ Adicionar aula</button>' +
      '</div></div>' +
      '</div>';
  }).join('') || '<div class="card"><p class="sub" style="margin:0">Nenhum módulo criado. Clique em “Novo módulo”.</p></div>';
  ligaConteudo();
}

function aulaHtml(l) {
  const mats = Array.isArray(l.materials) ? l.materials : [];
  return '<div class="item" data-aula="' + l.id + '">' +
    '<div class="grid grid-2" style="gap:10px">' +
    '<div class="field"><label>Título da aula</label><input type="text" class="au-titulo" value="' + esc(l.title) + '"></div>' +
    '<div class="field"><label>Duração (texto livre)</label><input type="text" class="au-dur" value="' + esc(l.duration || '') + '" placeholder="12 min"></div>' +
    '</div>' +
    '<div class="field" style="margin-top:10px"><label>Link do vídeo</label>' +
    '<span class="hint">YouTube, Vimeo, Loom, Google Drive ou link direto .mp4</span>' +
    '<input type="text" class="au-video" value="' + esc(l.video_url || '') + '" placeholder="https://…"></div>' +
    '<div class="field" style="margin-top:10px"><label>Descrição</label><textarea class="au-desc" style="min-height:70px">' + esc(l.description || '') + '</textarea></div>' +
    '<div class="field" style="margin-top:10px"><label>Material complementar</label>' +
    '<span class="hint">Um por linha, no formato: Nome do material | https://link</span>' +
    '<textarea class="au-mats" style="min-height:70px" placeholder="Apostila de boas-vindas | https://…">' +
    esc(mats.map(function (mt) { return (mt.label || '') + ' | ' + (mt.url || ''); }).join('\n')) + '</textarea></div>' +
    '<div class="row row-wrap" style="margin-top:12px">' +
    '<button class="btn btn-sm salvar-aula" data-id="' + l.id + '">Salvar aula</button>' +
    '<label class="row small" style="gap:6px"><input type="checkbox" class="au-pub" ' + (l.published ? 'checked' : '') + ' style="width:16px;height:16px"> publicada</label>' +
    '<span style="flex:1"></span>' +
    '<button class="btn btn-sm btn-ghost del-aula" data-id="' + l.id + '">Excluir aula</button>' +
    '</div></div>';
}

function leMateriais(txt) {
  return String(txt || '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) {
    const p = l.split('|');
    const url = (p[1] || p[0] || '').trim();
    const label = p.length > 1 ? p[0].trim() : 'Material';
    return { label: label, url: url };
  }).filter(function (m) { return m.url; });
}

/* ---------- arrastar módulos para mudar a ordem ---------- */
// Guarda a ordem no banco. Chamado depois de soltar o módulo no lugar novo.
let SALVANDO_ORDEM = false;
async function salvaOrdemModulos() {
  const caixa = document.getElementById('lista-conteudo');
  const ids = [...caixa.querySelectorAll('.sanfona')].map(function (c) { return c.dataset.mod; });
  if (!ids.length || SALVANDO_ORDEM) return;
  SALVANDO_ORDEM = true;
  try { await api('module_reorder', { body: { ids: ids } }); toast('Ordem salva'); }
  catch (e) { toast(e.message, true); carregaConteudo(); }
  SALVANDO_ORDEM = false;
}

function ligaArrasteModulos() {
  const caixa = document.getElementById('lista-conteudo');
  if (!caixa) return;
  let arrastando = null;

  caixa.querySelectorAll('.sanfona').forEach(function (card) {
    const pega = card.querySelector('.mod-pega');
    if (!pega) return;

    // o card só vira "arrastável" quando a pessoa segura a alça —
    // assim dá para selecionar texto nos campos normalmente
    pega.addEventListener('mousedown', function () { card.draggable = true; });
    pega.addEventListener('touchstart', function () { card.draggable = true; }, { passive: true });
    card.addEventListener('mouseup', function () { card.draggable = false; });

    card.addEventListener('dragstart', function (ev) {
      arrastando = card;
      card.classList.add('arrastando');
      try { ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', card.dataset.mod); } catch (e) { }
    });

    card.addEventListener('dragend', function () {
      card.classList.remove('arrastando');
      card.draggable = false;
      caixa.querySelectorAll('.sanfona').forEach(function (c) { c.classList.remove('alvo-cima', 'alvo-baixo'); });
      arrastando = null;
      salvaOrdemModulos();
    });

    card.addEventListener('dragover', function (ev) {
      if (!arrastando || arrastando === card) return;
      ev.preventDefault();
      const r = card.getBoundingClientRect();
      const emCima = ev.clientY < r.top + r.height / 2;
      card.classList.toggle('alvo-cima', emCima);
      card.classList.toggle('alvo-baixo', !emCima);
      // move de verdade enquanto arrasta, para a pessoa ver onde vai cair
      if (emCima) caixa.insertBefore(arrastando, card);
      else caixa.insertBefore(arrastando, card.nextSibling);
    });

    card.addEventListener('dragleave', function () {
      card.classList.remove('alvo-cima', 'alvo-baixo');
    });

    card.addEventListener('drop', function (ev) { ev.preventDefault(); });

    // sem mouse: com a alça focada, as setas do teclado sobem e descem o módulo
    pega.addEventListener('keydown', function (ev) {
      if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
      ev.preventDefault();
      const irrmao = ev.key === 'ArrowUp' ? card.previousElementSibling : card.nextElementSibling;
      if (!irrmao || !irrmao.classList.contains('sanfona')) return;
      if (ev.key === 'ArrowUp') caixa.insertBefore(card, irrmao);
      else caixa.insertBefore(irrmao, card);
      pega.focus();
      salvaOrdemModulos();
    });
  });
}

function ligaConteudo() {
  ligaArrasteModulos();

  document.querySelectorAll('.mod-toggle').forEach(function (bt) {
    bt.addEventListener('click', function () {
      const caixa = bt.closest('.sanfona');
      const vaiAbrir = !caixa.classList.contains('aberto');
      caixa.classList.toggle('aberto', vaiAbrir);
      bt.setAttribute('aria-expanded', vaiAbrir ? 'true' : 'false');
      ABERTOS_MOD[caixa.dataset.mod] = vaiAbrir;
    });
  });

  document.querySelectorAll('.salvar-mod').forEach(function (b) {
    b.addEventListener('click', async function () {
      const id = b.dataset.id;
      try {
        await api('module_save', {
          body: {
            id: id,
            title: document.querySelector('.mod-titulo[data-id="' + id + '"]').value,
            description: document.querySelector('.mod-desc[data-id="' + id + '"]').value
          }
        });
        toast('Módulo salvo');
      } catch (e) { toast(e.message, true); }
    });
  });
  document.querySelectorAll('.del-mod').forEach(function (b) {
    b.addEventListener('click', async function () {
      if (!confirm('Excluir este módulo e todas as aulas dele?')) return;
      try { await api('module_delete', { body: { id: b.dataset.id } }); toast('Excluído'); carregaConteudo(); }
      catch (e) { toast(e.message, true); }
    });
  });
  document.querySelectorAll('.nova-aula').forEach(function (b) {
    b.addEventListener('click', async function () {
      const t = prompt('Título da nova aula:');
      if (!t) return;
      ABERTOS_MOD[b.dataset.mod] = true; // deixa o módulo aberto para ver a aula nova
      try { await api('lesson_save', { body: { module_id: b.dataset.mod, title: t } }); carregaConteudo(); }
      catch (e) { toast(e.message, true); }
    });
  });
  document.querySelectorAll('.salvar-aula').forEach(function (b) {
    b.addEventListener('click', async function () {
      const box = b.closest('.item');
      try {
        await api('lesson_save', {
          body: {
            id: b.dataset.id,
            title: box.querySelector('.au-titulo').value,
            duration: box.querySelector('.au-dur').value,
            video_url: box.querySelector('.au-video').value,
            description: box.querySelector('.au-desc').value,
            materials: leMateriais(box.querySelector('.au-mats').value),
            published: box.querySelector('.au-pub').checked
          }
        });
        toast('Aula salva');
      } catch (e) { toast(e.message, true); }
    });
  });
  document.querySelectorAll('.del-aula').forEach(function (b) {
    b.addEventListener('click', async function () {
      if (!confirm('Excluir esta aula?')) return;
      try { await api('lesson_delete', { body: { id: b.dataset.id } }); toast('Excluída'); carregaConteudo(); }
      catch (e) { toast(e.message, true); }
    });
  });
}

document.getElementById('btn-novo-modulo').addEventListener('click', async function () {
  const t = prompt('Nome do novo módulo:', 'Módulo 3 — ');
  if (!t) return;
  try { await api('module_save', { body: { title: t } }); carregaConteudo(); }
  catch (e) { toast(e.message, true); }
});

/* ============================================================
   QUIZ (edicao)
   ============================================================ */
async function carregaQuiz() {
  const box = document.getElementById('painel-quiz');
  box.innerHTML = '<div class="loading-page">Carregando…</div>';
  const d = await api('quiz_admin');
  box.innerHTML = d.quizzes.map(function (qz) {
    return '<div class="card"><h2>' + esc(qz.title) + '</h2>' +
      '<div class="grid grid-3">' +
      '<div class="field"><label>Título</label><input type="text" id="qz-t" value="' + esc(qz.title) + '"></div>' +
      '<div class="field"><label>Tempo (minutos)</label><input type="number" id="qz-tempo" value="' + qz.time_limit_min + '"></div>' +
      '<div class="field"><label>Nota de corte (%)</label><input type="number" id="qz-corte" value="' + qz.pass_score + '"></div>' +
      '</div>' +
      '<div class="field" style="margin-top:12px"><label>Instrução mostrada ao candidato</label><textarea id="qz-desc" style="min-height:60px">' + esc(qz.description || '') + '</textarea></div>' +
      '<div class="row" style="margin-top:12px"><button class="btn btn-sm" id="btn-qz-salvar" data-id="' + qz.id + '">Salvar quiz</button>' +
      '<label class="row small" style="gap:6px"><input type="checkbox" id="qz-ativo" ' + (qz.active ? 'checked' : '') + ' style="width:16px;height:16px"> quiz ativo</label></div>' +
      '</div>' +
      '<div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Questões</h2>' +
      '<button class="btn btn-sm" id="btn-nova-q" data-quiz="' + qz.id + '">+ Nova questão</button></div></div>' +
      qz.questions.map(questaoHtml).join('');
  }).join('');
  ligaQuizEdicao();
}

function questaoHtml(q) {
  const ops = (q.options || []).map(function (o) {
    return (q.correct || []).indexOf(o.id) >= 0 ? '*' + o.text : o.text;
  }).join('\n');
  return '<div class="card" data-q="' + q.id + '">' +
    '<div class="row" style="gap:10px;align-items:flex-start">' +
    '<div class="field" style="width:110px"><label>Tipo</label><select class="q-kind">' +
    ['single|Uma resposta', 'multiple|Várias respostas', 'text|Resposta escrita'].map(function (o) {
      const p = o.split('|');
      return '<option value="' + p[0] + '"' + (q.kind === p[0] ? ' selected' : '') + '>' + p[1] + '</option>';
    }).join('') + '</select></div>' +
    '<div class="field" style="width:90px"><label>Pontos</label><input type="number" class="q-pts" value="' + (q.points || 1) + '"></div>' +
    '<div class="field" style="width:90px"><label>Ordem</label><input type="number" class="q-pos" value="' + q.position + '"></div>' +
    '</div>' +
    '<div class="field" style="margin-top:6px"><label>Pergunta</label><textarea class="q-prompt" style="min-height:60px">' + esc(q.prompt) + '</textarea></div>' +
    '<div class="field" style="margin-top:10px"><label>Alternativas</label>' +
    '<span class="hint">Uma por linha. Coloque <strong>*</strong> no começo da(s) correta(s). Deixe vazio para resposta escrita (correção manual).</span>' +
    '<textarea class="q-ops" style="min-height:100px">' + esc(ops) + '</textarea></div>' +
    '<div class="row" style="margin-top:12px"><button class="btn btn-sm salvar-q" data-id="' + q.id + '">Salvar questão</button>' +
    '<span style="flex:1"></span><button class="btn btn-sm btn-ghost del-q" data-id="' + q.id + '">Excluir</button></div>' +
    '</div>';
}

function leAlternativas(txt) {
  const linhas = String(txt || '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
  const options = [], correct = [];
  linhas.forEach(function (l, i) {
    const id = String.fromCharCode(97 + i);
    const certa = l.startsWith('*');
    options.push({ id: id, text: certa ? l.slice(1).trim() : l });
    if (certa) correct.push(id);
  });
  return { options: options, correct: correct };
}

function ligaQuizEdicao() {
  const bs = document.getElementById('btn-qz-salvar');
  if (bs) bs.addEventListener('click', async function () {
    try {
      await api('quiz_save', {
        body: {
          id: bs.dataset.id,
          title: document.getElementById('qz-t').value,
          description: document.getElementById('qz-desc').value,
          time_limit_min: Number(document.getElementById('qz-tempo').value),
          pass_score: Number(document.getElementById('qz-corte').value),
          active: document.getElementById('qz-ativo').checked
        }
      });
      toast('Quiz salvo');
    } catch (e) { toast(e.message, true); }
  });
  const bn = document.getElementById('btn-nova-q');
  if (bn) bn.addEventListener('click', async function () {
    const p = prompt('Enunciado da nova questão:');
    if (!p) return;
    try { await api('question_save', { body: { quiz_id: bn.dataset.quiz, prompt: p, kind: 'single' } }); carregaQuiz(); }
    catch (e) { toast(e.message, true); }
  });
  document.querySelectorAll('.salvar-q').forEach(function (b) {
    b.addEventListener('click', async function () {
      const box = b.closest('[data-q]');
      const kind = box.querySelector('.q-kind').value;
      const alt = leAlternativas(box.querySelector('.q-ops').value);
      try {
        await api('question_save', {
          body: {
            id: b.dataset.id, kind: kind,
            prompt: box.querySelector('.q-prompt').value,
            points: Number(box.querySelector('.q-pts').value) || 1,
            position: Number(box.querySelector('.q-pos').value) || 1,
            options: kind === 'text' ? [] : alt.options,
            correct: kind === 'text' ? [] : alt.correct
          }
        });
        toast('Questão salva');
      } catch (e) { toast(e.message, true); }
    });
  });
  document.querySelectorAll('.del-q').forEach(function (b) {
    b.addEventListener('click', async function () {
      if (!confirm('Excluir esta questão?')) return;
      try { await api('question_delete', { body: { id: b.dataset.id } }); carregaQuiz(); }
      catch (e) { toast(e.message, true); }
    });
  });
}

/* ============================================================
   TEMPLATES
   ============================================================ */
// lembra quais modelos estão abertos na sanfona
const ABERTOS_TPL = {};

async function carregaTemplates() {
  const box = document.getElementById('lista-templates');
  box.innerHTML = '<div class="loading-page">Carregando…</div>';
  const d = await api('templates');
  const ico = { email: ICO.mail(14), whatsapp: ICO.chat(14), sms: ICO.fone(14) };
  const canal = { email: 'E-mail', whatsapp: 'WhatsApp', sms: 'SMS' };

  box.innerHTML = d.templates.map(function (t) {
    const aberto = ABERTOS_TPL[t.key] === true;
    const linhas = String(t.body || '').split('\n').length;
    return '<div class="card sanfona' + (aberto ? ' aberto' : '') + '" data-tpl="' + esc(t.key) + '" data-mod="' + esc(t.key) + '">' +
      '<div class="row" style="align-items:center">' +
        '<button type="button" class="mod-toggle" aria-expanded="' + (aberto ? 'true' : 'false') + '" title="abrir/fechar modelo">' +
          '<svg class="seta" viewBox="0 0 24 24" width="16" height="16" style="stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><path d="m9 6 6 6-6 6"/></svg>' +
        '</button>' +
        '<div style="flex:1;min-width:0">' +
          '<h2 style="font-size:15px;margin:0">' + (ico[t.channel] || '') + ' ' + esc(t.name) + '</h2>' +
          '<p class="sub" style="margin:2px 0 0">' + esc(t.body.replace(/\s+/g, ' ').slice(0, 78)) + '…</p>' +
        '</div>' +
        '<span class="tag" style="align-self:center">' + esc(canal[t.channel] || t.channel) + '</span>' +
        '<span class="tag" style="align-self:center">' + linhas + (linhas === 1 ? ' linha' : ' linhas') + '</span>' +
      '</div>' +
      '<div class="mod-corpo"><div>' +
        '<hr class="sep" style="margin:14px 0">' +
        '<p class="small muted" style="margin:0 0 12px">chave: <code>' + esc(t.key) + '</code></p>' +
        (t.channel === 'email'
          ? '<div class="field" style="margin-bottom:10px"><label>Assunto</label><input type="text" class="t-subj" value="' + esc(t.subject || '') + '"></div>'
          : '') +
        '<div class="field"><label>Mensagem</label><textarea class="t-body" style="min-height:200px">' + esc(t.body) + '</textarea></div>' +
        '<div class="row" style="margin-top:12px"><button class="btn btn-sm salvar-tpl" data-key="' + esc(t.key) + '">Salvar modelo</button></div>' +
      '</div></div>' +
      '</div>';
  }).join('');

  document.querySelectorAll('#lista-templates .mod-toggle').forEach(function (bt) {
    bt.addEventListener('click', function () {
      const caixa = bt.closest('.sanfona');
      const vaiAbrir = !caixa.classList.contains('aberto');
      caixa.classList.toggle('aberto', vaiAbrir);
      bt.setAttribute('aria-expanded', vaiAbrir ? 'true' : 'false');
      ABERTOS_TPL[caixa.dataset.tpl] = vaiAbrir;
    });
  });

  document.querySelectorAll('.salvar-tpl').forEach(function (b) {
    b.addEventListener('click', async function () {
      const box2 = b.closest('[data-tpl]');
      const subj = box2.querySelector('.t-subj');
      try {
        await api('template_save', {
          body: { key: b.dataset.key, subject: subj ? subj.value : undefined, body: box2.querySelector('.t-body').value }
        });
        toast('Modelo salvo');
      } catch (e) { toast(e.message, true); }
    });
  });
}
