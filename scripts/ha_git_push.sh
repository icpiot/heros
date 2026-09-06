#!/bin/bash

resolve_config_dir() {
  if [ -n "${CONFIG_DIR:-}" ] && [ -d "$CONFIG_DIR" ]; then
    printf '%s\n' "$CONFIG_DIR"
    return 0
  fi

  if [ -d /config ]; then
    printf '%s\n' /config
    return 0
  fi

  if [ -d /h ]; then
    printf '%s\n' /h
    return 0
  fi

  printf '%s\n' "${CONFIG_DIR:-/config}"
  return 1
}

CONFIG_DIR="$(resolve_config_dir)"
REPO_DIR="${REPO_DIR:-$CONFIG_DIR/repos/heros}"

detach_if_running_from_repo() {
  if [ -n "${HEROS_SCRIPT_DETACHED:-}" ]; then
    return 0
  fi

  local script_source script_abs script_dir tmp_script
  script_source="${BASH_SOURCE[0]:-$0}"
  if command -v realpath >/dev/null 2>&1; then
    script_abs="$(realpath "$script_source" 2>/dev/null || printf '%s\n' "$script_source")"
  else
    script_dir="$(cd "$(dirname "$script_source")" 2>/dev/null && pwd)"
    script_abs="$script_dir/$(basename "$script_source")"
  fi

  case "$script_abs" in
    "$REPO_DIR"/*)
      tmp_script="$(mktemp "${TMPDIR:-/tmp}/heros-git-push.XXXXXX.sh")"
      cp "$script_abs" "$tmp_script"
      chmod +x "$tmp_script"
      export HEROS_SCRIPT_DETACHED=1
      exec bash "$tmp_script" "$@"
      ;;
  esac
}

detach_if_running_from_repo "$@"

cd "$CONFIG_DIR" || exit 1

PROJECT_NAME="${PROJECT_NAME:-HEROS}"
PROJECT_SLUG="${PROJECT_SLUG:-heros}"
TOKEN_FILE="${TOKEN_FILE:-$CONFIG_DIR/.github_pat}"
LOG_DIR="${LOG_DIR:-$CONFIG_DIR/www/ha-git}"
LOG="${LOG:-$LOG_DIR/${PROJECT_SLUG}_git_last.txt}"
SCRIPT_BUILD="${SCRIPT_BUILD:-2026-07-17.01}"
REPO_URL="${REPO_URL:-github.com/icpiot/heros.git}"
REPO_DIR="${REPO_DIR:-$CONFIG_DIR/repos/heros}"
BRANCH="${GIT_BRANCH:-main}"

mkdir -p "$LOG_DIR"

trust_repo_directory() {
  git config --global --add safe.directory "$REPO_DIR" >/dev/null 2>&1 || true
}

normalize_repo_checkout() {
  git -C "$REPO_DIR" config core.autocrlf false
  git -C "$REPO_DIR" config core.eol lf
}

{
  echo "=============================="
  echo "$PROJECT_NAME Git Push"
  echo "Started: $(date '+%Y-%m-%d %H:%M:%S %Z')"
  echo "Repo: $REPO_DIR"
  echo "Branch: $BRANCH"
  echo "Script Build: $SCRIPT_BUILD"
  echo "Auth: HTTPS token file"
  echo "Mode: current branch"
  echo "Log: $LOG"
  echo "=============================="
  echo ""

  if [ ! -d "$REPO_DIR/.git" ]; then
    echo "ERROR: repo clone not found: $REPO_DIR"
    exit 1
  fi

  trust_repo_directory
  normalize_repo_checkout

  if [ ! -f "$TOKEN_FILE" ]; then
    echo "ERROR: Token file missing: $TOKEN_FILE"
    exit 1
  fi

  TOKEN=$(tr -d '[:space:]' < "$TOKEN_FILE")
  if [ -z "$TOKEN" ]; then
    echo "ERROR: Token file is empty."
    exit 1
  fi

  AUTH_REMOTE="https://icpiot:${TOKEN}@${REPO_URL}"

  echo "Fetching remote branch..."
  git -C "$REPO_DIR" fetch "$AUTH_REMOTE" "$BRANCH" || exit 1

  echo "Checking out target branch..."
  git -C "$REPO_DIR" checkout -B "$BRANCH" FETCH_HEAD || exit 1

  LOCAL=$(git -C "$REPO_DIR" rev-parse HEAD)
  REMOTE=$(git -C "$REPO_DIR" rev-parse FETCH_HEAD)

  echo "Local:  $LOCAL"
  echo "Remote: $REMOTE"
  echo ""

  if [ "$LOCAL" != "$REMOTE" ]; then
    echo "ERROR: Local branch is not aligned with remote branch."
    echo "Run Git Pull first before pushing."
    exit 1
  fi

  echo "Checking for changes..."
  CHANGES=$(git -C "$REPO_DIR" status --porcelain)

  if [ -z "$CHANGES" ]; then
    echo "Nothing to commit. Working tree clean."
    exit 0
  fi

  echo "Changes found:"
  git -C "$REPO_DIR" status --short
  echo ""
  echo "Staging the full repository tree..."

  git -C "$REPO_DIR" add -A

  echo ""
  echo "Staged changes:"
  git -C "$REPO_DIR" diff --cached --name-status
  echo ""

  if [ -z "$(git -C "$REPO_DIR" diff --cached --name-only)" ]; then
    echo "No changes were staged. Push cancelled."
    exit 1
  fi

  MSG="$PROJECT_NAME repo sync $(date '+%Y-%m-%d %H:%M:%S %Z')"

  echo "Committing: $MSG"
  git -C "$REPO_DIR" commit -m "$MSG" || exit 1

  echo ""
  echo "Pushing to remote branch $BRANCH..."
  git -C "$REPO_DIR" push "$AUTH_REMOTE" "$BRANCH" || exit 1

  echo ""
  echo "Push complete."
  echo "Finished: $(date '+%Y-%m-%d %H:%M:%S %Z')"
} > "$LOG" 2>&1

cat "$LOG"
