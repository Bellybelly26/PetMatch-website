-- =====================================================================
-- PetMatch: REMOVE os planos pagos (a versão do site sem planos usa este script)
-- Rode DEPOIS de supabase-add-plans-roles-features.sql. Pode rodar mais de uma vez.
-- Não apaga tabelas nem dados: só tira limites e funções de assinatura.
-- =====================================================================

-- 1. Sem limite de pets por plano
drop trigger if exists pets_limit_trigger on public.pets;

-- 2. Reclamações sem prioridade por plano
drop trigger if exists complaints_priority_trigger on public.complaints;

-- 3. Conteúdo de prefeituras e empresas continua passando por aprovação, sem limites de plano
create or replace function public.trg_content_guard()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_role text;
  v_limit int;
  v_count int;
  v_skip text[] := array['active', 'views', 'clicks', 'status', 'is_featured', 'owner_id'];
begin
  if auth.uid() is null or public.is_staff() or coalesce(current_setting('app.counter', true), '') = '1' then
    return new;
  end if;
  v_role := public.current_role_type();

  if tg_op = 'INSERT' then
    new.owner_id := auth.uid();
    new.status := 'pending';

    if tg_table_name = 'partners' then
      if v_role <> 'empresa' then raise exception 'Só contas de empresa cadastram parceiros.'; end if;
      v_limit := 20;
      select count(*) into v_count from public.partners where owner_id = auth.uid();
      new.is_featured := false;
      new.views := 0;
    elsif tg_table_name = 'ads' then
      if v_role = 'prefeitura' then
        new.kind := 'prefeitura';
        v_limit := 20;
      elsif v_role = 'empresa' then
        new.kind := 'empresa';
        v_limit := 20;
      else
        raise exception 'Anúncios são para prefeituras e empresas.';
      end if;
      select count(*) into v_count from public.ads where owner_id = auth.uid();
      new.views := 0;
      new.clicks := 0;
    else
      if v_role <> 'empresa' then raise exception 'Só contas de empresa cadastram produtos.'; end if;
      v_limit := 200;
      select count(*) into v_count from public.products where owner_id = auth.uid();
    end if;

    if v_count >= v_limit then
      raise exception 'Limite de % itens atingido.', v_limit;
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
  if tg_table_name = 'partners' then new.is_featured := old.is_featured; end if;
  return new;
end;
$$;

-- 4. Indicadores do município liberados para a Prefeitura
create or replace function public.city_stats(p_city text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_role text := public.current_role_type();
  v_city text := p_city;
begin
  if v_role = 'prefeitura' then
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

-- 5. Visão geral para Supervisor e Administrador, sem planos nem receita
create or replace function public.admin_overview()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'Sem permissão.'; end if;
  return jsonb_build_object(
    'users', (select coalesce(jsonb_object_agg(user_type, n), '{}'::jsonb) from (select user_type, count(*) n from public.profiles group by 1) s),
    'pets', (select count(*) from public.pets),
    'requests', (select count(*) from public.adoption_requests),
    'completed', (select count(*) from public.adoption_requests where status = 'completed'),
    'pending_content', (select (select count(*) from public.partners where status = 'pending')
                             + (select count(*) from public.ads where status = 'pending')
                             + (select count(*) from public.products where status = 'pending'))
  );
end;
$$;
revoke all on function public.admin_overview() from public, anon;
grant execute on function public.admin_overview() to authenticated;

-- 6. Remove as funções de assinatura e de equipe da ONG
drop function if exists public.subscribe_plan(text);
drop function if exists public.cancel_plan();
drop function if exists public.admin_set_plan(uuid, text, numeric);
drop function if exists public.add_ong_member(text);

-- 7. Todas as contas voltam ao plano gratuito (o plano deixa de ter efeito)
select set_config('app.plan_change', '1', true);
update public.profiles set plan = 'free', plan_expires_at = null where plan is distinct from 'free';
