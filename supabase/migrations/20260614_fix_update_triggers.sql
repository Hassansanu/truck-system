-- Repair live databases where update triggers exist but updated_at columns do not.

alter table public.trucks
  add column if not exists updated_at timestamptz not null default now();

alter table public.cash_collections
  add column if not exists updated_at timestamptz not null default now();

alter table public.cash_book
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'cash_book'
      and column_name = 'type'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'cash_book'
      and column_name = 'transaction_type'
  ) then
    alter table public.cash_book rename column type to transaction_type;
  end if;
end
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trucks_updated_at on public.trucks;
create trigger trucks_updated_at
before update on public.trucks
for each row execute function public.set_updated_at();

drop trigger if exists collections_updated_at on public.cash_collections;
create trigger collections_updated_at
before update on public.cash_collections
for each row execute function public.set_updated_at();

drop trigger if exists cash_book_updated_at on public.cash_book;
create trigger cash_book_updated_at
before update on public.cash_book
for each row execute function public.set_updated_at();
