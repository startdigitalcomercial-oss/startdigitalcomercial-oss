/* ============================================================
   VAGAS — o que aparece na landing page
   ============================================================ */
let VAGAS_LISTA = [];
let VAGAS_GRUPOS = [];
let VAGAS_LANDING = {};
let VAGAS_CATALOGO = [];
let VAGAS_FIXOS = [];

const VG_MODO = { presencial: 'Presencial', remoto: 'Remoto', hibrido: 'Híbrido' };

function vgLinhas(v) {
  return (Array.isArray(v) ? v : []).join('\n');
}

async function carregaVagas() {
  const box = document.getElementById('painel-vagas');
  box.innerHTML = '<div class="loading-page">Carregando…</div>';
  let d;
  try { d = await api('vagas'); }
  catch (e) { box.innerHTML = '<div class="alert alert-erro">' + esc(e.message) + '</div>'; return; }

  VAGAS_LISTA = d.vagas || [];
  VAGAS_GRUPOS = d.grupos || [];
  VAGAS_LANDING = d.landing || {};
  VAGAS_CATALOGO = d.catalogo_campos || [];
  VAGAS_FIXOS = d.campos_fixos || [];
  const ativas = VAGAS_LISTA.filter(function (v) { return v.active !== false; });
  const semZap = !VAGAS_LANDING.whatsapp;

  box.innerHTML =
    (semZap
      ? '<div class="alert alert-aviso"><strong>Falta o número do WhatsApp.</strong> ' +
        'Sem ele o botão da landing não abre conversa nenhuma. Coloque em <strong>Ajustes → Landing page</strong>.</div>'
      : '') +

    '<div class="grid grid-3" style="margin-bottom:16px">' +
      '<div class="stat"><div class="n">' + ativas.length + '</div><div class="l">' +
        (ativas.length === 1 ? 'vaga no ar' : 'vagas no ar') + '</div></div>' +
      '<div class="stat"><div class="n">' +
        VAGAS_LISTA.reduce(function (a, v) { return a + (v.candidatos || 0); }, 0) +
        '</div><div class="l">candidatos vindos das vagas</div></div>' +
      '<div class="stat"><div class="n">' +
        VAGAS_LISTA.filter(function (v) { return v.active === false; }).length +
        '</div><div class="l">encerradas</div></div>' +
    '</div>' +

    '<div class="card"><div class="row" style="justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap">' +
      '<div><h2 style="margin:0 0 3px">A sua página de vagas</h2>' +
      '<p class="sub" style="margin:0">É esta a página que o candidato vê. Arraste pela alça para mudar a ordem.</p></div>' +
      '<div class="row" style="gap:10px">' +
        '<a class="btn btn-sm btn-ghost" href="/vagas" target="_blank" rel="noopener">Abrir a página</a>' +
        '<button class="btn btn-sm" id="vg-nova">Nova vaga</button>' +
      '</div>' +
    '</div></div>' +

    '<div class="card" style="padding:0;overflow:hidden" id="vg-lista">' +
      (VAGAS_LISTA.length
        ? VAGAS_LISTA.map(vgItem).join('')
        : '<p class="sub" style="padding:24px;margin:0">Nenhuma vaga cadastrada. Clique em <strong>Nova vaga</strong> ' +
          'para publicar a primeira.</p>') +
    '</div>';

  ligaVagas();
}

function vgItem(v) {
  const local = [VG_MODO[v.work_mode] || '', v.location].filter(Boolean).join(' · ');
  return '<div class="vg-item' + (v.active === false ? ' off' : '') + '" data-id="' + esc(v.id) + '">' +
    '<span class="vg-pega" title="Arraste para reordenar">' +
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">' +
      '<circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/>' +
      '<circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>' +
    '</span>' +
    '<div class="vg-info">' +
      '<h3>' + esc(v.title) +
        (v.active === false ? ' <span class="tag">encerrada</span>' : '') +
        (v.featured ? ' <span class="tag tag-verde">destaque</span>' : '') + '</h3>' +
      (v.summary ? '<div class="small muted">' + esc(v.summary) + '</div>' : '') +
      '<div class="vg-tags">' +
        (v.area ? '<span class="tag">' + esc(v.area) + '</span>' : '') +
        (v.salary ? '<span class="tag">' + esc(v.salary) + '</span>' : '') +
        (local ? '<span class="tag">' + esc(local) + '</span>' : '') +
        '<span class="tag">' + (v.candidatos || 0) + ' candidato(s)</span>' +
        ((v.campos_form || []).length
          ? '<span class="tag">+' + v.campos_form.length + ' no formulário</span>' : '') +
      '</div>' +
    '</div>' +
    '<button class="btn btn-sm btn-ghost vg-editar" data-id="' + esc(v.id) + '">Editar</button>' +
  '</div>';
}

function ligaVagas() {
  const nova = document.getElementById('vg-nova');
  if (nova) nova.addEventListener('click', function () { abreVaga(null); });

  document.querySelectorAll('.vg-editar').forEach(function (b) {
    b.addEventListener('click', function () { abreVaga(b.dataset.id); });
  });

  // arrastar para reordenar — igual ao das aulas
  const lista = document.getElementById('vg-lista');
  if (!lista) return;
  let pegou = null;

  lista.querySelectorAll('.vg-item').forEach(function (it) {
    const pega = it.querySelector('.vg-pega');
    if (!pega) return;
    pega.addEventListener('mousedown', function () { it.draggable = true; });
    pega.addEventListener('touchstart', function () { it.draggable = true; }, { passive: true });
    it.addEventListener('mouseup', function () { it.draggable = false; });

    it.addEventListener('dragstart', function () { pegou = it; it.classList.add('arrastando'); });
    it.addEventListener('dragend', function () {
      it.classList.remove('arrastando');
      it.draggable = false;
      lista.querySelectorAll('.vg-item').forEach(function (x) { x.classList.remove('alvo'); });
      salvaOrdemVagas();
    });
    it.addEventListener('dragover', function (ev) {
      ev.preventDefault();
      if (!pegou || pegou === it) return;
      it.classList.add('alvo');
      const meio = it.getBoundingClientRect().top + it.offsetHeight / 2;
      if (ev.clientY < meio) lista.insertBefore(pegou, it);
      else lista.insertBefore(pegou, it.nextSibling);
    });
    it.addEventListener('dragleave', function () { it.classList.remove('alvo'); });
  });
}

async function salvaOrdemVagas() {
  const ids = Array.from(document.querySelectorAll('#vg-lista .vg-item')).map(function (x) { return x.dataset.id; });
  const igual = ids.every(function (id, i) { return VAGAS_LISTA[i] && VAGAS_LISTA[i].id === id; });
  if (igual) return;
  try {
    await api('vaga_ordem', { body: { ids: ids } });
    toast('Ordem salva');
    VAGAS_LISTA = ids.map(function (id) {
      return VAGAS_LISTA.filter(function (v) { return v.id === id; })[0];
    }).filter(Boolean);
  } catch (e) { toast(e.message, true); }
}

/* ---------------------------------------------- editor ---------------------------------------------- */
function abreVaga(id) {
  const v = id ? VAGAS_LISTA.filter(function (x) { return x.id === id; })[0] : null;
  const novo = !v;
  const d = v || {};

  document.getElementById('g-nome').textContent = novo ? 'Nova vaga' : d.title;
  document.getElementById('g-sub').textContent = novo
    ? 'Ela aparece na página assim que você salvar'
    : (d.active === false ? 'Encerrada — não aparece na página' : 'No ar em /vagas');

  function campo(id2, rot, valor, dica, tipo) {
    return '<div class="field" style="margin-top:14px"><label for="' + id2 + '">' + rot + '</label>' +
      (dica ? '<span class="hint">' + dica + '</span>' : '') +
      (tipo === 'area'
        ? '<textarea id="' + id2 + '" rows="4">' + esc(valor || '') + '</textarea>'
        : '<input type="text" id="' + id2 + '" value="' + esc(valor || '') + '">') +
      '</div>';
  }

  document.getElementById('g-corpo').innerHTML =
    campo('vg-title', 'Título da vaga', d.title, 'É por este nome que a Aurea reconhece a vaga no WhatsApp.') +
    campo('vg-summary', 'Resumo de uma linha', d.summary, 'Aparece embaixo do título no card.') +
    campo('vg-salary', 'Salário', d.salary, 'Escreva do jeito que quer mostrar. Ex.: R$ 2.200 + Comissões') +

    '<div class="grid grid-2" style="gap:14px">' +
      campo('vg-area', 'Área', d.area, 'Vira filtro na página. Ex.: Tráfego Pago') +
      campo('vg-seniority', 'Nível', d.seniority, 'Ex.: Júnior, Pleno, Sênior') +
      campo('vg-employment', 'Contrato', d.employment_type, 'Ex.: CLT, PJ, Estágio') +
      '<div class="field" style="margin-top:14px"><label for="vg-mode">Modelo</label>' +
        '<span class="hint">Presencial, remoto ou híbrido</span>' +
        '<select id="vg-mode">' +
          '<option value="">Não informar</option>' +
          ['presencial', 'remoto', 'hibrido'].map(function (m) {
            return '<option value="' + m + '"' + (d.work_mode === m ? ' selected' : '') + '>' + VG_MODO[m] + '</option>';
          }).join('') +
        '</select></div>' +
      campo('vg-location', 'Local', d.location, 'Ex.: Praia Grande, SP') +
      campo('vg-schedule', 'Horário', d.schedule, 'Ex.: 08h45 às 18h') +
    '</div>' +

    campo('vg-description', 'Sobre a vaga', d.description, 'Texto livre. Pode usar parágrafos.', 'area') +
    campo('vg-resp', 'O que a pessoa vai fazer', vgLinhas(d.responsibilities), 'Um item por linha.', 'area') +
    campo('vg-req', 'O que a gente espera', vgLinhas(d.requirements), 'Um item por linha.', 'area') +
    campo('vg-ben', 'O que oferecemos', vgLinhas(d.benefits), 'Um item por linha.', 'area') +

    '<hr class="sep">' +
    '<h3 style="font-size:14px;margin:0 0 4px">O que o formulário pergunta</h3>' +
    '<p class="small muted" style="margin:0 0 12px">Antes de ir para o WhatsApp, o candidato preenche este ' +
    'formulário na página da vaga. Marque o que <strong>esta vaga</strong> precisa saber.</p>' +
    '<div class="cp-fixos">' +
      VAGAS_FIXOS.map(function (f) {
        return '<span class="cp-fixo">' + esc(f.rotulo) + '</span>';
      }).join('') +
      '<span class="cp-nota">sempre pedidos</span>' +
    '</div>' +
    '<div class="cp-lista">' +
      VAGAS_CATALOGO.map(function (c) {
        const marcado = (d.campos_form || []).indexOf(c.chave) >= 0;
        return '<label class="cp-item' + (marcado ? ' on' : '') + '">' +
          '<input type="checkbox" class="cp-check" value="' + esc(c.chave) + '"' +
          (marcado ? ' checked' : '') + '>' +
          '<span><strong>' + esc(c.rotulo) + '</strong>' +
          (c.tipo === 'arquivo' ? ' <span class="tag">anexo</span>' : '') +
          (c.dica ? '<em>' + esc(c.dica) + '</em>' : '') + '</span>' +
        '</label>';
      }).join('') +
    '</div>' +

    '<hr class="sep">' +
    '<h3 style="font-size:14px;margin:0 0 8px">Conversa no WhatsApp</h3>' +
    '<p class="small muted" style="margin:0 0 12px">Quando a pessoa clica em "Quero me candidatar", ' +
    'ela cai no WhatsApp com esta frase já escrita — e a Aurea usa o roteiro escolhido abaixo.</p>' +
    campo('vg-zapmsg', 'Frase do botão', d.whatsapp_message,
      'Deixe em branco para usar: "Olá! Tenho interesse na vaga de ' + esc(d.title || '…') + '."') +
    campo('vg-perguntas', 'Perguntas desta vaga no WhatsApp', d.wa_perguntas,
      'A Aurea manda estas perguntas logo na saudação. Deixe em branco e ela só pede o vídeo e o cadastro, ' +
      'que é o padrão de toda vaga.', 'area') +
    '<div class="field" style="margin-top:14px"><label for="vg-grupo">Roteiro de perguntas</label>' +
      '<span class="hint">O que a Aurea vai perguntar para quem se candidatar a esta vaga.</span>' +
      '<select id="vg-grupo">' +
        '<option value="">Usar o roteiro padrão</option>' +
        VAGAS_GRUPOS.map(function (g) {
          return '<option value="' + esc(g.id) + '"' + (d.prequal_group_id === g.id ? ' selected' : '') + '>' +
            esc(g.name) + (g.is_default ? ' (padrão)' : '') + '</option>';
        }).join('') +
      '</select></div>' +

    '<hr class="sep">' +
    '<div class="row row-wrap" style="gap:18px;align-items:center">' +
      '<label class="row small" style="gap:7px;align-items:center"><input type="checkbox" id="vg-ativa" ' +
      (d.active !== false ? 'checked' : '') + ' style="width:16px;height:16px"> vaga no ar</label>' +
      '<label class="row small" style="gap:7px;align-items:center"><input type="checkbox" id="vg-destaque" ' +
      (d.featured ? 'checked' : '') + ' style="width:16px;height:16px"> marcar como destaque</label>' +
    '</div>' +

    '<div class="row" style="gap:12px;margin-top:20px">' +
      '<button class="btn" id="vg-salvar">' + (novo ? 'Publicar vaga' : 'Salvar') + '</button>' +
      (novo ? '' : '<button class="btn btn-ghost" id="vg-excluir" style="color:var(--red)">Excluir</button>') +
    '</div>' +
    '<div id="vg-saida"></div>';

  document.getElementById('fundo').style.display = 'block';
  document.getElementById('gaveta').style.display = 'flex';

  document.querySelectorAll('.cp-check').forEach(function (c) {
    c.addEventListener('change', function () {
      c.closest('.cp-item').classList.toggle('on', c.checked);
    });
  });

  const val = function (i) { return (document.getElementById(i) || {}).value || ''; };

  document.getElementById('vg-salvar').addEventListener('click', async function () {
    const corpo = {
      title: val('vg-title'), summary: val('vg-summary'), salary: val('vg-salary'),
      area: val('vg-area'), seniority: val('vg-seniority'), employment_type: val('vg-employment'),
      work_mode: val('vg-mode'), location: val('vg-location'), schedule: val('vg-schedule'),
      description: val('vg-description'),
      responsibilities: val('vg-resp'), requirements: val('vg-req'), benefits: val('vg-ben'),
      whatsapp_message: val('vg-zapmsg'), wa_perguntas: val('vg-perguntas'),
      campos_form: Array.from(document.querySelectorAll('.cp-check:checked'))
        .map(function (x) { return x.value; }),
      prequal_group_id: val('vg-grupo') || null,
      active: document.getElementById('vg-ativa').checked,
      featured: document.getElementById('vg-destaque').checked
    };
    if (!novo) corpo.id = d.id;
    if (!corpo.title.trim()) return toast('Escreva o título da vaga', true);

    this.disabled = true;
    this.innerHTML = '<span class="spinner"></span> Salvando…';
    try {
      await api('vaga_salvar', { body: corpo });
      toast(novo ? 'Vaga publicada' : 'Vaga salva');
      fechaGaveta();
      carregaVagas();
    } catch (e) {
      document.getElementById('vg-saida').innerHTML =
        '<div class="alert alert-erro" style="margin-top:14px">' + esc(e.message) + '</div>';
      this.disabled = false;
      this.textContent = novo ? 'Publicar vaga' : 'Salvar';
    }
  });

  const bx = document.getElementById('vg-excluir');
  if (bx) bx.addEventListener('click', async function () {
    if (!confirm('Excluir a vaga "' + d.title + '"?\n\nOs candidatos que já vieram por ela continuam no sistema.\n' +
      'Se você só quer tirar do ar, desmarque "vaga no ar" e salve.')) return;
    try {
      await api('vaga_excluir', { body: { id: d.id } });
      toast('Vaga excluída');
      fechaGaveta();
      carregaVagas();
    } catch (e) { toast(e.message, true); }
  });
}
