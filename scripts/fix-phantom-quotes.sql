-- Run manually in Supabase SQL Editor
-- Review count before deleting
-- Backup table created first
-- Idempotent / safe to rerun

-- 1. Backup first
CREATE TABLE IF NOT EXISTS quotes_backup_phantom_fix AS
SELECT * FROM quotations;

-- Optional: track explicit saves (safe additive column)
ALTER TABLE IF EXISTS quotations
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT timezone('utc'::text, now());

-- 2. Count suspected phantom quotes
-- Phantom = created within 1s of parent lead OR empty/null BOQ items in extended_data
WITH lead_times AS (
  SELECT id AS lead_id, created_at AS lead_created_at
  FROM leads
),
quote_rows AS (
  SELECT
    q.id,
    q.lead_id,
    q.created_at,
    q.updated_at,
    l.lead_created_at,
    COALESCE(
      jsonb_array_length(q.extended_data->'boqRows'),
      jsonb_array_length(q.extended_data->'boqItems'),
      0
    ) AS item_count,
    ABS(EXTRACT(EPOCH FROM (q.created_at - l.lead_created_at))) AS lead_delta_seconds
  FROM quotations q
  LEFT JOIN lead_times l ON l.lead_id = q.lead_id
)
SELECT
  COUNT(*) AS suspected_phantom_count
FROM quote_rows
WHERE item_count = 0
   OR lead_delta_seconds <= 1;

-- 3. Preview rows that would be deleted (run before DELETE)
WITH lead_times AS (
  SELECT id AS lead_id, created_at AS lead_created_at
  FROM leads
),
quote_rows AS (
  SELECT
    q.id,
    q.lead_id,
    q.created_at,
    q.system_size_kw,
    COALESCE(
      jsonb_array_length(q.extended_data->'boqRows'),
      jsonb_array_length(q.extended_data->'boqItems'),
      0
    ) AS item_count,
    ABS(EXTRACT(EPOCH FROM (q.created_at - l.lead_created_at))) AS lead_delta_seconds
  FROM quotations q
  LEFT JOIN lead_times l ON l.lead_id = q.lead_id
)
SELECT id, lead_id, created_at, system_size_kw, item_count, lead_delta_seconds
FROM quote_rows
WHERE item_count = 0
   OR lead_delta_seconds <= 1
ORDER BY created_at DESC;

-- 4. Delete only suspected phantom quotes (uncomment after reviewing preview)
/*
WITH lead_times AS (
  SELECT id AS lead_id, created_at AS lead_created_at
  FROM leads
),
phantom_ids AS (
  SELECT q.id
  FROM quotations q
  LEFT JOIN lead_times l ON l.lead_id = q.lead_id
  WHERE COALESCE(
          jsonb_array_length(q.extended_data->'boqRows'),
          jsonb_array_length(q.extended_data->'boqItems'),
          0
        ) = 0
     OR ABS(EXTRACT(EPOCH FROM (q.created_at - l.lead_created_at))) <= 1
)
DELETE FROM quotations
WHERE id IN (SELECT id FROM phantom_ids);
*/
