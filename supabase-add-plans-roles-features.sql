-- =====================================================================
-- PetMatch: planos, perfis Prefeitura e Empresa e os recursos de cada plano
-- Rode DEPOIS de supabase-add-partners-ads-shop.sql. Pode rodar mais de uma vez.
--
-- Perfis:   adopter (Adotador) | ong | prefeitura | empresa | supervisor | admin
-- Planos:   free | plus (Adotador Plus) | essencial e premium (ONG)
--           parceira (Empresa) | institucional (Prefeitura, liberado pelo Administrador)
-- Pagamento: simulado. "Assinar" ativa o plano por 1 ano, sem cobrança.
-- =====================================================================

-- ---------- 1. PERFIS E PLANOS ----------
alter table public.profiles drop constraint if exists profiles_user_type_check;
alter table public.profiles add constraint profiles_user_type_check
  check (user_type in ('adopter', 'ong', 'supervisor', 'admin', 'prefeitura', 'empresa'));

alter table public.profiles add column if not exists plan text not null default 'free';
alter table public.profiles drop constraint if exists profiles_plan_check;
alter table public.profiles add constraint profiles_plan_check
  check (plan in ('free', 'plus', 'essencial', 'premium', 'parceira', 'institucional'));
alter table public.profiles add column if not exists plan_expires_at timestamptz;
alter table public.profiles add column if not exists pix_key text check (pix_key is null or char_length(pix_key) <= 140);
alter table public.profiles add column if not exists pix_name text check (pix_name is null or char_length(pix_name) <= 80);
alter table public.profiles add column if not exists match_prefs jsonb not null default '{}'::jsonb;

-- Plano válido de verdade (plano vencido volta a valer como grátis)
create or replace function public.effective_plan(p_user uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select case
      when plan = 'free' then 'free'
      when plan_expires_at is not null and plan_expires_at < now() then 'free'
      else plan end
    from public.profiles where id = p_user
  ), 'free');
$$;

create or replace function public.plan_price(p_plan text)
returns numeric
language sql immutable
as $$
  select case p_plan
    when 'plus' then 49.90
    when 'essencial' then 119.90
    when 'premium' then 199.90
    when 'parceira' then 499.00
    else 0 end;
$$;

create or replace function public.plan_allowed(p_role text, p_plan text)
returns boolean
language sql immutable
as $$
  select p_plan = 'free' or
    (p_role = 'adopter' and p_plan = 'plus') or
    (p_role = 'ong' and p_plan in ('essencial', 'premium')) or
    (p_role = 'empresa' and p_plan = 'parceira') or
    (p_role = 'prefeitura' and p_plan = 'institucional');
$$;

-- Cadastro público: adotador, ONG, prefeitura ou empresa (supervisor e admin nunca)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_type text := coalesce(new.raw_user_meta_data->>'user_type', 'adopter');
begin
  if v_type not in ('adopter', 'ong', 'prefeitura', 'empresa') then
    v_type := 'adopter';
  end if;

  insert into public.profiles (id, email, name, user_type, phone, address, city)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    v_type,
    new.raw_user_meta_data->>'phone',
    new.raw_user_meta_data->>'address',
    new.raw_user_meta_data->>'city'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Supervisor também verifica/bloqueia prefeituras e empresas
drop policy if exists "profiles_supervisor_update_users" on public.profiles;
create policy "profiles_supervisor_update_users"
  on public.profiles for update
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.user_type = 'supervisor')
    and user_type in ('adopter', 'ong', 'prefeitura', 'empresa')
  );

-- Trava: quem pode mudar o quê (agora inclui o plano)
create or replace function public.protect_profile_privileged_columns()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_role text;
begin
  if auth.uid() is null then
    return new;
  end if;

  select user_type into v_role from public.profiles where id = auth.uid();

  if v_role = 'admin' then
    return new;
  end if;

  if new.user_type is distinct from old.user_type then
    raise exception 'Apenas o Administrador pode alterar o tipo de conta.';
  end if;

  -- O plano só muda pelas funções subscribe_plan e cancel_plan
  if coalesce(current_setting('app.plan_change', true), '') <> '1' then
    new.plan := old.plan;
    new.plan_expires_at := old.plan_expires_at;
  end if;

  if v_role = 'supervisor' and old.id <> auth.uid() then
    new.name := old.name;
    new.email := old.email;
    new.phone := old.phone;
    new.address := old.address;
    new.city := old.city;
    new.cep := old.cep;
    new.pix_key := old.pix_key;
    new.pix_name := old.pix_name;
    new.match_prefs := old.match_prefs;
    return new;
  end if;

  new.is_verified := old.is_verified;
  new.is_blocked := old.is_blocked;
  return new;
end;
$$;

drop trigger if exists protect_profile_privileged_columns on public.profiles;
create trigger protect_profile_privileged_columns
  before update on public.profiles
  for each row execute function public.protect_profile_privileged_columns();

-- ---------- 2. ASSINATURAS (simuladas) ----------
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  user_name text,
  plan text not null,
  price numeric(10, 2) not null default 0,
  source text not null default 'self' check (source in ('self', 'admin')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  cancelled_at timestamptz
);
alter table public.subscriptions enable row level security;
drop policy if exists "subscriptions_select" on public.subscriptions;
create policy "subscriptions_select" on public.subscriptions for select
  using (user_id = auth.uid() or public.is_admin());
grant select on public.subscriptions to authenticated;

create or replace function public.subscribe_plan(p_plan text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_role text;
  v_name text;
begin
  if auth.uid() is null then raise exception 'Entre na sua conta para assinar.'; end if;
  select user_type, name into v_role, v_name from public.profiles where id = auth.uid();
  if p_plan = 'institucional' or p_plan = 'free' or not public.plan_allowed(v_role, p_plan) then
    raise exception 'Este plano não está disponível para o seu tipo de conta.';
  end if;

  update public.subscriptions set cancelled_at = now()
    where user_id = auth.uid() and cancelled_at is null;

  perform set_config('app.plan_change', '1', true);
  update public.profiles set plan = p_plan, plan_expires_at = now() + interval '1 year' where id = auth.uid();
  perform set_config('app.plan_change', '', true);

  insert into public.subscriptions (user_id, user_name, plan, price, source, ends_at)
  values (auth.uid(), v_name, p_plan, public.plan_price(p_plan), 'self', now() + interval '1 year');
  perform public.log_event('plano_assinado', p_plan);
end;
$$;

create or replace function public.cancel_plan()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Entre na sua conta.'; end if;
  update public.subscriptions set cancelled_at = now() where user_id = auth.uid() and cancelled_at is null;
  perform set_config('app.plan_change', '1', true);
  update public.profiles set plan = 'free', plan_expires_at = null where id = auth.uid();
  perform set_config('app.plan_change', '', true);
  perform public.log_event('plano_cancelado');
end;
$$;

-- Administrador define o plano de qualquer conta (ex.: institucional da prefeitura)
create or replace function public.admin_set_plan(p_user uuid, p_plan text, p_price numeric default null)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_role text;
  v_name text;
begin
  if not public.is_admin() then raise exception 'Apenas o Administrador pode fazer isso.'; end if;
  select user_type, name into v_role, v_name from public.profiles where id = p_user;
  if v_role is null then raise exception 'Conta não encontrada.'; end if;
  if not public.plan_allowed(v_role, p_plan) then
    raise exception 'Esse plano não existe para o tipo de conta (%).', v_role;
  end if;

  update public.subscriptions set cancelled_at = now() where user_id = p_user and cancelled_at is null;
  if p_plan = 'free' then
    update public.profiles set plan = 'free', plan_expires_at = null where id = p_user;
  else
    update public.profiles set plan = p_plan, plan_expires_at = now() + interval '1 year' where id = p_user;
    insert into public.subscriptions (user_id, user_name, plan, price, source, ends_at)
    values (p_user, v_name, p_plan, coalesce(p_price, public.plan_price(p_plan)), 'admin', now() + interval '1 year');
  end if;
  perform public.log_event('plano_alterado_admin', v_name || ': ' || p_plan, p_user);
end;
$$;

revoke all on function public.subscribe_plan(text), public.cancel_plan(), public.admin_set_plan(uuid, text, numeric) from public, anon;
grant execute on function public.subscribe_plan(text), public.cancel_plan(), public.admin_set_plan(uuid, text, numeric) to authenticated;

-- ---------- 3. EQUIPE DA ONG (mais de um administrador) ----------
create table if not exists public.ong_members (
  id uuid primary key default gen_random_uuid(),
  ong_id uuid not null references public.profiles(id) on delete cascade,
  member_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (ong_id, member_id),
  check (ong_id <> member_id)
);
alter table public.ong_members enable row level security;
drop policy if exists "ong_members_select" on public.ong_members;
create policy "ong_members_select" on public.ong_members for select
  using (ong_id = auth.uid() or member_id = auth.uid() or public.is_staff());
drop policy if exists "ong_members_delete" on public.ong_members;
create policy "ong_members_delete" on public.ong_members for delete
  using (ong_id = auth.uid() or member_id = auth.uid());
grant select, delete on public.ong_members to authenticated;

create or replace function public.can_manage_ong(p_ong uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select p_ong is not null and auth.uid() is not null and (
    p_ong = auth.uid()
    or exists (select 1 from public.ong_members m where m.ong_id = p_ong and m.member_id = auth.uid())
  );
$$;

create or replace function public.request_ong_id(p_request uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select p.ong_id from public.adoption_requests r join public.pets p on p.id = r.pet_id where r.id = p_request;
$$;

create or replace function public.add_ong_member(p_email text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_member uuid;
  v_name text;
begin
  if public.current_role_type() <> 'ong' then raise exception 'Apenas contas de ONG podem ter equipe.'; end if;
  if public.effective_plan(auth.uid()) <> 'premium' then raise exception 'Equipe com mais de um administrador é do plano ONG Premium.'; end if;
  if (select count(*) from public.ong_members where ong_id = auth.uid()) >= 5 then
    raise exception 'O limite é de 5 administradores extras.';
  end if;
  select id, name into v_member, v_name from public.profiles
    where lower(email) = lower(trim(p_email)) and user_type = 'ong' and id <> auth.uid();
  if v_member is null then
    raise exception 'Não encontramos uma conta de ONG com esse e-mail. Peça para a pessoa criar a conta de ONG primeiro.';
  end if;
  insert into public.ong_members (ong_id, member_id) values (auth.uid(), v_member) on conflict do nothing;
  perform public.log_event('membro_adicionado', v_name, v_member);
end;
$$;
revoke all on function public.add_ong_member(text) from public, anon;
grant execute on function public.add_ong_member(text) to authenticated;

-- Regras de acesso das ONGs agora valem também para a equipe
drop policy if exists "pets_insert_own_ong" on public.pets;
create policy "pets_insert_own_ong" on public.pets for insert
  with check (
    public.can_manage_ong(ong_id)
    and exists (select 1 from public.profiles where id = ong_id and user_type = 'ong')
  );
drop policy if exists "pets_update_own_ong" on public.pets;
create policy "pets_update_own_ong" on public.pets for update using (public.can_manage_ong(ong_id));
drop policy if exists "pets_delete_own_ong" on public.pets;
create policy "pets_delete_own_ong" on public.pets for delete using (public.can_manage_ong(ong_id));

drop policy if exists "requests_select_involved" on public.adoption_requests;
create policy "requests_select_involved" on public.adoption_requests for select
  using (auth.uid() = adopter_id or public.can_manage_ong(public.request_ong_id(id)));
drop policy if exists "requests_update_ong_owner" on public.adoption_requests;
create policy "requests_update_ong_owner" on public.adoption_requests for update
  using (public.can_manage_ong(public.request_ong_id(id)));

drop policy if exists "visits_select_involved" on public.visits;
create policy "visits_select_involved" on public.visits for select
  using (
    exists (select 1 from public.adoption_requests r where r.id = visits.request_id and r.adopter_id = auth.uid())
    or public.can_manage_ong(public.request_ong_id(request_id))
  );
drop policy if exists "visits_insert_ong_owner" on public.visits;
create policy "visits_insert_ong_owner" on public.visits for insert
  with check (public.can_manage_ong(public.request_ong_id(request_id)));

-- Visitas e entrevistas: tipo, situação e local
alter table public.visits add column if not exists kind text not null default 'visit';
alter table public.visits drop constraint if exists visits_kind_check;
alter table public.visits add constraint visits_kind_check check (kind in ('visit', 'interview'));
alter table public.visits add column if not exists status text not null default 'scheduled';
alter table public.visits drop constraint if exists visits_status_check;
alter table public.visits add constraint visits_status_check check (status in ('scheduled', 'done', 'cancelled'));
alter table public.visits add column if not exists location text;
drop policy if exists "visits_update_ong_owner" on public.visits;
create policy "visits_update_ong_owner" on public.visits for update
  using (public.can_manage_ong(public.request_ong_id(request_id)));
drop policy if exists "visits_delete_ong_owner" on public.visits;
create policy "visits_delete_ong_owner" on public.visits for delete
  using (public.can_manage_ong(public.request_ong_id(request_id)));
grant update, delete on public.visits to authenticated;

-- Notificações: ONG (e equipe) avisa o adotador; o adotador cria os próprios lembretes
drop policy if exists "notifications_insert_ong_owner" on public.notifications;
create policy "notifications_insert_ong_owner" on public.notifications for insert
  with check (public.can_manage_ong(public.request_ong_id(request_id)));
drop policy if exists "notifications_insert_self_reminder" on public.notifications;
create policy "notifications_insert_self_reminder" on public.notifications for insert
  with check (auth.uid() = adopter_id and message like 'Lembrete:%');

drop policy if exists "request_history_select_involved" on public.request_history;
create policy "request_history_select_involved" on public.request_history for select
  using (
    public.is_staff()
    or exists (
      select 1 from public.adoption_requests r
      where r.id = request_history.request_id
        and (r.adopter_id = auth.uid() or public.can_manage_ong(public.request_ong_id(r.id)))
    )
  );

-- ---------- 4. LIMITE DE PETS POR PLANO DA ONG ----------
create or replace function public.trg_pets_limit()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_plan text;
  v_limit int;
begin
  if auth.uid() is null then return new; end if;
  v_plan := public.effective_plan(new.ong_id);
  v_limit := case v_plan when 'premium' then 100 when 'essencial' then 30 else 10 end;
  if (select count(*) from public.pets where ong_id = new.ong_id) >= v_limit then
    raise exception 'Limite de % pets do plano atingido. Assine um plano maior para cadastrar mais.', v_limit;
  end if;
  return new;
end;
$$;
drop trigger if exists pets_limit_trigger on public.pets;
create trigger pets_limit_trigger before insert on public.pets
  for each row execute function public.trg_pets_limit();

-- ---------- 5. ADOTADOR PLUS: saúde, diário, lembretes ----------
create table if not exists public.pet_care_records (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.adoption_requests(id) on delete cascade,
  adopter_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('consulta', 'vacina', 'vermifugo', 'outro')),
  title text not null check (char_length(title) <= 120),
  record_date date not null default current_date,
  next_due date,
  notes text check (notes is null or char_length(notes) <= 1000),
  created_at timestamptz not null default now()
);
create index if not exists pet_care_records_request_idx on public.pet_care_records (request_id, record_date);

create table if not exists public.pet_diary (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.adoption_requests(id) on delete cascade,
  adopter_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null default 'note' check (kind in ('note', 'behavior', 'routine')),
  note text not null check (char_length(note) <= 1500),
  photo_url text,
  created_at timestamptz not null default now()
);
create index if not exists pet_diary_request_idx on public.pet_diary (request_id, created_at);

alter table public.pet_care_records enable row level security;
alter table public.pet_diary enable row level security;

do $$
declare t text;
begin
  foreach t in array array['pet_care_records', 'pet_diary'] loop
    execute format('drop policy if exists "%1$s_select" on public.%1$s', t);
    execute format('create policy "%1$s_select" on public.%1$s for select using (adopter_id = auth.uid())', t);
    -- criar exige plano Plus e uma adoção concluída do próprio adotador
    execute format('drop policy if exists "%1$s_insert" on public.%1$s', t);
    execute format($p$create policy "%1$s_insert" on public.%1$s for insert with check (
        adopter_id = auth.uid()
        and public.effective_plan(auth.uid()) = 'plus'
        and exists (select 1 from public.adoption_requests r
                    where r.id = request_id and r.adopter_id = auth.uid() and r.status = 'completed'))$p$, t);
    execute format('drop policy if exists "%1$s_update" on public.%1$s', t);
    execute format('create policy "%1$s_update" on public.%1$s for update using (adopter_id = auth.uid() and public.effective_plan(auth.uid()) = ''plus'')', t);
    execute format('drop policy if exists "%1$s_delete" on public.%1$s', t);
    execute format('create policy "%1$s_delete" on public.%1$s for delete using (adopter_id = auth.uid())', t);
  end loop;
end $$;
grant select, insert, update, delete on public.pet_care_records, public.pet_diary to authenticated;

-- ---------- 6. MENSAGENS ENTRE ONG E ADOTADOR (ONG Essencial ou Premium) ----------
create table if not exists public.request_messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.adoption_requests(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists request_messages_idx on public.request_messages (request_id, created_at);
-- Verifica (sem passar pelas regras de linha) se a outra parte já escreveu na conversa
create or replace function public.request_has_message_from_other(p_request uuid, p_me uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.request_messages where request_id = p_request and sender_id <> p_me);
$$;

alter table public.request_messages enable row level security;

drop policy if exists "request_messages_select" on public.request_messages;
create policy "request_messages_select" on public.request_messages for select
  using (
    public.is_staff()
    or exists (select 1 from public.adoption_requests r where r.id = request_id and r.adopter_id = auth.uid())
    or public.can_manage_ong(public.request_ong_id(request_id))
  );

drop policy if exists "request_messages_insert" on public.request_messages;
create policy "request_messages_insert" on public.request_messages for insert
  with check (
    sender_id = auth.uid()
    and (
      -- ONG (ou equipe) com plano Essencial/Premium
      (public.can_manage_ong(public.request_ong_id(request_id))
        and public.effective_plan(public.request_ong_id(request_id)) in ('essencial', 'premium'))
      -- adotador responde depois que a ONG escreveu
      or (exists (select 1 from public.adoption_requests r where r.id = request_id and r.adopter_id = auth.uid())
          and public.request_has_message_from_other(request_id, auth.uid()))
    )
  );
grant select, insert on public.request_messages to authenticated;

-- ---------- 7. ACOMPANHAMENTO DOS ADOTANTES (ONG Premium) ----------
create table if not exists public.request_notes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.adoption_requests(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  note text not null check (char_length(note) between 1 and 1000),
  created_at timestamptz not null default now()
);
alter table public.request_notes enable row level security;
drop policy if exists "request_notes_select" on public.request_notes;
create policy "request_notes_select" on public.request_notes for select
  using (public.can_manage_ong(public.request_ong_id(request_id)));
drop policy if exists "request_notes_insert" on public.request_notes;
create policy "request_notes_insert" on public.request_notes for insert
  with check (
    author_id = auth.uid()
    and public.can_manage_ong(public.request_ong_id(request_id))
    and public.effective_plan(public.request_ong_id(request_id)) = 'premium'
  );
drop policy if exists "request_notes_delete" on public.request_notes;
create policy "request_notes_delete" on public.request_notes for delete
  using (public.can_manage_ong(public.request_ong_id(request_id)));
grant select, insert, delete on public.request_notes to authenticated;

-- ---------- 8. EVENTOS DE ADOÇÃO (ONG Premium) ----------
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  ong_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) <= 120),
  description text check (description is null or char_length(description) <= 1000),
  event_date timestamptz not null,
  location text,
  city text,
  created_at timestamptz not null default now()
);
alter table public.events enable row level security;
drop policy if exists "events_select" on public.events;
create policy "events_select" on public.events for select using (true);
drop policy if exists "events_insert" on public.events;
create policy "events_insert" on public.events for insert
  with check (
    public.can_manage_ong(ong_id)
    and public.effective_plan(ong_id) = 'premium'
    and exists (select 1 from public.profiles where id = ong_id and user_type = 'ong')
  );
drop policy if exists "events_update" on public.events;
create policy "events_update" on public.events for update using (public.can_manage_ong(ong_id));
drop policy if exists "events_delete" on public.events;
create policy "events_delete" on public.events for delete using (public.can_manage_ong(ong_id) or public.is_staff());
grant select on public.events to anon, authenticated;
grant insert, update, delete on public.events to authenticated;

-- ---------- 9. SUPORTE PRIORITÁRIO ----------
alter table public.complaints add column if not exists priority boolean not null default false;
create or replace function public.trg_complaints_priority()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.author_id is not null and public.effective_plan(new.author_id) <> 'free' then
    new.priority := true;
  else
    new.priority := false;
  end if;
  return new;
end;
$$;
drop trigger if exists complaints_priority_trigger on public.complaints;
create trigger complaints_priority_trigger before insert on public.complaints
  for each row execute function public.trg_complaints_priority();

-- ---------- 10. PARCEIROS, ANÚNCIOS E PRODUTOS DE PREFEITURAS E EMPRESAS ----------
alter table public.partners add column if not exists owner_id uuid references public.profiles(id) on delete set null;
alter table public.partners add column if not exists status text not null default 'approved';
alter table public.partners add column if not exists plus_discount int check (plus_discount is null or plus_discount between 0 and 100);
alter table public.partners add column if not exists views int not null default 0;
alter table public.ads add column if not exists owner_id uuid references public.profiles(id) on delete set null;
alter table public.ads add column if not exists status text not null default 'approved';
alter table public.ads add column if not exists views int not null default 0;
alter table public.ads add column if not exists clicks int not null default 0;
alter table public.products add column if not exists owner_id uuid references public.profiles(id) on delete set null;
alter table public.products add column if not exists status text not null default 'approved';

do $$
declare t text;
begin
  foreach t in array array['partners', 'ads', 'products'] loop
    execute format('alter table public.%1$s drop constraint if exists %1$s_status_check', t);
    execute format('alter table public.%1$s add constraint %1$s_status_check check (status in (''pending'', ''approved'', ''rejected''))', t);

    execute format('drop policy if exists "%1$s_select" on public.%1$s', t);
    execute format('create policy "%1$s_select" on public.%1$s for select using ((active and status = ''approved'') or public.is_staff() or owner_id = auth.uid())', t);
    execute format('drop policy if exists "%1$s_staff_insert" on public.%1$s', t);
    execute format('drop policy if exists "%1$s_staff_update" on public.%1$s', t);
    execute format('drop policy if exists "%1$s_staff_delete" on public.%1$s', t);
    execute format('drop policy if exists "%1$s_write_insert" on public.%1$s', t);
    execute format('create policy "%1$s_write_insert" on public.%1$s for insert with check (public.is_staff() or owner_id = auth.uid())', t);
    execute format('drop policy if exists "%1$s_write_update" on public.%1$s', t);
    execute format('create policy "%1$s_write_update" on public.%1$s for update using (public.is_staff() or owner_id = auth.uid()) with check (public.is_staff() or owner_id = auth.uid())', t);
    execute format('drop policy if exists "%1$s_write_delete" on public.%1$s', t);
    execute format('create policy "%1$s_write_delete" on public.%1$s for delete using (public.is_staff() or owner_id = auth.uid())', t);
  end loop;
end $$;

-- Regras do que cada perfil pode publicar (a equipe do site não tem limites)
create or replace function public.trg_content_guard()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_role text;
  v_plan text;
  v_limit int;
  v_count int;
  v_skip text[] := array['active', 'views', 'clicks', 'status', 'is_featured', 'owner_id'];
begin
  if auth.uid() is null or public.is_staff() or coalesce(current_setting('app.counter', true), '') = '1' then
    return new;
  end if;
  v_role := public.current_role_type();
  v_plan := public.effective_plan(auth.uid());

  if tg_op = 'INSERT' then
    new.owner_id := auth.uid();
    new.status := 'pending';

    if tg_table_name = 'partners' then
      if v_role <> 'empresa' then raise exception 'Só contas de empresa cadastram parceiros.'; end if;
      v_limit := case when v_plan = 'parceira' then 5 else 1 end;
      select count(*) into v_count from public.partners where owner_id = auth.uid();
      new.is_featured := (v_plan = 'parceira');
      new.views := 0;
    elsif tg_table_name = 'ads' then
      if v_role = 'prefeitura' then
        new.kind := 'prefeitura';
        v_limit := case when v_plan = 'institucional' then 50 else 2 end;
      elsif v_role = 'empresa' and v_plan = 'parceira' then
        new.kind := 'empresa';
        v_limit := 10;
      else
        raise exception 'Anúncios são para prefeituras e para empresas com o plano Empresa Parceira.';
      end if;
      select count(*) into v_count from public.ads where owner_id = auth.uid();
      new.views := 0;
      new.clicks := 0;
    else
      if v_role <> 'empresa' then raise exception 'Só contas de empresa cadastram produtos.'; end if;
      v_limit := case when v_plan = 'parceira' then 30 else 3 end;
      select count(*) into v_count from public.products where owner_id = auth.uid();
    end if;

    if v_count >= v_limit then
      raise exception 'Limite de % itens do seu plano atingido.', v_limit;
    end if;
    return new;
  end if;

  -- UPDATE por quem não é da equipe
  if old.owner_id is distinct from auth.uid() then
    raise exception 'Você só pode editar o que você mesmo cadastrou.';
  end if;
  if (to_jsonb(new) - v_skip) is distinct from (to_jsonb(old) - v_skip) then
    new.status := 'pending';   -- mudou o conteúdo: volta para aprovação
  else
    new.status := old.status;
  end if;
  new.owner_id := old.owner_id;
  new.views := old.views;
  if tg_table_name = 'ads' then new.clicks := old.clicks; end if;
  if tg_table_name = 'partners' then new.is_featured := (v_plan = 'parceira'); end if;
  return new;
end;
$$;

drop trigger if exists partners_guard_trigger on public.partners;
create trigger partners_guard_trigger before insert or update on public.partners
  for each row execute function public.trg_content_guard();
drop trigger if exists ads_guard_trigger on public.ads;
create trigger ads_guard_trigger before insert or update on public.ads
  for each row execute function public.trg_content_guard();
drop trigger if exists products_guard_trigger on public.products;
create trigger products_guard_trigger before insert or update on public.products
  for each row execute function public.trg_content_guard();

-- Registro no log quando a equipe aprova ou rejeita
create or replace function public.trg_content_status_log()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_name text := coalesce(to_jsonb(new)->>'name', to_jsonb(new)->>'title');
begin
  if new.status is distinct from old.status and new.status in ('approved', 'rejected') then
    perform public.log_event(case new.status when 'approved' then 'conteudo_aprovado' else 'conteudo_rejeitado' end, v_name);
  end if;
  return new;
end;
$$;
drop trigger if exists partners_status_log on public.partners;
create trigger partners_status_log after update on public.partners for each row execute function public.trg_content_status_log();
drop trigger if exists ads_status_log on public.ads;
create trigger ads_status_log after update on public.ads for each row execute function public.trg_content_status_log();
drop trigger if exists products_status_log on public.products;
create trigger products_status_log after update on public.products for each row execute function public.trg_content_status_log();

-- Contador de visualizações e cliques (qualquer visitante)
create or replace function public.track_view(p_kind text, p_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  perform set_config('app.counter', '1', true);
  if p_kind = 'ad_view' then
    update public.ads set views = views + 1 where id = p_id and status = 'approved';
  elsif p_kind = 'ad_click' then
    update public.ads set clicks = clicks + 1 where id = p_id and status = 'approved';
  elsif p_kind = 'partner_view' then
    update public.partners set views = views + 1 where id = p_id and status = 'approved';
  end if;
  perform set_config('app.counter', '', true);
end;
$$;
revoke all on function public.track_view(text, uuid) from public;
grant execute on function public.track_view(text, uuid) to anon, authenticated;

-- ---------- 11. INDICADORES (Prefeitura com plano institucional e equipe) ----------
create or replace function public.city_stats(p_city text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_role text := public.current_role_type();
  v_city text := p_city;
begin
  if v_role = 'prefeitura' then
    if public.effective_plan(auth.uid()) <> 'institucional' then
      raise exception 'Os indicadores do município são do plano institucional.';
    end if;
    select city into v_city from public.profiles where id = auth.uid();
  elsif not public.is_staff() then
    raise exception 'Sem permissão.';
  end if;
  if v_city is null or trim(v_city) = '' then
    raise exception 'Informe a cidade no perfil.';
  end if;

  return jsonb_build_object(
    'city', v_city,
    'pets_available', (select count(*) from public.pets where lower(city) = lower(v_city) and status = 'available'),
    'pets_adopted', (select count(*) from public.pets where lower(city) = lower(v_city) and status = 'adopted'),
    'ongs', (select count(*) from public.profiles where user_type = 'ong' and lower(city) = lower(v_city)),
    'adopters', (select count(*) from public.profiles where user_type = 'adopter' and lower(city) = lower(v_city)),
    'requests', (select count(*) from public.adoption_requests r join public.pets p on p.id = r.pet_id where lower(p.city) = lower(v_city)),
    'completed', (select count(*) from public.adoption_requests r join public.pets p on p.id = r.pet_id where lower(p.city) = lower(v_city) and r.status = 'completed')
  );
end;
$$;
revoke all on function public.city_stats(text) from public, anon;
grant execute on function public.city_stats(text) to authenticated;

-- Visão geral para Supervisor e Administrador (receita só para o Administrador)
create or replace function public.admin_overview()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'Sem permissão.'; end if;
  return jsonb_build_object(
    'users', (select coalesce(jsonb_object_agg(user_type, n), '{}'::jsonb) from (select user_type, count(*) n from public.profiles group by 1) s),
    'plans', (select coalesce(jsonb_object_agg(plan, n), '{}'::jsonb) from (select public.effective_plan(id) plan, count(*) n from public.profiles group by 1) s),
    'pets', (select count(*) from public.pets),
    'requests', (select count(*) from public.adoption_requests),
    'completed', (select count(*) from public.adoption_requests where status = 'completed'),
    'pending_content', (select (select count(*) from public.partners where status = 'pending')
                             + (select count(*) from public.ads where status = 'pending')
                             + (select count(*) from public.products where status = 'pending')),
    'revenue', case when public.is_admin()
      then (select coalesce(sum(price), 0) from public.subscriptions where cancelled_at is null and ends_at > now())
      else null end
  );
end;
$$;
revoke all on function public.admin_overview() from public, anon;
grant execute on function public.admin_overview() to authenticated;
