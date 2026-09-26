#!/bin/sh
set -eu

: "${TARGET_DATABASE_URL:?TARGET_DATABASE_URL is required}"

echo "LEARNING_SCHEMA_APPLY_START"
psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -f /schema.sql >/tmp/learning-schema.log
cat /tmp/learning-schema.log

missing=""
for table in \
  learning_courses \
  learning_enrollments \
  learning_assessments \
  learning_generation_jobs \
  learning_usage_events
do
  found="$(psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "SELECT to_regclass('public.$table') IS NOT NULL")"
  if [ "$found" != "t" ]; then
    missing="$missing $table"
  fi
done

if [ -n "$missing" ]; then
  echo "LEARNING_SCHEMA_VERIFY_FAILED missing:$missing" >&2
  exit 1
fi

echo "LEARNING_SCHEMA_VERIFY_PASS tables=5"
