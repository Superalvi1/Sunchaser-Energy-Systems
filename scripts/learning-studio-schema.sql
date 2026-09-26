BEGIN;

CREATE TABLE IF NOT EXISTS learning_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL DEFAULT 'sunchaser',
  owner_user_id text NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  source_kind text NOT NULL DEFAULT 'prompt' CHECK (source_kind IN ('prompt','document','mixed','import')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','generating','review','published','archived','failed')),
  openmaic_stage_id text,
  language text NOT NULL DEFAULT 'en',
  level text NOT NULL DEFAULT 'beginner',
  teacher_voice text,
  generation_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);

CREATE INDEX IF NOT EXISTS learning_courses_owner_idx
  ON learning_courses(company_id, owner_user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS learning_courses_stage_unique
  ON learning_courses(openmaic_stage_id)
  WHERE openmaic_stage_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS learning_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL DEFAULT 'sunchaser',
  course_id uuid NOT NULL REFERENCES learning_courses(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  assigned_by_user_id text,
  status text NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned','in_progress','completed','cancelled')),
  progress_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (progress_percent >= 0 AND progress_percent <= 100),
  current_scene_id text,
  started_at timestamptz,
  completed_at timestamptz,
  last_activity_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, course_id, user_id)
);

CREATE INDEX IF NOT EXISTS learning_enrollments_user_idx
  ON learning_enrollments(company_id, user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS learning_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL DEFAULT 'sunchaser',
  course_id uuid NOT NULL REFERENCES learning_courses(id) ON DELETE CASCADE,
  enrollment_id uuid REFERENCES learning_enrollments(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  assessment_type text NOT NULL DEFAULT 'quiz' CHECK (assessment_type IN ('quiz','exam','assignment','practice')),
  score numeric(6,2),
  max_score numeric(6,2),
  percent numeric(5,2),
  passed boolean,
  attempt integer NOT NULL DEFAULT 1 CHECK (attempt > 0),
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS learning_assessments_user_idx
  ON learning_assessments(company_id, user_id, course_id, submitted_at DESC);

CREATE TABLE IF NOT EXISTS learning_generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL DEFAULT 'sunchaser',
  course_id uuid REFERENCES learning_courses(id) ON DELETE CASCADE,
  requested_by_user_id text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  step text NOT NULL DEFAULT 'queued',
  progress integer NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code text,
  error_message text,
  provider text,
  model text,
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  estimated_cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS learning_generation_jobs_queue_idx
  ON learning_generation_jobs(status, available_at, created_at)
  WHERE status IN ('queued','running');

CREATE TABLE IF NOT EXISTS learning_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL DEFAULT 'sunchaser',
  user_id text NOT NULL,
  course_id uuid REFERENCES learning_courses(id) ON DELETE SET NULL,
  job_id uuid REFERENCES learning_generation_jobs(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  provider text,
  model text,
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS learning_usage_events_cost_idx
  ON learning_usage_events(company_id, created_at DESC);

COMMIT;
