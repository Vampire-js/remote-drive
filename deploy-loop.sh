set -uo pipefail

# Poll git for new commits and redeploy on change. Skips work when unchanged.
# Manages the backend directly (no pm2) via a PID file + SIGTERM/SIGKILL.
#
# Env vars (all optional):
#   REPO_DIR         path to repo (default: this script's directory)
#   INTERVAL         seconds between poll cycles (default: 60)
#   BRANCH           branch to track (default: currently-checked-out branch)
#   BACKEND_CMD      command to start the backend (default: "npm start")
#   BACKEND_DIR      cwd for backend command (default: $REPO_DIR/backend)
#   BACKEND_PID_FILE where to remember the backend pid (default: $REPO_DIR/.backend.pid)
#   BACKEND_LOG_FILE where to append backend stdout/stderr (default: $REPO_DIR/.backend.log)
#   STOP_GRACE_SECS  seconds to wait for graceful SIGTERM before SIGKILL (default: 10)

# ---------- config ----------
REPO_DIR="${REPO_DIR:-$(cd "$(dirname "$0")" && pwd)}"
INTERVAL="${INTERVAL:-60}"
BRANCH="${BRANCH:-}"                       # empty = whichever branch is checked out
BACKEND_CMD="${BACKEND_CMD:-npm start}"
BACKEND_DIR="${BACKEND_DIR:-$REPO_DIR/backend}"
BACKEND_PID_FILE="${BACKEND_PID_FILE:-$REPO_DIR/.backend.pid}"
BACKEND_LOG_FILE="${BACKEND_LOG_FILE:-$REPO_DIR/.backend.log}"
STOP_GRACE_SECS="${STOP_GRACE_SECS:-10}"

# ---------- helpers ----------
log() {
  printf '[deploy %s] %s\n' "$(date +'%Y-%m-%d %H:%M:%S')" "$*"
}

# Portable "did anything under these paths change between commits A and B?"
# Returns 0 if paths changed, 1 if not. `git diff --quiet` is the reverse.
changed_in() {
  local before="$1"
  local after="$2"
  shift 2
  ! git diff --quiet "$before" "$after" -- "$@"
}

# Is the backend currently running (per the PID file)?
backend_running() {
  [ -f "$BACKEND_PID_FILE" ] || return 1
  local pid
  pid="$(cat "$BACKEND_PID_FILE" 2>/dev/null)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

# Stop the backend gracefully: SIGTERM, then SIGKILL if it's still alive after
# STOP_GRACE_SECS. Uses process-group kill so any child processes (npm run
# child forks) go down with it.
stop_backend() {
  [ -f "$BACKEND_PID_FILE" ] || return 0
  local pid pgid
  pid="$(cat "$BACKEND_PID_FILE" 2>/dev/null)"
  [ -n "$pid" ] || return 0

  if ! kill -0 "$pid" 2>/dev/null; then
    rm -f "$BACKEND_PID_FILE"
    return 0
  fi

  # Try to grab the process group id so we take out `npm` + the `node`
  # child it spawned in one shot. Falls back to killing just the pid.
  pgid="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')"

  if [ -n "$pgid" ]; then
    kill -TERM -"$pgid" 2>/dev/null || true
  else
    kill -TERM "$pid" 2>/dev/null || true
  fi

  local waited=0
  while kill -0 "$pid" 2>/dev/null && [ "$waited" -lt "$STOP_GRACE_SECS" ]; do
    sleep 1
    waited=$((waited + 1))
  done

  if kill -0 "$pid" 2>/dev/null; then
    log "backend didn't stop after ${STOP_GRACE_SECS}s, sending SIGKILL"
    if [ -n "$pgid" ]; then
      kill -KILL -"$pgid" 2>/dev/null || true
    else
      kill -KILL "$pid" 2>/dev/null || true
    fi
  fi

  rm -f "$BACKEND_PID_FILE"
}

# Launch backend detached in its own session so it survives this script
# and stays under a single process group for clean shutdown later.
start_backend() {
  ( cd "$BACKEND_DIR" && setsid nohup $BACKEND_CMD >> "$BACKEND_LOG_FILE" 2>&1 < /dev/null & echo $! > "$BACKEND_PID_FILE" )
  log "backend started (pid $(cat "$BACKEND_PID_FILE" 2>/dev/null)); logs at $BACKEND_LOG_FILE"
}

restart_backend() {
  stop_backend
  start_backend
}

# ---------- setup ----------
cd "$REPO_DIR" || {
  echo "REPO_DIR ($REPO_DIR) is not accessible" >&2
  exit 1
}

if [ ! -d .git ]; then
  echo "$REPO_DIR is not a git repository" >&2
  exit 1
fi

# Resolve the branch we're tracking, if not explicitly set.
if [ -z "$BRANCH" ]; then
  BRANCH="$(git rev-parse --abbrev-ref HEAD)"
fi

log "watching $REPO_DIR on branch '$BRANCH' every ${INTERVAL}s"

# Make sure the backend is running when the loop first starts. If we crashed
# or the phone rebooted, this brings it back up before we start polling.
if ! backend_running; then
  log "backend not running, starting it"
  start_backend
fi

# ---------- main loop ----------
while true; do
  BEFORE="$(git rev-parse HEAD)"

  # Fetch quietly; if the network is down or upstream is unreachable we just
  # skip this cycle without spamming errors.
  if ! git fetch --quiet origin "$BRANCH" 2>/dev/null; then
    log "fetch failed, will retry"
    sleep "$INTERVAL"
    continue
  fi

  REMOTE="$(git rev-parse "origin/$BRANCH")"

  # No new commits — nothing to do.
  if [ "$BEFORE" = "$REMOTE" ]; then
    sleep "$INTERVAL"
    continue
  fi

  log "new commits detected: $BEFORE -> $REMOTE"

  # Fast-forward only. If someone force-pushed or your local has diverged,
  # this refuses so we don't silently discard work. Fix it manually then.
  if ! git merge --ff-only "origin/$BRANCH" 2>&1; then
    log "cannot fast-forward, human intervention needed"
    sleep "$INTERVAL"
    continue
  fi

  AFTER="$(git rev-parse HEAD)"

  # --- root npm deps ---
  if changed_in "$BEFORE" "$AFTER" package.json package-lock.json; then
    log "root dependencies changed, running npm ci"
    if ! npm ci; then
      log "npm ci failed at repo root, aborting this cycle"
      sleep "$INTERVAL"
      continue
    fi
  fi

  # --- backend npm deps ---
  if changed_in "$BEFORE" "$AFTER" backend/package.json backend/package-lock.json; then
    log "backend dependencies changed, running npm ci in backend/"
    if ! (cd backend && npm ci); then
      log "npm ci failed in backend/, aborting this cycle"
      sleep "$INTERVAL"
      continue
    fi
  fi

  # --- frontend rebuild ---
  # Rebuild only when a file that ends up in dist/ has changed.
  if changed_in "$BEFORE" "$AFTER" src/ public/ index.html vite.config.ts tsconfig.json package.json package-lock.json; then
    log "frontend sources changed, running npm run build"
    if ! npm run build; then
      log "npm run build failed, aborting this cycle"
      sleep "$INTERVAL"
      continue
    fi
  fi

  # --- backend restart ---
  # Only restart if backend code or its deps changed. Frontend-only updates
  # don't require restarting Node — the new dist/ is picked up on next browser
  # request via express.static.
  if changed_in "$BEFORE" "$AFTER" backend/; then
    log "backend changed, restarting"
    restart_backend
  fi

  log "deploy complete for $AFTER"
  sleep "$INTERVAL"
done
