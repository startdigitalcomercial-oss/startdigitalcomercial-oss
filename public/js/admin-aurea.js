/* ============================================================
   PRÉ QUALIFICAÇÃO — grupos de perguntas da Aurea
   ============================================================ */
async function carregaPrequal() {
  const box = document.getElementById('painel-prequal');
  box.innerHTML = '<div class="loading-page">Carregando…</div>';
  let d;
  try { d = await api('prequal'); }
  catch (e) { box.innerHTML = '<div class="card">' + esc(e.message) + '</div>'; return; }

  box.innerHTML =
    '<div class="card"><div class="row" style="justify-content:space-between;align-items:flex-start">' +
      '<div><h2 style="margin:0">Grupos de perguntas</h2>' +
      '<p class="sub" style="margin:4px 0 0">Cada grupo é um roteiro que a Aurea segue no WhatsApp. ' +
      'Você pode ter um roteiro por vaga e marcar um deles como padrão.</p></div>' +
      '<button class="btn btn-sm" id="btn-novo-grupo">+ Novo grupo</button>' +
    '</div></div>' +
    (d.grupos.length ? d.grupos.map(grupoHtml).join('') :
      '<div class="card" style="margin-top:14px"><p class="sub" style="margin:0">Nenhum grupo criado ainda.</p></div>');

  ligaPrequal();
}

function grupoHtml(g) {
  return '<div class="card" style="margin-top:14px" data-grupo="' + g.id + '">' +
    '<div class="row" style="justify-content:space-between;align-items:flex-start;gap:12px">' +
      '<div style="flex:1;min-width:0">' +
        '<div class="row" style="gap:8px">' +
          '<input type="text" class="g-nome" value="' + esc(g.name) + '" style="font-weight:600;font-size:17px;letter-spacing:-.016em;border-color:transparent;background:transparent;padding:4px 6px">' +
          (g.is_default ? '<span class="tag tag-verde">padrão</span>' : '') +
          (g.active ? '' : '<span class="tag">desligado</span>') +
        '</div>' +
        '<input type="text" class="g-desc" value="' + esc(g.description || '') + '" placeholder="para que serve este roteiro" style="font-size:13.5px;color:var(--label-3);border-color:transparent;background:transparent;padding:4px 6px">' +
      '</div>' +
      '<button class="btn btn-sm btn-ghost g-salvar">Salvar</button>' +
      '<button class="btn btn-sm btn-ghost g-excluir" title="excluir grupo">' + ICO.lixo(14) + '</button>' +
    '</div>' +

    '<div class="grid grid-2" style="margin-top:14px">' +
      '<div class="field"><label>Mensagem de abertura</label>' +
      '<span class="hint">A primeira coisa que a Aurea manda. Use {{primeiro_nome}} e {{vaga}}.</span>' +
      '<textarea class="g-abertura" style="min-height:110px">' + esc(g.opening_message || '') + '</textarea></div>' +
      '<div class="field"><label>Mensagem de encerramento</label>' +
      '<span class="hint">O que ela diz quando termina as perguntas.</span>' +
      '<textarea class="g-fecho" style="min-height:110px">' + esc(g.closing_message || '') + '</textarea></div>' +
    '</div>' +

    '<div class="row row-wrap" style="margin-top:12px;gap:16px">' +
      '<label class="row small" style="gap:7px"><input type="checkbox" class="g-ativo" ' + (g.active ? 'checked' : '') + '> roteiro ligado</label>' +
      '<label class="row small" style="gap:7px"><input type="checkbox" class="g-padrao" ' + (g.is_default ? 'checked' : '') + '> usar como padrão</label>' +
      '<label class="row small" style="gap:7px"><input type="checkbox" class="g-auto" ' + (g.auto_on_apply ? 'checked' : '') + '> disparar ao receber candidatura</label>' +
    '</div>' +

    '<hr class="sep">' +
    '<h3 style="font-size:14px;margin:0 0 12px">Perguntas <span class="muted" style="font-weight:400">(' + g.questions.length + ')</span></h3>' +
    (g.questions.length ? g.questions.map(perguntaHtml).join('') :
      '<p class="small muted" style="margin:0 0 12px">Nenhuma pergunta neste roteiro ainda.</p>') +
    '<button class="btn btn-sm nova-pergunta" data-grupo="' + g.id + '">+ Adicionar pergunta</button>' +
    '</div>';
}

function perguntaHtml(q) {
  return '<div class="item" data-pergunta="' + q.id + '">' +
    '<div class="row" style="gap:10px;align-items:flex-start">' +
      '<div class="field" style="width:80px"><label>Ordem</label><input type="number" class="q-pos" value="' + q.position + '"></div>' +
      '<div class="field" style="flex:1"><label>Pergunta que a Aurea faz</label>' +
      '<textarea class="q-texto" style="min-height:56px">' + esc(q.question) + '</textarea></div>' +
    '</div>' +
    '<div class="field" style="margin-top:10px"><label>O que avaliar nessa resposta</label>' +
    '<span class="hint">Só a Aurea lê isto — é o critério que ela usa para julgar. Ex: “requisito eliminatório, precisa ser sim”.</span>' +
    '<textarea class="q-objetivo" style="min-height:56px">' + esc(q.objective || '') + '</textarea></div>' +
    '<div class="row row-wrap" style="margin-top:12px;gap:14px">' +
      '<button class="btn btn-sm salvar-pergunta">Salvar pergunta</button>' +
      '<div class="field" style="width:110px;margin:0"><label style="margin:0 0 3px">Peso na nota</label>' +
      '<input type="number" class="q-peso" value="' + (q.weight || 1) + '" min="1" max="5"></div>' +
      '<span style="flex:1"></span>' +
      '<button class="btn btn-sm btn-ghost excluir-pergunta">Excluir</button>' +
    '</div></div>';
}

function ligaPrequal() {
  document.getElementById('btn-novo-grupo').addEventListener('click', async function () {
    const nome = prompt('Nome do novo roteiro:', 'Pré-qualificação — ');
    if (!nome) return;
    try { await api('prequal_group_save', { body: { name: nome, active: true } }); carregaPrequal(); }
    catch (e) { toast(e.message, true); }
  });

  document.querySelectorAll('[data-grupo] .g-salvar').forEach(function (b) {
    b.addEventListener('click', async function () {
      const c = b.closest('[data-grupo]');
      try {
        await api('prequal_group_save', {
          body: {
            id: c.dataset.grupo,
            name: c.querySelector('.g-nome').value,
            description: c.querySelector('.g-desc').value,
            opening_message: c.querySelector('.g-abertura').value,
            closing_message: c.querySelector('.g-fecho').value,
            active: c.querySelector('.g-ativo').checked,
            is_default: c.querySelector('.g-padrao').checked,
            auto_on_apply: c.querySelector('.g-auto').checked
          }
        });
        toast('Roteiro salvo');
        carregaPrequal();
      } catch (e) { toast(e.message, true); }
    });
  });

  document.querySelectorAll('[data-grupo] .g-excluir').forEach(function (b) {
    b.addEventListener('click', async function () {
      if (!confirm('Excluir este roteiro e todas as perguntas dele?')) return;
      try { await api('prequal_group_delete', { body: { id: b.closest('[data-grupo]').dataset.grupo } }); carregaPrequal(); }
      catch (e) { toast(e.message, true); }
    });
  });

  document.querySelectorAll('.nova-pergunta').forEach(function (b) {
    b.addEventListener('click', async function () {
      const t = prompt('Qual pergunta a Aurea deve fazer?');
      if (!t) return;
      try { await api('prequal_question_save', { body: { group_id: b.dataset.grupo, question: t } }); carregaPrequal(); }
      catch (e) { toast(e.message, true); }
    });
  });

  document.querySelectorAll('.salvar-pergunta').forEach(function (b) {
    b.addEventListener('click', async function () {
      const c = b.closest('[data-pergunta]');
      try {
        await api('prequal_question_save', {
          body: {
            id: c.dataset.pergunta,
            question: c.querySelector('.q-texto').value,
            objective: c.querySelector('.q-objetivo').value,
            position: Number(c.querySelector('.q-pos').value) || 1,
            weight: Number(c.querySelector('.q-peso').value) || 1
          }
        });
        toast('Pergunta salva');
      } catch (e) { toast(e.message, true); }
    });
  });

  document.querySelectorAll('.excluir-pergunta').forEach(function (b) {
    b.addEventListener('click', async function () {
      if (!confirm('Excluir esta pergunta?')) return;
      try { await api('prequal_question_delete', { body: { id: b.closest('[data-pergunta]').dataset.pergunta } }); carregaPrequal(); }
      catch (e) { toast(e.message, true); }
    });
  });
}

/* ============================================================
   AUREA
   ============================================================ */
async function carregaAurea() {
  const box = document.getElementById('painel-aurea');
  box.innerHTML = '<div class="loading-page">Carregando…</div>';
  let d, grupos = { grupos: [] };
  try { d = await api('aurea'); grupos = await api('prequal'); }
  catch (e) { box.innerHTML = '<div class="card">' + esc(e.message) + '</div>'; return; }

  const c = d.config;
  const rotStatus = {
    em_andamento: ['tag-azul', 'conversando'], concluida: ['tag-verde', 'concluída'],
    desistiu: ['tag-ambar', 'desistiu'], sem_interesse: ['tag', 'sem interesse'],
    erro: ['tag-vermelho', 'erro'], aguardando: ['tag', 'aguardando']
  };
  const rotRec = { avancar: ['tag-verde', 'avançar'], talvez: ['tag-ambar', 'talvez'], descartar: ['tag-vermelho', 'descartar'] };

  box.innerHTML =
    '<div class="card"><div class="row" style="gap:14px;align-items:flex-start">' +
      '<span class="stat-ico" style="width:44px;height:44px;background:var(--purple-tint);color:var(--purple)">' + ICO.check(20) + '</span>' +
      '<div style="flex:1"><h2 style="margin:0">Aurea</h2>' +
      '<p class="sub" style="margin:4px 0 0">A assistente que conversa com o candidato no WhatsApp, faz as perguntas do roteiro, ' +
      'entende as respostas e entrega um resumo com nota para você.</p></div>' +
      '<label class="row small" style="gap:7px;white-space:nowrap"><input type="checkbox" id="a-ativa" ' + (c.ativa ? 'checked' : '') + '> ligada</label>' +
    '</div>' +

    '<div class="row row-wrap" style="gap:10px;margin-top:16px">' +
      '<span class="tag ' + (d.tem_chave_ia ? 'tag-verde' : 'tag-vermelho') + '">' +
        (d.tem_chave_ia ? 'IA conectada' : 'falta ANTHROPIC_API_KEY') + '</span>' +
      '<span class="tag ' + (d.providers.whatsapp ? 'tag-verde' : 'tag-ambar') + '">' +
        (d.providers.whatsapp ? 'WhatsApp conectado' : 'WhatsApp não configurado') + '</span>' +
      '<button class="btn btn-sm btn-ghost" id="a-testar">Testar conexão da IA</button>' +
      '<span id="a-teste-res" class="small muted"></span>' +
    '</div></div>' +

    '<div class="card" style="margin-top:14px"><h2>Como ela se comporta</h2>' +
    '<p class="sub">Este texto é a personalidade da Aurea. Ela segue isto em toda conversa.</p>' +
    '<div class="grid grid-3">' +
      '<div class="field"><label>Modelo de IA</label><input type="text" id="a-modelo" value="' + esc(c.modelo || '') + '"></div>' +
      '<div class="field"><label>Instância do WhatsApp</label>' +
      '<span class="hint">Vazio usa a dos Ajustes.</span>' +
      '<input type="text" id="a-inst" value="' + esc(c.instancia_whatsapp || '') + '"></div>' +
      '<div class="field"><label>Horário de envio</label>' +
      '<div class="row" style="gap:8px"><input type="number" id="a-h1" value="' + (c.hora_inicio || 8) + '" style="width:70px">' +
      '<span class="muted small">até</span><input type="number" id="a-h2" value="' + (c.hora_fim || 20) + '" style="width:70px"></div></div>' +
    '</div>' +
    '<div class="field" style="margin-top:12px"><label>Personalidade e regras</label>' +
    '<textarea id="a-personalidade" style="min-height:220px;font-size:13.5px;line-height:1.6">' + esc(c.personalidade || '') + '</textarea></div>' +
    '<div class="row row-wrap" style="margin-top:12px;gap:16px">' +
      '<button class="btn btn-sm" id="a-salvar">Salvar</button>' +
      '<label class="row small" style="gap:7px"><input type="checkbox" id="a-auto" ' + (c.auto_ao_receber_formulario ? 'checked' : '') + '> puxar conversa assim que chegar uma candidatura</label>' +
      '<label class="row small" style="gap:7px"><input type="checkbox" id="a-horario" ' + (c.horario_comercial ? 'checked' : '') + '> só em horário comercial</label>' +
    '</div></div>' +

    '<div class="card" style="margin-top:14px"><h2>Importar lista e chamar</h2>' +
    '<p class="sub">Cole a lista de candidatos do Indeed, LinkedIn, Catho ou de onde vier. Um por linha, no formato: ' +
    '<code>Nome ; telefone ; e-mail ; vaga</code> — o e-mail e a vaga são opcionais.</p>' +
    '<div class="grid grid-3">' +
      '<div class="field"><label>Origem da lista</label>' +
      '<select id="imp-origem"><option>Indeed</option><option>LinkedIn</option><option>Catho</option><option>Infojobs</option><option>Indicação</option><option>Outra</option></select></div>' +
      '<div class="field"><label>Vaga (se todos forem da mesma)</label><input type="text" id="imp-vaga" placeholder="opcional"></div>' +
      '<div class="field"><label>Roteiro da Aurea</label><select id="imp-grupo">' +
        '<option value="">Usar o padrão</option>' +
        grupos.grupos.map(function (g) { return '<option value="' + g.id + '">' + esc(g.name) + '</option>'; }).join('') +
      '</select></div>' +
    '</div>' +
    '<div class="field" style="margin-top:12px"><label>A lista</label>' +
    '<textarea id="imp-lista" style="min-height:150px;font-family:ui-monospace,monospace;font-size:13px" ' +
    'placeholder="Maria Souza ; (11) 98877-6655 ; maria@email.com ; Social Media&#10;João Lima ; 11 97766-5544"></textarea></div>' +
    '<div class="row row-wrap" style="margin-top:12px;gap:16px">' +
      '<button class="btn" id="imp-enviar">Importar</button>' +
      '<label class="row small" style="gap:7px"><input type="checkbox" id="imp-aurea" checked> a Aurea já chama cada um no WhatsApp</label>' +
    '</div>' +
    '<div id="imp-resultado"></div></div>' +

    '<div class="card" style="margin-top:14px"><h2>Conversas</h2>' +
    '<p class="sub">Tudo que a Aurea já conversou. Clique para ler a conversa inteira.</p>' +
    (d.sessoes.length
      ? '<table class="tbl"><thead><tr><th>Candidato</th><th>Roteiro</th><th>Situação</th><th>Respostas</th><th>Nota</th><th>Última mensagem</th></tr></thead><tbody>' +
        d.sessoes.map(function (s2) {
          const st = rotStatus[s2.status] || ['tag', s2.status];
          const rec = s2.recommendation ? rotRec[s2.recommendation] : null;
          return '<tr class="linha-sessao" data-id="' + s2.id + '" style="cursor:pointer">' +
            '<td><strong>' + esc(s2.candidato) + '</strong><div class="small muted">' + esc(s2.telefone) + '</div></td>' +
            '<td class="small">' + esc(s2.grupo) + '</td>' +
            '<td><span class="tag ' + st[0] + '">' + st[1] + '</span>' +
            (rec ? ' <span class="tag ' + rec[0] + '">' + rec[1] + '</span>' : '') + '</td>' +
            '<td class="small">' + s2.total_respostas + '</td>' +
            '<td class="small"><strong>' + (s2.score === null || s2.score === undefined ? '—' : s2.score) + '</strong></td>' +
            '<td class="small muted" style="white-space:nowrap">' + dataBr(s2.last_message_at || s2.started_at) + '</td></tr>';
        }).join('') + '</tbody></table>'
      : '<p class="small muted" style="margin:0">Nenhuma conversa ainda.</p>') +
    '</div>' +

    '<div class="card" style="margin-top:14px"><h2>Ligar o WhatsApp na Aurea</h2>' +
    '<p class="sub">Para ela <strong>receber</strong> as respostas, cole este endereço no webhook da sua Evolution API ' +
    '(Instância → Webhook → marque o evento <code>MESSAGES_UPSERT</code>).</p>' +
    '<div class="item"><div class="topo"><span class="t" style="word-break:break-all;font-family:ui-monospace,monospace;font-size:12.5px">' +
    esc(d.webhook_url) + '</span>' +
    '<button class="btn btn-sm btn-ghost" id="a-copiar-webhook">Copiar</button></div></div>' +
    '<p class="small muted" style="margin:12px 0 0">Sem esse passo a Aurea envia as perguntas mas não escuta as respostas.</p>' +
    '</div>';

  ligaAurea(d);
}

function ligaAurea(d) {
  document.getElementById('a-salvar').addEventListener('click', async function () {
    try {
      await api('aurea_config_save', {
        body: {
          value: {
            ativa: document.getElementById('a-ativa').checked,
            auto_ao_receber_formulario: document.getElementById('a-auto').checked,
            horario_comercial: document.getElementById('a-horario').checked,
            hora_inicio: Number(document.getElementById('a-h1').value) || 8,
            hora_fim: Number(document.getElementById('a-h2').value) || 20,
            modelo: document.getElementById('a-modelo').value.trim(),
            instancia_whatsapp: document.getElementById('a-inst').value.trim(),
            personalidade: document.getElementById('a-personalidade').value
          }
        }
      });
      toast('Aurea atualizada');
    } catch (e) { toast(e.message, true); }
  });

  document.getElementById('a-testar').addEventListener('click', async function () {
    const alvo = document.getElementById('a-teste-res');
    alvo.textContent = 'testando…';
    try {
      const r = await api('aurea_test');
      alvo.innerHTML = '<span style="color:var(--accent)">✓ ' + esc(r.resposta) + '</span>';
    } catch (e) {
      alvo.innerHTML = '<span style="color:var(--red)">✕ ' + esc(e.message) + '</span>';
    }
  });

  document.getElementById('a-copiar-webhook').addEventListener('click', function () {
    navigator.clipboard.writeText(d.webhook_url).then(function () { toast('Endereço copiado'); });
  });

  document.getElementById('imp-enviar').addEventListener('click', async function () {
    const bruto = document.getElementById('imp-lista').value.trim();
    if (!bruto) return toast('Cole a lista primeiro', true);
    const rows = bruto.split('\n').map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) {
      const p = l.split(/[;\t]/).map(function (x) { return x.trim(); });
      return { name: p[0], phone: p[1], email: p[2] || '', role: p[3] || '' };
    });
    const btn = this;
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Importando…';
    try {
      const r = await api('import_candidates', {
        body: {
          rows: rows,
          source: document.getElementById('imp-origem').value,
          role: document.getElementById('imp-vaga').value.trim(),
          group_id: document.getElementById('imp-grupo').value || null,
          iniciar_aurea: document.getElementById('imp-aurea').checked,
          forcar: true
        }
      });
      const falhas = (r.disparos || []).filter(function (x) { return !x.ok; });
      document.getElementById('imp-resultado').innerHTML =
        '<div class="alert alert-ok" style="margin-top:14px"><strong>' + r.criados.length + ' importado(s)</strong>' +
        (r.pulados.length ? ' · ' + r.pulados.length + ' pulado(s): ' +
          esc(r.pulados.map(function (p) { return (p.linha.name || '?') + ' (' + p.motivo + ')'; }).join(', ')) : '') +
        (r.disparos.length ? '<br>Aurea chamou ' + (r.disparos.length - falhas.length) + ' de ' + r.disparos.length + '.' : '') +
        (falhas.length ? '<br><span style="opacity:.85">Não deu para chamar: ' +
          esc(falhas.map(function (f) { return f.nome + ' — ' + f.error; }).join(' · ')) + '</span>' : '') +
        '</div>';
      document.getElementById('imp-lista').value = '';
      carregaBoard();
    } catch (e) {
      document.getElementById('imp-resultado').innerHTML =
        '<div class="alert alert-erro" style="margin-top:14px">' + esc(e.message) + '</div>';
    }
    btn.disabled = false; btn.textContent = 'Importar';
  });

  document.querySelectorAll('.linha-sessao').forEach(function (tr) {
    tr.addEventListener('click', function () { abreConversa(tr.dataset.id); });
  });
}

async function abreConversa(id) {
  document.getElementById('fundo').style.display = 'block';
  const gv = document.getElementById('gaveta');
  gv.style.display = 'flex';
  gv.classList.remove('aberta'); void gv.offsetWidth; gv.classList.add('aberta');
  document.getElementById('g-corpo').innerHTML = '<div class="loading-page">Carregando…</div>';

  let d;
  try { d = await api('aurea_session', { params: { id: id } }); }
  catch (e) { return toast(e.message, true); }

  const s2 = d.sessao, c = d.candidato || {};
  document.getElementById('g-nome').textContent = c.name || 'Conversa';
  const legivel = { em_andamento: 'conversando agora', concluida: 'conversa concluída',
    desistiu: 'candidato desistiu', sem_interesse: 'sem interesse', erro: 'deu erro', aguardando: 'aguardando' };
  document.getElementById('g-sub').textContent =
    (c.role_applied || 'sem vaga') + ' · ' + (c.phone || '') + ' · ' + (legivel[s2.status] || s2.status);

  const bolhas = d.mensagens.map(function (m) {
    const eu = m.role === 'aurea';
    return '<div class="bolha-msg ' + (eu ? 'aurea' : 'cand') + '">' +
      '<div class="txt">' + esc(m.text).replace(/\n/g, '<br>') + '</div>' +
      '<div class="hora">' + (eu ? 'Aurea' : (c.name || 'candidato').split(' ')[0]) + ' · ' + dataBr(m.created_at) + '</div>' +
      '</div>';
  }).join('');

  document.getElementById('g-corpo').innerHTML =
    (s2.summary
      ? '<div class="card"><h2>O que a Aurea concluiu</h2>' +
        '<div class="row row-wrap" style="gap:12px;margin:10px 0 14px">' +
        '<div class="stat" style="min-width:110px"><span><span class="n" style="display:block">' +
          (s2.score === null || s2.score === undefined ? '—' : s2.score) + '</span><span class="l">nota de 0 a 10</span></span></div>' +
        '<div class="stat" style="min-width:150px"><span><span class="n" style="display:block;font-size:19px">' +
          esc({ avancar: 'Avançar', talvez: 'Talvez', descartar: 'Descartar' }[s2.recommendation] || '—') +
          '</span><span class="l">recomendação</span></span></div></div>' +
        '<p style="margin:0;white-space:pre-wrap;line-height:1.6;font-size:14.5px">' + esc(s2.summary) + '</p></div>'
      : '<div class="card"><div class="alert alert-info" style="margin:0">Esta conversa ainda não foi encerrada, então a Aurea não gerou o resumo.</div></div>') +

    (s2.error ? '<div class="card"><div class="alert alert-erro" style="margin:0"><strong>Erro registrado</strong><br>' + esc(s2.error) + '</div></div>' : '') +

    '<div class="card"><h2>A conversa</h2>' +
    '<p class="sub">' + d.mensagens.length + ' mensagem(ns) · começou em ' + dataBr(s2.started_at) + '</p>' +
    (bolhas || '<p class="small muted" style="margin:0">Nenhuma mensagem.</p>') + '</div>';
}

/* ============================================================
   GATILHO AO CONCLUIR
   ============================================================ */
async function gatilhoConcluido(c) {
  if (!confirm(c.name.split(' ')[0] + ' foi para Concluído.\n\nEnviar agora as boas-vindas por e-mail, WhatsApp e SMS?\n' +
    'Isso também libera a área de integração e o link para ele criar a senha.')) return;
  try {
    const r = await api('send', { body: { candidate_id: c.id, set: 'welcome' } });
    const linhas = r.results.map(function (x) { return x.channel + ': ' + x.status + (x.error ? ' (' + x.error + ')' : ''); });
    alert('Resultado do envio:\n\n' + linhas.join('\n'));
    carregaBoard();
  } catch (e) { toast(e.message, true); }
}
