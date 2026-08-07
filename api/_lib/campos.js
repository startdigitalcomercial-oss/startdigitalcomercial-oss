// ============================================================
// CAMPOS DO FORMULÁRIO DA VAGA
//
// Nome, WhatsApp e e-mail são sempre pedidos. Além deles, cada vaga
// escolhe o que mais quer perguntar. Este arquivo é a lista do que
// existe para escolher — a landing monta a tela a partir daqui, e a
// API valida a partir daqui. Um lugar só, para os dois não brigarem.
// ============================================================
'use strict';

const CATALOGO = [
  {
    chave: 'pretensao', coluna: 'salary_expectation', tipo: 'texto',
    rotulo: 'Pretensão salarial', dica: 'Quanto você espera receber?',
    exemplo: 'R$ 2.500', max: 60
  },
  {
    chave: 'cpf', coluna: 'cpf', tipo: 'cpf',
    rotulo: 'CPF', dica: 'Só números, a gente formata.',
    exemplo: '000.000.000-00', max: 14
  },
  {
    chave: 'cidade', coluna: 'city', tipo: 'texto',
    rotulo: 'Cidade onde mora', dica: 'É por causa do trabalho presencial.',
    exemplo: 'Praia Grande', max: 80
  },
  {
    chave: 'indicacao', coluna: 'indicacao', tipo: 'texto',
    rotulo: 'Foi indicação de alguém?', dica: 'Se sim, escreva o nome de quem indicou. Se não, deixe em branco.',
    exemplo: 'Nome de quem indicou', max: 120, nunca_obrigatorio: true
  },
  {
    chave: 'linkedin', coluna: 'linkedin', tipo: 'texto',
    rotulo: 'LinkedIn', dica: 'Cole o endereço do seu perfil.',
    exemplo: 'linkedin.com/in/seunome', max: 200
  },
  {
    chave: 'instagram', coluna: 'instagram', tipo: 'texto',
    rotulo: 'Instagram', dica: 'Seu @ ou o endereço do perfil.',
    exemplo: '@seuperfil', max: 120
  },
  {
    chave: 'experiencia', coluna: 'experience', tipo: 'texto_longo',
    rotulo: 'Experiência profissional', dica: 'Um resumo do que você já fez.',
    exemplo: 'Conte rapidamente a sua trajetória', max: 3000
  },
  {
    chave: 'curriculo', coluna: 'curriculo_url', tipo: 'arquivo',
    rotulo: 'Currículo', dica: 'PDF, Word ou uma foto. Até 8 MB.',
    exemplo: '', max: 0
  }
];

const PORCHAVE = {};
CATALOGO.forEach(function (c) { PORCHAVE[c.chave] = c; });

// Os três que toda vaga pede, sempre. Ficam aqui só para o painel
// conseguir mostrá-los como fixos, sem caixinha de marcar.
const FIXOS = [
  { chave: 'nome', rotulo: 'Nome completo' },
  { chave: 'whatsapp', rotulo: 'WhatsApp com DDD' },
  { chave: 'email', rotulo: 'E-mail' }
];

function existe(chave) { return !!PORCHAVE[chave]; }

// Limpa o que veio do painel: só chaves conhecidas, sem repetição,
// e na ordem do catálogo (para o formulário não sair embaralhado).
function normaliza(lista) {
  const querem = {};
  (Array.isArray(lista) ? lista : []).forEach(function (x) {
    const chave = typeof x === 'string' ? x : (x && x.chave);
    if (existe(chave)) querem[chave] = true;
  });
  return CATALOGO.filter(function (c) { return querem[c.chave]; })
    .map(function (c) { return c.chave; });
}

// O que a landing precisa saber para desenhar os campos.
function paraFormulario(lista) {
  return normaliza(lista).map(function (chave) {
    const c = PORCHAVE[chave];
    return {
      chave: c.chave, tipo: c.tipo, rotulo: c.rotulo,
      dica: c.dica || '', exemplo: c.exemplo || '',
      obrigatorio: !c.nunca_obrigatorio && c.tipo !== 'arquivo'
    };
  });
}

// ---------------------------------------------------------------- CPF
// Os dois dígitos verificadores. Sem isso, "111.111.111-11" passaria.
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

function formataCpf(bruto) {
  const d = String(bruto || '').replace(/\D/g, '').slice(0, 11);
  if (d.length !== 11) return String(bruto || '').trim();
  return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9);
}

// ---------------------------------------------------------------- validação
// Devolve { erro } ou { dados } com as colunas prontas para o banco.
function validar(lista, corpo) {
  const dados = {};
  const chaves = normaliza(lista);

  for (const chave of chaves) {
    const c = PORCHAVE[chave];
    if (c.tipo === 'arquivo') continue;          // arquivo vai por outro caminho

    const bruto = String((corpo && corpo[chave]) || '').trim();

    if (!bruto) {
      if (c.nunca_obrigatorio) continue;
      return { erro: 'Preencha: ' + c.rotulo.toLowerCase() + '.' };
    }
    if (bruto.length > c.max) {
      return { erro: c.rotulo + ' ficou grande demais.' };
    }
    if (c.tipo === 'cpf') {
      if (!cpfValido(bruto)) return { erro: 'Confira o CPF, ele não parece válido.' };
      dados[c.coluna] = formataCpf(bruto);
      continue;
    }
    dados[c.coluna] = bruto;
  }
  return { dados: dados };
}

function pedeCurriculo(lista) {
  return normaliza(lista).indexOf('curriculo') >= 0;
}

module.exports = {
  CATALOGO, FIXOS, normaliza, paraFormulario, validar,
  cpfValido, formataCpf, pedeCurriculo, existe
};
