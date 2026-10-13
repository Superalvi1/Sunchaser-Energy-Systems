#!/usr/bin/env bash
# READ-ONLY. Records which PostgREST is running in production RIGHT NOW and the exact image it corresponds to, BEFORE anyone changes the image setting.
# The file it writes is the rollback source: rollback = set the image back to the exact reference recorded here (never :latest, never a version
# that was not running).
#
#   bash scripts/rehearsal/postgrest-record.sh            # asks the running PostgREST for its version through the Railway CLI (railway login first)
#   RUNNING_VERSION=16.4 bash scripts/rehearsal/postgrest-record.sh   # only if you obtained the version another way (tests / manual)
#
# What it does: (1) runs ONE read-only request inside the CRM container (`railway ssh`), which asks PostgREST for its root document and prints only the
# version string - the service key stays inside the container and is never shown; (2) looks the version tag up on Docker Hub (public, unauthenticated)
# to get the image digests; (3) writes ~/postgrest-current-image-record.txt. It changes nothing in Railway.
# Exit 0 = recorded and it is the version this release was tested with (16.4). Exit 3 = recorded but DIFFERENT from the tested version: do not pin.
set -uo pipefail
RW_PROJECT_ID="${RW_PROJECT_ID:-11d4acc0-4f19-4c05-a41c-fa20d3b235af}"
RW_ENVIRONMENT_ID="${RW_ENVIRONMENT_ID:-a3fcb877-f02b-44b5-af5c-f03fac71f05b}"
RW_CRM_SERVICE="${RW_CRM_SERVICE:-sunchaser-crm-private-smoke}"
OUT="${RECORD_FILE:-$HOME/postgrest-current-image-record.txt}"
TESTED_VERSION=16.4
TESTED_INDEX=sha256:d155c6718ed9a9f990d159a2ab7c0a3f16944dbb6d0a0344557421042acfe0df
command -v curl >/dev/null && command -v perl >/dev/null || { echo "curl and perl are required"; exit 1; }

VER="${RUNNING_VERSION:-}"
if [ -z "$VER" ]; then
  command -v railway >/dev/null || { echo "Railway CLI not found (brew install railway; railway login)"; exit 1; }
  VER="$(railway ssh --project "$RW_PROJECT_ID" --environment "$RW_ENVIRONMENT_ID" --service "$RW_CRM_SERVICE" -- node -e "fetch(process.env.RAILWAY_POSTGREST_URL+'/',{headers:{Authorization:'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY}}).then(r=>r.json()).then(j=>console.log('PGRST_VERSION='+j.info.version)).catch(e=>console.log('PGRST_ERROR'))" 2>/dev/null | sed -n 's/^PGRST_VERSION=//p' | head -1)"
fi
VER="$(printf '%s' "$VER" | sed -E 's/^v//; s/ .*//')"
case "$VER" in [0-9]*.[0-9]*|[0-9]*.[0-9]*.[0-9]*) ;; *) echo "STOP: could not read the running PostgREST version. Do NOT change the image. Tell me what happened (the 'railway ssh' command may need adjusting)."; exit 1;; esac
echo "running PostgREST version: $VER"

JSON="$(curl -sS -m 30 "https://hub.docker.com/v2/repositories/postgrest/postgrest/tags/v$VER")" || { echo "STOP: Docker Hub lookup failed"; exit 1; }
INDEX="$(printf '%s' "$JSON" | perl -MJSON::PP -e 'local $/; my $j = eval { decode_json(<STDIN>) } or exit 1; print $j->{digest} // ""')"
AMD64="$(printf '%s' "$JSON" | perl -MJSON::PP -e 'local $/; my $j = eval { decode_json(<STDIN>) } or exit 1; for my $i (@{$j->{images} || []}) { print $i->{digest} if ($i->{architecture} // "") eq "amd64" && ($i->{os} // "") eq "linux" }')"
LAST="$(printf '%s' "$JSON" | perl -MJSON::PP -e 'local $/; my $j = eval { decode_json(<STDIN>) } or exit 1; print $j->{last_updated} // ""')"
case "$INDEX" in sha256:????????????????????????????????????????????????????????????????) ;; *) echo "STOP: Docker Hub has no usable digest for tag v$VER"; exit 1;; esac
REF="postgrest/postgrest:v$VER@$INDEX"
umask 077
{
  echo "PostgREST image record (written $(date -u +%Y-%m-%dT%H:%M:%SZ), BEFORE any change; read-only)"
  echo "running version:      $VER"
  echo "image tag:            postgrest/postgrest:v$VER   (Docker Hub tag last updated $LAST)"
  echo "image index digest:   $INDEX"
  echo "linux/amd64 digest:   ${AMD64:-unknown}"
  echo "digest source:        Docker Hub's CURRENT digest for tag v$VER. PostgREST cannot report its own image digest, so this is the best available"
  echo "                      reference for the running version, not a reading of the running container. Also note the Railway deployment id/image shown in the dashboard."
  echo "ROLLBACK REFERENCE:   $REF"
  echo "  (if Railway rejects the @sha256 form use: postgrest/postgrest:v$VER)"
  echo "Railway currently says: postgrest/postgrest:latest  (floating) - write down the active deployment id from the dashboard: ______________"
  echo "NEVER roll back to ':latest' or to a version that was not recorded as running."
} > "$OUT"
cat "$OUT"; echo "written: $OUT"
if [ "$VER" = "$TESTED_VERSION" ] && [ "$INDEX" = "$TESTED_INDEX" ]; then echo "OK: this is exactly the image the release was tested with (v$TESTED_VERSION, $TESTED_INDEX). Pinning it changes no software."; exit 0; fi
echo "STOP: the running version/digest is NOT the one this release was tested with (v$TESTED_VERSION, $TESTED_INDEX). Do not pin; send me $OUT."; exit 3
