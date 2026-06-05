-- Project Delivery: installation completion_stage (additive, idempotent)
-- Run in Supabase SQL Editor if production errors:
--   column project_deliveries.completion_stage does not exist
--
-- Note: delivery_status tracks order/logistics; completion_stage tracks
-- installation proof milestones (Survey → Completed). Default matches app code.

alter table public.project_deliveries
  add column if not exists completion_stage text not null default 'Survey';

alter table public.project_deliveries
  drop constraint if exists project_deliveries_completion_stage_check;

alter table public.project_deliveries
  add constraint project_deliveries_completion_stage_check check (
    completion_stage in (
      'Survey',
      'Installation Started',
      'Panels Installed',
      'Inverter Installed',
      'Battery Installed',
      'Earthing Completed',
      'QA Inspection',
      'Customer Handover',
      'Completed'
    )
  );

create index if not exists project_deliveries_completion_stage_idx
  on public.project_deliveries(completion_stage);

notify pgrst, 'reload schema';
