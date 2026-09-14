#!/usr/bin/env bash
#
# Break-glass admin password reset for the Multi Proxy backend.
# Runs the reset inside the backend container and prints a clear success/failure.
#
# Usage:
#   ./reset-password.sh 'NEW_PASSWORD'                 # resets user "admin"
#   ./reset-password.sh 'NEW_PASSWORD' someuser        # resets a specific user
#   ./reset-password.sh 'NEW_PASSWORD' admin --create  # create the account if missing
#   ./reset-password.sh 'NEW_PASSWORD' admin --unlock  # also clear a lock / reactivate
#   ./reset-password.sh --list                         # list accounts (changes nothing)
#
# Env overrides (rarely needed):
#   SERVICE=backend                        compose service name
#   COMPOSE_FILE=docker-compose.prod.yml   compose file (auto-detected if unset)
#
# Note: the password is passed as an argument, so it will appear in your shell
# history and briefly in `ps`. Prefix the command with a space to skip history,
# or reset from the app once you're back in.

set -eo pipefail

# Always run from this script's own directory so the compose file is found
# (on the droplet this script and docker-compose.prod.yml both live in ~).
cd "$(dirname "$0")"

SERVICE="${SERVICE:-backend}"

# Choose the compose file: explicit env wins, else prefer the prod file.
if [ -n "${COMPOSE_FILE:-}" ]; then
  COMPOSE_ARGS=(-f "$COMPOSE_FILE")
elif [ -f docker-compose.prod.yml ]; then
  COMPOSE_ARGS=(-f docker-compose.prod.yml)
elif [ -f docker-compose.yml ]; then
  COMPOSE_ARGS=()
else
  echo "✖ No docker-compose file found in $(pwd). Set COMPOSE_FILE=... and retry." >&2
  exit 1
fi

# --list: just show the accounts, no change, no password needed.
if [ "${1:-}" = "--list" ]; then
  docker compose "${COMPOSE_ARGS[@]}" exec -T "$SERVICE" npm run admin:reset -- --list
  exit $?
fi

PASSWORD="${1:-}"
if [ -z "$PASSWORD" ]; then
  echo "✖ Usage: $0 'NEW_PASSWORD' [username] [--create] [--unlock] [--make-admin]" >&2
  echo "         $0 --list" >&2
  exit 2
fi
shift

# Optional username (defaults to "admin") if the next arg isn't a flag.
USERNAME="admin"
if [ -n "${1:-}" ] && [ "${1#-}" = "${1:-}" ]; then
  USERNAME="$1"; shift
fi

# Anything left (--create, --unlock, --make-admin, --role ...) passes straight through.
echo "→ Resetting password for \"$USERNAME\" (service: $SERVICE)…"

if docker compose "${COMPOSE_ARGS[@]}" exec -T "$SERVICE" \
     npm run admin:reset -- --user "$USERNAME" --password "$PASSWORD" "$@"; then
  echo "✔ Success — \"$USERNAME\" can now log in with the new password. Change it from the app afterwards."
else
  code=$?
  echo "✖ Failed (exit $code). Is the backend container running?  docker compose ${COMPOSE_ARGS[*]} ps" >&2
  exit "$code"
fi
