-- Production backup — 2026-06-06 (idempotent)
BEGIN;

DROP TABLE IF EXISTS public.leads_backup_20260606;
CREATE TABLE public.leads_backup_20260606 AS SELECT * FROM public.leads;

DROP TABLE IF EXISTS public.customers_backup_20260606;
CREATE TABLE public.customers_backup_20260606 AS SELECT * FROM public.customers;

DROP TABLE IF EXISTS public.invoices_backup_20260606;
CREATE TABLE public.invoices_backup_20260606 AS SELECT * FROM public.invoices;

DROP TABLE IF EXISTS public.invoice_items_backup_20260606;
CREATE TABLE public.invoice_items_backup_20260606 AS SELECT * FROM public.invoice_items;

DROP TABLE IF EXISTS public.invoice_payments_backup_20260606;
CREATE TABLE public.invoice_payments_backup_20260606 AS SELECT * FROM public.invoice_payments;

DROP TABLE IF EXISTS public.customer_documents_backup_20260606;
CREATE TABLE public.customer_documents_backup_20260606 AS SELECT * FROM public.customer_documents;

DROP TABLE IF EXISTS public.project_deliveries_backup_20260606;
CREATE TABLE public.project_deliveries_backup_20260606 AS SELECT * FROM public.project_deliveries;

DROP TABLE IF EXISTS public.project_completion_media_backup_20260606;
CREATE TABLE public.project_completion_media_backup_20260606 AS SELECT * FROM public.project_completion_media;

DROP TABLE IF EXISTS public.quotations_backup_20260606;
CREATE TABLE public.quotations_backup_20260606 AS SELECT * FROM public.quotations;

DROP TABLE IF EXISTS public.support_tickets_backup_20260606;
CREATE TABLE public.support_tickets_backup_20260606 AS SELECT * FROM public.support_tickets;

DROP TABLE IF EXISTS public.users_backup_20260606;
CREATE TABLE public.users_backup_20260606 AS SELECT * FROM public.users;

COMMIT;
