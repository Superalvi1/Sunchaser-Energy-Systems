-- Rollback of phase2h-storage-reservations.sql. Reservations are transient bookkeeping (pending ones expire in minutes, finished ones are only kept
-- for a few minutes so other processes count them), so nothing is kept. The application then refuses pilot-company uploads (retryable "could not
-- verify storage") until the migration is applied again; the founding company and single-company mode never use it.
begin;
set local lock_timeout = '5s';
drop function if exists public.saas_storage_settle(uuid, text);
drop function if exists public.saas_storage_reserve(text, bigint, bigint, bigint, bigint, integer, integer);
drop function if exists public.saas_storage_mark();
drop table if exists public.saas_storage_reservations;
drop sequence if exists public.saas_storage_seq;
commit;
