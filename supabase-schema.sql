-- ============================================================================
-- PETMATCH — SCHEMA DO BANCO DE DADOS (SUPABASE / POSTGRES)
-- ============================================================================
-- Como usar:
-- 1. Acesse https://supabase.com/dashboard > seu projeto > SQL Editor
-- 2. Cole todo este arquivo e clique em "Run"
-- 3. Vá em Settings > API e copie a "Project URL" e a "anon public key"
--    para as constantes SUPABASE_URL e SUPABASE_ANON_KEY em js/script.js
-- 4. Vá em Storage e confirme que os buckets "pet-images" e "user-uploads"
--    foram criados (o script abaixo já faz isso, mas confira as políticas)
-- ============================================================================

-- Extensão para gerar UUIDs
create extension if not exists "pgcrypto";

-- ============================================================================
-- TABELA: profiles
-- Um perfil é criado para TODO usuário autenticado (adotador ou ONG).
-- id = mesmo id do usuário em auth.users (1 para 1)
-- ============================================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null,
  user_type text not null check (user_type in ('adopter', 'ong')),
  phone text,
  address text,
  city text,
  profile_photo_url text,
  residence_photos text[] default '{}',
  residence_videos text[] default '{}',
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_all"
  on public.profiles for select
  using (true); -- perfis são públicos para leitura (nome da ONG, etc.)

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id);

-- ============================================================================
-- TABELA: pets
-- Cadastrados pelas ONGs (ong_id = profiles.id de um usuário do tipo 'ong')
-- ============================================================================
create table if not exists public.pets (
  id uuid primary key default gen_random_uuid(),
  ong_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  type text not null check (type in ('dog', 'cat', 'rabbit', 'bird')),
  breed text not null,
  age int not null check (age >= 0),
  size text not null check (size in ('small', 'medium', 'large')),
  energy text default 'Moderada',
  city text not null,
  image_url text,
  status text not null default 'available' check (status in ('available', 'adopted')),
  created_at timestamptz default now()
);

alter table public.pets enable row level security;

drop policy if exists "pets_select_all" on public.pets;
create policy "pets_select_all"
  on public.pets for select
  using (true); -- qualquer visitante pode ver os pets

drop policy if exists "pets_insert_own_ong" on public.pets;
create policy "pets_insert_own_ong"
  on public.pets for insert
  with check (
    auth.uid() = ong_id
    and exists (select 1 from public.profiles where id = auth.uid() and user_type = 'ong')
  );

drop policy if exists "pets_update_own_ong" on public.pets;
create policy "pets_update_own_ong"
  on public.pets for update
  using (auth.uid() = ong_id);

drop policy if exists "pets_delete_own_ong" on public.pets;
create policy "pets_delete_own_ong"
  on public.pets for delete
  using (auth.uid() = ong_id);

-- ============================================================================
-- TABELA: favorites
-- ============================================================================
create table if not exists public.favorites (
  adopter_id uuid not null references public.profiles(id) on delete cascade,
  pet_id uuid not null references public.pets(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (adopter_id, pet_id)
);

alter table public.favorites enable row level security;

drop policy if exists "favorites_select_own" on public.favorites;
create policy "favorites_select_own"
  on public.favorites for select
  using (auth.uid() = adopter_id);

drop policy if exists "favorites_insert_own" on public.favorites;
create policy "favorites_insert_own"
  on public.favorites for insert
  with check (auth.uid() = adopter_id);

drop policy if exists "favorites_delete_own" on public.favorites;
create policy "favorites_delete_own"
  on public.favorites for delete
  using (auth.uid() = adopter_id);

-- ============================================================================
-- TABELA: adoption_requests
-- ============================================================================
create table if not exists public.adoption_requests (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  adopter_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz default now()
);

alter table public.adoption_requests enable row level security;

drop policy if exists "requests_select_involved" on public.adoption_requests;
create policy "requests_select_involved"
  on public.adoption_requests for select
  using (
    auth.uid() = adopter_id
    or auth.uid() in (select ong_id from public.pets where pets.id = adoption_requests.pet_id)
  );

drop policy if exists "requests_insert_own" on public.adoption_requests;
create policy "requests_insert_own"
  on public.adoption_requests for insert
  with check (auth.uid() = adopter_id);

drop policy if exists "requests_update_ong_owner" on public.adoption_requests;
create policy "requests_update_ong_owner"
  on public.adoption_requests for update
  using (
    auth.uid() in (select ong_id from public.pets where pets.id = adoption_requests.pet_id)
  );

-- ============================================================================
-- TABELA: visits (visitas pré-adoção agendadas pela ONG)
-- ============================================================================
create table if not exists public.visits (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.adoption_requests(id) on delete cascade,
  scheduled_date timestamptz not null,
  notes text,
  created_at timestamptz default now()
);

alter table public.visits enable row level security;

drop policy if exists "visits_select_involved" on public.visits;
create policy "visits_select_involved"
  on public.visits for select
  using (
    auth.uid() in (
      select adopter_id from public.adoption_requests where adoption_requests.id = visits.request_id
      union
      select pets.ong_id from public.adoption_requests
      join public.pets on pets.id = adoption_requests.pet_id
      where adoption_requests.id = visits.request_id
    )
  );

drop policy if exists "visits_insert_ong_owner" on public.visits;
create policy "visits_insert_ong_owner"
  on public.visits for insert
  with check (
    auth.uid() in (
      select pets.ong_id from public.adoption_requests
      join public.pets on pets.id = adoption_requests.pet_id
      where adoption_requests.id = visits.request_id
    )
  );

-- ============================================================================
-- STORAGE: buckets para imagens/vídeos
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('pet-images', 'pet-images', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('user-uploads', 'user-uploads', true)
on conflict (id) do nothing;

drop policy if exists "pet_images_public_read" on storage.objects;
create policy "pet_images_public_read"
  on storage.objects for select
  using (bucket_id = 'pet-images');

drop policy if exists "pet_images_ong_write" on storage.objects;
create policy "pet_images_ong_write"
  on storage.objects for insert
  with check (bucket_id = 'pet-images' and auth.role() = 'authenticated');

drop policy if exists "user_uploads_public_read" on storage.objects;
create policy "user_uploads_public_read"
  on storage.objects for select
  using (bucket_id = 'user-uploads');

drop policy if exists "user_uploads_owner_write" on storage.objects;
create policy "user_uploads_owner_write"
  on storage.objects for insert
  with check (bucket_id = 'user-uploads' and auth.role() = 'authenticated');
