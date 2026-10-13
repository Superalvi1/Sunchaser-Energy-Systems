-- Rollback of phase2c-document-numbering.sql. Keeps a copy of the counters in schema app_rollback_backup, restores the global unique
-- key on invoices.invoice_number only if no two companies use the same number, and removes the two functions.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create schema if not exists app_rollback_backup;
do $$ begin
  if to_regclass('public.document_counters') is not null then
    drop table if exists app_rollback_backup.document_counters;
    create table app_rollback_backup.document_counters as table public.document_counters;
  end if;
  if exists (select 1 from app.original_state where kind = 'dropped_unique') then
    if exists (select 1 from public.invoices group by invoice_number having count(*) > 1) then
      raise exception 'rollback refused: two invoices share an invoice number (different companies); the global unique key cannot come back';
    end if;
  end if;
end $$;

drop function if exists public.next_document_number(text, text, text, int);
drop function if exists public.document_counter_set_floor(text, text, text, bigint);
drop table if exists public.document_counters;

do $$
declare r record;
begin
  if exists (select 1 from app.original_state where kind = 'created_unique' and value = 'invoices_company_invoice_number_key') then
    alter table public.invoices drop constraint if exists invoices_company_invoice_number_key;
    delete from app.original_state where kind = 'created_unique' and value = 'invoices_company_invoice_number_key';
  end if;
  for r in select name, value from app.original_state where kind = 'dropped_unique' loop
    execute format('alter table public.invoices add constraint %I %s', substring(r.name from 'invoices\.(.*)$'), r.value);
    delete from app.original_state where kind = 'dropped_unique' and name = r.name;
  end loop;
end $$;

commit;
notify pgrst, 'reload schema';
