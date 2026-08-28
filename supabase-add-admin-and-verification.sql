-- ============================================================================
-- PETMATCH — Painel ADM (verificar, bloquear, excluir usuários)
-- + Verificação em duas etapas (e-mail e telefone, versão de demonstração)
-- ============================================================================

-- ---------- 1. Novas colunas em profiles ----------
alter table public.profiles add column if not exists is_verified boolean not null default false;
alter table public.profiles add column if not exists is_blocked boolean not null default false;
alter table public.profiles add column if not exists two_factor_verified boolean not null default false;

-- ---------- 2. Permitir o tipo 'admin' em user_type ----------
alter table public.profiles drop constraint if exists profiles_user_type_check;
alter table public.profiles add constraint profiles_user_type_check
  check (user_type in ('adopter', 'ong', 'admin'));

-- ---------- 3. Políticas de acesso do ADM ----------
-- A leitura de todos os perfis já é pública (profiles_select_all já existe).
-- Faltam as permissões de UPDATE (verificar/bloquear) e DELETE (excluir)
-- exclusivas para quem tem user_type = 'admin'.

drop policy if exists "profiles_admin_update_any" on public.profiles;
create policy "profiles_admin_update_any"
  on public.profiles for update
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.user_type = 'admin')
  );

drop policy if exists "profiles_admin_delete_any" on public.profiles;
create policy "profiles_admin_delete_any"
  on public.profiles for delete
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.user_type = 'admin')
  );

-- ============================================================================
-- COMO CRIAR O PRIMEIRO ADM
-- ============================================================================
-- Não existe cadastro público de ADM (por segurança). Cadastre-se normalmente
-- como adotador pelo site, e depois rode o comando abaixo trocando o e-mail
-- pelo e-mail dessa conta, para promovê-la a administrador:
--
-- update public.profiles set user_type = 'admin' where email = 'seu-email@exemplo.com';
