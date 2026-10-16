-- t11: make durable invoice creator attribution part of the versioned install.
-- Legacy invoices remain NULL: no guessed ownership and no timestamp/amount changes.
begin;
set local lock_timeout = '5s';
do $f$
begin
  if to_regclass('app.original_state') is null then raise exception 'company foundation is required'; end if;
  insert into app.original_state(kind,name,value)
    select 't11_column','invoices.created_by_user_id',exists(select 1 from information_schema.columns where table_schema='public' and table_name='invoices' and column_name='created_by_user_id')::text
    on conflict do nothing;
  insert into app.original_state(kind,name,value)
    values('t11_index','invoices_company_creator_idx',(to_regclass('public.invoices_company_creator_idx') is not null)::text) on conflict do nothing;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='invoices' and column_name='created_by_user_id') then
    alter table public.invoices add column created_by_user_id text;
    comment on column public.invoices.created_by_user_id is 'Authenticated creator user id for new invoices; legacy ownership is not inferred.';
  elsif not exists(select 1 from information_schema.columns where table_schema='public' and table_name='invoices' and column_name='created_by_user_id' and data_type in ('text','character varying')) then
    raise exception 'invoices.created_by_user_id must be text-compatible; refusing to change existing data';
  end if;
end $f$;
create index if not exists invoices_company_creator_idx on public.invoices(company_id,created_by_user_id);
commit;
notify pgrst, 'reload schema';
