set -uo pipefail

# ---------- config ----------
REPO_DIR="${REPO_DIR:-$(cd "$(dirname "$0")" && pwd)}"
INTERVAL="${INTERVAL:-60}"
BRANCH="${BRANCH:-}"                       # empty = whichever branch is checked out
BACKEND_PM2_NAME="${BACKEND_PM2_NAME:-backend}"

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
    log "backend changed, restarting $BACKEND_PM2_NAME via pm2"
    if ! pm2 restart "$BACKEND_PM2_NAME"; then
      log "pm2 restart failed"
    fi
  fi

  log "deploy complete for $AFTER"
  sleep "$INTERVAL"
done
