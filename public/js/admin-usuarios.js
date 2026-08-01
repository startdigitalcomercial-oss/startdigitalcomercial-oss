/* ============================================================
   USUÁRIOS DO PAINEL — quem entra e o que cada um pode
   ============================================================ */
let USUARIOS = [];
let PAPEIS = [];
let PAPEL_ESCOLHIDO = 'rh';

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

async function carregaUsuarios() {
  const box = document.getElementById('painel-usuarios');
  box.innerHTML = '<div class="loading-page">Carregando…</div>';
  let d;
  try { d = await api('usuarios'); }
  catch (e) { box.innerHTML = '<div class="alert alert-erro">' + esc(e.message) + '</div>'; return; }

  USUARIOS = d.usuarios || [];
  PAPEIS = d.papeis || [];
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
      '<div class="stat"><div class="n">' + ativos.filter(function (x) { return x.role === 'dono'; }).length +
        '</div><div class="l">donos do painel</div></div>' +
      '<div class="stat"><div class="n">' + USUARIOS.filter(function (x) { return x.active === false; }).length +
        '</div><div class="l">desativados</div></div>' +
    '</div>' +

    // ---------- novo usuário ----------
    '<div class="card">' +
      '<h2 style="margin:0 0 4px">Dar acesso a alguém</h2>' +
      '<p class="sub" style="margin:0 0 18px">A pessoa recebe um e-mail com um link e cria a própria senha por lá. ' +
      'Ninguém aqui vê essa senha — nem você.</p>' +
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
      (USUARIOS.length
        ? '<table class="tbl" style="margin:0"><thead><tr>' +
          '<th style="padding-left:22px">Pessoa</th><th>Nível</th><th>Último acesso</th><th></th>' +
          '</tr></thead><tbody>' +
          USUARIOS.map(function (x) {
            const eu = d.eu && x.email === d.eu;
            return '<tr' + (x.active === false ? ' style="opacity:.5"' : '') + '>' +
              '<td style="padding-left:22px"><strong>' + esc(x.name) + '</strong>' +
                (eu ? ' <span class="tag tag-verde">você</span>' : '') +
                (x.must_change ? ' <span class="tag tag-ambar">senha nova</span>' : '') +
                '<div class="small muted">' + esc(x.email) + '</div></td>' +
              '<td><span class="tag">' + esc(x.role_nome) + '</span></td>' +
              '<td class="small muted">' + (x.last_login_at ? dataBr(x.last_login_at) : 'nunca entrou') + '</td>' +
              '<td style="padding-right:22px;text-align:right;white-space:nowrap">' +
                '<button class="btn btn-sm btn-ghost us-editar" data-id="' + esc(x.id) + '">Editar</button>' +
              '</td></tr>';
          }).join('') + '</tbody></table>'
        : '<p class="sub" style="padding:0 22px 22px;margin:0">Ninguém cadastrado ainda.</p>') +
    '</div>' +

    '<div class="card"><div class="row" style="justify-content:space-between;align-items:center">' +
      '<div><h2 style="margin:0 0 3px;font-size:15px">Histórico de quem fez o quê</h2>' +
      '<p class="sub" style="margin:0">Cada entrada no painel e cada mudança de acesso fica registrada.</p></div>' +
      '<button class="btn btn-sm btn-ghost" id="us-auditoria">Ver histórico</button>' +
    '</div><div id="us-audit"></div></div>';

  ligaUsuarios(d);
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

  document.getElementById('g-nome').textContent = x.name;
  document.getElementById('g-sub').textContent = x.email;
  document.getElementById('g-corpo').innerHTML =
    '<div class="field"><label>Nome</label><input type="text" id="ue-nome" value="' + esc(x.name) + '"></div>' +
    '<div class="field" style="margin-top:16px"><label>Nível de acesso</label>' +
      '<div id="ue-papeis" style="margin-top:8px"></div></div>' +
    '<div class="row row-wrap" style="gap:12px;margin-top:14px;align-items:center">' +
      '<button class="btn btn-sm" id="ue-salvar">Salvar</button>' +
      '<label class="row small" style="gap:6px"><input type="checkbox" id="ue-ativo" ' +
      (x.active !== false ? 'checked' : '') + ' style="width:16px;height:16px"> tem acesso ao painel</label>' +
    '</div>' +
    '<hr class="sep">' +
    '<h3 style="font-size:14px;margin:0 0 8px">Senha</h3>' +
    '<p class="small muted" style="margin:0 0 12px">Manda um e-mail novo para a pessoa criar outra senha. ' +
    'A senha atual dela para de valer na hora. Use quando alguém esquecer a senha.</p>' +
    '<button class="btn btn-sm btn-ghost" id="ue-senha">Enviar link de senha nova</button>' +
    '<div id="ue-saida"></div>' +
    '<hr class="sep">' +
    '<button class="btn btn-sm btn-ghost" id="ue-excluir" style="color:var(--red)">Excluir este acesso</button>';

  document.getElementById('fundo').style.display = 'block';
  document.getElementById('gaveta').style.display = 'flex';

  let papel = x.role;
  function desenha() {
    document.getElementById('ue-papeis').innerHTML = PAPEIS.map(function (p) {
      return '<button type="button" class="papel-op' + (papel === p.chave ? ' on' : '') + '" ' +
        'data-p="' + esc(p.chave) + '"><strong>' + esc(p.nome) + '</strong>' +
        '<span>' + esc(p.descricao) + '</span></button>';
    }).join('');
    document.getElementById('ue-papeis').querySelectorAll('.papel-op').forEach(function (bt) {
      bt.addEventListener('click', function () { papel = bt.dataset.p; desenha(); });
    });
  }
  desenha();

  document.getElementById('ue-salvar').addEventListener('click', async function () {
    try {
      await api('usuario_salvar', {
        body: {
          id: x.id,
          name: document.getElementById('ue-nome').value,
          role: papel,
          active: document.getElementById('ue-ativo').checked
        }
      });
      toast('Salvo');
      fechaGaveta();
      carregaUsuarios();
    } catch (e) { toast(e.message, true); }
  });

  document.getElementById('ue-senha').addEventListener('click', async function () {
    if (!confirm('Enviar para ' + x.email + ' um link para criar senha nova?\n\n' +
      'A senha atual de ' + x.name + ' para de funcionar na hora.')) return;
    this.disabled = true;
    this.innerHTML = '<span class="spinner"></span> Enviando…';
    try {
      const r = await api('usuario_senha', { body: { id: x.id } });
      document.getElementById('ue-saida').innerHTML = caixaConvite(r.nome, r.email, r.convite);
    } catch (e) { toast(e.message, true); }
    this.disabled = false;
    this.textContent = 'Enviar link de senha nova';
  });

  document.getElementById('ue-excluir').addEventListener('click', async function () {
    if (!confirm('Excluir o acesso de ' + x.name + '? Ela perde o painel imediatamente.')) return;
    try {
      await api('usuario_excluir', { body: { id: x.id } });
      toast('Acesso excluído');
      fechaGaveta();
      carregaUsuarios();
    } catch (e) { toast(e.message, true); }
  });
}
