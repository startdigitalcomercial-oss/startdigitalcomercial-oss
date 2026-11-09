// ============================================================
// AGENDA OPERACIONAL — as reuniões dos gestores com os clientes.
//
// Duas coisas moram aqui:
//   1. a agenda do sistema (reuniões, situação, indicadores)
//   2. a ponte com o Google Calendar (OAuth 2.0)
//
// Sobre ATRASADA x NÃO REALIZADA — é a confusão mais fácil de
// cometer e o documento pede para não cometer:
//   atrasada     = a hora passou e NINGUÉM disse o que aconteceu
//   não realizada = alquém disse que não aconteceu
// A primeira é uma conta feita com o relógio; a segunda é uma
// decisão registrada. Por isso "atrasada" não é um status no
// banco: é calculada na hora de mostrar.
//
// Sobre o Google: enquanto não existirem as credenciais, nada
// aqui finge que conecta. A tela diz o que falta.
// ============================================================
'use strict';
