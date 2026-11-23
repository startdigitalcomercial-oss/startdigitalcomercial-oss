-- ============================================================
-- LINK DE CADASTRO PARA VARIOS COLABORADORES
--
-- O convite nasceu de uso unico: uma pessoa usava e o link morria.
-- Na pratica o Dono quer mandar UM link no grupo e o time inteiro
-- se cadastrar por ele. Esta migracao acompanha essa mudanca.
--
-- ADITIVA: duas colunas novas e um acerto de dados nos convites que
-- ja existiam. Nenhuma linha e apagada. Pode rodar duas vezes.
-- ============================================================

-- Quantas pessoas ja se cadastraram por este link.
alter table public.panel_invites
  add column if not exists usos integer not null default 0;

-- Quando comecou a janela atual de buscas sem resultado. E o relogio
-- do freio: dez CPFs que nao dao em nada em quinze minutos e o link
-- descansa ate a janela passar. (A coluna "tentativas", que ja
-- existia, passa a contar so as falhas DENTRO dessa janela.)
alter table public.panel_invites
  add column if not exists falhas_desde timestamptz;

-- "usado_em" deixa de encerrar o link: vira a data do ultimo cadastro.
comment on column public.panel_invites.usado_em is
  'Data do ULTIMO cadastro feito por este link. Nao encerra o link (ele serve para varios colaboradores).';

-- ACERTO DOS CONVITES QUE JA EXISTIAM
-- 1) quem ja tinha sido usado uma vez passa a contar 1 cadastro;
update public.panel_invites set usos = 1 where usado_em is not null and usos = 0;
-- 2) a contagem antiga de tentativas e zerada, senao um link que ja
--    tinha gasto tentativas no modelo antigo nasceria perto do freio;
update public.panel_invites set tentativas = 0, falhas_desde = null where falhas_desde is null and tentativas <> 0;
-- 3) os links que ainda nao venceram nem foram cancelados ganham o
--    prazo novo, de 30 dias a partir da criacao (nunca encurta).
update public.panel_invites
   set expira_em = greatest(expira_em, created_at + interval '30 days')
 where cancelado_em is null and expira_em > now();
