-- =====================================================================
-- PetMatch: CEP (pets, parceiros e perfil), parceiros por localização, anúncios e lojinha
-- Rode DEPOIS de supabase-add-history-logs-help-lgpd.sql (usa is_staff e log_event).
-- Pode rodar mais de uma vez sem problema.
-- =====================================================================

-- ---------- 1. CEP NOS PETS E NO PERFIL ----------
-- (versão anterior deste script usava bairro; a coluna é removida se existir)
alter table public.pets add column if not exists cep text check (cep is null or cep ~ '^[0-9]{8}$');
alter table public.pets drop column if exists neighborhood;
alter table public.profiles add column if not exists cep text check (cep is null or cep ~ '^[0-9]{8}$');

-- ---------- 2. PARCEIROS (pet shops, clínicas, etc.) ----------
create table if not exists public.partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'outro'
    check (category in ('petshop', 'clinica', 'racao', 'banho_tosa', 'hotel', 'outro')),
  city text not null,
  cep text check (cep is null or cep ~ '^[0-9]{8}$'),
  address text,
  phone text,
  website text,
  description text,
  is_featured boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
-- coordenadas (opcionais) para mostrar a distância quando o usuário permitir a localização
alter table public.partners add column if not exists latitude numeric(9, 6) check (latitude between -90 and 90);
alter table public.partners add column if not exists longitude numeric(9, 6) check (longitude between -180 and 180);

-- caso a versão anterior (com bairro) já tenha sido rodada
alter table public.partners add column if not exists cep text check (cep is null or cep ~ '^[0-9]{8}$');
alter table public.partners drop column if exists neighborhood;
create index if not exists partners_city_idx on public.partners (lower(city));

-- ---------- 3. ANÚNCIOS (prefeitura e empresas) ----------
create table if not exists public.ads (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'empresa' check (kind in ('prefeitura', 'empresa')),
  title text not null,
  body text,
  advertiser text,
  city text,
  link_url text,
  details text,   -- explicação completa do anúncio (quem pode usar, como funciona)
  location text,  -- onde acontece / onde procurar (endereço ou local de atendimento)
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.ads add column if not exists details text;
alter table public.ads add column if not exists location text;

-- ---------- 4. LOJINHA ----------
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'outro'
    check (category in ('caminha', 'roupa', 'coleira', 'brinquedo', 'outro')),
  price numeric(10, 2) not null check (price >= 0),
  description text,
  image_url text,
  partner_id uuid references public.partners(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- 5. RLS: todos veem o que está ativo; só staff altera ----------
alter table public.partners enable row level security;
alter table public.ads enable row level security;
alter table public.products enable row level security;

do $$
declare t text;
begin
  foreach t in array array['partners', 'ads', 'products'] loop
    execute format('drop policy if exists "%1$s_select" on public.%1$s', t);
    execute format('create policy "%1$s_select" on public.%1$s for select using (active or public.is_staff())', t);
    execute format('drop policy if exists "%1$s_staff_insert" on public.%1$s', t);
    execute format('create policy "%1$s_staff_insert" on public.%1$s for insert with check (public.is_staff())', t);
    execute format('drop policy if exists "%1$s_staff_update" on public.%1$s', t);
    execute format('create policy "%1$s_staff_update" on public.%1$s for update using (public.is_staff()) with check (public.is_staff())', t);
    execute format('drop policy if exists "%1$s_staff_delete" on public.%1$s', t);
    execute format('create policy "%1$s_staff_delete" on public.%1$s for delete using (public.is_staff())', t);
  end loop;
end $$;

grant select on public.partners, public.ads, public.products to anon, authenticated;
grant insert, update, delete on public.partners, public.ads, public.products to authenticated;

-- ---------- 6. LOG DE SISTEMA para o que o staff cadastra/remove ----------
create or replace function public.trg_commerce_log()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_label text;
  v_name text;
begin
  v_label := case tg_table_name
    when 'partners' then 'parceiro'
    when 'ads' then 'anuncio'
    else 'produto' end;
  v_name := case tg_op when 'DELETE' then coalesce(to_jsonb(old)->>'name', to_jsonb(old)->>'title')
                       else coalesce(to_jsonb(new)->>'name', to_jsonb(new)->>'title') end;

  if tg_op = 'INSERT' then
    perform public.log_event(v_label || '_cadastrado', v_name);
    return new;
  elsif tg_op = 'DELETE' then
    perform public.log_event(v_label || '_excluido', v_name);
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists partners_log_trigger on public.partners;
create trigger partners_log_trigger after insert or delete on public.partners
  for each row execute function public.trg_commerce_log();
drop trigger if exists ads_log_trigger on public.ads;
create trigger ads_log_trigger after insert or delete on public.ads
  for each row execute function public.trg_commerce_log();
drop trigger if exists products_log_trigger on public.products;
create trigger products_log_trigger after insert or delete on public.products
  for each row execute function public.trg_commerce_log();

-- ---------- 7. DADOS DE EXEMPLO (fictícios, só entram se as tabelas estiverem vazias) ----------
insert into public.partners (name, category, city, cep, address, phone, description, is_featured)
select * from (values
  ('Pet Feliz (exemplo)', 'petshop', 'Curitiba', '80010000', 'Rua Exemplo, 100', '(41) 90000-0001', 'Pet shop de exemplo com ração, acessórios e banho e tosa.', true),
  ('Clínica Vet Vida (exemplo)', 'clinica', 'Curitiba', '80420000', 'Av. Exemplo, 200', '(41) 90000-0002', 'Clínica veterinária de exemplo: consultas, vacinas e castração.', true),
  ('Banho & Tosa Patinhas (exemplo)', 'banho_tosa', 'Curitiba', '81070000', 'Rua Modelo, 50', '(41) 90000-0003', 'Banho e tosa de exemplo.', false),
  ('Ração Boa (exemplo)', 'racao', 'Londrina', '86010000', 'Rua Teste, 10', '(43) 90000-0004', 'Casa de ração de exemplo.', false)
) as v(name, category, city, cep, address, phone, description, is_featured)
where not exists (select 1 from public.partners);

insert into public.ads (kind, title, body, advertiser, city, link_url, details, location)
select * from (values
  ('prefeitura', 'Castração gratuita', 'Campanha de exemplo: castração gratuita de cães e gatos.', 'Prefeitura (exemplo)', null, null,
   'Campanha de exemplo. Moradores do município podem castrar cães e gatos sem custo. É preciso levar documento com foto, comprovante de residência e agendar o atendimento. Vagas limitadas por mês.',
   'Secretaria de Meio Ambiente do seu município (exemplo)'),
  ('empresa', 'Vacinação com desconto', 'Anúncio de exemplo: vacinas com desconto para pets adotados pelo PetMatch.', 'Clínica Vet Vida (exemplo)', 'Curitiba', null,
   'Anúncio de exemplo. Apresente o comprovante de adoção do PetMatch na clínica para ter desconto nas vacinas do primeiro ano.',
   'Av. Exemplo, 200 - Curitiba')
) as v(kind, title, body, advertiser, city, link_url, details, location)
where not exists (select 1 from public.ads);

insert into public.products (name, category, price, description, partner_id)
select v.name, v.category, v.price, v.description, (select id from public.partners where name like 'Pet Feliz%' limit 1)
from (values
  ('Caminha macia (exemplo)', 'caminha', 89.90, 'Caminha de exemplo, lavável.'),
  ('Roupinha de inverno (exemplo)', 'roupa', 39.90, 'Roupinha de exemplo para dias frios.'),
  ('Coleira ajustável (exemplo)', 'coleira', 24.90, 'Coleira de exemplo.'),
  ('Bolinha de borracha (exemplo)', 'brinquedo', 12.90, 'Brinquedo de exemplo.')
) as v(name, category, price, description)
where not exists (select 1 from public.products);

-- coordenadas de exemplo para os parceiros de exemplo (só onde ainda estiverem vazias)
update public.partners set latitude = -25.4284, longitude = -49.2733 where name like 'Pet Feliz%' and latitude is null;
update public.partners set latitude = -25.4400, longitude = -49.2800 where name like 'Clínica Vet Vida%' and latitude is null;
update public.partners set latitude = -25.4800, longitude = -49.2900 where name like 'Banho & Tosa Patinhas%' and latitude is null;
update public.partners set latitude = -23.3045, longitude = -51.1696 where name like 'Ração Boa%' and latitude is null;
