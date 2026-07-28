/* ============================================================
   QUADRO
   ============================================================ */
async function carregaBoard() {
  const d = await api('board');
  BOARD = d;
  APP_URL = d.app_url || location.origin;
  document.getElementById('link-form').href = (APP_URL || '') + '/vaga';

  const vagas = {};
  d.candidates.forEach(function (c) { if (c.role_applied) vagas[c.role_applied] = 1; });
  const sel = document.getElementById('filtro-vaga');
  const escolhida = sel.value;
  sel.innerHTML = '<option value="">Todas as vagas</option>' +
    Object.keys(vagas).sort().map(function (v) { return '<option>' + esc(v) + '</option>'; }).join('');
  sel.value = escolhida;

  const total = d.candidates.length;
  const contratados = d.candidates.filter(function (c) { return c.stage_key === 'contratado'; }).length;
  const comDisc = d.candidates.filter(function (c) { return c.disc; }).length;
  function statCard(icone, tinta, cor, n, l) {
    return '<div class="stat"><span class="stat-ico" style="background:' + tinta + ';color:' + cor + '">' + icone + '</span>' +
      '<span><span class="n" style="display:block">' + n + '</span><span class="l">' + l + '</span></span></div>';
  }
  document.getElementById('stats').innerHTML =
    statCard(ICO.pessoas(19), 'var(--accent-tint)', 'var(--accent)', total, 'candidatos ativos') +
    statCard(ICO.grafico(19), 'var(--purple-tint)', 'var(--purple)', comDisc, 'com teste DISC respondido') +
    statCard(ICO.check(19), 'var(--blue-tint)', 'var(--blue)', contratados, 'contratados');

  desenhaBoard();
}

function candidatosFiltrados() {
  const q = document.getElementById('busca').value.trim().toLowerCase();
  const vaga = document.getElementById('filtro-vaga').value;
  return BOARD.candidates.filter(function (c) {
    if (vaga && c.role_applied !== vaga) return false;
    if (!q) return true;
    return [c.name, c.email, c.role_applied, c.city].join(' ').toLowerCase().indexOf(q) >= 0;
  });
}

function desenhaBoard() {
  const lista = candidatosFiltrados();
  document.getElementById('board').innerHTML = BOARD.stages.map(function (s) {
    const cards = lista.filter(function (c) { return c.stage_key === s.key; });
    return '<div class="coluna" data-stage="' + s.key + '">' +
      '<div class="coluna-cab"><span class="pt" style="background:' + esc(s.color) + '"></span>' +
      '<h3>' + esc(s.name) + '</h3><span class="qtd">' + cards.length + '</span></div>' +
      (cards.length ? cards.map(cartao).join('') : '<div class="vazio-col">arraste candidatos para cá</div>') +
      '</div>';
  }).join('');
  ligaArrasto();
}

function cartao(c) {
  const tags = [];
  if (c.disc) tags.push('<span class="tag tag-roxo">DISC ' + esc(c.disc) + '</span>');
  if (c.quiz_percent !== null && c.quiz_percent !== undefined) {
    tags.push('<span class="tag ' + (c.quiz_passed ? 'tag-verde' : 'tag-vermelho') + '">Quiz ' + c.quiz_percent + '%</span>');
  }
  if (c.quiz_flags) tags.push('<span class="tag tag-ambar">' + ICO.alerta(11) + ' ' + c.quiz_flags + '</span>');
  if (c.member_access) tags.push('<span class="tag tag-azul">Integração</span>');
  const estrelas = c.rating ? '<div class="estrelas">' + '★'.repeat(c.rating) + '<span style="color:var(--fill-3)">' + '★'.repeat(5 - c.rating) + '</span></div>' : '';
  return '<div class="cartao" draggable="true" data-id="' + c.id + '">' +
    '<div class="row" style="align-items:flex-start"><div style="flex:1;min-width:0">' +
    '<div class="nome">' + esc(c.name) + '</div>' +
    '<div class="vaga">' + esc(c.role_applied || '—') + (c.city ? ' · ' + esc(c.city) : '') + '</div>' +
    '</div>' + estrelas + '</div>' +
    (tags.length ? '<div class="tags">' + tags.join('') + '</div>' : '') +
    '</div>';
}

function ligaArrasto() {
  let arrastando = null;
  document.querySelectorAll('.cartao').forEach(function (el) {
    el.addEventListener('dragstart', function () { arrastando = el; el.classList.add('arrastando'); });
    el.addEventListener('dragend', function () { el.classList.remove('arrastando'); arrastando = null; });
    el.addEventListener('click', function () { abreCandidato(el.dataset.id); });
  });
  document.querySelectorAll('.coluna').forEach(function (col) {
    col.addEventListener('dragover', function (e) { e.preventDefault(); col.classList.add('hover'); });
    col.addEventListener('dragleave', function () { col.classList.remove('hover'); });
    col.addEventListener('drop', async function (e) {
      e.preventDefault();
      col.classList.remove('hover');
      if (!arrastando) return;
      const id = arrastando.dataset.id;
      const stage = col.dataset.stage;
      const c = BOARD.candidates.find(function (x) { return x.id === id; });
      if (!c || c.stage_key === stage) return;
      const antes = c.stage_key;
      c.stage_key = stage;
      desenhaBoard();
      try {
        await api('move', { body: { id: id, stage_key: stage } });
        const nome = (BOARD.stages.find(function (s) { return s.key === stage; }) || {}).name;
        toast(c.name.split(' ')[0] + ' → ' + nome);
        if (stage === 'concluido') gatilhoConcluido(c);
      } catch (err) {
        c.stage_key = antes; desenhaBoard(); toast(err.message, true);
      }
    });
  });
}

document.getElementById('busca').addEventListener('input', desenhaBoard);
document.getElementById('filtro-vaga').addEventListener('change', desenhaBoard);
document.getElementById('btn-recarregar').addEventListener('click', function () { carregaBoard(); });
document.getElementById('btn-copiar-form').addEventListener('click', function () {
  const url = (APP_URL || location.origin) + '/vaga';
  navigator.clipboard.writeText(url).then(function () { toast('Link da vaga copiado — é esse que você envia ao candidato'); });
});

/* ============================================================
   GAVETA DO CANDIDATO
   ============================================================ */
function fechaGaveta() {
  document.getElementById('gaveta').style.display = 'none';
  document.getElementById('fundo').style.display = 'none';
}
document.getElementById('g-fechar').addEventListener('click', fechaGaveta);
document.getElementById('fundo').addEventListener('click', fechaGaveta);

async function abreCandidato(id) {
  document.getElementById('fundo').style.display = 'block';
  const gv = document.getElementById('gaveta');
  gv.style.display = 'flex';
  gv.classList.remove('aberta'); void gv.offsetWidth; gv.classList.add('aberta');
  document.getElementById('g-corpo').innerHTML = '<div class="loading-page">Carregando…</div>';
  try {
    atualCand = await api('candidate', { params: { id: id } });
  } catch (e) { return toast(e.message, true); }
  const c = atualCand.candidate;
  document.getElementById('g-nome').textContent = c.name;
  const etapa = (BOARD.stages.find(function (s) { return s.key === c.stage_key; }) || {}).name || c.stage_key;
  document.getElementById('g-sub').textContent = (c.role_applied || 'sem vaga') + ' · ' + etapa + ' · inscrito em ' + dataBr(c.created_at);
  desenhaGaveta('dados');
}

function desenhaGaveta(sub) {
  const c = atualCand.candidate;
  const abas = [['dados', 'Formulário'], ['disc', 'DISC'], ['quiz', 'Quiz'], ['acoes', 'Ações'], ['hist', 'Histórico']];
  let html = '<div class="sub-abas">' + abas.map(function (a) {
    return '<button data-sub="' + a[0] + '" class="' + (a[0] === sub ? 'on' : '') + '">' + a[1] + '</button>';
  }).join('') + '</div>';

  if (sub === 'dados') html += gavetaDados();
  if (sub === 'disc') html += gavetaDisc();
  if (sub === 'quiz') html += gavetaQuiz();
  if (sub === 'acoes') html += gavetaAcoes();
  if (sub === 'hist') html += gavetaHist();

  const corpo = document.getElementById('g-corpo');
  corpo.innerHTML = html;
  corpo.scrollTop = 0;
  corpo.querySelectorAll('.sub-abas button').forEach(function (b) {
    b.addEventListener('click', function () { desenhaGaveta(b.dataset.sub); });
  });
  if (sub === 'acoes') ligaAcoes();
  if (sub === 'quiz') ligaQuizNotas();
}

function gavetaDados() {
  const c = atualCand.candidate;
  const campos = [
    ['E-mail', c.email], ['WhatsApp', c.phone], ['Cidade / UF', [c.city, c.state].filter(Boolean).join(' / ')],
    ['Nascimento', c.birth_date], ['Vaga', c.role_applied], ['Pretensão', c.salary_expectation],
    ['Disponibilidade', c.availability], ['Computador', c.has_computer], ['Internet', c.internet_speed],
    ['Formação', c.education], ['Inglês', c.english_level], ['Ferramentas', c.tools],
    ['LinkedIn', c.linkedin], ['Instagram / portfólio', c.instagram],
    ['Onde nos conheceu', c.extra && c.extra.onde_conheceu]
  ].filter(function (p) { return p[1]; });

  let html = '<div class="card"><h2>Dados do formulário</h2><dl class="kv">' +
    campos.map(function (p) { return '<dt>' + p[0] + '</dt><dd>' + esc(p[1]) + '</dd>'; }).join('') +
    '</dl></div>';

  const textos = [['Experiência profissional', c.experience], ['Por que a StartDigital', c.why_start],
    ['Pontos fortes', c.strengths], ['A melhorar', c.weaknesses]].filter(function (p) { return p[1]; });
  if (textos.length) {
    html += '<div class="card">' + textos.map(function (p) {
      return '<h3 style="font-size:12.5px;font-weight:500;margin:0 0 6px;color:var(--label-3)">' + p[0] + '</h3>' +
        '<p style="margin:0 0 22px;line-height:1.5;white-space:pre-wrap;font-size:14.5px">' + esc(p[1]) + '</p>';
    }).join('') + '</div>';
  }
  return html;
}

function gavetaDisc() {
  const d = atualCand.disc;
  if (!d) {
    return '<div class="card"><h2>Teste DISC</h2><p class="sub">Este candidato ainda não respondeu.</p>' +
      '<div class="alert alert-info" style="margin:0">Envie o convite na aba <strong>Ações</strong> ou copie o link do teste de lá.</div></div>';
  }
  const cor = { D: '#ff3b30', I: '#ff9f0a', S: '#00a15c', C: '#0071e3' };
  const nomes = { D: 'Dominância', I: 'Influência', S: 'Estabilidade', C: 'Conformidade' };
  const p = d.computed.percent;
  const barras = ['D', 'I', 'S', 'C'].map(function (L) {
    return '<div class="disc-linha"><span class="rot">' + L + ' · ' + nomes[L] + '</span>' +
      '<div class="disc-bar"><i style="width:' + p[L] + '%;background:' + cor[L] + '"></i></div>' +
      '<span class="disc-val">' + p[L] + '%</span></div>';
  }).join('');

  const prof = atualCand.disc_profiles[d.primary_profile] || {};
  const prof2 = atualCand.disc_profiles[d.secondary_profile] || {};
  return '<div class="card"><h2>Perfil comportamental</h2>' +
    '<p class="sub">Respondido em ' + dataBr(d.created_at) + ' · perfil <strong>' + d.primary_profile + '/' + d.secondary_profile + '</strong></p>' +
    '<div class="disc-barras">' + barras + '</div>' +
    '<div class="perfil-box"><h4>' + esc(prof.nome || '') + ' — ' + esc(prof.apelido || '') + ' (predominante)</h4>' +
    '<p>' + esc(prof.resumo || '') + '</p>' +
    '<h5>Pontos fortes</h5><ul>' + (prof.forcas || []).map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul>' +
    '<h5>Pontos de atenção</h5><ul>' + (prof.atencao || []).map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul>' +
    '<h5>Como liderar esse perfil</h5>' +
    '<p>' + esc(prof.como_gerir || '') + '</p></div>' +
    (prof2.nome ? '<div class="perfil-box"><h4>' + esc(prof2.nome) + ' — ' + esc(prof2.apelido) + ' (apoio)</h4>' +
      '<p>' + esc(prof2.resumo) + '</p></div>' : '') +
    '<p class="small muted" style="margin:14px 0 0">O DISC descreve preferências de comportamento, não capacidade técnica. Use sempre junto com entrevista e teste prático.</p>' +
    '</div>';
}

function gavetaQuiz() {
  const a = (atualCand.attempts || [])[0];
  if (!a) {
    return '<div class="card"><h2>Quiz</h2><p class="sub">Este candidato ainda não respondeu.</p>' +
      '<div class="alert alert-info" style="margin:0">O quiz deve ser feito ao vivo, com você acompanhando. Copie o link na aba <strong>Ações</strong>.</div></div>';
  }
  const flags = (a.integrity_flags || []);
  let html = '<div class="card"><h2>Resultado do quiz</h2>' +
    '<p class="sub">Enviado em ' + dataBr(a.finished_at) + '</p>' +
    '<div class="row row-wrap" style="gap:14px;margin-bottom:6px">' +
    '<div class="stat" style="min-width:120px"><div class="n">' + (a.percent === null ? '—' : a.percent + '%') + '</div><div class="l">acerto automático</div></div>' +
    '<div class="stat" style="min-width:120px"><div class="n">' + (a.score || 0) + '/' + (a.max_score || 0) + '</div><div class="l">pontos objetivos</div></div>' +
    '<div class="stat" style="min-width:120px"><div class="n">' + (a.passed === null ? '—' : (a.passed ? 'Passou' : 'Não')) + '</div><div class="l">nota de corte</div></div>' +
    '</div>' +
    (flags.length
      ? '<div class="alert alert-aviso" style="margin-top:14px"><strong>Alertas de integridade</strong><br>' + flags.map(esc).join('<br>') + '</div>'
      : '<div class="alert alert-ok" style="margin-top:14px">Nenhum alerta de integridade registrado durante a prova.</div>');

  const qs = atualCand.quiz_questions || [];
  html += '<hr class="sep"><h3 style="font-size:14px;margin:0 0 12px">Respostas</h3>';
  qs.forEach(function (q, i) {
    const dado = (a.answers || {})[q.id];
    const arr = Array.isArray(dado) ? dado : (dado ? [dado] : []);
    const correct = q.correct || [];
    let respTxt, sit = '';
    if (q.kind === 'text') {
      respTxt = typeof dado === 'string' ? dado : (arr[0] || '');
      sit = '<span class="tag tag-ambar">corrigir manualmente</span>';
    } else {
      const label = function (id) {
        const o = (q.options || []).find(function (x) { return x.id === id; });
        return o ? o.text : id;
      };
      respTxt = arr.map(label).join(' · ') || '(sem resposta)';
      const acertou = arr.length === correct.length && correct.every(function (x) { return arr.indexOf(x) >= 0; });
      sit = acertou ? '<span class="tag tag-verde">certo</span>'
        : '<span class="tag tag-vermelho">errado</span> <span class="small muted">esperado: ' + esc(correct.map(label).join(' · ')) + '</span>';
    }
    html += '<div class="item"><div class="topo"><span class="t">' + (i + 1) + '. ' + esc(q.prompt) + '</span></div>' +
      '<p style="margin:9px 0 6px;white-space:pre-wrap;font-size:14px;line-height:1.6">' + esc(respTxt) + '</p>' +
      '<div class="row row-wrap">' + sit + '</div></div>';
  });

  html += '<div class="card"><h3 style="font-size:14px;margin:0 0 4px">Nota final (opcional)</h3>' +
    '<p class="sub" style="margin:0 0 12px">Ajuste depois de corrigir as questões abertas.</p>' +
    '<div class="row row-wrap"><input type="number" id="q-pct" min="0" max="100" value="' + (a.percent === null ? '' : a.percent) + '" style="width:110px" placeholder="%">' +
    '<label class="row small" style="gap:6px"><input type="checkbox" id="q-pass" ' + (a.passed ? 'checked' : '') + ' style="width:16px;height:16px"> aprovado no quiz</label>' +
    '<button class="btn btn-sm" id="btn-nota" data-attempt="' + a.id + '">Salvar nota</button></div></div>';
  return html;
}

function ligaQuizNotas() {
  const b = document.getElementById('btn-nota');
  if (!b) return;
  b.addEventListener('click', async function () {
    const pct = document.getElementById('q-pct').value;
    try {
      await api('grade_attempt', { body: { attempt_id: b.dataset.attempt, percent: pct === '' ? null : Number(pct), passed: document.getElementById('q-pass').checked } });
      toast('Nota salva');
      abreCandidato(atualCand.candidate.id);
      carregaBoard();
    } catch (e) { toast(e.message, true); }
  });
}

function gavetaAcoes() {
  const c = atualCand.candidate;
  const l = atualCand.links;
  const etapas = BOARD.stages.map(function (s) {
    return '<option value="' + s.key + '"' + (s.key === c.stage_key ? ' selected' : '') + '>' + esc(s.name) + '</option>';
  }).join('');
  const links = [['Teste DISC', l.link_disc], ['Quiz', l.link_quiz], ['Área de integração', l.link_portal]];

  return '<div class="card"><h2>Etapa e avaliação</h2>' +
    '<div class="grid grid-2">' +
    '<div class="field"><label>Etapa atual</label><select id="a-stage">' + etapas + '</select></div>' +
    '<div class="field"><label>Nota do time (1 a 5 estrelas)</label><select id="a-rating">' +
    '<option value="">sem nota</option>' + [1, 2, 3, 4, 5].map(function (n) {
      return '<option value="' + n + '"' + (c.rating === n ? ' selected' : '') + '>' + '★'.repeat(n) + '</option>';
    }).join('') + '</select></div></div>' +
    '<div class="field" style="margin-top:14px"><label>Anotações internas</label>' +
    '<span class="hint">Só o time vê. O candidato nunca tem acesso.</span>' +
    '<textarea id="a-notes" style="min-height:110px">' + esc(c.notes || '') + '</textarea></div>' +
    '<div class="row row-wrap" style="margin-top:14px">' +
    '<button class="btn" id="btn-salvar-cand">Salvar</button>' +
    '<label class="row small" style="gap:7px"><input type="checkbox" id="a-access" ' + (c.member_access ? 'checked' : '') + ' style="width:16px;height:16px"> liberar área de integração</label>' +
    '</div></div>' +

    '<div class="card"><h2>Links pessoais do candidato</h2>' +
    '<p class="sub">Cada link é único e pessoal. Envie pelo painel de mensagens ou copie aqui.</p>' +
    links.map(function (p) {
      return '<div class="item"><div class="topo"><span class="t">' + p[0] + '</span>' +
        '<button class="btn btn-sm btn-ghost copiar" data-txt="' + esc(p[1]) + '">Copiar</button>' +
        '<a class="btn btn-sm btn-ghost" href="' + esc(p[1]) + '" target="_blank">Abrir ↗</a></div>' +
        '<div class="small muted" style="margin-top:7px;word-break:break-all">' + esc(p[1]) + '</div></div>';
    }).join('') + '</div>' +

    '<div class="card"><h2>Mensagens enviadas</h2>' +
    (atualCand.logs.length
      ? '<table class="tbl"><thead><tr><th>Quando</th><th>Canal</th><th>Situação</th></tr></thead><tbody>' +
        atualCand.logs.map(function (g) {
          const cls = g.status === 'enviado' ? 'tag-verde' : (g.status === 'erro' ? 'tag-vermelho' : 'tag-ambar');
          return '<tr><td>' + dataBr(g.created_at) + '</td><td>' + esc(g.channel) + '</td>' +
            '<td><span class="tag ' + cls + '">' + esc(g.status) + '</span>' +
            (g.error ? '<div class="small muted" style="margin-top:4px">' + esc(g.error) + '</div>' : '') + '</td></tr>';
        }).join('') + '</tbody></table>'
      : '<p class="sub" style="margin:0">Nenhuma mensagem enviada ainda.</p>') +
    '</div>' +

    '<div class="card"><h2>Zona de risco</h2>' +
    '<div class="row row-wrap"><button class="btn btn-sm btn-ghost" id="btn-arquivar">' +
    (c.archived ? 'Desarquivar' : 'Arquivar candidato') + '</button>' +
    '<button class="btn btn-sm btn-danger" id="btn-excluir">Excluir definitivamente</button></div>' +
    '<p class="small muted" style="margin:10px 0 0">Arquivar tira do quadro sem perder os dados. Excluir apaga tudo, inclusive testes e respostas.</p></div>';
}

function ligaAcoes() {
  document.querySelectorAll('.copiar').forEach(function (b) {
    b.addEventListener('click', function () {
      navigator.clipboard.writeText(b.dataset.txt).then(function () { toast('Link copiado'); });
    });
  });
  document.getElementById('btn-salvar-cand').addEventListener('click', async function () {
    const id = atualCand.candidate.id;
    const stage = document.getElementById('a-stage').value;
    const rating = document.getElementById('a-rating').value;
    try {
      if (stage !== atualCand.candidate.stage_key) await api('move', { body: { id: id, stage_key: stage } });
      await api('update_candidate', {
        body: {
          id: id, rating: rating === '' ? null : Number(rating),
          notes: document.getElementById('a-notes').value,
          member_access: document.getElementById('a-access').checked
        }
      });
      toast('Salvo');
      await carregaBoard();
      abreCandidato(id);
    } catch (e) { toast(e.message, true); }
  });
  document.getElementById('btn-arquivar').addEventListener('click', async function () {
    try {
      await api('update_candidate', { body: { id: atualCand.candidate.id, archived: !atualCand.candidate.archived } });
      toast('Feito'); fechaGaveta(); carregaBoard();
    } catch (e) { toast(e.message, true); }
  });
  document.getElementById('btn-excluir').addEventListener('click', async function () {
    if (!confirm('Excluir ' + atualCand.candidate.name + ' e todos os dados? Isso não pode ser desfeito.')) return;
    try {
      await api('delete_candidate', { body: { id: atualCand.candidate.id } });
      toast('Excluído'); fechaGaveta(); carregaBoard();
    } catch (e) { toast(e.message, true); }
  });
}

function gavetaHist() {
  const h = atualCand.history || [];
  if (!h.length) return '<div class="card"><p class="sub" style="margin:0">Sem histórico.</p></div>';
  const nome = function (k) { return (BOARD.stages.find(function (s) { return s.key === k; }) || {}).name || k || '—'; };
  return '<div class="card"><h2>Linha do tempo</h2>' +
    '<table class="tbl"><tbody>' + h.map(function (r) {
      return '<tr><td style="white-space:nowrap;color:var(--cinza)">' + dataBr(r.created_at) + '</td>' +
        '<td>' + (r.from_stage !== r.to_stage ? '<strong>' + esc(nome(r.from_stage)) + ' → ' + esc(nome(r.to_stage)) + '</strong><br>' : '') +
        esc(r.note || '') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
}

/* ============================================================
   BOAS-VINDAS / MENSAGENS PARA O CANDIDATO
   ============================================================ */
async function carregaBoasVindas() {
  if (!BOARD.candidates.length) await carregaBoard();
  const sel = document.getElementById('bv-candidato');
  const atual = sel.value;
  const ordem = { aprovado: 0, contratado: 1 };
  const lista = BOARD.candidates.slice().sort(function (a, b) {
    return (ordem[a.stage_key] !== undefined ? 0 : 1) - (ordem[b.stage_key] !== undefined ? 0 : 1);
  });
  sel.innerHTML = '<option value="">Selecione…</option>' + lista.map(function (c) {
    const etapa = (BOARD.stages.find(function (s) { return s.key === c.stage_key; }) || {}).name || '';
    return '<option value="' + c.id + '">' + esc(c.name) + ' — ' + esc(etapa) + '</option>';
  }).join('');
  sel.value = atual;

  const p = BOARD.providers || {};
  const linha = function (on, nome, dica) {
    return '<span class="tag ' + (on ? 'tag-verde' : 'tag-ambar') + '">' + (on ? '✓' : '!') + ' ' + nome + '</span> ' +
      (on ? '' : '<span class="small muted">' + dica + '</span>');
  };
  document.getElementById('bv-provedores').innerHTML =
    '<div class="row row-wrap" style="gap:14px">' +
    linha(p.email, 'E-mail', 'configure RESEND_API_KEY') +
    linha(p.whatsapp, 'WhatsApp', 'configure EVOLUTION_API_URL e EVOLUTION_API_KEY') +
    linha(p.sms, 'SMS', 'sem provedor: a mensagem fica registrada para envio manual') +
    '</div>';
}

async function carregaPreview() {
  const id = document.getElementById('bv-candidato').value;
  const set = document.getElementById('bv-set').value;
  const box = document.getElementById('bv-mensagens');
  document.getElementById('bv-acoes').style.display = 'none';
  if (!id) { box.innerHTML = ''; return; }
  box.innerHTML = '<div class="loading-page">Montando as mensagens…</div>';
  try {
    const d = await api('preview', { body: { candidate_id: id, set: set } });
    bvItens = d.items;
    const rotulo = { email: ICO.mail() + ' E-mail', whatsapp: ICO.chat() + ' WhatsApp', sms: ICO.fone() + ' SMS' };
    const destino = { email: d.candidate.email, whatsapp: d.candidate.phone, sms: d.candidate.phone };
    box.innerHTML = d.items.map(function (it, i) {
      return '<div class="caixa-msg"><div class="cab-msg">' +
        '<strong style="font-size:14px">' + rotulo[it.channel] + '</strong>' +
        '<span class="small muted">para ' + esc(destino[it.channel] || '—') + '</span>' +
        '<span style="flex:1"></span>' +
        '<label class="row small" style="gap:6px"><input type="checkbox" class="bv-on" data-i="' + i + '" checked style="width:16px;height:16px"> enviar</label>' +
        '</div>' +
        (it.channel === 'email'
          ? '<div class="field" style="margin-bottom:10px"><label>Assunto</label><input type="text" class="bv-subj" data-i="' + i + '" value="' + esc(it.subject || '') + '"></div>'
          : '') +
        '<div class="field"><label>Mensagem</label><textarea class="bv-body" data-i="' + i + '">' + esc(it.body) + '</textarea></div>' +
        (it.channel === 'sms' ? '<p class="small muted" style="margin:6px 0 0">SMS: mantenha curto, sem acentos e sem emoji.</p>' : '') +
        '</div>';
    }).join('') || '<div class="card"><p class="sub" style="margin:0">Nenhum modelo para este conjunto.</p></div>';
    if (d.items.length) document.getElementById('bv-acoes').style.display = 'block';
  } catch (e) {
    box.innerHTML = '<div class="card"><div class="alert alert-erro" style="margin:0">' + esc(e.message) + '</div></div>';
  }
}
document.getElementById('bv-candidato').addEventListener('change', carregaPreview);
document.getElementById('bv-set').addEventListener('change', carregaPreview);

document.getElementById('btn-enviar-msgs').addEventListener('click', async function () {
  const id = document.getElementById('bv-candidato').value;
  const set = document.getElementById('bv-set').value;
  const itens = [];
  document.querySelectorAll('.bv-on').forEach(function (chk) {
    if (!chk.checked) return;
    const i = chk.dataset.i;
    const it = Object.assign({}, bvItens[i]);
    const subj = document.querySelector('.bv-subj[data-i="' + i + '"]');
    const body = document.querySelector('.bv-body[data-i="' + i + '"]');
    if (subj) it.subject = subj.value;
    if (body) it.body = body.value;
    itens.push(it);
  });
  if (!itens.length) return toast('Marque pelo menos um canal', true);
  const nomes = { welcome: 'as boas-vindas', disc_invite: 'o convite do DISC', quiz_invite: 'o convite do quiz', reject: 'o retorno negativo' };
  if (!confirm('Enviar ' + nomes[set] + ' agora por ' + itens.map(function (i) { return i.channel; }).join(', ') + '?')) return;

  const btn = this;
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Enviando…';
  try {
    const r = await api('send', { body: { candidate_id: id, set: set, items: itens } });
    const linhas = r.results.map(function (x) {
      return x.channel + ': ' + x.status + (x.error ? ' (' + x.error + ')' : '');
    });
    alert('Resultado do envio:\n\n' + linhas.join('\n'));
    toast('Envio concluído');
    await carregaBoard();
    carregaPreview();
  } catch (e) { toast(e.message, true); }
  btn.disabled = false; btn.textContent = 'Enviar mensagens';
});
