-- Phase 7: Service History & Asset Log (additive only)

alter table public.after_sales_service_logs add column if not exists description text;
alter table public.after_sales_service_logs add column if not exists warranty_covered boolean default false;
alter table public.after_sales_service_logs add column if not exists labor_cost numeric default 0;
alter table public.after_sales_service_logs add column if not exists parts_cost numeric default 0;
alter table public.after_sales_service_logs add column if not exists replacement_parts text;
alter table public.after_sales_service_logs add column if not exists performance_improvement_pct numeric;

alter table public.customer_portal_profiles add column if not exists next_recommended_service_date date;

-- Backfill warranty_covered from under_free_service where unset
update public.after_sales_service_logs
set warranty_covered = under_free_service
where warranty_covered is null;
