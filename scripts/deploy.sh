#!/usr/bin/env bash
# Build InstaFlow as a standalone bundle and deploy it to a VPS running it under systemd.
#
#   npm run deploy                 (settings from .deploy.env, see .deploy.env.example)
#   npm run deploy -- --skip-checks --skip-migrate
#
# Steps: typecheck + unit tests → build → database migrations (through an SSH tunnel) →
# upload → swap releases → restart → health check (automatic rollback if it fails).
#
# Settings (.deploy.env, or environment variables, which take precedence):
#   DEPLOY_HOST   ssh target (required)
#   PUBLIC_URL    public origin, e.g. https://example.com (required)
#   BASE_PATH     sub-path the app is served under (default /instaflow; "" for the domain root)
#   APP_DIR       install dir on the server          (default /var/www/instaflow)
#   SERVICE       systemd unit name                  (default instaflow)
#   ENV_FILE      server env file with DATABASE_URL  (default /etc/instaflow/instaflow.env)
#   APP_PORT      port the service listens on        (default 3200)
#
# Flags:
#   --skip-checks    don't run typecheck and tests first
#   --skip-migrate   don't run `prisma migrate deploy` (it's a no-op when nothing is pending)
#
# The new release is unpacked next to the live one and swapped in; the previous release is kept
# as $APP_DIR.prev and restored automatically if the health check fails.
set -euo pipefail
export MSYS_NO_PATHCONV=1 MSYS2_ENV_CONV_EXCL='*' # Git Bash on Windows: don't rewrite /paths
cd "$(dirname "$0")/.."

# Load .deploy.env; variables already set in the environment win.
if [[ -f .deploy.env ]]; then
  while IFS='=' read -r key value; do
    [[ "$key" =~ ^[A-Z_][A-Z0-9_]*$ ]] || continue
    # Strip one pair of surrounding quotes.
    if [[ "$value" =~ ^\"(.*)\"$ || "$value" =~ ^\'(.*)\'$ ]]; then value="${BASH_REMATCH[1]}"; fi
    if [[ -z "${!key+x}" ]]; then export "$key=$value"; fi
  done < <(grep -vE '^[[:space:]]*(#|$)' .deploy.env | tr -d '\r')
fi

: "${DEPLOY_HOST:?Set DEPLOY_HOST in .deploy.env (copy .deploy.env.example)}"
: "${PUBLIC_URL:?Set PUBLIC_URL in .deploy.env (copy .deploy.env.example)}"
BASE_PATH="${BASE_PATH-/instaflow}"
APP_DIR="${APP_DIR:-/var/www/instaflow}"
SERVICE="${SERVICE:-instaflow}"
ENV_FILE="${ENV_FILE:-/etc/instaflow/instaflow.env}"
APP_PORT="${APP_PORT:-3200}"
CHECKS=true
MIGRATE=true
for arg in "$@"; do
  case "$arg" in
    --skip-checks) CHECKS=false ;;
    --skip-migrate) MIGRATE=false ;;
    --migrate) ;; # default now; kept for compatibility
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

echo "==> Checking SSH access to $DEPLOY_HOST"
ssh -o BatchMode=yes -o ConnectTimeout=10 "$DEPLOY_HOST" "systemctl cat '$SERVICE' >/dev/null && test -f '$ENV_FILE'" || {
  echo "    Can't reach $DEPLOY_HOST without a password, or the server isn't set up ($SERVICE service / $ENV_FILE)." >&2
  echo "    See README → \"Your own server (VPS)\"." >&2
  exit 1
}

if $CHECKS; then
  echo "==> Typecheck and unit tests"
  npm run -s typecheck
  npm test --silent >/dev/null || { echo "    Unit tests failed (run npm test to see why)." >&2; exit 1; }
fi

BUNDLE="$(mktemp -u -t instaflow-XXXXXX).tgz"
trap 'rm -f "$BUNDLE"' EXIT

echo "==> Building (BASE_PATH=${BASE_PATH:-<root>}, PUBLIC_URL=$PUBLIC_URL)"
BASE_PATH="$BASE_PATH" PUBLIC_URL="$PUBLIC_URL" npm run -s build:standalone

echo "==> Packaging"
# sharp is only used by next/image (not used here) and its binaries are platform-specific.
tar --force-local -C .next/standalone --exclude='./node_modules/@img' --exclude='./node_modules/sharp' \
  --exclude='./.env*' -czf "$BUNDLE" .
echo "    $(wc -c < "$BUNDLE") bytes"

if $MIGRATE; then
  echo "==> Migrating database through an SSH tunnel"
  DB_URL=$(ssh "$DEPLOY_HOST" "sed -nE \"s/^DATABASE_URL='?([^']*)'?\$/\\1/p\" '$ENV_FILE'")
  DB_HOSTPORT=$(sed -E 's#^[a-z]+://[^@]*@([^/]+)/.*#\1#' <<<"$DB_URL")
  LOCAL_PORT=15433
  ssh -o ExitOnForwardFailure=yes -N -L "$LOCAL_PORT:$DB_HOSTPORT" "$DEPLOY_HOST" &
  TUNNEL=$!
  trap 'kill $TUNNEL 2>/dev/null; rm -f "$BUNDLE"' EXIT
  sleep 3
  TUNNEL_URL=$(sed -E "s#@[^/]+/#@127.0.0.1:$LOCAL_PORT/#" <<<"$DB_URL")
  DATABASE_URL="$TUNNEL_URL" DIRECT_URL="$TUNNEL_URL" npx prisma migrate deploy
  kill $TUNNEL 2>/dev/null || true
fi

echo "==> Uploading"
scp -q "$BUNDLE" "$DEPLOY_HOST:/tmp/instaflow-release.tgz"

echo "==> Installing and restarting $SERVICE"
ssh "$DEPLOY_HOST" APP_DIR="$APP_DIR" SERVICE="$SERVICE" APP_PORT="$APP_PORT" BASE_PATH="$BASE_PATH" 'bash -s' <<'REMOTE'
set -euo pipefail
NEW="$APP_DIR.new"; PREV="$APP_DIR.prev"
rm -rf "$NEW"; mkdir -p "$NEW"
tar -xzf /tmp/instaflow-release.tgz -C "$NEW" --no-same-owner
rm -f /tmp/instaflow-release.tgz
chown -R root:root "$NEW"; chmod -R u=rwX,go=rX "$NEW"
install -d -m 0750 -o "$SERVICE" -g "$SERVICE" "$NEW/.next/cache"

rm -rf "$PREV"
[ -d "$APP_DIR" ] && mv "$APP_DIR" "$PREV"
mv "$NEW" "$APP_DIR"
systemctl restart "$SERVICE"

ok=false
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$APP_PORT$BASE_PATH/login" || true)
  [ "$code" = "200" ] && { ok=true; break; }
  sleep 1
done
if $ok; then
  echo "    healthy (GET $BASE_PATH/login -> 200)"
else
  echo "    HEALTH CHECK FAILED — rolling back" >&2
  journalctl -u "$SERVICE" -n 30 --no-pager -o cat >&2 || true
  if [ -d "$PREV" ]; then rm -rf "$APP_DIR"; mv "$PREV" "$APP_DIR"; systemctl restart "$SERVICE"; fi
  exit 1
fi
REMOTE
echo "==> Deployed: $PUBLIC_URL$BASE_PATH"
