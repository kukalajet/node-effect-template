#!/usr/bin/env bash
# Runs the built image against a real PostgreSQL in an isolated Compose project:
# migrations, API and worker-once smoke checks, liveness that survives a
# database outage, the fail-fast worker's restart and recovery, and data kept in
# the volume.
# Build the image first (`docker build -t node-effect-template:local .`).
set -euo pipefail
cd "$(dirname "$0")/.."

export APP_IMAGE=${APP_IMAGE:-node-effect-template:local}
export POSTGRES_DB=smoke_test POSTGRES_USER=smoke_test POSTGRES_PASSWORD=smoke_test
export API_PORT=0 COMPOSE_PROFILES='' WORKER_POLL_INTERVAL_MS=500
project="node-effect-smoke-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-1}"
compose=(docker compose --env-file .env.example -f docker-compose.yml --profile app -p "$project")

cleanup() {
  status=$?
  if [[ "$status" != 0 ]]; then
    "${compose[@]}" logs --no-color
  fi
  "${compose[@]}" down --volumes --remove-orphans
  exit "$status"
}
trap cleanup EXIT

wait_for_worker_restart() {
  for _ in {1..30}; do
    if test "$(docker inspect --format '{{.RestartCount}}' "$worker_id")" -gt 0; then
      return 0
    fi
    sleep 1
  done
  echo "Timed out waiting for the worker to restart" >&2
  return 1
}

# Waits for the worker to log a successful pass after a Docker timestamp. A
# running container alone proves nothing: a crash-looping worker is briefly
# running before each failure.
wait_for_worker_pass() {
  # Docker's restart delay doubles while the worker keeps failing.
  for _ in {1..120}; do
    logs=$("${compose[@]}" logs --no-color --since "$1" worker)
    if [[ $logs == *"Worker user sample loaded"* ]]; then
      return 0
    fi
    sleep 1
  done
  echo "Timed out waiting for a successful worker pass" >&2
  return 1
}

# The daemon's clock, which also stamps the container logs.
docker_time() {
  docker info --format '{{.SystemTime}}'
}

started=$(docker_time)
"${compose[@]}" up -d --no-build --wait --wait-timeout 120
address=$("${compose[@]}" port api 8000)
curl --fail --silent --show-error "http://$address/health/live"
curl --fail --silent --show-error "http://$address/health/ready"
"${compose[@]}" exec -T api node scripts/smoke-api.ts
"${compose[@]}" run --rm --no-deps worker-once
"${compose[@]}" run --rm --no-deps migrate

# Before the outage the worker has completed a pass and never restarted, so the
# restart below is the outage's doing.
worker_id=$("${compose[@]}" ps -q worker)
wait_for_worker_pass "$started"
test "$(docker inspect --format '{{.State.Status}} {{.RestartCount}}' "$worker_id")" = "running 0"

# Database loss affects readiness, not the API process liveness probe. The
# worker fails fast and relies on its restart policy.
"${compose[@]}" stop postgresql
curl --fail --silent --show-error "http://$address/health/live"
status=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' "http://$address/health/ready")
test "$status" = 503
wait_for_worker_restart

# Also prove that a newly started API can serve liveness without PostgreSQL.
"${compose[@]}" up -d --no-build --no-deps --force-recreate --wait --wait-timeout 90 api
address=$("${compose[@]}" port api 8000)
curl --fail --silent --show-error "http://$address/health/live"

# Restore the database and verify that its named volume kept the data and the
# migration history, and that the restarted worker completes a pass again.
restored=$(docker_time)
"${compose[@]}" up -d --no-deps --force-recreate --wait --wait-timeout 90 postgresql
"${compose[@]}" up -d --no-build --no-deps --force-recreate --wait --wait-timeout 90 api
address=$("${compose[@]}" port api 8000)
curl --fail --silent --show-error "http://$address/health/ready"
curl --fail --silent --show-error "http://$address/users" | grep -F 'ada@example.com' > /dev/null
migration_count=$("${compose[@]}" exec -T postgresql psql \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --tuples-only \
  --no-align \
  --command 'select count(*) from drizzle.__drizzle_migrations')
test "$migration_count" -gt 0
wait_for_worker_pass "$restored"
echo "Docker smoke checks passed, including independent liveness, persistent data, and worker modes"
