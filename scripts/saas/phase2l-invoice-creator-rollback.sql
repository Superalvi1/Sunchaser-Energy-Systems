-- Only remove what t11 created. Never erase recorded creator attribution.
begin;
set local lock_timeout = '5s';
do $f$
begin
  if exists(select 1 from app.original_state where kind='t11_column' and name='invoices.created_by_user_id' and value='false') then
    if exists(select 1 from public.invoices where created_by_user_id is not null) then
      raise exception 'rollback refused: invoice creator values exist; keep the column and fix forward';
    end if;
  end if;
  if exists(select 1 from app.original_state where kind='t11_index' and name='invoices_company_creator_idx' and value='false') then
    drop index if exists public.invoices_company_creator_idx;
  end if;
  if exists(select 1 from app.original_state where kind='t11_column' and name='invoices.created_by_user_id' and value='false') then
    alter table public.invoices drop column if exists created_by_user_id;
  end if;
  delete from app.original_state where (kind='t11_column' and name='invoices.created_by_user_id') or (kind='t11_index' and name='invoices_company_creator_idx');
end $f$;
commit;
notify pgrst, 'reload schema';
