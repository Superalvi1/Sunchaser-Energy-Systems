-- =============================================================================
-- Invoice bank accounts schema update (additive, idempotent)
-- =============================================================================
--
-- Run manually in Supabase SQL Editor
-- Review schema before applying
-- Backup bank_accounts table if production contains live payment data
--
-- Purpose:
--   Supports Admin-controlled bank account visibility on invoice PDFs.
--   Quotation PDFs continue to use is_active; invoice PDFs also require
--   show_on_invoice = true plus verified account fields in application code.
--
-- Prerequisites:
--   public.bank_accounts table (from scripts/quotation-settings-schema.sql)
--
-- Do NOT run from CI/CD or application startup — apply manually after review.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Existing baseline columns (quotation-settings-schema.sql)
-- -----------------------------------------------------------------------------
-- id              text PRIMARY KEY
-- bank_name       text NOT NULL
-- account_title   text
-- account_number  text
-- iban            text DEFAULT ''
-- branch_code     text DEFAULT ''
-- is_active       boolean NOT NULL DEFAULT true   -- quotation PDF / admin list
-- sort_order      integer NOT NULL DEFAULT 0
-- created_at      timestamptz NOT NULL DEFAULT now()
-- updated_at      timestamptz NOT NULL DEFAULT now()

-- -----------------------------------------------------------------------------
-- 1. show_on_invoice — invoice PDF last-page bank table visibility
-- -----------------------------------------------------------------------------
-- When true AND is_active = true, account may appear on generated invoice PDFs
-- (application also validates bank_name, account_title, account_number, IBAN).
-- Default false: non-Sunchaser / legacy accounts stay hidden until Super Admin
-- explicitly enables them in Admin → Quotation Settings → Bank Accounts.

ALTER TABLE IF EXISTS public.bank_accounts
  ADD COLUMN IF NOT EXISTS show_on_invoice boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.bank_accounts.show_on_invoice IS
  'Invoice PDF visibility flag. When true (and is_active), account may render on the invoice bank page. Default false; enable per account in Admin settings.';

-- -----------------------------------------------------------------------------
-- 2. is_active — ensure column exists on older deployments (no rename to active)
-- -----------------------------------------------------------------------------
-- Application code reads is_active (dbManager.ts, server.ts, invoicePdf.ts).
-- Do NOT add a separate "active" column — that would duplicate is_active.

ALTER TABLE IF EXISTS public.bank_accounts
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.bank_accounts.is_active IS
  'Master enable for quotations and admin lists. Inactive accounts are excluded from quotation PDF bank pages and should not be edited as live channels.';

-- -----------------------------------------------------------------------------
-- 3. Indexes — filter invoice-visible and active accounts efficiently
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS bank_accounts_show_on_invoice_idx
  ON public.bank_accounts (show_on_invoice)
  WHERE show_on_invoice = true;

CREATE INDEX IF NOT EXISTS bank_accounts_is_active_idx
  ON public.bank_accounts (is_active)
  WHERE is_active = true;

-- -----------------------------------------------------------------------------
-- 4. Optional one-time data alignment (review before uncommenting)
-- -----------------------------------------------------------------------------
-- Enables invoice display only for Sunchaser-titled accounts that pass field
-- validation. Does NOT invent account numbers. Safe to skip if Admin will set
-- show_on_invoice manually.

-- UPDATE public.bank_accounts
-- SET show_on_invoice = true
-- WHERE account_title ILIKE '%sunchaser%'
--   AND COALESCE(is_active, true) = true
--   AND COALESCE(bank_name, '') <> ''
--   AND COALESCE(account_number, '') <> ''
--   AND COALESCE(iban, '') <> ''
--   AND UPPER(TRIM(iban)) NOT IN ('N/A', 'NA');

NOTIFY pgrst, 'reload schema';
