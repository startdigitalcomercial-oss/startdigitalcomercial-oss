/* ============================================================
   USUÁRIOS DO PAINEL — quem entra, quem é, e o que cada um acessa

   Três perguntas diferentes, e esta tela trata cada uma no seu
   lugar para não misturar:

     NÍVEL     o que a pessoa pode FAZER  (Dono, RH, Avaliador, Leitura)
     MÓDULOS   ONDE ela pode entrar       (Vagas, Comercial, Financeiro…)
     VÍNCULO   QUEM ela é na empresa      (qual colaborador)

   E dois jeitos de alguém ganhar acesso:

     Dar acesso a alguém     o caminho de sempre: nome, e-mail, nível.
                             Serve para qualquer pessoa.
     Convidar colaborador    um link de cadastro, que serve para o
                             time inteiro: cada pessoa que abre
                             informa o próprio CPF, o sistema acha o
                             cadastro dela entre os colaboradores e
                             cria o usuário JÁ vinculado — sem
                             duplicar ninguém.
   ============================================================ */
let USUARIOS = [];
let PAPEIS = [];
let MODULOS_LISTA = [];          // [{chave, nome}] — vem do servidor, na ordem do menu
let COLABS_LIVRES = [];          // colaboradores ainda sem usuário
let PAPEL_ESCOLHIDO = 'rh';

const SITUACAO = {
  ativo: { texto: 'Ativo', classe: 'tag-verde' },
  aguardando_senha: { texto: 'Aguardando criação de senha', classe: 'tag-ambar' },
  inativo: { texto: 'Inativo', classe: '' }
};
const CONVITE_ESTADO = {
  ativo: { texto: 'Link ativo', classe: 'tag-azul' },
  expirado: { texto: 'Link expirado', classe: 'tag-vermelho' },
  // Pausa do freio de tentativas: passa sozinha em alguns minutos.
  pausado: { texto: 'Link em pausa', classe: 'tag-ambar' }
};

// Caixa que aparece depois de criar um acesso ou reenviar o convite.
// Se o e-mail sair, e so avisar. Se falhar, mostra o link para copiar
// e mandar na mao — o acesso ja existe, so falta a pessoa abrir.
function caixaConvite(nome, email, c) {
  c = c || {};
  if (c.enviado) {
    return '<div class="alert alert-ok" style="margin-top:18px">' +
      '<strong>Convite enviado para ' + esc(email) + '.</strong><br>' +
      '<span class="small">' + esc(nome) + ' abre o e-mail, clica no botão e escolhe a senha. ' +
      'O link vale 72 horas e só funciona uma vez. Se não chegar, olhe o spam ou reenvie em Editar.</span></div>';
  }
  return '<div class="alert alert-aviso" style="margin-top:18px">' +
    '<strong>O acesso foi criado, mas o e-mail não saiu.</strong><br>' +
    '<span class="small">Motivo: ' + esc(c.erro || 'desconhecido') + '</span>' +
    (c.link
      ? '<div class="small" style="margin-top:10px">Copie este link e mande para ' + esc(nome) + ':</div>' +
        '<div class="senha-nova" style="word-break:break-all;margin-top:6px">' + esc(c.link) + '</div>'
      : '') +
    '</div>';
}

/* ---------------- módulos: caixas de marcar ----------------
   marcados = null quer dizer "todos" (sem restrição). */
function caixasDeModulos(prefixo, marcados, travado) {
  return '<div class="mod-grade" id="' + prefixo + '-mods">' +
    MODULOS_LISTA.map(function (m) {
      const on = travado || marcados === null || marcados.indexOf(m.chave) >= 0;
      return '<label class="mod-op' + (on ? ' on' : '') + (travado ? ' travado' : '') + '">' +
        '<input type="checkbox" value="' + esc(m.chave) + '"' + (on ? ' checked' : '') +
        (travado ? ' disabled' : '') + '> ' + esc(m.nome) + '</label>';
    }).join('') + '</div>';
}

function ligaCaixasDeModulos(prefixo) {
  const caixa = document.getElementById(prefixo + '-mods');
  if (!caixa) return;
  caixa.addEventListener('change', function (ev) {
    const rotulo = ev.target.closest('.mod-op');
    if (rotulo) rotulo.classList.toggle('on', ev.target.checked);
  });
}

function modulosMarcados(prefixo) {
  return Array.prototype.map.call(
    document.querySelectorAll('#' + prefixo + '-mods input:checked'),
    function (i) { return i.value; });
}

// As etiquetas da coluna "Permissões".
function chipsDeModulos(x) {
  if (x.role === 'dono') return '<span class="tag tag-roxo">Acesso total</span>';
  if (x.modulos === null) return '<span class="tag">Todos os módulos</span>';
  if (!x.modulos.length) return '<span class="small muted">nenhum</span>';
  const nome = {};
  MODULOS_LISTA.forEach(function (m) { nome[m.chave] = m.nome; });
  return '<div class="mod-chips">' + x.modulos.map(function (k) {
    return '<span class="tag tag-azul">' + esc(nome[k] || k) + '</span>';
  }).join('') + '</div>';
}

function copiaTexto(texto, botao) {
  const pronto = function () {
    const antes = botao.textContent;
    botao.textContent = 'Copiado!';
    setTimeout(function () { botao.textContent = antes; }, 1600);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(texto).then(pronto).catch(function () {
      toast('Selecione o link e copie na mão (Ctrl+C).');
    });
  } else {
    toast('Selecione o link e copie na mão (Ctrl+C).');
  }
}

// A caixa com o link de cadastro recém-gerado. O link só aparece
// AGORA: o servidor guarda o hash dele, não ele. Se o Dono fechar sem
// copiar, é só gerar outro.
function caixaLinkConvite(link, dias) {
  return '<div class="alert alert-ok" style="margin-top:18px">' +
    '<strong>Link de cadastro gerado.</strong> Copie e envie para os colaboradores — pode mandar no grupo.<br>' +
    '<span class="small">O <strong>mesmo link serve para todos</strong>: cada pessoa informa o próprio CPF e cria o próprio acesso. ' +
    'Vale por ' + dias + ' dias, e você pode cancelar quando quiser. ' +
    'Por segurança, o link não fica guardado — se perder, gere outro na lista abaixo.</span>' +
    '<div class="cv-link" id="cv-link-novo" style="margin-top:12px">' + esc(link) + '</div>' +
    '<div class="row" style="margin-top:10px"><button class="btn btn-sm" id="cv-copiar">Copiar link</button></div>' +
    '</div>';
}

async function carregaUsuarios() {
  const box = document.getElementById('painel-usuarios');
  box.innerHTML = '<div class="loading-page">Carregando…</div>';
  let d;
  try { d = await api('usuarios'); }
  catch (e) { box.innerHTML = '<div class="alert alert-erro">' + esc(e.message) + '</div>'; return; }

  USUARIOS = d.usuarios || [];
  PAPEIS = d.papeis || [];
  MODULOS_LISTA = d.modulos || [];
  COLABS_LIVRES = d.colaboradores_livres || [];
  const convites = d.convites || [];
  const ativos = USUARIOS.filter(function (x) { return x.active !== false; });

  box.innerHTML =
    (d.senha_mestra_vale
      ? '<div class="alert alert-aviso">' +
        '<strong>A senha mestra ainda está valendo.</strong> Enquanto não existir um Dono cadastrado aqui, ' +
        'qualquer pessoa com a senha do painel entra como Dono. Crie o seu usuário abaixo — a partir daí ' +
        'a senha mestra deixa de funcionar sozinha.</div>'
      : '') +

    '<div class="grid grid-3" style="margin-bottom:16px">' +
      '<div class="stat"><div class="n">' + ativos.length + '</div><div class="l">' +
        (ativos.length === 1 ? 'pessoa com acesso' : 'pessoas com acesso') + '</div></div>' +
      '<div class="stat"><div class="n">' + USUARIOS.filter(function (x) { return !!x.collaborator_id; }).length +
        '</div><div class="l">vinculadas a um colaborador</div></div>' +
      '<div class="stat"><div class="n">' + convites.filter(function (c) { return c.estado !== 'expirado'; }).length +
        '</div><div class="l">' + (convites.filter(function (c) { return c.estado !== 'expirado'; }).length === 1
          ? 'link de cadastro ativo' : 'links de cadastro ativos') + '</div></div>' +
    '</div>' +

    // ---------- convidar colaborador ----------
    '<div class="card">' +
      '<h2 style="margin:0 0 4px">Convidar colaborador</h2>' +
      '<p class="sub" style="margin:0 0 18px">Para quem <strong>já está no cadastro de colaboradores</strong>. ' +
      'Você gera <strong>um link de cadastro que serve para várias pessoas</strong>: cada uma abre, informa o próprio CPF, ' +
      'confirma quem é e cria a própria senha. O acesso nasce vinculado ao cadastro dela — sem criar colaborador repetido.</p>' +
      '<div class="field"><label for="cv-anotacao">Nome deste link <span class="muted">(só uma anotação sua)</span></label>' +
        '<input type="text" id="cv-anotacao" maxlength="120" placeholder="Time Comercial"></div>' +
      '<div class="field" style="margin-top:16px"><label>Acesso aos módulos</label>' +
        '<div class="hint" style="margin-top:2px">O que <strong>todos que se cadastrarem por este link</strong> vão enxergar no primeiro login. ' +
        'Para dar acessos diferentes a grupos diferentes, gere um link para cada grupo. Dá para ajustar pessoa por pessoa depois.</div>' +
        caixasDeModulos('cv', null, false) + '</div>' +
      '<div class="row" style="margin-top:16px"><button class="btn" id="cv-gerar">Gerar link de cadastro</button></div>' +
      '<div id="cv-saida"></div>' +
    '</div>' +

    // ---------- acesso comum ----------
    '<div class="card">' +
      '<h2 style="margin:0 0 4px">Dar acesso a alguém</h2>' +
      '<p class="sub" style="margin:0 0 18px">O caminho comum, para qualquer pessoa: você informa nome e e-mail, ' +
      'ela recebe um link e cria a própria senha. Ninguém aqui vê essa senha — nem você.</p>' +
      '<div class="grid grid-2" style="gap:14px">' +
        '<div class="field"><label for="us-nome">Nome</label>' +
        '<input type="text" id="us-nome" placeholder="Maria Aparecida"></div>' +
        '<div class="field"><label for="us-email">E-mail</label>' +
        '<input type="email" id="us-email" placeholder="maria@startdigital1.com.br"></div>' +
      '</div>' +
      '<div class="field" style="margin-top:16px"><label>Nível de acesso</label>' +
        '<div id="us-papeis" style="margin-top:8px"></div></div>' +
      '<div class="row" style="margin-top:6px"><button class="btn" id="us-criar">Criar acesso</button></div>' +
      '<div id="us-saida"></div>' +
    '</div>' +

    // ---------- lista ----------
    '<div class="card" style="padding:0;overflow:hidden">' +
      '<div style="padding:20px 22px 4px"><h2 style="margin:0">Quem tem acesso</h2></div>' +
      ((USUARIOS.length || convites.length)
        ? '<div style="overflow-x:auto"><table class="tbl" style="margin:0;min-width:860px"><thead><tr>' +
          '<th style="padding-left:22px">Usuário</th><th>Colaborador vinculado</th><th>E-mail</th>' +
          '<th>Status</th><th>Permissões</th><th style="padding-right:22px;text-align:right">Ações</th>' +
          '</tr></thead><tbody>' +
          convites.map(linhaConvite).join('') +
          USUARIOS.map(function (x) { return linhaUsuario(x, d.eu); }).join('') +
          '</tbody></table></div>'
        : '<p class="sub" style="padding:0 22px 22px;margin:0">Ninguém cadastrado ainda.</p>') +
    '</div>' +

    '<div class="card"><div class="row" style="justify-content:space-between;align-items:center">' +
      '<div><h2 style="margin:0 0 3px;font-size:15px">Histórico de quem fez o quê</h2>' +
      '<p class="sub" style="margin:0">Cada entrada, cada convite e cada mudança de permissão fica registrada.</p></div>' +
      '<button class="btn btn-sm btn-ghost" id="us-auditoria">Ver histórico</button>' +
    '</div><div id="us-audit"></div></div>';

  ligaUsuarios(d);
}

function linhaUsuario(x, euEmail) {
  const eu = euEmail && x.email === euEmail;
  const sit = SITUACAO[x.situacao] || SITUACAO.ativo;
  return '<tr data-usuario="' + esc(x.id) + '"' + (x.active === false ? ' style="opacity:.55"' : '') + '>' +
    '<td style="padding-left:22px"><strong>' + esc(x.name) + '</strong>' +
      (eu ? ' <span class="tag tag-verde">você</span>' : '') +
      '<div class="small muted">' + esc(x.role_nome) +
        ' · ' + (x.last_login_at ? 'último acesso ' + dataBr(x.last_login_at) : 'nunca entrou') + '</div></td>' +
    '<td>' + (x.collaborator_id
      ? esc(x.colaborador_nome || 'Colaborador removido')
      : '<span class="small muted">sem vínculo</span>') + '</td>' +
    '<td class="small">' + esc(x.email) +
      (x.email_difere ? '<div class="small muted" title="O e-mail do login é diferente do e-mail no cadastro do colaborador">' +
        'difere do cadastro</div>' : '') + '</td>' +
    '<td><span class="tag ' + sit.classe + '">' + sit.texto + '</span></td>' +
    '<td>' + chipsDeModulos(x) + '</td>' +
    '<td style="padding-right:22px"><div class="us-acoes">' +
      '<button class="btn btn-sm btn-ghost us-editar" data-id="' + esc(x.id) + '">Editar</button>' +
    '</div></td></tr>';
}

function linhaConvite(c) {
  const est = CONVITE_ESTADO[c.estado] || CONVITE_ESTADO.ativo;
  const quando = c.estado === 'expirado' ? 'venceu em ' + dataBr(c.expira_em)
    : c.estado === 'pausado' ? 'muitas tentativas; volta sozinho em minutos'
    : 'vale até ' + dataBr(c.expira_em);
  const usos = Number(c.usos) || 0;
  return '<tr data-convite="' + esc(c.id) + '">' +
    '<td style="padding-left:22px"><strong>' + esc(c.anotacao || 'Link de cadastro') + '</strong>' +
      '<div class="small muted">gerado por ' + esc(c.criado_por || '—') + ' em ' + dataBr(c.criado_em) + '</div></td>' +
    '<td><span class="small muted">cada pessoa confirma pelo CPF</span></td>' +
    // Quantas pessoas já entraram por este link. Elas aparecem logo
    // abaixo, na mesma lista, cada uma com o seu colaborador.
    '<td class="cv-usos"><strong>' + usos + '</strong> <span class="small muted">' +
      (usos === 1 ? 'cadastro feito' : 'cadastros feitos') + '</span>' +
      (c.ultimo_uso_em ? '<div class="small muted">último em ' + dataBr(c.ultimo_uso_em) + '</div>' : '') + '</td>' +
    '<td><span class="tag ' + est.classe + '">' + est.texto + '</span>' +
      '<div class="small muted" style="margin-top:4px">' + esc(quando) + '</div></td>' +
    '<td>' + chipsDeModulos({ role: 'rh', modulos: c.modulos }) + '</td>' +
    '<td style="padding-right:22px"><div class="us-acoes">' +
      '<button class="btn btn-sm btn-ghost cv-renovar" data-id="' + esc(c.id) + '">Gerar novo link</button>' +
      '<button class="btn btn-sm btn-ghost cv-cancelar" data-id="' + esc(c.id) + '" style="color:var(--red-soft)">Cancelar</button>' +
    '</div></td></tr>';
}

function ligaUsuarios(d) {
  const b = function (id) { return document.getElementById(id); };

  function desenhaPapeis() {
    b('us-papeis').innerHTML = PAPEIS.map(function (p) {
      return '<button type="button" class="papel-op' + (PAPEL_ESCOLHIDO === p.chave ? ' on' : '') + '" ' +
        'data-p="' + esc(p.chave) + '"><strong>' + esc(p.nome) + '</strong>' +
        '<span>' + esc(p.descricao) + '</span></button>';
    }).join('');
    b('us-papeis').querySelectorAll('.papel-op').forEach(function (bt) {
      bt.addEventListener('click', function () {
        PAPEL_ESCOLHIDO = bt.dataset.p;
        desenhaPapeis();
      });
    });
  }
  desenhaPapeis();
  ligaCaixasDeModulos('cv');

  // ---------- gerar convite de colaborador ----------
  const mostraLink = function (r) {
    b('cv-saida').innerHTML = caixaLinkConvite(r.link, d.convite_dias || 7);
    b('cv-copiar').addEventListener('click', function () { copiaTexto(r.link, b('cv-copiar')); });
    b('cv-saida').scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  // Recarrega a lista sem perder a caixa com o link recém-gerado: o
  // link só existe naquela caixa.
  const recarregaGuardandoLink = function (r) {
    carregaUsuarios().then(function () {
      const saida = document.getElementById('cv-saida');
      if (!saida) return;
      saida.innerHTML = caixaLinkConvite(r.link, d.convite_dias || 7);
      const bt = document.getElementById('cv-copiar');
      bt.addEventListener('click', function () { copiaTexto(r.link, bt); });
      saida.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  b('cv-gerar').addEventListener('click', async function () {
    const marcados = modulosMarcados('cv');
    if (!marcados.length) return toast('Marque pelo menos um módulo.', true);
    this.disabled = true;
    this.innerHTML = '<span class="spinner"></span> Gerando…';
    try {
      const r = await api('cv_criar', {
        body: {
          anotacao: b('cv-anotacao').value.trim(),
          // todos marcados = sem restrição
          modulos: marcados.length === MODULOS_LISTA.length ? null : marcados
        }
      });
      recarregaGuardandoLink(r);
    } catch (e) {
      b('cv-saida').innerHTML = '<div class="alert alert-erro" style="margin-top:18px">' + esc(e.message) + '</div>';
      this.disabled = false;
      this.textContent = 'Gerar link de cadastro';
    }
  });

  document.querySelectorAll('.cv-renovar').forEach(function (bt) {
    bt.addEventListener('click', async function () {
      if (!confirm('Gerar um link novo?\n\nO link anterior para de funcionar na hora — quem ainda não se cadastrou ' +
        'vai precisar do link novo. Quem já se cadastrou não é afetado.')) return;
      bt.disabled = true;
      try { recarregaGuardandoLink(await api('cv_renovar', { body: { id: bt.dataset.id } })); }
      catch (e) { toast(e.message, true); bt.disabled = false; }
    });
  });

  document.querySelectorAll('.cv-cancelar').forEach(function (bt) {
    bt.addEventListener('click', async function () {
      if (!confirm('Cancelar este link de cadastro?\n\nNinguém mais consegue se cadastrar por ele. ' +
        'Quem já se cadastrou continua com o acesso.')) return;
      bt.disabled = true;
      try { await api('cv_cancelar', { body: { id: bt.dataset.id } }); toast('Link cancelado'); carregaUsuarios(); }
      catch (e) { toast(e.message, true); bt.disabled = false; }
    });
  });

  // ---------- acesso comum ----------
  b('us-criar').addEventListener('click', async function () {
    const nome = b('us-nome').value.trim();
    const email = b('us-email').value.trim();
    if (!nome) return toast('Escreva o nome', true);
    if (!email) return toast('Escreva o e-mail', true);
    this.disabled = true;
    this.innerHTML = '<span class="spinner"></span> Criando…';
    try {
      const r = await api('usuario_salvar', { body: { name: nome, email: email, role: PAPEL_ESCOLHIDO } });
      b('us-saida').innerHTML = caixaConvite(nome, email, r.convite);
      b('us-nome').value = '';
      b('us-email').value = '';
      setTimeout(function () {
        const saida = b('us-saida').innerHTML;
        carregaUsuarios();
        setTimeout(function () { if (b('us-saida')) b('us-saida').innerHTML = saida; }, 400);
      }, 300);
    } catch (e) {
      b('us-saida').innerHTML = '<div class="alert alert-erro" style="margin-top:18px">' + esc(e.message) + '</div>';
    }
    this.disabled = false;
    this.textContent = 'Criar acesso';
  });

  document.querySelectorAll('.us-editar').forEach(function (bt) {
    bt.addEventListener('click', function () { abreUsuario(bt.dataset.id); });
  });

  b('us-auditoria').addEventListener('click', async function () {
    this.disabled = true;
    try {
      const r = await api('auditoria');
      b('us-audit').innerHTML = r.registros.length
        ? '<table class="tbl" style="margin-top:14px"><thead><tr><th>Quando</th><th>Quem</th>' +
          '<th>O que fez</th><th>Sobre</th></tr></thead><tbody>' +
          r.registros.map(function (l) {
            return '<tr><td class="small muted" style="white-space:nowrap">' + dataBr(l.created_at) + '</td>' +
              '<td>' + esc(l.user_name || '—') + '</td>' +
              '<td class="small">' + esc(String(l.action).replace(/_/g, ' ')) + '</td>' +
              '<td class="small muted">' + esc(l.target || '—') + '</td></tr>';
          }).join('') + '</tbody></table>'
        : '<p class="small muted" style="margin:14px 0 0">Nada registrado ainda.</p>';
    } catch (e) { toast(e.message, true); }
    this.disabled = false;
  });
}

function abreUsuario(id) {
  const x = USUARIOS.filter(function (y) { return y.id === id; })[0];
  if (!x) return;

  const aguardando = x.situacao === 'aguardando_senha';

  // O seletor de vínculo oferece: ficar como está, soltar o vínculo,
  // ou escolher um colaborador que AINDA não tem usuário. Quem já tem
  // nem aparece na lista — um colaborador, um usuário.
  const opcoesVinculo =
    '<option value="">Sem vínculo</option>' +
    (x.collaborator_id
      ? '<option value="' + esc(x.collaborator_id) + '" selected>' +
        esc(x.colaborador_nome || 'Colaborador removido') + '</option>'
      : '') +
    COLABS_LIVRES.map(function (c) {
      return '<option value="' + esc(c.id) + '">' + esc(c.nome) + '</option>';
    }).join('');

  document.getElementById('g-nome').textContent = x.name;
  document.getElementById('g-sub').textContent = x.email;
  document.getElementById('g-corpo').innerHTML =
    '<div class="field"><label>Nome</label><input type="text" id="ue-nome" value="' + esc(x.name) + '"></div>' +

    '<div class="field" style="margin-top:16px"><label>Nível de acesso</label>' +
      '<div class="hint" style="margin-top:2px">O que a pessoa pode <strong>fazer</strong>.</div>' +
      '<div id="ue-papeis" style="margin-top:8px"></div></div>' +

    '<div class="field" style="margin-top:16px"><label>Acesso aos módulos</label>' +
      '<div class="hint" style="margin-top:2px" id="ue-mods-dica"></div>' +
      '<div id="ue-mods-caixa"></div></div>' +

    '<div class="field" style="margin-top:16px"><label for="ue-colab">Colaborador vinculado</label>' +
      '<div class="hint" style="margin-top:2px"><strong>Quem</strong> esta pessoa é no cadastro de colaboradores. ' +
      'Não muda o que ela acessa, e não altera os dados do colaborador.</div>' +
      '<select id="ue-colab" style="margin-top:8px">' + opcoesVinculo + '</select></div>' +

    '<div class="row row-wrap" style="gap:12px;margin-top:16px;align-items:center">' +
      '<button class="btn btn-sm" id="ue-salvar">Salvar</button>' +
      '<label class="row small" style="gap:6px"><input type="checkbox" id="ue-ativo" ' +
      (x.active !== false ? 'checked' : '') + ' style="width:16px;height:16px"> tem acesso ao painel</label>' +
    '</div>' +
    '<hr class="sep">' +
    '<h3 style="font-size:14px;margin:0 0 8px">' + (aguardando ? 'E-mail de acesso' : 'Senha') + '</h3>' +
    '<p class="small muted" style="margin:0 0 12px">' + (aguardando
      ? 'Esta pessoa ainda não criou a senha. Reenvie o e-mail com o link — o anterior deixa de valer.'
      : 'Manda um e-mail novo para a pessoa criar outra senha. A senha atual dela para de valer na hora. ' +
        'Use quando alguém esquecer a senha.') + '</p>' +
    '<button class="btn btn-sm btn-ghost" id="ue-senha">' +
      (aguardando ? 'Reenviar e-mail de acesso' : 'Enviar link de senha nova') + '</button>' +
    '<div id="ue-saida"></div>' +
    '<hr class="sep">' +
    '<button class="btn btn-sm btn-ghost" id="ue-excluir" style="color:var(--red)">Excluir este acesso</button>';

  document.getElementById('fundo').style.display = 'block';
  document.getElementById('gaveta').style.display = 'flex';

  let papel = x.role;
  // O que está marcado agora, guardado fora da tela: trocar o nível
  // para Dono e voltar não pode apagar o que o administrador marcou.
  let marcados = x.modulos;

  function desenhaModulos() {
    const dono = papel === 'dono';
    if (!dono && document.getElementById('ue-mods')) {
      const agora = modulosMarcados('ue');
      marcados = agora.length === MODULOS_LISTA.length ? null : agora;
    }
    document.getElementById('ue-mods-dica').innerHTML = dono
      ? 'O Dono acessa <strong>tudo</strong>, sempre — não dá para restringir.'
      : '<strong>Onde</strong> a pessoa pode entrar. O que estiver desmarcado some do menu dela e fica bloqueado no servidor.';
    document.getElementById('ue-mods-caixa').innerHTML = caixasDeModulos('ue', marcados, dono);
    ligaCaixasDeModulos('ue');
  }

  function desenha() {
    document.getElementById('ue-papeis').innerHTML = PAPEIS.map(function (p) {
      return '<button type="button" class="papel-op' + (papel === p.chave ? ' on' : '') + '" ' +
        'data-p="' + esc(p.chave) + '"><strong>' + esc(p.nome) + '</strong>' +
        '<span>' + esc(p.descricao) + '</span></button>';
    }).join('');
    document.getElementById('ue-papeis').querySelectorAll('.papel-op').forEach(function (bt) {
      bt.addEventListener('click', function () { desenhaModulos(); papel = bt.dataset.p; desenha(); desenhaModulos(); });
    });
  }
  desenha();
  desenhaModulos();

  document.getElementById('ue-salvar').addEventListener('click', async function () {
    const corpo = {
      id: x.id,
      name: document.getElementById('ue-nome').value,
      role: papel,
      active: document.getElementById('ue-ativo').checked,
      collaborator_id: document.getElementById('ue-colab').value || ''
    };
    if (papel !== 'dono') {
      const agora = modulosMarcados('ue');
      if (!agora.length) return toast('Marque pelo menos um módulo.', true);
      corpo.modulos = agora.length === MODULOS_LISTA.length ? null : agora;
    }
    try {
      await api('usuario_salvar', { body: corpo });
      toast('Salvo');
      fechaGaveta();
      carregaUsuarios();
    } catch (e) { toast(e.message, true); }
  });

  document.getElementById('ue-senha').addEventListener('click', async function () {
    const rotulo = this.textContent;
    if (!confirm(aguardando
      ? 'Reenviar para ' + x.email + ' o e-mail com o link de criar a senha?'
      : 'Enviar para ' + x.email + ' um link para criar senha nova?\n\n' +
        'A senha atual de ' + x.name + ' para de funcionar na hora.')) return;
    this.disabled = true;
    this.innerHTML = '<span class="spinner"></span> Enviando…';
    try {
      const r = await api('usuario_senha', { body: { id: x.id } });
      document.getElementById('ue-saida').innerHTML = caixaConvite(r.nome, r.email, r.convite);
    } catch (e) { toast(e.message, true); }
    this.disabled = false;
    this.textContent = rotulo;
  });

  document.getElementById('ue-excluir').addEventListener('click', async function () {
    if (!confirm('Excluir o acesso de ' + x.name + '? Ela perde o painel imediatamente.' +
      (x.collaborator_id ? '\n\nO cadastro do colaborador NÃO é apagado — só o login.' : ''))) return;
    try {
      await api('usuario_excluir', { body: { id: x.id } });
      toast('Acesso excluído');
      fechaGaveta();
      carregaUsuarios();
    } catch (e) { toast(e.message, true); }
  });
}
