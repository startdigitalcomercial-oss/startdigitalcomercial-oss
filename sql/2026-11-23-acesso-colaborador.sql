-- ============================================================
-- ACESSO DE COLABORADOR — vinculo, modulos e convites
--
-- Migracao ADITIVA. Cria duas colunas e uma tabela; nao apaga,
-- nao renomeia e nao altera o valor de nenhuma linha existente.
-- Pode rodar duas vezes sem medo (tudo e "if not exists").
--
-- O desenho, em tres frases:
--
--   COLABORADOR e a pessoa dentro da empresa (tabela collaborators).
--   USUARIO e a credencial de acesso (tabela panel_users).
--   Um usuario PODE apontar para um colaborador — pelo ID, nunca
--   pelo nome, porque nome muda (casamento, correcao de cadastro) e
--   ID nao.
-- ============================================================

-- 1) O VINCULO: qual colaborador e este usuario.
--    "on delete set null": se um dia o colaborador for apagado, o
--    usuario continua existindo, so perde o vinculo. Apagar em
--    cascata tiraria o acesso de alguem por tabela.
alter table public.panel_users
  add column if not exists collaborator_id uuid
  references public.collaborators (id) on delete set null;

-- Um colaborador tem NO MAXIMO um usuario. Esta e a tranca de
-- verdade contra "Fulano da Silva 2": mesmo que dois convites sejam
-- confirmados no mesmo milesimo, o banco aceita um e recusa o outro.
-- Indice parcial: usuarios sem vinculo (os de hoje) nao disputam vaga.
create unique index if not exists panel_users_um_por_colaborador
  on public.panel_users (collaborator_id)
  where collaborator_id is not null;

-- 2) OS MODULOS: o que este usuario pode acessar.
--    NULL quer dizer "sem restricao: vale so o nivel de acesso", que
--    e exatamente como todos os usuarios funcionam hoje. Por isso
--    ninguem perde nem ganha nada com esta migracao.
--    Uma lista (["comercial","operacao"]) restringe aos modulos dela.
alter table public.panel_users
  add column if not exists modulos jsonb;

-- 3) OS CONVITES DE COLABORADOR.
--    Guardamos o HASH do codigo do link, nunca o codigo. Se esta
--    tabela vazar, ninguem consegue montar um link valido a partir
--    dela — do mesmo jeito que nao se guarda senha, so o hash.
create table if not exists public.panel_invites (
  id              uuid primary key default gen_random_uuid(),
  token_hash      text not null unique,
  role            text not null default 'rh',
  modulos         jsonb,
  anotacao        text,
  created_by      text,
  created_by_id   uuid references public.panel_users (id) on delete set null,
  created_at      timestamptz not null default now(),
  expira_em       timestamptz not null,
  -- Quantos CPFs ja foram tentados com este link. Passou do limite,
  -- o link trava: sem isso, um convite viraria uma maquina de
  -- descobrir quem trabalha na empresa.
  tentativas      integer not null default 0,
  usado_em        timestamptz,
  user_id         uuid references public.panel_users (id) on delete set null,
  collaborator_id uuid references public.collaborators (id) on delete set null,
  cancelado_em    timestamptz
);

create index if not exists panel_invites_abertos_idx
  on public.panel_invites (created_at desc)
  where usado_em is null and cancelado_em is null;

-- Lida e escrita so pela API, com a chave de servico. RLS ligado
-- sem politica = ninguem entra pela chave publica do navegador.
alter table public.panel_invites enable row level security;
