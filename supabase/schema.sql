-- Truck Sales & Cash Management System
-- Run this once in the Supabase SQL editor.

create extension if not exists "pgcrypto";

create table public.trucks (
  id uuid primary key default gen_random_uuid(),
  truck_number text not null,
  entry_date date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trucks_number_not_empty check (length(trim(truck_number)) > 0)
);

create table public.truck_products (
  id uuid primary key default gen_random_uuid(),
  truck_id uuid not null references public.trucks(id) on delete cascade,
  product_name text not null,
  quantity numeric(14, 3) not null check (quantity > 0),
  purchase_rate numeric(14, 2) not null check (purchase_rate >= 0),
  sale_rate numeric(14, 2) not null check (sale_rate >= 0),
  created_at timestamptz not null default now()
);

create table public.cash_collections (
  id uuid primary key default gen_random_uuid(),
  collection_date date not null default current_date,
  amount numeric(14, 2) not null check (amount > 0),
  description text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.cash_book (
  id uuid primary key default gen_random_uuid(),
  transaction_date date not null default current_date,
  transaction_type text not null check (transaction_type in ('in', 'out')),
  amount numeric(14, 2) not null check (amount > 0),
  description text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index trucks_entry_date_idx on public.trucks(entry_date desc);
create index trucks_truck_number_idx on public.trucks using btree(lower(truck_number));
create index truck_products_truck_id_idx on public.truck_products(truck_id);
create index cash_collections_date_idx on public.cash_collections(collection_date desc);
create index cash_book_date_idx on public.cash_book(transaction_date desc);
create index cash_book_type_idx on public.cash_book(transaction_type);

alter table public.trucks enable row level security;
alter table public.truck_products enable row level security;
alter table public.cash_collections enable row level security;
alter table public.cash_book enable row level security;

create policy "Admin full access to trucks" on public.trucks for all to authenticated using (true) with check (true);
create policy "Admin full access to truck products" on public.truck_products for all to authenticated using (true) with check (true);
create policy "Admin full access to collections" on public.cash_collections for all to authenticated using (true) with check (true);
create policy "Admin full access to cash book" on public.cash_book for all to authenticated using (true) with check (true);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger trucks_updated_at before update on public.trucks for each row execute function public.set_updated_at();
create trigger collections_updated_at before update on public.cash_collections for each row execute function public.set_updated_at();
create trigger cash_book_updated_at before update on public.cash_book for each row execute function public.set_updated_at();
