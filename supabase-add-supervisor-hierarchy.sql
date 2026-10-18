-- ============================================================================
-- PETMATCH — Hierarquia de acesso: ADMINISTRADOR > SUPERVISOR > USUÁRIO
-- Rode DEPOIS do supabase-add-admin-and-verification.sql
-- ============================================================================
-- Administrador: controle total (verificar, bloquear, excluir, promover/remover Supervisor)
-- Supervisor:    modera usuários (verificar e bloquear/desbloquear). Não exclui nem promove.
-- Usuário:       Adotador ou ONG (cadastro público). Sem poderes de moderação.

-- 1. Libera o tipo 'supervisor'
alter table public.profiles drop constraint if exists profiles_user_type_check;
alter table public.profiles add constraint profiles_user_type_check
  check (user_type in ('adopter', 'ong', 'supervisor', 'admin'));

-- 2. Cadastro público só pode criar adotador ou ONG (supervisor/admin nunca)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_type text := coalesce(new.raw_user_meta_data->>'user_type', 'adopter');
begin
  if v_type not in ('adopter', 'ong') then
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

-- 3. Supervisor pode atualizar perfis de adotadores e ONGs
drop policy if exists "profiles_supervisor_update_users" on public.profiles;
create policy "profiles_supervisor_update_users"
  on public.profiles for update
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.user_type = 'supervisor')
    and user_type in ('adopter', 'ong')
  );

-- 4. Trava de segurança: quem pode mudar o quê
create or replace function public.protect_profile_privileged_columns()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_role text;
begin
  -- SQL Editor do Supabase (sem usuário logado): liberado
  if auth.uid() is null then
    return new;
  end if;

  select user_type into v_role from public.profiles where id = auth.uid();

  -- Administrador: pode tudo
  if v_role = 'admin' then
    return new;
  end if;

  -- Ninguém além do admin muda o tipo de conta
  if new.user_type is distinct from old.user_type then
    raise exception 'Apenas o Administrador pode alterar o tipo de conta.';
  end if;

  if v_role = 'supervisor' and old.id <> auth.uid() then
    -- Supervisor em conta de outra pessoa: só is_verified e is_blocked
    new.name := old.name;
    new.email := old.email;
    new.phone := old.phone;
    new.address := old.address;
    new.city := old.city;
    return new;
  end if;

  -- Usuário comum (ou o próprio supervisor no próprio perfil): não mexe em verificação/bloqueio
  new.is_verified := old.is_verified;
  new.is_blocked := old.is_blocked;
  return new;
end;
$$;

drop trigger if exists protect_profile_privileged_columns on public.profiles;
create trigger protect_profile_privileged_columns
  before update on public.profiles
  for each row execute function public.protect_profile_privileged_columns();

-- ============================================================================
-- COMO CRIAR UM SUPERVISOR
-- ============================================================================
-- Opção A (pelo site): entre como Administrador > Painel ADM > "Tornar Supervisor".
-- Opção B (SQL): troque o e-mail e rode:
-- update public.profiles set user_type = 'supervisor' where email = 'email-do-supervisor@exemplo.com';
