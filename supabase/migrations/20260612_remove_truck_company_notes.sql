alter table public.trucks
  drop column if exists supplier_name,
  drop column if exists notes;
