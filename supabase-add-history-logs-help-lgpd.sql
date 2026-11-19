-- ============================================================================
-- PETMATCH — Histórico, Log de sistema, Ajuda e Reclamações e LGPD
-- Rode DEPOIS do supabase-add-supervisor-hierarchy.sql
-- Pode rodar mais de uma vez sem problema.
-- ============================================================================

-- ---------- 0. Funções auxiliares ----------
create or replace function public.current_role_type()
returns text language sql stable security definer set search_path = public as $$
  select user_type from public.profiles where id = auth.uid()
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role_type() in ('admin', 'supervisor'), false)
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role_type() = 'admin', false)
$$;

-- ---------- 1. LGPD: registro do consentimento no perfil ----------
alter table public.profiles add column if not exists lgpd_consent_at timestamptz;
alter table public.profiles add column if not exists lgpd_consent_version text;

-- Cadastro: grava o consentimento enviado pelo site (e continua aceitando só ONG ou adotador)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_type text := coalesce(new.raw_user_meta_data->>'user_type', 'adopter');
  v_consent boolean := coalesce(new.raw_user_meta_data->>'lgpd_consent', 'false') = 'true';
begin
  if v_type not in ('adopter', 'ong') then
    v_type := 'adopter';
  end if;

  insert into public.profiles (id, email, name, user_type, phone, address, city, lgpd_consent_at, lgpd_consent_version)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    v_type,
    new.raw_user_meta_data->>'phone',
    new.raw_user_meta_data->>'address',
    new.raw_user_meta_data->>'city',
    case when v_consent then now() end,
    case when v_consent then '1.0' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ---------- 2. LOG DE SISTEMA ----------
create table if not exists public.system_logs (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor_id uuid,
  actor_name text,
  actor_role text,
  action text not null,
  details text,
  target_id uuid
);
create index if not exists system_logs_created_idx on public.system_logs (created_at desc);

alter table public.system_logs enable row level security;

-- Só o Administrador lê. Ninguém altera nem apaga logs (auditoria).
drop policy if exists "system_logs_admin_read" on public.system_logs;
create policy "system_logs_admin_read"
  on public.system_logs for select
  using (public.is_admin());

-- Função interna: grava um log com o autor atual (uso apenas pelos gatilhos)
create or replace function public.log_event(p_action text, p_details text default null, p_target uuid default null)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_name text;
  v_role text;
begin
  select name, user_type into v_name, v_role from public.profiles where id = auth.uid();
  insert into public.system_logs (actor_id, actor_name, actor_role, action, details, target_id)
  values (auth.uid(), coalesce(v_name, 'Sistema'), coalesce(v_role, 'sistema'), p_action, p_details, p_target);
end;
$$;
revoke all on function public.log_event(text, text, uuid) from public, anon, authenticated;

-- Função pública restrita: o site só pode registrar estas ações
create or replace function public.log_client_event(p_action text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then return; end if;
  if p_action not in ('login', 'logout', 'exportou_dados', 'aceitou_lgpd') then return; end if;
  perform public.log_event(p_action);
end;
$$;
revoke all on function public.log_client_event(text) from public, anon;
grant execute on function public.log_client_event(text) to authenticated;

-- ---------- 3. HISTÓRICO DAS SOLICITAÇÕES ----------
create table if not exists public.request_history (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.adoption_requests(id) on delete cascade,
  status text not null,
  changed_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists request_history_request_idx on public.request_history (request_id, created_at);

alter table public.request_history enable row level security;

drop policy if exists "request_history_select_involved" on public.request_history;
create policy "request_history_select_involved"
  on public.request_history for select
  using (
    public.is_staff()
    or exists (
      select 1
      from public.adoption_requests r
      join public.pets p on p.id = r.pet_id
      where r.id = request_history.request_id
        and (r.adopter_id = auth.uid() or p.ong_id = auth.uid())
    )
  );

-- Solicitações que já existiam ganham uma primeira linha de histórico
insert into public.request_history (request_id, status, created_at)
select r.id, r.status, coalesce(r.created_at, now())
from public.adoption_requests r
where not exists (select 1 from public.request_history h where h.request_id = r.id);

create or replace function public.trg_request_history()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_pet text;
begin
  select name into v_pet from public.pets where id = new.pet_id;

  if tg_op = 'INSERT' then
    insert into public.request_history (request_id, status, changed_by) values (new.id, new.status, auth.uid());
    perform public.log_event('solicitacao_' || new.status, 'Pet: ' || coalesce(v_pet, '?'), new.adopter_id);
  elsif new.status is distinct from old.status then
    insert into public.request_history (request_id, status, changed_by) values (new.id, new.status, auth.uid());
    perform public.log_event('solicitacao_' || new.status, 'Pet: ' || coalesce(v_pet, '?'), new.adopter_id);
  end if;
  return new;
end;
$$;

drop trigger if exists request_history_trigger on public.adoption_requests;
create trigger request_history_trigger
  after insert or update on public.adoption_requests
  for each row execute function public.trg_request_history();

-- ---------- 4. AJUDA E RECLAMAÇÕES ----------
create table if not exists public.complaints (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references public.profiles(id) on delete set null,
  author_name text,
  author_email text,
  kind text not null check (kind in ('help', 'complaint', 'suggestion')),
  subject text not null check (char_length(subject) <= 150),
  message text not null check (char_length(message) <= 3000),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
  response text,
  responded_by uuid,
  responded_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.complaints enable row level security;

drop policy if exists "complaints_select" on public.complaints;
create policy "complaints_select"
  on public.complaints for select
  using (author_id = auth.uid() or public.is_staff());

drop policy if exists "complaints_insert_own" on public.complaints;
create policy "complaints_insert_own"
  on public.complaints for insert
  with check (author_id = auth.uid());

drop policy if exists "complaints_staff_update" on public.complaints;
create policy "complaints_staff_update"
  on public.complaints for update
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists "complaints_admin_delete" on public.complaints;
create policy "complaints_admin_delete"
  on public.complaints for delete
  using (public.is_admin());

create or replace function public.trg_complaints_log()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_event('mensagem_enviada', 'Tipo: ' || new.kind, new.author_id);
  elsif new.response is distinct from old.response and new.response is not null then
    perform public.log_event('mensagem_respondida', 'Tipo: ' || new.kind, new.author_id);
  end if;
  return new;
end;
$$;

drop trigger if exists complaints_log_trigger on public.complaints;
create trigger complaints_log_trigger
  after insert or update on public.complaints
  for each row execute function public.trg_complaints_log();

-- ---------- 5. Logs automáticos de contas e pets ----------
create or replace function public.trg_profiles_log()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_name text;
  v_role text;
begin
  if tg_op = 'INSERT' then
    insert into public.system_logs (actor_id, actor_name, actor_role, action, details, target_id)
    values (new.id, new.name, new.user_type, 'cadastro', 'Nova conta: ' || new.user_type, new.id);
    return new;

  elsif tg_op = 'UPDATE' then
    if new.is_verified is distinct from old.is_verified then
      perform public.log_event(case when new.is_verified then 'conta_verificada' else 'verificacao_removida' end, null, new.id);
    end if;
    if new.is_blocked is distinct from old.is_blocked then
      perform public.log_event(case when new.is_blocked then 'conta_bloqueada' else 'conta_desbloqueada' end, null, new.id);
    end if;
    if new.user_type is distinct from old.user_type then
      perform public.log_event('papel_alterado', old.user_type || ' -> ' || new.user_type, new.id);
    end if;
    if new.two_factor_verified is distinct from old.two_factor_verified and new.two_factor_verified then
      perform public.log_event('2fa_concluida', null, new.id);
    end if;
    return new;

  elsif tg_op = 'DELETE' then
    select name, user_type into v_name, v_role from public.profiles where id = auth.uid();
    if auth.uid() = old.id then
      -- a própria pessoa excluindo a conta: o registro não guarda o nome dela
      v_name := 'Conta excluída'; v_role := old.user_type;
    end if;
    -- LGPD: o nome da conta excluída deixa de aparecer nos registros antigos
    update public.system_logs set actor_name = 'Conta excluída' where actor_id = old.id;
    insert into public.system_logs (actor_id, actor_name, actor_role, action, details, target_id)
    values (auth.uid(), coalesce(v_name, 'Sistema'), coalesce(v_role, 'sistema'), 'conta_excluida',
            'Conta ' || old.user_type || ' removida', old.id);
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists profiles_log_trigger on public.profiles;
create trigger profiles_log_trigger
  after insert or update or delete on public.profiles
  for each row execute function public.trg_profiles_log();

create or replace function public.trg_pets_log()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_event('pet_cadastrado', 'Pet: ' || new.name);
    return new;
  else
    perform public.log_event('pet_excluido', 'Pet: ' || old.name);
    return old;
  end if;
end;
$$;

drop trigger if exists pets_log_trigger on public.pets;
create trigger pets_log_trigger
  after insert or delete on public.pets
  for each row execute function public.trg_pets_log();

-- ---------- 6. LGPD: o titular elimina a própria conta ----------
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer set search_path = public, auth
as $$
declare
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'É preciso estar logado.';
  end if;

  select user_type into v_role from public.profiles where id = auth.uid();
  if v_role in ('admin', 'supervisor') then
    raise exception 'Contas de Administrador e Supervisor só podem ser removidas pelo Administrador do sistema.';
  end if;

  update public.complaints
     set author_name = 'Conta excluída', author_email = null
   where author_id = auth.uid();

  -- Apaga o login; o perfil e os dados ligados a ele caem em cascata
  delete from auth.users where id = auth.uid();
end;
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
