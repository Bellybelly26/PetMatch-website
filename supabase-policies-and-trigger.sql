-- ============================================================================
-- PETMATCH — Políticas de segurança (RLS) + Buckets de Storage + Trigger
-- ============================================================================
-- Este arquivo assume que as tabelas (profiles, pets, favorites,
-- adoption_requests, visits) já existem, no formato de supabase-schema.sql.
-- É seguro rodar mais de uma vez (idempotente).
-- ============================================================================

-- ---------- Políticas de segurança (RLS) ----------
alter table public.profiles enable row level security;
alter table public.pets enable row level security;
alter table public.favorites enable row level security;
alter table public.adoption_requests enable row level security;
alter table public.visits enable row level security;

drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_all" on public.profiles for select using (true);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);

drop policy if exists "pets_select_all" on public.pets;
create policy "pets_select_all" on public.pets for select using (true);

drop policy if exists "pets_insert_own_ong" on public.pets;
create policy "pets_insert_own_ong" on public.pets for insert
  with check (auth.uid() = ong_id and exists (select 1 from public.profiles where id = auth.uid() and user_type = 'ong'));

drop policy if exists "pets_update_own_ong" on public.pets;
create policy "pets_update_own_ong" on public.pets for update using (auth.uid() = ong_id);

drop policy if exists "pets_delete_own_ong" on public.pets;
create policy "pets_delete_own_ong" on public.pets for delete using (auth.uid() = ong_id);

drop policy if exists "favorites_select_own" on public.favorites;
create policy "favorites_select_own" on public.favorites for select using (auth.uid() = adopter_id);

drop policy if exists "favorites_insert_own" on public.favorites;
create policy "favorites_insert_own" on public.favorites for insert with check (auth.uid() = adopter_id);

drop policy if exists "favorites_delete_own" on public.favorites;
create policy "favorites_delete_own" on public.favorites for delete using (auth.uid() = adopter_id);

drop policy if exists "requests_select_involved" on public.adoption_requests;
create policy "requests_select_involved" on public.adoption_requests for select
  using (auth.uid() = adopter_id or auth.uid() in (select ong_id from public.pets where pets.id = adoption_requests.pet_id));

drop policy if exists "requests_insert_own" on public.adoption_requests;
create policy "requests_insert_own" on public.adoption_requests for insert with check (auth.uid() = adopter_id);

drop policy if exists "requests_update_ong_owner" on public.adoption_requests;
create policy "requests_update_ong_owner" on public.adoption_requests for update
  using (auth.uid() in (select ong_id from public.pets where pets.id = adoption_requests.pet_id));

drop policy if exists "visits_select_involved" on public.visits;
create policy "visits_select_involved" on public.visits for select
  using (auth.uid() in (
    select adopter_id from public.adoption_requests where adoption_requests.id = visits.request_id
    union
    select pets.ong_id from public.adoption_requests join public.pets on pets.id = adoption_requests.pet_id
    where adoption_requests.id = visits.request_id
  ));

drop policy if exists "visits_insert_ong_owner" on public.visits;
create policy "visits_insert_ong_owner" on public.visits for insert
  with check (auth.uid() in (
    select pets.ong_id from public.adoption_requests join public.pets on pets.id = adoption_requests.pet_id
    where adoption_requests.id = visits.request_id
  ));

-- ---------- Buckets de storage ----------
insert into storage.buckets (id, name, public) values ('pet-images', 'pet-images', true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('user-uploads', 'user-uploads', true) on conflict (id) do nothing;

drop policy if exists "pet_images_public_read" on storage.objects;
create policy "pet_images_public_read" on storage.objects for select using (bucket_id = 'pet-images');

drop policy if exists "pet_images_ong_write" on storage.objects;
create policy "pet_images_ong_write" on storage.objects for insert with check (bucket_id = 'pet-images' and auth.role() = 'authenticated');

drop policy if exists "user_uploads_public_read" on storage.objects;
create policy "user_uploads_public_read" on storage.objects for select using (bucket_id = 'user-uploads');

drop policy if exists "user_uploads_owner_write" on storage.objects;
create policy "user_uploads_owner_write" on storage.objects for insert with check (bucket_id = 'user-uploads' and auth.role() = 'authenticated');

-- ---------- Trigger: cria o perfil automaticamente no cadastro ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, user_type, phone, address, city)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', ''),
    coalesce(new.raw_user_meta_data->>'user_type', 'adopter'),
    new.raw_user_meta_data->>'phone',
    new.raw_user_meta_data->>'address',
    new.raw_user_meta_data->>'city'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
