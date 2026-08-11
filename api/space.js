// ============================================================
// SPACE COLABORADOR
//
// O benefício que a empresa libera de tempos em tempos e que o
// colaborador saca por Pix, pelo Asaas.
//
// Três portas neste arquivo, nesta ordem:
//   1. WEBHOOK   — o Asaas avisando o que aconteceu com o dinheiro
//   2. COLABORADOR — abre pelo link pessoal dele, sem senha
//   3. PAINEL    — nós, com login, liberando e acompanhando
//
// A regra de ouro: SEM LIBERAÇÃO, NINGUÉM SACA. E cada liberação
// vale um saque só. Isso é garantido em três camadas — índice
// único no banco, troca de estado condicional aqui, e o
// externalReference do lado do Asaas.
// ============================================================
'use strict';

const db = require('./_lib/db');
const u = require('./_lib/util');
const porta = require('./_lib/porta');
const asaas = require('./_lib/asaas');
const send = require('./_lib/send');

// Ajustes do Space guardados no banco (settings.space):
//   aviso_sms_para — o telefone que recebe um SMS a cada saque feito.
async function configSpace() {
  const row = await db.selectOne('settings', { key: 'eq.space', select: 'value' });
  return Object.assign({ aviso_sms_para: '' }, (row && row.value) || {});
}

// A instância do WhatsApp é a mesma que a Aurea usa.
async function instanciaZap() {
  const a = await db.selectOne('settings', { key: 'eq.aurea', select: 'value' });
  if (a && a.value && a.value.instancia_whatsapp) return a.value.instancia_whatsapp;
  const w = await db.selectOne('settings', { key: 'eq.whatsapp', select: 'value' });
  return (w && w.value && w.value.instance) || process.env.EVOLUTION_INSTANCE || '';
}

// SMS para o dono a cada saque. Nunca pode atrapalhar o saque em si:
// se o SMS falhar, o Pix já saiu e está tudo bem — só registra.
async function avisaChefeDoSaque(colaborador, lib) {
  try {
    const cfg = await configSpace();
    if (!cfg.aviso_sms_para) return;
    await send.sendSms({
      to: cfg.aviso_sms_para,
      text: 'StartDigital Space: ' + u.firstName(colaborador.name) + ' (' + colaborador.name + ') sacou ' +
        lib.nome_voucher + ' de R$ ' + Number(lib.valor).toFixed(2).replace('.', ',') + '.'
    });
  } catch (e) { console.error('[space] aviso de saque falhou:', e.message); }
}

// Teto de segurança. Não é regra de negócio, é cinto: se alguém
// digitar um zero a mais no valor do voucher, o saque para aqui
// em vez de sair da conta. Dá para afrouxar pela variável.
function teto() {
  const v = Number(process.env.ASAAS_TETO_SAQUE || 0);
  return (isFinite(v) && v > 0) ? v : 2000;
}

function dinheiro(v) {
  return 'R$ ' + Number(v || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
}

const SITUACOES = {
  liberado: 'Disponível para saque',
  processando: 'Saque em processamento',
  pago: 'Pago',
  falhou: 'Falhou',
  cancelado: 'Cancelado'
};

function paraTela(r) {
  return {
    id: r.id,
    voucher: r.nome_voucher,
    valor: Number(r.valor || 0),
    valor_br: dinheiro(r.valor),
    status: r.status,
    situacao: SITUACOES[r.status] || r.status,
    liberado_em: r.liberado_em,
    solicitado_em: r.solicitado_em,
    pago_em: r.pago_em,
    pix_chave: r.pix_chave || '',
    comprovante_url: r.comprovante_url || '',
    falha_motivo: r.falha_motivo || ''
  };
}

async function colaboradorPorToken(token) {
  const t = String(token || '').trim();
  if (t.length < 10) return null;
  return await db.selectOne('collaborators', { token: 'eq.' + t, select: '*' });
}

// ------------------------------------------------------------
// DIÁRIO DO WEBHOOK DO ASAAS
// Grava as últimas batidas — inclusive as recusadas. Sem isto,
// quando um saque volta, não dá para saber se o Asaas não chamou,
// se chamou com o token errado, ou se chamou e a gente recusou.
// ------------------------------------------------------------
async function anotaAsaas(dados) {
  try {
    const reg = await db.selectOne('settings', { key: 'eq.asaas_webhook_log', select: 'value' });
    const itens = (reg && reg.value && Array.isArray(reg.value.itens)) ? reg.value.itens : [];
    itens.unshift(Object.assign({ em: new Date().toISOString() }, dados));
    await db.upsert('settings', {
      key: 'asaas_webhook_log', value: { itens: itens.slice(0, 25) }
    }, 'key');
  } catch (e) { /* o diario nunca pode derrubar o webhook */ }
}

// ------------------------------------------------------------
// 1) WEBHOOK DO ASAAS
// O Asaas manda o header asaas-access-token com o valor que a
// gente cadastrou lá. Se não bater, não é o Asaas falando.
// ------------------------------------------------------------
const ESTADO_POR_EVENTO = {
  TRANSFER_CREATED: 'processando',
  TRANSFER_PENDING: 'processando',
  TRANSFER_IN_BANK_PROCESSING: 'processando',
  TRANSFER_BLOCKED: 'processando',
  TRANSFER_DONE: 'pago',
  TRANSFER_FAILED: 'falhou',
  TRANSFER_CANCELLED: 'falhou'
};

async function receberWebhook(req, res) {
  const esperado = String(process.env.ASAAS_WEBHOOK_TOKEN || '').trim();
  const veio = String(req.headers['asaas-access-token'] || '').trim();

  if (!esperado) {
    await anotaAsaas({ decisao: 'ASAAS_WEBHOOK_TOKEN nao configurada na Vercel (faltou variavel ou Redeploy)' });
    return u.json(res, 200, { ok: true, ignorado: 'webhook sem token configurado' });
  }
  if (!veio || !u.safeEqual(veio, esperado)) {
    await anotaAsaas({
      decisao: 'token invalido',
      veio_token: veio ? (veio.slice(0, 6) + '…') : '(vazio — o campo token nao foi preenchido no Asaas)'
    });
    return u.json(res, 401, { ok: false, error: 'token invalido' });
  }

  let corpo;
  try { corpo = await u.readBody(req); } catch (e) { return u.json(res, 200, { ok: true }); }

  // ---- VALIDAÇÃO DE SAQUE ----
  // Com o mecanismo de segurança ligado, o Asaas pergunta ANTES de
  // soltar cada Pix: "foi você que pediu isso?". O pedido de validação
  // vem com "type" e sem "event" — é assim que a gente o distingue do
  // aviso normal de transferência.
  if (!corpo.event && corpo.type) return await validarSaida(res, corpo);

  const evento = String(corpo.event || '');
  const t = corpo.transfer || {};
  const novo = ESTADO_POR_EVENTO[evento];

  // Responde 200 mesmo para evento que não interessa: o Asaas
  // repete o que não recebe 200, e a fila dele trava.
  if (!novo) return u.json(res, 200, { ok: true, ignorado: 'evento ' + evento });

  // Acha a liberação: primeiro pela nossa referência, depois pelo id do Asaas.
  let lib = null;
  if (t.externalReference) {
    lib = await db.selectOne('benefit_releases', { id: 'eq.' + t.externalReference, select: '*' });
  }
  if (!lib && t.id) {
    lib = await db.selectOne('benefit_releases', { asaas_id: 'eq.' + t.id, select: '*' });
  }
  if (!lib) return u.json(res, 200, { ok: true, ignorado: 'transferencia desconhecida' });

  // "pago" é ponto final. Um evento atrasado não desfaz pagamento.
  if (lib.status === 'pago' && novo !== 'pago') {
    return u.json(res, 200, { ok: true, ignorado: 'ja estava pago' });
  }

  const patch = {
    status: novo,
    asaas_id: t.id || lib.asaas_id,
    asaas_status: t.status || null,
    updated_at: new Date().toISOString()
  };
  if (t.transactionReceiptUrl) patch.comprovante_url = t.transactionReceiptUrl;
  if (novo === 'pago') patch.pago_em = new Date().toISOString();
  if (novo === 'falhou') patch.falha_motivo = t.failReason || ('Asaas: ' + evento);

  await db.update('benefit_releases', patch, { id: 'eq.' + lib.id });
  await anotaAsaas({ decisao: 'evento aplicado', evento: evento, novo_status: novo, transfer_id: t.id });
  return u.json(res, 200, { ok: true, atualizado: novo });
}

// ------------------------------------------------------------
// "FOI VOCÊ QUE PEDIU ESTE SAQUE?"
//
// A regra é uma só: a gente APROVA apenas o que a gente mesmo pediu —
// uma transferência que está no nosso banco, em andamento, com o valor
// exato. TODO o resto é recusado. Pagamento de conta, recarga, QR Code,
// estorno: o portal nunca pede nada disso, então nunca aprova.
//
// É esta função que torna a chave da API quase inútil para um ladrão:
// mesmo com a chave na mão, o saque dele morre aqui, porque não existe
// no nosso banco.
// ------------------------------------------------------------
async function validarSaida(res, corpo) {
  async function recusa(motivo) {
    await anotaAsaas({
      decisao: 'validacao RECUSADA', motivo: motivo,
      tipo: corpo.type, transfer_id: (corpo.transfer || {}).id, valor: (corpo.transfer || {}).value
    });
    return u.json(res, 200, { status: 'REFUSED', refuseReason: motivo });
  }

  if (String(corpo.type) !== 'TRANSFER') {
    return recusa('O Portal do Colaborador não realiza este tipo de operação.');
  }

  const t = corpo.transfer || {};
  if (!t.id) return recusa('Transferência sem identificador.');

  const lib = await db.selectOne('benefit_releases', { asaas_id: 'eq.' + t.id, select: '*' });
  if (!lib) return recusa('Transferência não encontrada no nosso banco.');

  if (lib.status !== 'processando' && lib.status !== 'pago') {
    return recusa('Este saque não está em andamento no nosso sistema.');
  }

  // centavo por centavo — valor mexido no caminho é recusa na hora
  if (Math.round(Number(t.value) * 100) !== Math.round(Number(lib.valor) * 100)) {
    return recusa('O valor não confere com o que foi liberado.');
  }

  await anotaAsaas({ decisao: 'validacao APROVADA', transfer_id: t.id, valor: t.value });
  return u.json(res, 200, { status: 'APPROVED' });
}

// ------------------------------------------------------------
// 2) O SAQUE
// ------------------------------------------------------------
async function sacar(res, colaborador, chaveBruta, tipoEscolhido) {
  if (!asaas.configurado()) {
    return u.fail(res, 503, 'O saque ainda não está ligado. Fale com o time da Start.');
  }

  // Onze dígitos podem ser CPF e telefone ao mesmo tempo. Nesse caso a
  // gente NÃO escolhe por conta própria: pergunta. Mandar para o tipo
  // errado é mandar o dinheiro para outra pessoa, e não tem volta.
  const possiveis = asaas.tiposPossiveis(chaveBruta);
  if (!possiveis.length) {
    return u.fail(res, 400, 'Não reconheci essa chave Pix. Use CPF, e-mail, telefone com DDD ou chave aleatória.');
  }

  let tipo = null;
  if (tipoEscolhido && possiveis.indexOf(String(tipoEscolhido).toUpperCase()) >= 0) {
    tipo = String(tipoEscolhido).toUpperCase();
  } else if (possiveis.length === 1) {
    tipo = possiveis[0];
  } else {
    return u.json(res, 400, {
      ok: false,
      error: 'Esse número serve como ' + possiveis.map(function (p) { return asaas.TIPO_NOME[p]; }).join(' e como ') +
        '. Me diga qual é a sua chave.',
      escolher: possiveis.map(function (p) { return { tipo: p, nome: asaas.TIPO_NOME[p] }; })
    });
  }

  const chave = asaas.formataChave(chaveBruta, tipo);

  const aberta = await db.selectOne('benefit_releases', {
    collaborator_id: 'eq.' + colaborador.id, status: 'eq.liberado', select: '*'
  });
  if (!aberta) {
    return u.fail(res, 400, 'Você não tem benefício liberado agora. Assim que a Start liberar, ele aparece aqui.');
  }
  if (Number(aberta.valor) <= 0) {
    return u.fail(res, 400, 'O valor deste benefício está zerado. Fale com o time da Start.');
  }
  if (Number(aberta.valor) > teto()) {
    console.error('[space] saque acima do teto', aberta.id, aberta.valor);
    return u.fail(res, 400, 'Este valor passou do limite de segurança. O time da Start precisa conferir.');
  }

  // ---- A TRAVA ----
  // Só sai daqui quem conseguir virar liberado -> processando. O
  // filtro status=liberado vai no UPDATE de propósito: se dois
  // cliques chegarem juntos, um deles não acha mais a linha nesse
  // estado e volta de mãos vazias. Sem isso, dois Pix.
  const travada = await db.update('benefit_releases', {
    status: 'processando',
    pix_chave: chave,
    pix_tipo: tipo,
    solicitado_em: new Date().toISOString(),
    falha_motivo: null,
    updated_at: new Date().toISOString()
  }, { id: 'eq.' + aberta.id, status: 'eq.liberado' });

  if (!travada) {
    return u.fail(res, 409, 'Esse saque já está sendo processado. Aguarde um instante e atualize a página.');
  }

  const r = await asaas.transferirPix({
    valor: Number(travada.valor),
    chave: chave,
    tipo: tipo,
    descricao: travada.nome_voucher + ' - StartDigital',
    referencia: travada.id
  });

  if (r.ok) {
    const t = r.dados || {};
    const pago = String(t.status || '') === 'DONE';
    const atualizada = await db.update('benefit_releases', {
      status: pago ? 'pago' : 'processando',
      asaas_id: t.id || null,
      asaas_status: t.status || null,
      comprovante_url: t.transactionReceiptUrl || null,
      pago_em: pago ? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    }, { id: 'eq.' + travada.id });

    // o SMS para o dono sai antes de responder: em serverless, depois
    // do res.end a função pode ser congelada e o aviso nunca sairia
    await avisaChefeDoSaque(colaborador, travada);

    return u.ok(res, {
      enviado: true,
      liberacao: paraTela(atualizada || travada),
      aviso: pago ? 'Pix enviado!' : 'Pix solicitado. Costuma cair em segundos.'
    });
  }

  // ---- deu errado ----
  // Timeout é o caso perigoso: o Asaas pode ter recebido e mandado
  // o dinheiro, e a resposta é que se perdeu. Devolver para
  // "liberado" aqui seria abrir a porta para pagar duas vezes.
  // Fica em "processando" e alguém do time confere no Asaas.
  if (r.incerto) {
    await db.update('benefit_releases', {
      falha_motivo: 'Sem resposta do Asaas. Precisa conferir no painel do Asaas antes de liberar de novo.',
      updated_at: new Date().toISOString()
    }, { id: 'eq.' + travada.id });
    return u.fail(res, 504, 'O banco demorou a responder. Não tente de novo: o time da Start vai conferir e te avisar.');
  }

  // Erro claro do Asaas: nada saiu. Devolve o saque para a pessoa.
  await db.update('benefit_releases', {
    status: 'liberado',
    solicitado_em: null,
    falha_motivo: r.erro || 'Recusado pelo Asaas.',
    updated_at: new Date().toISOString()
  }, { id: 'eq.' + travada.id });

  console.error('[space] transferencia recusada', travada.id, r.status, r.erro);
  return u.fail(res, 400, r.erro || 'O banco recusou o envio. Confira a chave Pix e tente de novo.');
}

// ------------------------------------------------------------
module.exports = async function handler(req, res) {
  u.setBaseFromReq(req);
  const params = (req.query && Object.keys(req.query).length)
    ? req.query
    : Object.fromEntries(new URL(req.url, 'http://x').searchParams.entries());
  const action = params.action || '';

  try {
    // ---------------------------------------------------- 1) webhook
    if (action === 'webhook') {
      if (req.method !== 'POST') return u.json(res, 200, { ok: true, servico: 'webhook asaas' });
      return await receberWebhook(req, res);
    }

    // ---------------------------------------------------- 2) colaborador
    // Entra pelo link pessoal. O token é longo e aleatório, é ele
    // que faz as vezes de senha.
    if (action === 'meu_space' || action === 'sacar') {
      const corpo = req.method === 'POST' ? await u.readBody(req) : {};
      const colab = await colaboradorPorToken(params.t || corpo.t);
      if (!colab) return u.fail(res, 404, 'Link não encontrado. Peça um novo para a Start.');
      if (colab.active === false) return u.fail(res, 403, 'Este acesso está desativado.');

      if (action === 'sacar') {
        if (req.method !== 'POST') return u.fail(res, 405, 'Metodo nao permitido');
        return await sacar(res, colab, corpo.chave, corpo.tipo);
      }

      const linhas = await db.select('benefit_releases', {
        collaborator_id: 'eq.' + colab.id, order: 'liberado_em.desc', select: '*', limit: 20
      });
      const disponivel = linhas.filter(function (x) { return x.status === 'liberado'; })[0] || null;
      const emCurso = linhas.filter(function (x) { return x.status === 'processando'; })[0] || null;

      return u.ok(res, {
        colaborador: {
          nome: colab.name,
          primeiro_nome: u.firstName(colab.name),
          cargo: colab.role_title || ''
        },
        disponivel: disponivel ? paraTela(disponivel) : null,
        em_curso: emCurso ? paraTela(emCurso) : null,
        historico: linhas.map(paraTela),
        ligado: asaas.configurado()
      });
    }

    // ---------------------------------------------------- 3) painel
    const entrada = await porta.abrir(req, res, action);
    if (!entrada) return;

    if (action === 'sp_painel') {
      const vouchers = await db.select('benefit_vouchers', { order: 'position.asc', select: '*' });
      const pessoas = await db.select('collaborators', {
        active: 'is.true', order: 'name.asc', select: 'id,name,role_title,area,token'
      });
      const libs = await db.select('benefit_releases', {
        order: 'liberado_em.desc', select: '*', limit: 200
      });

      const porPessoa = {};
      libs.forEach(function (l) {
        if (!porPessoa[l.collaborator_id]) porPessoa[l.collaborator_id] = [];
        porPessoa[l.collaborator_id].push(l);
      });

      let saldo = null;
      if (asaas.configurado()) {
        const s = await asaas.saldo();
        saldo = s.ok ? s.saldo : null;
      }

      return u.ok(res, {
        vouchers: vouchers.map(function (v) {
          return { id: v.id, nome: v.nome, valor: Number(v.valor || 0), descricao: v.descricao || '', ativo: v.ativo !== false };
        }),
        colaboradores: pessoas.map(function (p) {
          const minhas = porPessoa[p.id] || [];
          const aberta = minhas.filter(function (x) { return x.status === 'liberado' || x.status === 'processando'; })[0];
          const ultimoPago = minhas.filter(function (x) { return x.status === 'pago'; })[0];
          return {
            id: p.id, nome: p.name, cargo: p.role_title || '', area: p.area || '',
            link: u.appUrl() + '/space?t=' + p.token,
            aberta: aberta ? paraTela(aberta) : null,
            ultimo_pago: ultimoPago ? paraTela(ultimoPago) : null,
            total_pago: minhas.filter(function (x) { return x.status === 'pago'; })
              .reduce(function (a, x) { return a + Number(x.valor || 0); }, 0)
          };
        }),
        historico: libs.slice(0, 60).map(function (l) {
          const p = pessoas.filter(function (x) { return x.id === l.collaborator_id; })[0];
          return Object.assign(paraTela(l), { colaborador: p ? p.name : '—' });
        }),
        config: await configSpace(),
        asaas: {
          ligado: asaas.configurado(),
          ambiente: asaas.ambiente(),
          chave: asaas.chaveResumida(),
          saldo: saldo,
          teto: teto(),
          webhook_url: u.appUrl() + '/api/space?action=webhook',
          webhook_pronto: !!String(process.env.ASAAS_WEBHOOK_TOKEN || '').trim()
        }
      });
    }

    if (action === 'sp_voucher_salvar') {
      if (req.method !== 'POST') return u.fail(res, 405, 'Metodo nao permitido');
      const body = await u.readBody(req);
      const nome = String(body.nome || '').trim().slice(0, 80);
      if (!nome) return u.fail(res, 400, 'Escreva o nome do voucher.');

      const valor = Math.round(Number(String(body.valor || '0').replace(',', '.')) * 100) / 100;
      if (!isFinite(valor) || valor < 0) return u.fail(res, 400, 'Confira o valor.');
      if (valor > teto()) return u.fail(res, 400, 'Esse valor passa do limite de segurança (' + dinheiro(teto()) + ').');

      const patch = {
        nome: nome, valor: valor,
        descricao: String(body.descricao || '').trim().slice(0, 300) || null,
        ativo: body.ativo !== false,
        updated_at: new Date().toISOString()
      };

      let row;
      if (body.id) {
        row = await db.update('benefit_vouchers', patch, { id: 'eq.' + body.id });
        if (!row) return u.fail(res, 404, 'Voucher nao encontrado.');
      } else {
        const todos = await db.select('benefit_vouchers', { select: 'position' });
        patch.position = todos.reduce(function (a, r) { return Math.max(a, Number(r.position || 0)); }, 0) + 1;
        row = await db.insert('benefit_vouchers', patch);
      }
      return u.ok(res, { voucher: row });
    }

    // ---- liberar o benefício para alguém ----
    if (action === 'sp_liberar') {
      if (req.method !== 'POST') return u.fail(res, 405, 'Metodo nao permitido');
      const body = await u.readBody(req);

      const voucher = await db.selectOne('benefit_vouchers', { id: 'eq.' + String(body.voucher_id || ''), select: '*' });
      if (!voucher) return u.fail(res, 404, 'Escolha um voucher.');
      if (Number(voucher.valor) <= 0) return u.fail(res, 400, 'Esse voucher está com valor zerado.');
      if (Number(voucher.valor) > teto()) return u.fail(res, 400, 'Esse voucher passa do limite de segurança.');

      const ids = Array.isArray(body.colaboradores) ? body.colaboradores : [body.colaborador_id];
      const feitos = [];
      const pulados = [];

      // por quais canais avisar cada pessoa que o benefício chegou
      const avisar = Object.assign({ whatsapp: false, sms: false, email: false }, body.avisar || {});
      const vaiAvisar = avisar.whatsapp || avisar.sms || avisar.email;
      const inst = vaiAvisar ? await instanciaZap() : '';
      let avisos = 0;

      for (const cid of ids) {
        if (!cid) continue;
        const p = await db.selectOne('collaborators', { id: 'eq.' + cid, select: 'id,name,active,phone,email,token' });
        if (!p || p.active === false) { pulados.push({ id: cid, motivo: 'colaborador inativo' }); continue; }

        // Já tem uma em aberto? Não empilha. O banco também barra
        // (índice único), mas checar aqui dá uma mensagem decente.
        const aberta = await db.selectOne('benefit_releases', {
          collaborator_id: 'eq.' + cid, status: 'in.(liberado,processando)', select: 'id,status'
        });
        if (aberta) { pulados.push({ nome: p.name, motivo: 'já tem um benefício em aberto' }); continue; }

        try {
          const nova = await db.insert('benefit_releases', {
            collaborator_id: cid,
            voucher_id: voucher.id,
            nome_voucher: voucher.nome,
            valor: Number(voucher.valor),
            status: 'liberado',
            liberado_por: entrada.session.nome || entrada.papel,
            liberado_em: new Date().toISOString()
          });
          feitos.push({ nome: p.name, id: nova.id });

          // ---- avisa a pessoa pelos canais escolhidos ----
          // Aviso que falha não desfaz a liberação: o benefício está lá,
          // o link continua valendo, e o painel mostra quem foi avisado.
          if (vaiAvisar) {
            const link = u.appUrl() + '/space?t=' + p.token;
            const valorBr = 'R$ ' + Number(voucher.valor).toFixed(2).replace('.', ',');
            const texto = 'Oi ' + u.firstName(p.name) + '! Você recebeu um benefício da StartDigital: ' +
              voucher.nome + ' de ' + valorBr + '. Resgate por Pix aqui: ' + link;

            if (avisar.whatsapp && p.phone) {
              const r1 = await send.sendWhatsApp({ to: p.phone, text: texto, instance: inst })
                .catch(function () { return { status: 'erro' }; });
              if (r1.status === 'enviado') avisos++;
            }
            if (avisar.sms && p.phone) {
              const r2 = await send.sendSms({ to: p.phone, text: texto })
                .catch(function () { return { status: 'erro' }; });
              if (r2.status === 'enviado') avisos++;
            }
            if (avisar.email && p.email) {
              const r3 = await send.sendEmail({
                to: p.email,
                subject: 'Você recebeu um benefício da StartDigital 🎁',
                text: texto + '\n\nQualquer dúvida, fale com o time da Start.\n\nEquipe StartDigital'
              }).catch(function () { return { status: 'erro' }; });
              if (r3.status === 'enviado') avisos++;
            }
          }
        } catch (e) {
          pulados.push({ nome: p.name, motivo: 'já tem um benefício em aberto' });
        }
      }

      return u.ok(res, { liberados: feitos, pulados: pulados, avisos_enviados: avisos });
    }

    // ---- ajustes do Space (por enquanto: o telefone do aviso de saque) ----
    if (action === 'sp_config_save') {
      if (req.method !== 'POST') return u.fail(res, 405, 'Metodo nao permitido');
      const body = await u.readBody(req);
      const atual = await configSpace();
      const novo = Object.assign({}, atual, {
        aviso_sms_para: String(body.aviso_sms_para || '').trim().slice(0, 30)
      });
      await db.upsert('settings', { key: 'space', value: novo }, 'key');
      return u.ok(res, { config: novo });
    }

    // ---- cancelar uma liberação que ninguém sacou ----
    if (action === 'sp_cancelar') {
      if (req.method !== 'POST') return u.fail(res, 405, 'Metodo nao permitido');
      const body = await u.readBody(req);
      const row = await db.update('benefit_releases', {
        status: 'cancelado', updated_at: new Date().toISOString()
      }, { id: 'eq.' + String(body.id || ''), status: 'eq.liberado' });
      if (!row) return u.fail(res, 400, 'Só dá para cancelar benefício que ainda não foi sacado.');
      return u.ok(res, { cancelado: true });
    }

    // ---- conferir no Asaas um saque que ficou no escuro ----
    // Serve exatamente para o caso do timeout: pergunta ao Asaas o
    // que aconteceu com aquela referência e acerta o nosso lado.
    if (action === 'sp_conferir') {
      if (req.method !== 'POST') return u.fail(res, 405, 'Metodo nao permitido');
      const body = await u.readBody(req);
      const lib = await db.selectOne('benefit_releases', { id: 'eq.' + String(body.id || ''), select: '*' });
      if (!lib) return u.fail(res, 404, 'Liberacao nao encontrada.');

      const r = await asaas.transferenciasPorReferencia(lib.id);
      if (!r.ok) return u.fail(res, 502, r.erro);

      const lista = (r.dados && r.dados.data) || [];
      if (!lista.length) {
        // Não saiu nada. Pode devolver para a pessoa com segurança.
        await db.update('benefit_releases', {
          status: 'liberado', solicitado_em: null,
          falha_motivo: 'Conferido no Asaas: nada foi enviado.',
          updated_at: new Date().toISOString()
        }, { id: 'eq.' + lib.id });
        return u.ok(res, { achou: false, aviso: 'Nada saiu. O benefício voltou a ficar disponível.' });
      }

      const t = lista[0];
      const novo = String(t.status) === 'DONE' ? 'pago'
        : (String(t.status) === 'FAILED' || String(t.status) === 'CANCELLED') ? 'falhou' : 'processando';
      await db.update('benefit_releases', {
        status: novo, asaas_id: t.id, asaas_status: t.status,
        comprovante_url: t.transactionReceiptUrl || null,
        pago_em: novo === 'pago' ? new Date().toISOString() : null,
        falha_motivo: novo === 'falhou' ? (t.failReason || 'Recusado pelo Asaas') : null,
        updated_at: new Date().toISOString()
      }, { id: 'eq.' + lib.id });

      return u.ok(res, { achou: true, status: novo, asaas: t.status, aviso: 'Estado atualizado: ' + (SITUACOES[novo] || novo) });
    }

    return u.fail(res, 400, 'Acao desconhecida: ' + action);
  } catch (e) {
    console.error('[space]', e);
    return u.fail(res, 500, e.message);
  }
};

module.exports.SITUACOES = SITUACOES;
module.exports.teto = teto;
