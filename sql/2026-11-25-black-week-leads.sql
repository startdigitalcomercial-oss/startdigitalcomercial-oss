-- ============================================================
-- BLACK WEEK START 2026 — LEADS DA LANDING PAGE
--
-- A pagina publica /black-week tem um formulario (nome, WhatsApp e
-- e-mail). Cada envio vira uma linha aqui, e o painel le esta
-- tabela na aba Comercial > BLACK FRIDAY.
--
-- ADITIVA: cria UMA tabela nova e nao encosta em nenhuma que ja
-- existe. Pode rodar duas vezes.
--
-- Seguranca igual ao resto do sistema: RLS ligado e SEM policies.
-- A chave publica do Supabase nao le nem escreve nada aqui; so as
-- funcoes do servidor (api/blackweek.js), com a chave secreta.
-- ============================================================

create table if not exists public.bw_leads (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  nome           text not null,
  whatsapp       text not null,          -- so numeros, com DDI (5513...)
  email          text not null,
  consentimento  boolean not null default false,
  origem         jsonb not null default '{}'::jsonb,   -- utm_*, referrer, botao clicado
  status         text not null default 'novo',         -- novo | em_contato | fechado | descartado
  wa_status      text,                   -- enviado | erro | pendente_manual | desligado
  wa_erro        text,
  wa_enviado_em  timestamptz
);

comment on table public.bw_leads is
  'Leads da landing page Black Week Start 2026 (/black-week). Uma linha por envio do formulario.';

create index if not exists bw_leads_created_at_idx on public.bw_leads (created_at desc);
create index if not exists bw_leads_whatsapp_idx on public.bw_leads (whatsapp);

alter table public.bw_leads enable row level security;
