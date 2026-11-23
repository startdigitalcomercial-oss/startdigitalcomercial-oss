// ============================================================
// A PORTA DO PAINEL
//
// Toda rota de painel passa por aqui antes de fazer qualquer coisa.
// São cinco conferências, nesta ordem:
//
//   1. o crachá (token) é de verdade?
//   2. o crachá foi emitido antes do último "encerrar todas as sessões"?
//   3. a pessoa ainda trabalha aqui (e com o mesmo papel)?
//   4. este papel pode executar ESTA ação?
//   5. o módulo desta ação está liberado para ESTA pessoa?
//
// Antes isto morava dentro de api/admin.js. Quando nasceu o financeiro,
// copiar a porta para o arquivo novo seria pedir para as duas versões
// discordarem um dia. Agora existe uma só.
// ============================================================
'use strict';

const db = require('./db');
const u = require('./util');
const perms = require('./perms');

async function epocaSessao() {
  try {
    const reg = await db.selectOne('settings', { key: 'eq.session_epoch', select: 'value' });
    return (reg && reg.value && Number(reg.value.valor)) || 0;
  } catch (e) { return 0; }
}

// Devolve { session, papel } quando pode entrar.
// Devolve null quando NÃO pode — e a resposta de erro já foi escrita,
// então quem chamou só precisa dar return.
async function abrir(req, res, action) {
  const session = u.requireAdmin(req, res);
  if (!session) return null;

  const epocaAtual = await epocaSessao();
  if (session.epoca && session.epoca < epocaAtual) {
    u.fail(res, 401, 'Sua sessao foi encerrada. Faca login novamente.');
    return null;
  }

  const papel = session.papel || 'dono';
  let eu = null;
  if (session.uid) {
    eu = await db.selectOne('panel_users', { id: 'eq.' + session.uid, select: '*' });
    if (!eu || eu.active === false) {
      u.fail(res, 401, 'O seu acesso foi desativado. Fale com o Dono do painel.');
      return null;
    }
    if (eu.role !== papel) {
      u.fail(res, 401, 'O seu nível de acesso mudou. Entre novamente.');
      return null;
    }
  }

  if (!perms.permite(papel, action)) {
    u.fail(res, 403, perms.recado(papel, action));
    return null;
  }

  // 5. o MÓDULO desta ação está liberado para esta pessoa?
  //
  // Esconder o item do menu é gentileza; a tranca é aqui. Quem digitar
  // o endereço da API na mão, ou guardar um link antigo, bate nesta
  // linha. E como a lista de módulos é lida do banco a cada pedido
  // (junto com a conferência de "ainda trabalha aqui"), tirar um
  // módulo de alguém vale no pedido seguinte — não na próxima vez que
  // a pessoa fizer login.
  if (eu && !perms.moduloPermite(papel, eu.modulos, action)) {
    u.fail(res, 403, perms.recadoModulo(action));
    return null;
  }

  return { session: session, papel: papel, usuario: eu };
}

module.exports = { abrir, epocaSessao };
