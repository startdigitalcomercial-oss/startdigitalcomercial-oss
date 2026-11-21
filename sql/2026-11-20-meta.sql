-- ============================================================
-- META EM TEMPO REAL — uma tabela nova, nada tocado
--
-- Esta migracao e ADITIVA: ela cria uma tabela que nao existia e
-- nao encosta em nenhuma outra. Pode rodar duas vezes sem medo
-- (tudo e "if not exists").
--
-- POR QUE CENTAVOS E NAO REAIS:
-- dinheiro em numero decimal e armadilha classica. 0,1 + 0,2 nao
-- da 0,3 em ponto flutuante, e um placar que soma trezentos
-- lancamentos erraria centavos no fim do mes. Guardamos numero
-- inteiro de centavos: R$ 3.500,00 = 350000. Somar inteiro nunca
-- erra. A divisao por 100 acontece so na hora de desenhar na tela.
--
-- POR QUE NAO EXISTE COLUNA "total":
-- o documento pediu (item 27) e esta certo: total guardado e total
-- que um dia discorda dos lancamentos. O total e SEMPRE calculado
-- somando os lancamentos vivos.
-- ============================================================

create table if not exists public.meta_lancamentos (
  id            uuid primary key default gen_random_uuid(),

  -- de onde veio o dinheiro. O check e a tranca: so estas duas
  -- palavras entram, entao nunca aparece um terceiro total do nada.
  tipo          text not null check (tipo in ('comercial', 'operacional')),

  responsavel   text not null,
  cliente       text not null,
  servico       text,
  valor_centavos bigint not null check (valor_centavos > 0),
  observacao    text,

  -- quem digitou (nao e o mesmo que o responsavel pela venda)
  user_id       uuid references public.panel_users (id) on delete set null,
  user_nome     text,

  -- data e hora de verdade, do servidor, nao do navegador
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- apagar aqui e riscar a linha, nao queimar o papel: o historico
  -- continua, o placar deixa de somar.
  excluido_em   timestamptz
);

-- O placar pergunta sempre a mesma coisa: "lancamentos vivos deste
-- mes". Este indice e exatamente essa pergunta, por isso ele e
-- parcial: linhas apagadas nem entram no indice.
create index if not exists meta_lancamentos_vivos_idx
  on public.meta_lancamentos (created_at desc)
  where excluido_em is null;

create index if not exists meta_lancamentos_tipo_idx
  on public.meta_lancamentos (tipo, created_at desc)
  where excluido_em is null;

-- A tabela e lida e escrita so pela API, com a chave de servico.
-- Ligar RLS sem politica = ninguem entra pela porta do navegador,
-- nem com a chave publica. E o padrao do resto do sistema.
alter table public.meta_lancamentos enable row level security;
