-- ============================================================================
-- PETMATCH — Barra de progresso, perfil de saúde/comportamento e notificações
-- ============================================================================

-- ---------- 1. Perfil completo do pet: saúde e comportamento ----------
alter table public.pets add column if not exists vaccinated boolean default false;
alter table public.pets add column if not exists neutered boolean default false;
alter table public.pets add column if not exists dewormed boolean default false;
alter table public.pets add column if not exists health_notes text;
alter table public.pets add column if not exists temperament text;

-- ---------- 2. Etapas extras para a barra de progresso da adoção ----------
-- status passa a aceitar: pending -> approved -> visit_scheduled -> completed
-- (ou "rejected" a qualquer momento antes de completed)
alter table public.adoption_requests drop constraint if exists adoption_requests_status_check;
alter table public.adoption_requests add constraint adoption_requests_status_check
  check (status in ('pending', 'approved', 'rejected', 'visit_scheduled', 'completed'));

-- ---------- 3. Tabela: notifications ----------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  adopter_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid references public.adoption_requests(id) on delete cascade,
  message text not null,
  is_read boolean not null default false,
  created_at timestamptz default now()
);

alter table public.notifications enable row level security;

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own"
  on public.notifications for select
  using (auth.uid() = adopter_id);

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own"
  on public.notifications for update
  using (auth.uid() = adopter_id);

-- Só a ONG dona do pet relacionado à solicitação pode criar a notificação
-- (é ela quem aprova, rejeita, agenda visita ou conclui a adoção).
drop policy if exists "notifications_insert_ong_owner" on public.notifications;
create policy "notifications_insert_ong_owner"
  on public.notifications for insert
  with check (
    auth.uid() in (
      select pets.ong_id from public.adoption_requests
      join public.pets on pets.id = adoption_requests.pet_id
      where adoption_requests.id = notifications.request_id
    )
  );
