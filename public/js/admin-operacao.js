/* ============================================================
   OPERAÇÃO — dashboard e carteira por gestor.

   Duas telas: o Dashboard (a visão da liderança) e os Gestores
   (onde a carteira é mantida). Tudo o que aparece no dashboard sai
   dos clientes cadastrados aqui — não existe número digitado.

   Sobre as cores: a paleta dos gestores foi conferida para
   daltonismo nos dois modos. Mesmo assim, a cor NUNCA carrega a
   informação sozinha — toda fatia tem nome e número na legenda ao
   lado. Quem não distingue as cores lê o mesmo que todo mundo.
   ============================================================ */

let OP = null;                 // o que o dashboard recebeu
let OP_FILTRO = { tipo: 'mes', mes: null, ano: null, semana_atras: 0, de: '', ate: '', gestor_id: '' };
let OP_GESTORES = null;        // a tela de gestores
let OP_ABERTO = null;          // id do gestor cuja carteira está aberta
let OP_BUSCA = '', OP_F_STATUS = '', OP_F_FASE = '';

const OP_CORES = {
  azul: 'var(--g-azul)', laranja: 'var(--g-laranja)', verdeagua: 'var(--g-verdeagua)',
  amarelo: 'var(--g-amarelo)', magenta: 'var(--g-magenta)', verde: 'var(--g-verde)',
  violeta: 'var(--g-violeta)', outros: 'var(--g-outros)'
};
const OP_FASE_COR = {
  onboarding: 'var(--f1)', estrategia: 'var(--f2)', aprovacao: 'var(--f3)', consolidacao: 'var(--f4)'
};
const OP_MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

async function apiOp(action, opts) {
  opts = opts || {};
  const qs = new URLSearchParams(Object.assign({ action: action }, opts.params || {}));
  const res = await fetch('/api/operacao?' + qs.toString(), {
    method: opts.body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json().catch(function () { return { ok: false, error: 'resposta invalida' }; });
  if (res.status === 401) { sair(); throw new Error('sessao expirada'); }
  if (!data.ok) throw new Error(data.error || 'erro');
  return data;
}

function opCor(nome) { return OP_CORES[nome] || OP_CORES.azul; }

/* ---------------- os números subindo ----------------
   Contar de zero até o valor dá a sensação de que o painel
   acabou de medir aquilo. Dura meio segundo e não atrapalha
   quem só quer ler o número. */
function opConta(el, ate) {
  const alvo = Number(ate) || 0;
  if (!el) return;
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = alvo; return;
  }
  if (alvo === 0) { el.textContent = '0'; return; }
  const t0 = performance.now(), dur = 620;
  (function passo(agora) {
    const t = Math.min(1, (agora - t0) / dur);
    const e = 1 - Math.pow(1 - t, 4);
    el.textContent = Math.round(alvo * e);
    if (t < 1) requestAnimationFrame(passo);
    else el.textContent = alvo;
  })(performance.now());
}

/* ============================================================
   TELA 1 — O DASHBOARD
   ============================================================ */
function opParams() {
  const p = { gestor_id: OP_FILTRO.gestor_id || '' };
  if (OP_FILTRO.tipo === 'personalizado' && OP_FILTRO.de && OP_FILTRO.ate) {
    p.de = OP_FILTRO.de; p.ate = OP_FILTRO.ate;
  } else if (OP_FILTRO.tipo === 'semana') {
    p.semana = '1'; p.semana_atras = OP_FILTRO.semana_atras || 0;
  } else {
    if (OP_FILTRO.mes) p.mes = OP_FILTRO.mes;
    if (OP_FILTRO.ano) p.ano = OP_FILTRO.ano;
  }
  Object.keys(p).forEach(function (k) { if (p[k] === '' || p[k] == null) delete p[k]; });
  return p;
}

async function carregaOpDash() {
  const alvo = document.getElementById('painel-opdash');
  if (!OP) alvo.innerHTML = '<div class="spinner"></div>';
  try {
    const d = await apiOp('op_dashboard', { params: opParams() });
    OP = d;
    if (!OP_FILTRO.mes && d.periodo.tipo === 'mes') {
      OP_FILTRO.mes = d.periodo.mes; OP_FILTRO.ano = d.periodo.ano;
    }
    desenhaOpDash();
  } catch (e) {
    alvo.innerHTML = '<div class="alert alert-erro">' + esc(e.message) + '</div>';
  }
}

function opSelectMes() {
  const anoBase = Number((OP.hoje || '2026').slice(0, 4));
  const anos = [];
  for (let a = anoBase + 1; a >= anoBase - 3; a--) anos.push(a);
  return '<select id="op-mes" aria-label="Mês">' +
      OP_MESES.map(function (m, i) {
        return '<option value="' + (i + 1) + '"' + (OP_FILTRO.mes === i + 1 ? ' selected' : '') + '>' + m + '</option>';
      }).join('') +
    '</select>' +
    '<select id="op-ano" aria-label="Ano">' +
      anos.map(function (a) {
        return '<option value="' + a + '"' + (OP_FILTRO.ano === a ? ' selected' : '') + '>' + a + '</option>';
      }).join('') +
    '</select>';
}

function desenhaOpDash() {
  const k = OP.kpis;
  const p = OP.periodo;

  const kpi = function (rot, valor, pe, ico, classe) {
    return '<div class="op-kpi ' + (classe || '') + '">' +
      '<div class="rot">' + rot + ico + '</div>' +
      '<div class="num" data-ate="' + valor + '">0</div>' +
      '<div class="pe">' + pe + '</div></div>';
  };
  const I = {
    pessoas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="9" cy="8.6" r="3.2"/><path d="M3.8 19c.6-2.8 2.7-4.2 5.2-4.2s4.6 1.4 5.2 4.2"/><path d="M15.6 5.8a3.2 3.2 0 0 1 0 5.6"/></svg>',
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="8.4"/><path d="m8.4 12.3 2.4 2.4 4.8-5.4"/></svg>',
    pausa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="8.4"/><path d="M10.2 9.4v5.2M13.8 9.4v5.2"/></svg>',
    alerta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="8.4"/><path d="M12 7.8v4.6M12 15.8v.2"/></svg>',
    renova: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M19.6 11a7.6 7.6 0 0 0-13.2-4M4.4 13a7.6 7.6 0 0 0 13.2 4"/><path d="M19.6 4.6V11h-6M4.4 19.4V13h6"/></svg>',
    saiu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="10" cy="8.6" r="3.2"/><path d="M4.4 19c.6-2.8 2.7-4.2 5.6-4.2 1 0 1.9.2 2.7.5"/><path d="m16.4 14.6 4.2 4.2M20.6 14.6l-4.2 4.2"/></svg>'
  };

  document.getElementById('painel-opdash').innerHTML =
    '<div class="op">' +

    // ---------- 1) cabeçalho e filtros ----------
    '<div class="op-cab op-entra" style="animation-delay:0ms">' +
      '<div>' +
        '<div class="small muted">Visão geral da carteira de clientes e desempenho operacional.</div>' +
      '</div>' +
      '<div class="op-filtros">' +
        '<select id="op-tipo" aria-label="Tipo de período">' +
          '<option value="mes"' + (p.tipo === 'mes' ? ' selected' : '') + '>Por mês</option>' +
          '<option value="semana"' + (p.tipo === 'semana' ? ' selected' : '') + '>Por semana</option>' +
          '<option value="personalizado"' + (p.tipo === 'personalizado' ? ' selected' : '') + '>Período</option>' +
        '</select>' +
        (p.tipo === 'mes' ? opSelectMes() : '') +
        (p.tipo === 'semana'
          ? '<select id="op-semana" aria-label="Semana">' +
              [[0, 'Esta semana'], [1, 'Semana passada'], [2, 'Duas semanas atrás'], [3, 'Três semanas atrás']]
                .map(function (o) {
                  return '<option value="' + o[0] + '"' +
                    (Number(OP_FILTRO.semana_atras) === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
                }).join('') + '</select>'
          : '') +
        (p.tipo === 'personalizado'
          ? '<input type="date" id="op-de" value="' + esc(OP_FILTRO.de || p.de) + '" aria-label="Data inicial">' +
            '<input type="date" id="op-ate" value="' + esc(OP_FILTRO.ate || p.ate) + '" aria-label="Data final">'
          : '') +
        '<select id="op-gestor" aria-label="Gestor">' +
          '<option value="">Todos os gestores</option>' +
          (OP.por_gestor || []).map(function (g) {
            return '<option value="' + esc(g.id) + '"' +
              (OP_FILTRO.gestor_id === g.id ? ' selected' : '') + '>' + esc(g.nome) + '</option>';
          }).join('') +
        '</select>' +
        (opTemFiltro() ? '<button class="btn btn-sm btn-ghost" id="op-limpar">Limpar</button>' : '') +
      '</div>' +
    '</div>' +

    (OP.vazio ? opVazioGeral() : (

    '<div class="small muted" style="margin:2px 0 16px">Período: <strong>' + esc(p.rotulo) + '</strong>' +
      (OP_FILTRO.gestor_id ? ' · só ' + esc(opNomeGestor(OP_FILTRO.gestor_id)) : '') + '</div>' +

    // ---------- 2) visão executiva ----------
    '<div class="op-kpis op-entra" style="animation-delay:60ms">' +
      kpi('Total de clientes', k.total, 'na carteira ao fim do período', I.pessoas, '') +
      kpi('Ativos', k.ativos, 'tocando o projeto', I.ok, 'bom') +
      kpi('Suspensos', k.suspensos, 'pausados', I.pausa, 'atencao') +
      kpi('Flopados', k.flopados, 'precisam de atenção', I.alerta, 'ruim') +
      kpi('Renovados', k.renovados, 'renovaram no período', I.renova, 'bom') +
      kpi('Cancelados', k.cancelados, 'saíram no período', I.saiu, 'ruim') +
    '</div>' +

    // ---------- 3) distribuição ----------
    '<div class="op-grade2">' +
      '<div class="card op-entra" style="animation-delay:120ms">' +
        '<h3 style="margin:0 0 2px;font-size:15.5px">Distribuição por gestor</h3>' +
        '<div class="small muted" style="margin-bottom:16px">Clique num gestor para abrir a carteira dele.</div>' +
        opRosca() +
      '</div>' +
      '<div class="card op-entra" style="animation-delay:180ms">' +
        '<h3 style="margin:0 0 2px;font-size:15.5px">Fases dos projetos</h3>' +
        '<div class="small muted" style="margin-bottom:16px">Onde a carteira está parada agora.</div>' +
        (OP.fases || []).map(function (f) {
          return opBarra(f.nome, f.clientes, f.percentual, OP_FASE_COR[f.chave], 'fase', f.chave);
        }).join('') +
      '</div>' +
    '</div>' +

    // ---------- 4) qualidade operacional ----------
    '<div class="op-grade2">' +
      '<div class="card op-entra" style="animation-delay:240ms">' +
        '<h3 style="margin:0 0 2px;font-size:15.5px">Situação da carteira</h3>' +
        '<div class="small muted" style="margin-bottom:16px">Cancelados ficam fora: são histórico de saída.</div>' +
        (OP.situacao || []).map(function (s) {
          const cor = s.chave === 'ativo' ? 'var(--green)'
            : (s.chave === 'suspenso' ? 'var(--orange)' : 'var(--red)');
          return opBarra(s.nome, s.clientes, s.percentual, cor, 'status', s.chave);
        }).join('') +
        '<div class="small muted" style="margin-top:14px;padding-top:12px;border-top:1px solid var(--hairline)">' +
          '<strong>' + OP.saidas + '</strong> cliente(s) cancelado(s) no histórico desta carteira.</div>' +
      '</div>' +
      '<div class="card op-entra" style="animation-delay:300ms">' +
        '<h3 style="margin:0 0 2px;font-size:15.5px">Nível de satisfação</h3>' +
        '<div class="small muted" style="margin-bottom:16px">Quem não foi classificado fica como “não informado”.</div>' +
        (OP.satisfacao || []).map(function (s) {
          const cor = { satisfeito: 'var(--green)', neutro: 'var(--label-3)',
            insatisfeito: 'var(--red)', nao_informado: 'var(--fill-3)' }[s.chave];
          return opBarra(s.nome, s.clientes, s.percentual, cor, '', '');
        }).join('') +
      '</div>' +
    '</div>' +

    // ---------- 5) movimentação ----------
    '<div class="card op-entra" style="animation-delay:360ms">' +
      '<h3 style="margin:0 0 2px;font-size:15.5px">Movimentação de clientes</h3>' +
      '<div class="small muted" style="margin-bottom:16px">' +
        'Eventos acontecidos entre ' + esc(p.de.split('-').reverse().join('/')) +
        ' e ' + esc(p.ate.split('-').reverse().join('/')) +
        '. Um cliente que renovou duas vezes conta uma vez.</div>' +
      '<div class="row row-wrap" style="gap:40px">' +
        '<div><div class="small muted" style="font-weight:600;margin-bottom:4px">Renovações</div>' +
          '<div style="font-size:26px;font-weight:700;color:var(--green);font-variant-numeric:tabular-nums" ' +
          'class="op-sobe" data-ate="' + k.renovados + '">0</div></div>' +
        '<div><div class="small muted" style="font-weight:600;margin-bottom:4px">Cancelamentos</div>' +
          '<div style="font-size:26px;font-weight:700;color:var(--red);font-variant-numeric:tabular-nums" ' +
          'class="op-sobe" data-ate="' + k.cancelados + '">0</div></div>' +
      '</div>' +
    '</div>'
    )) + '</div>';

  opAnima();
  ligaOpDash();
}

function opTemFiltro() {
  return !!(OP_FILTRO.gestor_id || OP_FILTRO.tipo !== 'mes');
}
function opNomeGestor(id) {
  const g = (OP.por_gestor || []).filter(function (x) { return x.id === id; })[0];
  return g ? g.nome : '';
}

function opVazioGeral() {
  return '<div class="card" style="text-align:center;padding:48px 24px">' +
    '<div style="font-size:15.5px;font-weight:600;margin-bottom:6px">A carteira ainda está vazia</div>' +
    '<div class="small muted" style="max-width:420px;margin:0 auto 18px;line-height:1.6">' +
      'Assim que os gestores cadastrarem os clientes, os números aparecem aqui sozinhos. ' +
      'Nada neste painel é digitado à mão.</div>' +
    '<button class="btn btn-sm" id="op-ir-gestores">Ir para Gestores</button></div>';
}

/* ---------------- a rosca ----------------
   Um anel SVG: cada gestor vira um pedaço do contorno. Desenhar com
   stroke-dasharray deixa a animação de "desenhar sozinho" sair de
   graça, e o furo do meio guarda o total. */
function opRosca() {
  const lista = (OP.por_gestor || []).filter(function (g) { return g.clientes > 0; });
  const total = lista.reduce(function (a, g) { return a + g.clientes; }, 0);

  if (!total) {
    return '<div class="small muted" style="padding:28px 0;text-align:center">' +
      'Nenhum cliente neste período.</div>';
  }

  const R = 70, C = 2 * Math.PI * R;
  let acum = 0;
  const fatias = lista.map(function (g) {
    const frac = g.clientes / total;
    const dash = (frac * C) - 2;                 // 2px de respiro entre as fatias
    const off = -acum * C;
    acum += frac;
    return '<circle class="fatia" data-id="' + esc(g.id) + '" cx="90" cy="90" r="' + R + '" fill="none" ' +
      'stroke="' + opCor(g.cor) + '" stroke-width="17" stroke-linecap="butt" ' +
      'stroke-dasharray="' + Math.max(dash, 0.1) + ' ' + (C - Math.max(dash, 0.1)) + '" ' +
      'stroke-dashoffset="' + off + '"><title>' + esc(g.nome) + ': ' + g.clientes +
      ' cliente(s) · ' + String(g.percentual).replace('.', ',') + '%</title></circle>';
  }).join('');

  return '<div class="op-rosca" id="op-rosca">' +
    '<svg width="180" height="180" viewBox="0 0 180 180" role="img" aria-label="Clientes por gestor">' +
      '<circle cx="90" cy="90" r="' + R + '" fill="none" stroke="var(--fill-1)" stroke-width="17"/>' +
      '<g class="anel">' + fatias + '</g>' +
      '<text class="op-centro" x="90" y="88" text-anchor="middle">' +
        '<tspan class="n" id="op-rosca-n">' + total + '</tspan></text>' +
      '<text class="op-centro t" x="90" y="104" text-anchor="middle">clientes</text>' +
    '</svg>' +
    '<div class="op-legenda">' +
      lista.map(function (g) {
        return '<button type="button" class="op-leg" data-id="' + esc(g.id) + '">' +
          '<span class="bolinha" style="background:' + opCor(g.cor) + '"></span>' +
          '<span class="nome">' + esc(g.nome) + '</span>' +
          '<span class="qtd">' + g.clientes + '</span>' +
          '<span class="pct">' + String(g.percentual).replace('.', ',') + '%</span>' +
        '</button>';
      }).join('') +
      (OP.sem_gestor ? '<button type="button" class="op-leg" data-id="">' +
        '<span class="bolinha" style="background:var(--g-outros)"></span>' +
        '<span class="nome">Sem gestor</span><span class="qtd">' + OP.sem_gestor + '</span>' +
        '<span class="pct"></span></button>' : '') +
    '</div></div>';
}

function opBarra(nome, qtd, pct, cor, filtro, chave) {
  const tag = filtro ? 'button' : 'div';
  return '<' + tag + ' class="op-barra"' +
    (filtro ? ' type="button" data-filtro="' + filtro + '" data-chave="' + chave + '"' : '') + '>' +
    '<div class="topo"><b>' + esc(nome) + '</b>' +
      '<span><b>' + qtd + '</b> · ' + String(pct).replace('.', ',') + '%</span></div>' +
    '<div class="op-trilho"><div class="op-fita" data-pct="' + pct + '" style="background:' + cor + '"></div></div>' +
  '</' + tag + '>';
}

// Dispara as animações depois que o HTML já está na tela.
// Recebe QUAL painel animar: a Agenda também usa estes cartões, e
// com o seletor preso no dashboard os números dela ficavam em zero.
function opAnima(painel) {
  const raiz = document.getElementById(painel || 'painel-opdash');
  if (!raiz) return;
  raiz.querySelectorAll('.op-kpi .num, .op-sobe')
    .forEach(function (el) { opConta(el, el.dataset.ate); });
  requestAnimationFrame(function () {
    raiz.querySelectorAll('.op-fita').forEach(function (f) {
      f.style.width = Math.max(Number(f.dataset.pct) || 0, 0) + '%';
    });
  });
}

function ligaOpDash() {
  const b = function (id) { return document.getElementById(id); };

  const vazio = b('op-ir-gestores');
  if (vazio) {
    vazio.addEventListener('click', function () {
      document.querySelector('#abas button[data-aba="opgestores"]').click();
    });
    return;
  }

  b('op-tipo').addEventListener('change', function () {
    OP_FILTRO.tipo = this.value;
    if (this.value === 'personalizado' && (!OP_FILTRO.de || !OP_FILTRO.ate)) {
      OP_FILTRO.de = OP.periodo.de; OP_FILTRO.ate = OP.periodo.ate;
    }
    carregaOpDash();
  });
  ['op-mes', 'op-ano'].forEach(function (id) {
    const el = b(id);
    if (el) el.addEventListener('change', function () {
      OP_FILTRO.mes = Number(b('op-mes').value);
      OP_FILTRO.ano = Number(b('op-ano').value);
      carregaOpDash();
    });
  });
  const sem = b('op-semana');
  if (sem) sem.addEventListener('change', function () {
    OP_FILTRO.semana_atras = Number(this.value); carregaOpDash();
  });
  ['op-de', 'op-ate'].forEach(function (id) {
    const el = b(id);
    if (el) el.addEventListener('change', function () {
      OP_FILTRO.de = b('op-de').value; OP_FILTRO.ate = b('op-ate').value;
      if (OP_FILTRO.de && OP_FILTRO.ate) carregaOpDash();
    });
  });
  b('op-gestor').addEventListener('change', function () {
    OP_FILTRO.gestor_id = this.value; carregaOpDash();
  });
  const limpar = b('op-limpar');
  if (limpar) limpar.addEventListener('click', function () {
    OP_FILTRO = { tipo: 'mes', mes: null, ano: null, semana_atras: 0, de: '', ate: '', gestor_id: '' };
    carregaOpDash();
  });

  // rosca: passar o mouse acende a fatia; clicar abre o gestor
  const rosca = b('op-rosca');
  if (rosca) {
    const acende = function (id, liga) {
      rosca.classList.toggle('focado', liga);
      rosca.querySelectorAll('.fatia').forEach(function (f) {
        f.classList.toggle('aceso', liga && f.dataset.id === id);
      });
    };
    rosca.querySelectorAll('.op-leg').forEach(function (l) {
      l.addEventListener('mouseenter', function () { acende(l.dataset.id, true); });
      l.addEventListener('mouseleave', function () { acende('', false); });
      l.addEventListener('click', function () { if (l.dataset.id) abreGestor(l.dataset.id); });
    });
    rosca.querySelectorAll('.fatia').forEach(function (f) {
      f.addEventListener('mouseenter', function () { acende(f.dataset.id, true); });
      f.addEventListener('mouseleave', function () { acende('', false); });
      f.addEventListener('click', function () { abreGestor(f.dataset.id); });
    });
  }

  // clicar numa fase ou situação abre a carteira já filtrada
  document.querySelectorAll('#painel-opdash button.op-barra').forEach(function (bt) {
    bt.addEventListener('click', function () {
      OP_F_FASE = bt.dataset.filtro === 'fase' ? bt.dataset.chave : '';
      OP_F_STATUS = bt.dataset.filtro === 'status' ? bt.dataset.chave : '';
      OP_ABERTO = OP_FILTRO.gestor_id || null;
      document.querySelector('#abas button[data-aba="opgestores"]').click();
    });
  });
}

/* ============================================================
   TELA 2 — GESTORES
   ============================================================ */
async function carregaOpGestores() {
  const alvo = document.getElementById('painel-opgestores');
  if (OP_ABERTO) return abreGestor(OP_ABERTO);
  alvo.innerHTML = '<div class="spinner"></div>';
  try {
    OP_GESTORES = await apiOp('op_gestores');
    desenhaOpGestores();
  } catch (e) {
    alvo.innerHTML = '<div class="alert alert-erro">' + esc(e.message) + '</div>';
  }
}

function desenhaOpGestores() {
  const gs = OP_GESTORES.gestores || [];
  document.getElementById('painel-opgestores').innerHTML =
    '<div class="op">' +
    '<div class="op-cab">' +
      '<div><h2>Gestores</h2>' +
        '<div class="small muted">Cada gestor tem a sua carteira. Clique para abrir.</div></div>' +
      '<button class="btn btn-sm" id="opg-novo">+ Novo gestor</button>' +
    '</div>' +
    '<div class="op-kpis" style="grid-template-columns:repeat(auto-fit,minmax(230px,1fr))">' +
      gs.map(function (g, i) {
        return '<button class="op-cartao-gestor op-entra" data-id="' + esc(g.id) + '" ' +
          'style="animation-delay:' + (i * 45) + 'ms">' +
          '<div class="row" style="gap:11px;align-items:center;margin-bottom:12px">' +
            '<span class="op-ini" style="background:' + opCor(g.cor) + '">' +
              esc((g.nome || '?')[0].toUpperCase()) + '</span>' +
            '<div style="min-width:0">' +
              '<div style="font-weight:650;font-size:15px">' + esc(g.nome) + '</div>' +
              '<div class="small muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' +
                esc(g.colaborador || 'sem colaborador vinculado') + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="row" style="gap:14px">' +
            '<div><div style="font-size:21px;font-weight:700;font-variant-numeric:tabular-nums">' +
              g.clientes + '</div><div class="small muted">clientes</div></div>' +
            '<div><div style="font-size:21px;font-weight:700;color:var(--green);font-variant-numeric:tabular-nums">' +
              g.ativos + '</div><div class="small muted">ativos</div></div>' +
            '<div><div style="font-size:21px;font-weight:700;color:var(--orange);font-variant-numeric:tabular-nums">' +
              g.suspensos + '</div><div class="small muted">susp.</div></div>' +
            '<div><div style="font-size:21px;font-weight:700;color:var(--red);font-variant-numeric:tabular-nums">' +
              g.flopados + '</div><div class="small muted">flop.</div></div>' +
          '</div></button>';
      }).join('') +
    '</div></div>';

  document.querySelectorAll('.op-cartao-gestor').forEach(function (c) {
    c.addEventListener('click', function () { abreGestor(c.dataset.id); });
  });
  document.getElementById('opg-novo').addEventListener('click', function () { abreFichaGestor(null); });
}

/* ---------------- a carteira de um gestor ---------------- */
async function abreGestor(id) {
  OP_ABERTO = id;
  const alvo = document.getElementById('painel-opgestores');
  alvo.innerHTML = '<div class="spinner"></div>';
  try {
    if (!OP_GESTORES) OP_GESTORES = await apiOp('op_gestores');
    const d = await apiOp('op_carteira', { params: { gestor_id: id } });
    desenhaCarteira(id, d);
  } catch (e) {
    OP_ABERTO = null;
    alvo.innerHTML = '<div class="alert alert-erro">' + esc(e.message) + '</div>';
  }
}

let OP_CART = null;

function opChave(t) {
  return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function desenhaCarteira(id, d) {
  OP_CART = d;
  const g = (OP_GESTORES.gestores || []).filter(function (x) { return x.id === id; })[0] || { nome: '—' };

  document.getElementById('painel-opgestores').innerHTML =
    '<div class="op">' +
    '<button class="btn btn-sm btn-ghost" id="opg-voltar" style="margin-bottom:14px">‹ Todos os gestores</button>' +

    '<div class="card" style="margin-bottom:16px">' +
      '<div class="row row-wrap" style="justify-content:space-between;align-items:flex-start;gap:12px">' +
        '<div class="row" style="gap:12px;align-items:center">' +
          '<span class="op-ini" style="background:' + opCor(g.cor) + ';width:42px;height:42px;font-size:17px">' +
            esc((g.nome || '?')[0].toUpperCase()) + '</span>' +
          '<div><h2 style="margin:0;font-size:20px">' + esc(g.nome) + '</h2>' +
            '<div class="small muted">' + esc(g.colaborador || 'sem colaborador vinculado') +
            (g.cargo ? ' · ' + esc(g.cargo) : '') + '</div></div>' +
        '</div>' +
        '<div class="row" style="gap:8px">' +
          '<button class="btn btn-sm btn-ghost" id="opg-editar">Editar gestor</button>' +
          '<button class="btn btn-sm" id="opc-novo">+ Cliente</button>' +
        '</div>' +
      '</div>' +
      '<div class="row row-wrap" style="gap:36px;margin-top:20px">' +
        opMini('Clientes', g.clientes, '') + opMini('Ativos', g.ativos, 'var(--green)') +
        opMini('Suspensos', g.suspensos, 'var(--orange)') + opMini('Flopados', g.flopados, 'var(--red)') +
      '</div>' +
    '</div>' +

    '<div class="row row-wrap ob-filtros" style="gap:10px;align-items:flex-end;margin-bottom:14px">' +
      buscaHtml('opc-busca', 'Buscar cliente…', OP_BUSCA) +
      '<div class="field" style="margin:0"><label for="opc-status">Situação</label>' +
        '<select id="opc-status"><option value="">Todas</option>' +
          d.status.map(function (s) {
            return '<option value="' + s + '"' + (OP_F_STATUS === s ? ' selected' : '') + '>' +
              esc(d.status_nome[s]) + '</option>';
          }).join('') + '</select></div>' +
      '<div class="field" style="margin:0"><label for="opc-fase">Fase</label>' +
        '<select id="opc-fase"><option value="">Todas</option>' +
          d.fases.map(function (f) {
            return '<option value="' + f + '"' + (OP_F_FASE === f ? ' selected' : '') + '>' +
              esc(d.fases_nome[f]) + '</option>';
          }).join('') + '</select></div>' +
      '<span style="flex:1"></span><span class="small muted" id="opc-conta"></span>' +
    '</div>' +

    '<div class="card" style="padding:0;overflow:hidden"><div style="overflow-x:auto">' +
      '<table class="tbl" style="min-width:720px"><thead><tr>' +
        '<th style="padding:12px 16px 10px">Cliente</th><th>Categoria</th>' +
        '<th>Satisfação</th><th>Fase</th><th>Situação</th><th></th>' +
      '</tr></thead><tbody id="opc-corpo"></tbody></table>' +
    '</div></div></div>';

  pintaCarteira();

  document.getElementById('opg-voltar').addEventListener('click', function () {
    OP_ABERTO = null; OP_BUSCA = ''; OP_F_STATUS = ''; OP_F_FASE = '';
    carregaOpGestores();
  });
  document.getElementById('opg-editar').addEventListener('click', function () { abreFichaGestor(id); });
  document.getElementById('opc-novo').addEventListener('click', function () { abreFichaCliente(null, id); });

  // a carteira inteira já veio nesta chamada: filtra na mesma tecla
  ligaBusca('opc-busca', function (texto) { OP_BUSCA = texto; pintaCarteira(); }, 0);
  document.getElementById('opc-status').addEventListener('change', function () {
    OP_F_STATUS = this.value; pintaCarteira();
  });
  document.getElementById('opc-fase').addEventListener('change', function () {
    OP_F_FASE = this.value; pintaCarteira();
  });
}

function opMini(rot, n, cor) {
  return '<div><div style="font-size:24px;font-weight:700;font-variant-numeric:tabular-nums' +
    (cor ? ';color:' + cor : '') + '">' + n + '</div>' +
    '<div class="small muted">' + rot + '</div></div>';
}

const OP_CARINHA = {
  satisfeito: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="8.6"/><path d="M8.4 14.2a4.4 4.4 0 0 0 7.2 0"/><path d="M9.4 9.6v.2M14.6 9.6v.2"/></svg>',
  neutro: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="8.6"/><path d="M8.8 14.6h6.4"/><path d="M9.4 9.6v.2M14.6 9.6v.2"/></svg>',
  insatisfeito: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="8.6"/><path d="M8.4 15.6a4.4 4.4 0 0 1 7.2 0"/><path d="M9.4 9.6v.2M14.6 9.6v.2"/></svg>',
  nao_informado: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="8.6"/><path d="M9.8 9.8a2.3 2.3 0 1 1 2.6 2.4v1.2"/><path d="M12 16.6v.2"/></svg>'
};

function pintaCarteira() {
  const d = OP_CART;
  let lista = d.clientes || [];
  const b = opChave(OP_BUSCA);
  if (b) lista = lista.filter(function (c) { return opChave(c.nome).indexOf(b) >= 0; });
  if (OP_F_STATUS) lista = lista.filter(function (c) { return c.status === OP_F_STATUS; });
  if (OP_F_FASE) lista = lista.filter(function (c) { return c.fase === OP_F_FASE; });

  const conta = document.getElementById('opc-conta');
  if (conta) conta.textContent = lista.length + (lista.length === 1 ? ' cliente' : ' clientes');

  document.getElementById('opc-corpo').innerHTML = lista.length
    ? lista.map(function (c) {
        const s = c.satisfacao || 'nao_informado';
        return '<tr>' +
          '<td style="padding-left:16px;font-weight:600">' + esc(c.nome) + '</td>' +
          '<td class="small muted">' + esc(c.categoria || '—') + '</td>' +
          '<td><span class="op-carinha ' + s + '">' + OP_CARINHA[s] + esc(c.satisfacao_nome) + '</span></td>' +
          '<td><span class="op-fase"><i style="background:' + OP_FASE_COR[c.fase] + '"></i>' +
            esc(c.fase_nome) + '</span></td>' +
          '<td><span class="op-pino ' + c.status + '">' + esc(c.status_nome) + '</span></td>' +
          '<td style="text-align:right;padding-right:14px;white-space:nowrap">' +
            '<button class="btn btn-sm btn-ghost opc-editar" data-id="' + esc(c.id) + '">Abrir</button></td>' +
        '</tr>';
      }).join('')
    : '<tr><td colspan="6" style="padding:26px" class="muted">' +
      ((b || OP_F_STATUS || OP_F_FASE)
        ? 'Nenhum cliente com esses filtros.'
        : 'Este gestor ainda não tem clientes. Use “+ Cliente” para começar.') + '</td></tr>';

  document.querySelectorAll('.opc-editar').forEach(function (bt) {
    bt.addEventListener('click', function () { abreFichaCliente(bt.dataset.id, OP_ABERTO); });
  });
}

/* ---------------- ficha do gestor ---------------- */
function abreFichaGestor(id) {
  const novo = !id;
  const g = novo ? { nome: '', cor: 'azul', ativo: true }
    : ((OP_GESTORES.gestores || []).filter(function (x) { return x.id === id; })[0] || {});

  document.getElementById('g-nome').textContent = novo ? 'Novo gestor' : (g.nome || 'Gestor');
  document.getElementById('g-sub').textContent = 'A carteira e o histórico dele não mudam de lugar.';

  document.getElementById('g-corpo').innerHTML =
    '<div class="field"><label for="opg-f-nome">Como o time chama</label>' +
      '<span class="hint">Nome curto, do jeito que vocês falam no dia a dia. Ex.: “Rafael”.</span>' +
      '<input id="opg-f-nome" maxlength="60" value="' + esc(g.nome || '') + '"></div>' +
    '<div class="field"><label for="opg-f-colab">Colaborador</label>' +
      '<span class="hint">Liga ao cadastro que já existe, para não ter dois lugares com o mesmo nome.</span>' +
      '<select id="opg-f-colab"><option value="">— sem vínculo —</option>' +
        (OP_GESTORES.colaboradores || []).map(function (c) {
          return '<option value="' + esc(c.id) + '"' + (g.collaborator_id === c.id ? ' selected' : '') + '>' +
            esc(c.name) + (c.role_title ? ' — ' + esc(c.role_title) : '') + '</option>';
        }).join('') + '</select></div>' +
    '<div class="field"><label>Cor na rosca do dashboard</label>' +
      '<div class="pl-cores" id="opg-f-cores">' +
        (OP_GESTORES.cores || []).map(function (c) {
          return '<button type="button" class="pl-opt-cor' + (g.cor === c ? ' on' : '') + '" data-c="' + c + '" ' +
            'style="background:' + opCor(c) + '" title="' + c + '"></button>';
        }).join('') +
      '</div><input type="hidden" id="opg-f-cor" value="' + esc(g.cor || 'azul') + '"></div>' +
    '<label class="row small" style="gap:8px;margin-top:4px">' +
      '<input type="checkbox" id="opg-f-ativo" ' + (g.ativo !== false ? 'checked' : '') +
      ' style="width:16px;height:16px"> está na operação</label>' +
    '<div class="row" style="gap:12px;margin-top:20px">' +
      '<button class="btn" id="opg-f-salvar">' + (novo ? 'Adicionar' : 'Salvar') + '</button></div>' +
    '<div id="opg-f-saida"></div>';

  document.getElementById('fundo').style.display = 'block';
  document.getElementById('gaveta').style.display = 'flex';

  document.querySelectorAll('#opg-f-cores .pl-opt-cor').forEach(function (bt) {
    bt.addEventListener('click', function () {
      document.querySelectorAll('#opg-f-cores .pl-opt-cor').forEach(function (x) { x.classList.remove('on'); });
      bt.classList.add('on');
      document.getElementById('opg-f-cor').value = bt.dataset.c;
    });
  });

  document.getElementById('opg-f-salvar').addEventListener('click', async function () {
    const nome = document.getElementById('opg-f-nome').value;
    if (!nome.trim()) return toast('Escreva o nome do gestor', true);
    this.disabled = true; this.innerHTML = '<span class="spinner"></span> Salvando…';
    try {
      await apiOp('op_gestor_salvar', {
        body: {
          id: novo ? undefined : g.id, nome: nome,
          collaborator_id: document.getElementById('opg-f-colab').value || null,
          cor: document.getElementById('opg-f-cor').value,
          ativo: document.getElementById('opg-f-ativo').checked
        }
      });
      toast(novo ? 'Gestor adicionado' : 'Gestor salvo');
      fechaGaveta();
      OP_GESTORES = null; OP = null;
      if (OP_ABERTO) abreGestor(OP_ABERTO); else carregaOpGestores();
    } catch (e) {
      document.getElementById('opg-f-saida').innerHTML =
        '<div class="alert alert-erro" style="margin-top:14px">' + esc(e.message) + '</div>';
      this.disabled = false; this.textContent = novo ? 'Adicionar' : 'Salvar';
    }
  });
}

/* ---------------- ficha do cliente ---------------- */
async function abreFichaCliente(id, gestorId) {
  const novo = !id;
  const d = OP_CART;
  const c = novo
    ? { gestor_id: gestorId, fase: 'onboarding', status: 'ativo', satisfacao: '', categoria: '' }
    : ((d.clientes || []).filter(function (x) { return x.id === id; })[0] || {});

  document.getElementById('g-nome').textContent = novo ? 'Novo cliente' : (c.nome || 'Cliente');
  document.getElementById('g-sub').textContent = novo
    ? 'Entra na carteira e já conta no dashboard.'
    : 'Cada mudança fica registrada com a data.';

  const opcoes = function (lista, nomes, atual) {
    return lista.map(function (k) {
      return '<option value="' + k + '"' + (atual === k ? ' selected' : '') + '>' + esc(nomes[k]) + '</option>';
    }).join('');
  };

  document.getElementById('g-corpo').innerHTML =
    (novo
      ? '<div class="field"><label for="opc-f-cliente">Cliente</label>' +
          '<span class="hint">Escolha um dos clientes do Financeiro, ou escreva um nome novo abaixo.</span>' +
          '<select id="opc-f-cliente"><option value="">— escrever um nome novo —</option>' +
            (d.disponiveis || []).map(function (x) {
              return '<option value="' + esc(x.id) + '">' + esc(x.nome) + '</option>';
            }).join('') + '</select></div>' +
        '<div class="field"><label for="opc-f-nome">Nome</label>' +
          '<input id="opc-f-nome" maxlength="160" value=""></div>'
      : '<div class="field"><label for="opc-f-nome">Nome</label>' +
          '<input id="opc-f-nome" maxlength="160" value="' + esc(c.nome || '') + '"></div>') +

    '<div class="field"><label for="opc-f-categoria">Categoria / segmento</label>' +
      '<span class="hint">Ex.: Odontologia, Imobiliária, Educação…</span>' +
      '<input id="opc-f-categoria" maxlength="80" value="' + esc(c.categoria || '') + '"></div>' +

    '<div class="row row-wrap" style="gap:14px">' +
      '<div class="field" style="flex:1;min-width:150px"><label for="opc-f-gestor">Gestor</label>' +
        '<select id="opc-f-gestor">' +
          (d.gestores || []).map(function (g) {
            return '<option value="' + esc(g.id) + '"' + (c.gestor_id === g.id ? ' selected' : '') + '>' +
              esc(g.nome) + '</option>';
          }).join('') + '</select></div>' +
      '<div class="field" style="flex:1;min-width:150px"><label for="opc-f-fase">Fase</label>' +
        '<select id="opc-f-fase">' + opcoes(d.fases, d.fases_nome, c.fase) + '</select></div>' +
    '</div>' +
    '<div class="row row-wrap" style="gap:14px">' +
      '<div class="field" style="flex:1;min-width:150px"><label for="opc-f-status">Situação</label>' +
        '<select id="opc-f-status">' + opcoes(d.status, d.status_nome, c.status) + '</select></div>' +
      '<div class="field" style="flex:1;min-width:150px"><label for="opc-f-satis">Satisfação</label>' +
        '<select id="opc-f-satis"><option value="">Não informado</option>' +
          opcoes(d.satisfacoes, d.satisfacao_nome, c.satisfacao || '') + '</select></div>' +
    '</div>' +
    '<div class="field"><label for="opc-f-entrou">Entrou em</label>' +
      '<input type="date" id="opc-f-entrou" value="' + esc(c.entrou_em || '') + '"></div>' +

    '<div class="row row-wrap" style="gap:12px;margin-top:18px">' +
      '<button class="btn" id="opc-f-salvar">' + (novo ? 'Adicionar' : 'Salvar') + '</button>' +
      (novo ? '' :
        '<button class="btn btn-sm btn-ghost" id="opc-f-renovar">Registrar renovação</button>' +
        '<button class="btn btn-sm btn-ghost" id="opc-f-cancelar" style="color:var(--red)">Registrar cancelamento</button>') +
    '</div>' +
    (novo ? '' : '<div id="opc-f-hist" style="margin-top:22px"><div class="small muted">carregando histórico…</div></div>') +
    '<div id="opc-f-saida"></div>';

  document.getElementById('fundo').style.display = 'block';
  document.getElementById('gaveta').style.display = 'flex';

  const sel = document.getElementById('opc-f-cliente');
  if (sel) {
    sel.addEventListener('change', function () {
      const nome = this.options[this.selectedIndex].textContent;
      document.getElementById('opc-f-nome').value = this.value ? nome : '';
    });
  }

  document.getElementById('opc-f-salvar').addEventListener('click', async function () {
    const corpo = {
      id: novo ? undefined : c.id,
      customer_id: sel ? (sel.value || null) : (c.customer_id || null),
      nome: document.getElementById('opc-f-nome').value,
      categoria: document.getElementById('opc-f-categoria').value,
      gestor_id: document.getElementById('opc-f-gestor').value,
      fase: document.getElementById('opc-f-fase').value,
      status: document.getElementById('opc-f-status').value,
      satisfacao: document.getElementById('opc-f-satis').value,
      entrou_em: document.getElementById('opc-f-entrou').value
    };
    if (!corpo.nome.trim()) return toast('Escolha ou escreva o nome do cliente', true);
    this.disabled = true; this.innerHTML = '<span class="spinner"></span> Salvando…';
    try {
      await apiOp('op_cliente_salvar', { body: corpo });
      toast(novo ? 'Cliente adicionado' : 'Cliente salvo');
      fechaGaveta();
      OP = null; OP_GESTORES = null;
      abreGestor(corpo.gestor_id);
    } catch (e) {
      document.getElementById('opc-f-saida').innerHTML =
        '<div class="alert alert-erro" style="margin-top:14px">' + esc(e.message) + '</div>';
      this.disabled = false; this.textContent = novo ? 'Adicionar' : 'Salvar';
    }
  });

  if (!novo) {
    const movimenta = async function (tipo, rotulo) {
      try {
        await apiOp('op_movimentar', { body: { id: c.id, tipo: tipo } });
        toast(rotulo + ' registrada');
        fechaGaveta();
        OP = null; OP_GESTORES = null;
        abreGestor(OP_ABERTO);
      } catch (e) { toast(e.message, true); }
    };
    document.getElementById('opc-f-renovar').addEventListener('click', function () {
      movimenta('renovacao', 'Renovação');
    });
    document.getElementById('opc-f-cancelar').addEventListener('click', function () {
      spConfirma('Registrar cancelamento?',
        '<strong>' + esc(c.nome) + '</strong> passa para cancelado e sai da carteira ativa. ' +
        'O histórico fica guardado.', function () { movimenta('cancelamento', 'Baixa'); }, 'Cancelar contrato');
    });

    apiOp('op_cliente_historico', { params: { id: c.id } }).then(function (h) {
      const caixa = document.getElementById('opc-f-hist');
      if (!caixa) return;
      caixa.innerHTML = '<h3 style="margin:0 0 10px;font-size:14.5px">Histórico</h3>' +
        ((h.eventos || []).length
          ? '<div class="small" style="line-height:1.9">' + h.eventos.map(function (e) {
              return '<div style="display:flex;gap:10px;align-items:baseline">' +
                '<span class="muted" style="white-space:nowrap;font-variant-numeric:tabular-nums">' +
                  dataBr(e.quando) + '</span>' +
                '<span><strong>' + esc(e.titulo) + '</strong>' +
                  (e.de !== '—' && e.para !== '—' && e.tipo !== 'entrada'
                    ? ' · ' + esc(e.de) + ' → ' + esc(e.para) : '') +
                  (e.quem ? ' <span class="muted">por ' + esc(e.quem) + '</span>' : '') +
                '</span></div>';
            }).join('') + '</div>'
          : '<div class="small muted">Nada registrado ainda.</div>');
    }).catch(function () { });
  }
}
