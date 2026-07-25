# StartDigital RH — Recrutamento e Seleção

Sistema completo de recrutamento da StartDigital: formulário público, quadro Kanban,
teste DISC, quiz supervisionado, área de integração com aulas e envio de boas-vindas
por e-mail + WhatsApp + SMS.

Feito na mesma receita do `adv_01`: **zero dependências npm**, funções serverless em
`api/`, site estático em `public/`, Supabase acessado pela API REST.

---

## 1. As telas do sistema

| Endereço | Para quem | O que faz |
|---|---|---|
| `/vaga` | candidato | Formulário de candidatura (link para divulgar) |
| `/admin` | seu time | Painel: Kanban, fichas, aulas, quiz, mensagens |
| `/disc?t=TOKEN` | candidato | Teste de perfil comportamental (24 grupos) |
| `/prova?t=TOKEN` | candidato | Quiz ao vivo, com travas anti-consulta |
| `/portal?t=TOKEN` | contratado | Área de integração com os módulos e aulas |

O `TOKEN` é gerado sozinho para cada candidato. O painel mostra e copia esses links
na ficha da pessoa, aba **Ações**.

---

## 2. As etapas do Kanban

1. Formulário recebido
2. Triagem
3. Entrevista inicial
4. Teste prático
5. Teste DISC
6. Quiz supervisionado
7. Entrevista final
8. Aprovado / Boas-vindas
9. Contratado
10. Não seguiu

Arraste o cartão de uma coluna para a outra. Cada movimento fica registrado no
histórico do candidato.

---

## 3. Como publicar na Vercel (passo a passo)

1. **Vercel → Add New Project → Import** e escolha este repositório.
2. Não mexa em nada na tela de build (o projeto não tem build).
3. **Settings → Environment Variables**: cole as variáveis do arquivo `.env.example`,
   com os valores reais.
4. Faça o Deploy.
5. Volte em `APP_URL` e coloque o endereço final que a Vercel te deu
   (ex: `https://start-rh.vercel.app`). Isso é o que faz os links das mensagens
   funcionarem.
6. **REGRA SAGRADA:** mudou variável de ambiente? Faça **Redeploy**
   (Deployments → botão `⋯` → Redeploy). Sem isso a mudança não vale.

Todo commit novo no GitHub gera um deploy automático.

---

## 4. Variáveis de ambiente

| Variável | Para que serve | Obrigatória |
|---|---|---|
| `APP_URL` | Endereço público do sistema; monta os links enviados ao candidato | sim |
| `SUPABASE_URL` | Endereço do projeto no Supabase | sim |
| `SUPABASE_SECRET_KEY` | Chave secreta (`sb_secret_…`) que deixa o sistema escrever no banco | sim |
| `ADMIN_PASSWORD` | Senha para entrar em `/admin` | sim |
| `APP_SECRET` | Chave aleatória que assina a sessão do painel | sim |
| `RESEND_API_KEY` | Envio de e-mail | para e-mail |
| `MAIL_FROM` | Remetente. Sem domínio verificado use `StartDigital <onboarding@resend.dev>` | para e-mail |
| `MAIL_BCC` | Cópia oculta de todos os envios | não |
| `EVOLUTION_API_URL` | Endereço da Evolution API | para WhatsApp |
| `EVOLUTION_API_KEY` | Chave da Evolution API | para WhatsApp |
| `EVOLUTION_INSTANCE` | Nome da instância. Também pode ser escolhido no painel, em Ajustes | para WhatsApp |
| `TWILIO_ACCOUNT_SID` `TWILIO_AUTH_TOKEN` `TWILIO_FROM` | Envio de SMS | para SMS |

**Sem chave de um canal o sistema não quebra.** Ele grava a mensagem com a situação
`pendente_manual`, e você envia na mão. O e-mail do Resend sem domínio verificado só
chega no endereço do dono da conta.

---

## 5. Como usar no dia a dia

**Receber candidatos.** Divulgue `/vaga`. Cada envio cai na primeira coluna e o
candidato recebe um e-mail automático de confirmação.

**Avaliar.** Clique no cartão para abrir a ficha: respostas do formulário, resultado
do DISC, respostas do quiz, notas de 1 a 5 estrelas e anotações internas (o candidato
nunca vê essas anotações).

**Aplicar o DISC.** Mova para *Teste DISC*, vá em **Boas-vindas → Convite para o teste
DISC**, escolha os canais e envie. O candidato responde e o resultado aparece na ficha
com gráfico, pontos fortes, pontos de atenção e como liderar aquele perfil.

**Aplicar o quiz.** O quiz é para ser respondido **na sua frente, ao vivo**. Envie o
link só na hora da chamada. Durante a prova o sistema registra saídas da aba,
tentativas de colar texto, bloqueia copiar/colar e clique direito, e mostra
cronômetro. Tudo isso vai para a ficha como alerta de integridade.

**Corrigir a questão escrita.** As questões objetivas são corrigidas na hora. A
questão aberta você lê na aba Quiz da ficha e ajusta a nota final ali.

**Dar as boas-vindas.** Aba **Boas-vindas** → escolha a pessoa → revise os três textos
(pode editar antes de enviar) → **Enviar mensagens**. Isso move o candidato para
*Aprovado* e **libera a área de integração** dele automaticamente.

**Montar as aulas.** Aba **Aulas**: crie módulos, adicione aulas, cole o link do vídeo
(YouTube, Vimeo, Loom, Google Drive ou `.mp4`) e liste os materiais no formato
`Nome do material | https://link`, um por linha. O candidato assiste e marca como
concluída. Não existe comentário embaixo do vídeo.

**Editar os textos.** Aba **Mensagens**: todos os modelos de e-mail, WhatsApp e SMS.
Variáveis disponíveis:

```
{{nome}} {{primeiro_nome}} {{vaga}} {{email}} {{telefone}} {{cidade}}
{{empresa}} {{link_portal}} {{link_disc}} {{link_quiz}}
```

---

## 6. Segurança

- Todas as tabelas estão com RLS ligado e **sem policies**: a chave pública do
  Supabase não lê nem escreve nada. Só as funções do servidor, com a chave secreta,
  acessam o banco.
- O gabarito do quiz nunca é enviado para o navegador do candidato.
- O painel exige senha e a sessão vale 12 horas.
- `/admin`, `/disc`, `/prova` e `/portal` estão marcados como `noindex` e bloqueados
  no `robots.txt`.
- A chave secreta do Supabase **nunca** aparece no código do site — ela só existe
  como variável de ambiente na Vercel.

---

## 7. Estrutura dos arquivos

```
api/
  public.js          rotas do candidato (formulário, DISC, quiz, portal)
  admin.js           rotas do painel (login, Kanban, aulas, mensagens, envios)
  _lib/db.js         acesso ao Supabase via REST
  _lib/util.js       sessão, templates, telefone, validação
  _lib/disc.js       cálculo e interpretação do DISC
  _lib/send.js       Resend, Evolution e Twilio
public/
  index.html         formulário público
  disc.html          teste DISC
  prova.html         quiz supervisionado
  portal.html        área de integração
  admin.html         painel
  ui.css             estilo compartilhado
tools/
  mock-supabase.js   espelho local do banco (só para testes)
  test-fluxo.js      teste do fluxo completo
dev-server.js        servidor local (a Vercel não usa)
```

## 8. Rodar e testar na sua máquina

```bash
cp .env.example .env      # preencha os valores
node dev-server.js        # http://localhost:3000

# teste automático do fluxo inteiro, sem tocar no banco real:
node tools/mock-supabase.js &
SUPABASE_URL=http://127.0.0.1:54321 node dev-server.js &
node tools/test-fluxo.js
```
