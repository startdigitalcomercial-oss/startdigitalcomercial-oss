// ============================================================
// ASAAS — o banco por onde o dinheiro sai
//
// Aqui só tem chamada de API. Regra de negócio (quem pode sacar,
// quanto, quando) NÃO mora aqui — mora no space.js. Este arquivo
// só sabe conversar com o Asaas.
//
// A chave NUNCA fica no código. Ela vem da variável de ambiente
// ASAAS_API_KEY, criada no painel da Vercel. Este repositório é
// público: chave no código é chave vazada.
// ============================================================
'use strict';

// sandbox = dinheiro de mentira, para testar à vontade.
// producao = dinheiro de verdade. Só troque quando tiver certeza.
function ambiente() {
  const v = String(process.env.ASAAS_AMBIENTE || 'sandbox').trim().toLowerCase();
  return (v === 'producao' || v === 'production' || v === 'prod') ? 'producao' : 'sandbox';
}

function baseUrl() {
  // ASAAS_BASE_URL existe para o espelho local dos testes apontar para
  // um Asaas de mentira. Em produção ela fica vazia e valem os dois
  // endereços de verdade abaixo.
  const forcada = String(process.env.ASAAS_BASE_URL || '').trim().replace(/\/+$/, '');
  if (forcada) return forcada;
  return ambiente() === 'producao'
    ? 'https://api.asaas.com/v3'
    : 'https://api-sandbox.asaas.com/v3';
}

function chave() {
  return String(process.env.ASAAS_API_KEY || '').trim();
}

function configurado() { return !!chave(); }

// Só os últimos caracteres, para o painel mostrar "está configurada"
// sem nunca imprimir a chave inteira em lugar nenhum.
function chaveResumida() {
  const k = chave();
  if (!k) return '';
  return '…' + k.slice(-6);
}

// ------------------------------------------------------------
// A chamada crua. Devolve { ok, status, dados } — nunca lança por
// erro do Asaas, porque quem chama precisa decidir o que fazer com
// o dinheiro, e não levar uma exceção no meio do caminho.
// ------------------------------------------------------------
async function chamar(caminho, opcoes) {
  opcoes = opcoes || {};
  if (!configurado()) {
    return { ok: false, status: 0, dados: null, erro: 'ASAAS_API_KEY não está configurada na Vercel.' };
  }

  const controle = new AbortController();
  const relogio = setTimeout(function () { controle.abort(); }, opcoes.timeout || 25000);

  try {
    const res = await fetch(baseUrl() + caminho, {
      method: opcoes.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'access_token': chave(),
        'User-Agent': 'StartDigital-Portal/1.0.0'
      },
      body: opcoes.body ? JSON.stringify(opcoes.body) : undefined,
      signal: controle.signal
    });

    const texto = await res.text();
    let dados = null;
    try { dados = texto ? JSON.parse(texto) : null; } catch (e) { dados = { bruto: texto }; }

    // Um corpo com "errors" é recusa, mesmo que o HTTP diga 200.
    // Dinheiro não é lugar para confiar só no código de status: se um
    // dia o Asaas (ou um proxy no meio) devolver 200 com erro dentro,
    // a gente tem que ler isso como "não saiu", e não como sucesso.
    const temErro = dados && Array.isArray(dados.errors) && dados.errors.length > 0;
    if (!res.ok || temErro) {
      return { ok: false, status: res.status, dados: dados, erro: primeiroErro(dados, res.status) };
    }
    return { ok: true, status: res.status, dados: dados };
  } catch (e) {
    const foiTempo = e.name === 'AbortError';
    return {
      ok: false, status: 0, dados: null,
      erro: foiTempo ? 'O Asaas demorou demais para responder.' : ('Não consegui falar com o Asaas: ' + e.message),
      incerto: foiTempo   // <- pode ter saído mesmo assim. Ver nota em space.js.
    };
  } finally {
    clearTimeout(relogio);
  }
}

function primeiroErro(dados, status) {
  const lista = dados && Array.isArray(dados.errors) ? dados.errors : [];
  if (lista.length && lista[0].description) return lista[0].description;
  if (status === 401) return 'A chave do Asaas foi recusada. Confira ASAAS_API_KEY na Vercel.';
  return 'O Asaas recusou a operação (erro ' + status + ').';
}

// ------------------------------------------------------------
// Saldo da conta. Serve para o painel avisar antes de liberar
// benefício que a conta não tem dinheiro para pagar.
// ------------------------------------------------------------
async function saldo() {
  const r = await chamar('/finance/balance');
  if (!r.ok) return { ok: false, erro: r.erro };
  const v = r.dados && (r.dados.balance !== undefined ? r.dados.balance : r.dados.totalBalance);
  return { ok: true, saldo: Number(v || 0) };
}

// ------------------------------------------------------------
// TRANSFERÊNCIA PIX
// externalReference é o id da liberação no nosso banco. É por ele
// que a gente reconhece o webhook depois e, se precisar conferir,
// consegue achar a transferência sem adivinhação.
// ------------------------------------------------------------
const TIPOS_PIX = ['CPF', 'CNPJ', 'EMAIL', 'PHONE', 'EVP'];

async function transferirPix(dados) {
  const corpo = {
    value: Number(dados.valor),
    pixAddressKey: String(dados.chave || '').trim(),
    pixAddressKeyType: dados.tipo,
    operationType: 'PIX',
    description: String(dados.descricao || '').slice(0, 100),
    externalReference: String(dados.referencia || '')
  };
  return await chamar('/transfers', { method: 'POST', body: corpo });
}

// Consulta uma transferência pelo id do Asaas. Usada quando a
// chamada de criação deu timeout e a gente não sabe se saiu.
async function verTransferencia(id) {
  return await chamar('/transfers/' + encodeURIComponent(id));
}

// Lista transferências por externalReference — o jeito de descobrir
// se um saque saiu quando a resposta se perdeu no caminho.
async function transferenciasPorReferencia(referencia) {
  return await chamar('/transfers?externalReference=' + encodeURIComponent(referencia) + '&limit=10');
}

// ------------------------------------------------------------
// QUE TIPO DE CHAVE É ESSA?
//
// Cuidado aqui: onze dígitos podem ser um CPF E um celular ao mesmo
// tempo. "13996003897" é um telefone de Praia Grande e também passa
// nos dígitos verificadores de CPF. Não dá para adivinhar — e chutar
// errado manda o dinheiro para outra pessoa.
//
// Então esta função devolve TODAS as leituras possíveis. Quando sobra
// mais de uma, quem chama tem que perguntar para o dono da chave.
// ------------------------------------------------------------
function tiposPossiveis(bruta) {
  const t = String(bruta || '').trim();
  if (!t) return [];

  if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(t)) return ['EMAIL'];
  // chave aleatória (EVP): 32 hexadecimais, com ou sem hífen
  if (/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(t)) return ['EVP'];

  const d = t.replace(/\D/g, '');
  const fora = [];

  if (d.length === 14) fora.push('CNPJ');
  if (d.length === 11 && cpfValido(d)) fora.push('CPF');
  if (pareceTelefone(d)) fora.push('PHONE');

  return fora;
}

// Telefone brasileiro de verdade, não "onze dígitos quaisquer".
// Isso derruba quase toda a confusão com CPF: em celular o dígito
// depois do DDD é sempre 9, e em CPF quase nunca é. Sobra pouca
// coisa de fato ambígua — e essa a gente pergunta.
function pareceTelefone(digitos) {
  let d = String(digitos || '');
  if ((d.length === 12 || d.length === 13) && d.slice(0, 2) === '55') d = d.slice(2);

  if (d.length !== 10 && d.length !== 11) return false;

  const ddd = Number(d.slice(0, 2));
  if (!(ddd >= 11 && ddd <= 99)) return false;

  // celular: 11 dígitos e o primeiro do número é 9
  if (d.length === 11) return d[2] === '9';
  // fixo: 10 dígitos e o primeiro do número vai de 2 a 5
  return d[2] >= '2' && d[2] <= '5';
}

// O tipo, quando só existe um. Ambíguo devolve null de propósito.
function tipoDaChave(bruta) {
  const p = tiposPossiveis(bruta);
  return p.length === 1 ? p[0] : null;
}

const TIPO_NOME = {
  CPF: 'CPF', CNPJ: 'CNPJ', EMAIL: 'E-mail',
  PHONE: 'Telefone', EVP: 'Chave aleatória'
};

// O Asaas quer o telefone com o +55 na frente.
function formataChave(bruta, tipo) {
  const t = String(bruta || '').trim();
  if (tipo === 'PHONE') {
    let d = t.replace(/\D/g, '');
    if (d.length === 10 || d.length === 11) d = '55' + d;
    return '+' + d;
  }
  if (tipo === 'CPF' || tipo === 'CNPJ') return t.replace(/\D/g, '');
  return t;
}

function cpfValido(bruto) {
  const d = String(bruto || '').replace(/\D/g, '');
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;
  for (let volta = 0; volta < 2; volta++) {
    const ate = 9 + volta;
    let soma = 0;
    for (let i = 0; i < ate; i++) soma += Number(d[i]) * (ate + 1 - i);
    let dig = (soma * 10) % 11;
    if (dig === 10) dig = 0;
    if (dig !== Number(d[ate])) return false;
  }
  return true;
}

module.exports = {
  ambiente, baseUrl, configurado, chaveResumida,
  saldo, transferirPix, verTransferencia, transferenciasPorReferencia,
  tipoDaChave, tiposPossiveis, formataChave, cpfValido,
  TIPOS_PIX, TIPO_NOME, chamar
};
