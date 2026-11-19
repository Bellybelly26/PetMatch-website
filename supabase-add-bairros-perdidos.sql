-- ============================================================================
-- PetMatch: BAIRRO nos pets + ANIMAIS PERDIDOS/ENCONTRADOS com mapa
-- Rode no SQL Editor do Supabase (depois dos scripts 1 a 10). Pode rodar mais de uma vez.
-- ============================================================================

-- ---------- 1. Bairro e coordenadas nos pets ----------
alter table public.pets add column if not exists neighborhood text;
alter table public.pets add column if not exists lat double precision;
alter table public.pets add column if not exists lng double precision;
alter table public.pets add column if not exists state text check (state is null or state ~ '^[A-Z]{2}$');

-- ---------- 2. Tabela de animais perdidos/encontrados ----------
create table if not exists public.lost_animals (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('lost', 'found')),
  pet_name text,
  type text not null default 'dog' check (type in ('dog', 'cat', 'bird', 'rabbit', 'other')),
  description text not null check (char_length(description) between 5 and 600),
  photo_url text,
  city text not null,
  neighborhood text,
  state text check (state is null or state ~ '^[A-Z]{2}$'),
  cep text check (cep is null or cep ~ '^[0-9]{8}$'),
  lat double precision check (lat is null or lat between -90 and 90),
  lng double precision check (lng is null or lng between -180 and 180),
  seen_on date not null default current_date,
  contact text not null check (char_length(contact) between 8 and 60),
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now()
);

alter table public.lost_animals add column if not exists state text check (state is null or state ~ '^[A-Z]{2}$');

create index if not exists lost_animals_status_idx on public.lost_animals (status, created_at desc);

alter table public.lost_animals enable row level security;

drop policy if exists lost_select on public.lost_animals;
create policy lost_select on public.lost_animals for select using (true);

drop policy if exists lost_insert on public.lost_animals;
create policy lost_insert on public.lost_animals for insert to authenticated
  with check (reporter_id = auth.uid());

drop policy if exists lost_update on public.lost_animals;
create policy lost_update on public.lost_animals for update to authenticated
  using (reporter_id = auth.uid() or public.is_staff())
  with check (reporter_id = auth.uid() or public.is_staff());

drop policy if exists lost_delete on public.lost_animals;
create policy lost_delete on public.lost_animals for delete to authenticated
  using (reporter_id = auth.uid() or public.is_staff());

-- O contato (telefone/WhatsApp) só aparece para quem está logado (LGPD):
-- quem não está logado lê todas as colunas, menos "contact".
revoke all on public.lost_animals from anon;
grant select (id, reporter_id, kind, pet_name, type, description, photo_url, city, neighborhood,
              cep, lat, lng, seen_on, status, created_at, state) on public.lost_animals to anon;
grant select, insert, update, delete on public.lost_animals to authenticated;

-- ---------- 2b. Estado (UF) dos registros que já existiam: o PetMatch começou no Paraná ----------
update public.pets set state = 'PR' where state is null;
update public.lost_animals set state = 'PR' where state is null;

-- ---------- 3. Trava: no máximo 10 avisos abertos por pessoa ----------
create or replace function public.trg_lost_guard()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.reporter_id := coalesce(auth.uid(), new.reporter_id);
    new.status := 'open';
    if (select count(*) from public.lost_animals
        where reporter_id = new.reporter_id and status = 'open') >= 10 then
      raise exception 'Você já tem 10 avisos abertos. Marque algum como resolvido para criar outro.';
    end if;
  else
    -- quem não é staff só pode mudar o status e o texto, nunca o dono
    new.reporter_id := old.reporter_id;
  end if;
  return new;
end $$;

drop trigger if exists lost_guard on public.lost_animals;
create trigger lost_guard before insert or update on public.lost_animals
  for each row execute function public.trg_lost_guard();

-- ---------- 4. Log de sistema ----------
create or replace function public.trg_lost_log()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_event('aviso_animal_' || new.kind, coalesce(new.pet_name, new.type) || ' - ' || new.city);
  elsif tg_op = 'UPDATE' and old.status is distinct from new.status then
    perform public.log_event('aviso_animal_' || new.status, coalesce(new.pet_name, new.type) || ' - ' || new.city);
  elsif tg_op = 'DELETE' then
    perform public.log_event('aviso_animal_removido', coalesce(old.pet_name, old.type) || ' - ' || old.city);
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists lost_log on public.lost_animals;
create trigger lost_log after insert or update or delete on public.lost_animals
  for each row execute function public.trg_lost_log();
