#!/usr/bin/env bash
set -Eeuo pipefail

umask 027

APP_ROOT="${APP_ROOT:-/var/www/play.xedoc.ru}"
REPO_URL="${REPO_URL:-https://github.com/WizardJIOCb/play.xedoc.ru.git}"
BRANCH="${BRANCH:-main}"
SERVICE_NAME="${SERVICE_NAME:-play.xedoc.ru.service}"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-http://127.0.0.1:3037/api/health}"
RELEASES_TO_KEEP="${RELEASES_TO_KEEP:-3}"

REPOSITORY_DIR="$APP_ROOT/repository"
RELEASES_DIR="$APP_ROOT/releases"
SHARED_DIR="$APP_ROOT/shared"
VENV_CACHE_DIR="$SHARED_DIR/venvs"
CURRENT_LINK="$APP_ROOT/current"

fail() {
    printf 'deploy error: %s\n' "$*" >&2
    exit 1
}

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    fail "run as root"
fi

# All destructive cleanup and symlink operations below are constrained to this exact root.
[[ "$APP_ROOT" == "/var/www/play.xedoc.ru" ]] || fail "unexpected APP_ROOT: $APP_ROOT"
[[ "$RELEASES_TO_KEEP" =~ ^[0-9]+$ ]] || fail "RELEASES_TO_KEEP must be an integer"
((RELEASES_TO_KEEP >= 2)) || fail "RELEASES_TO_KEEP must be at least 2"

for command_name in chmod chown curl find flock git install ln mv npm python3 readlink rm sleep sort systemctl tar; do
    command -v "$command_name" >/dev/null 2>&1 || fail "missing command: $command_name"
done

exec 9>/run/lock/play.xedoc.ru.deploy.lock
flock -n 9 || fail "another deployment is already running"

[[ -r /etc/play.xedoc.ru/backend.env ]] || fail "missing /etc/play.xedoc.ru/backend.env"
systemctl cat "$SERVICE_NAME" >/dev/null 2>&1 || fail "systemd unit $SERVICE_NAME is not installed"

install -d -m 0755 "$APP_ROOT" "$RELEASES_DIR"
install -d -m 0750 -o www-data -g www-data "$SHARED_DIR" "$SHARED_DIR/data"
install -d -m 0755 "$VENV_CACHE_DIR"

if [[ ! -d "$REPOSITORY_DIR/.git" ]]; then
    [[ ! -e "$REPOSITORY_DIR" ]] || fail "$REPOSITORY_DIR exists but is not a git repository"
    git clone --filter=blob:none --no-checkout "$REPO_URL" "$REPOSITORY_DIR"
else
    actual_origin="$(git -C "$REPOSITORY_DIR" remote get-url origin)"
    [[ "$actual_origin" == "$REPO_URL" ]] || fail "unexpected origin: $actual_origin"
fi

git -C "$REPOSITORY_DIR" fetch --prune origin "$BRANCH"
commit_sha="$(git -C "$REPOSITORY_DIR" rev-parse --verify 'FETCH_HEAD^{commit}')"
release_dir="$RELEASES_DIR/$commit_sha"

if [[ ! -f "$release_dir/.release-ready" ]]; then
    [[ ! -e "$release_dir" ]] || fail "incomplete release already exists: $release_dir"

    staging_dir="$RELEASES_DIR/.staging-$commit_sha-$$"
    venv_build_dir=""
    [[ ! -e "$staging_dir" ]] || fail "staging path already exists: $staging_dir"
    install -d -m 0755 "$staging_dir"

    cleanup_staging() {
        if [[ -n "${staging_dir:-}" && -d "$staging_dir" && "$staging_dir" == "$RELEASES_DIR"/.staging-* ]]; then
            rm -rf -- "$staging_dir"
        fi
        if [[ -n "${venv_build_dir:-}" && -d "$venv_build_dir" && ! -L "$venv_build_dir" && "$venv_build_dir" == "$VENV_CACHE_DIR"/* ]]; then
            rm -rf -- "$venv_build_dir"
        fi
    }
    trap cleanup_staging EXIT

    git -C "$REPOSITORY_DIR" archive "$commit_sha" | tar -x -C "$staging_dir"

    (
        cd "$staging_dir"
        npm ci --include=dev --no-audit --no-fund
        npm run build
    )

    if [[ -e "$staging_dir/node_modules" || -L "$staging_dir/node_modules" ]]; then
        [[ -d "$staging_dir/node_modules" && ! -L "$staging_dir/node_modules" ]] || fail "unexpected node_modules path"
        rm -rf -- "$staging_dir/node_modules"
    fi

    [[ -f "$staging_dir/backend/requirements.txt" ]] || fail "backend/requirements.txt is missing"
    [[ -f "$staging_dir/backend/constraints.txt" ]] || fail "backend/constraints.txt is missing"

    dependency_key="$(
        python3 - "$staging_dir/backend/requirements.txt" "$staging_dir/backend/constraints.txt" <<'PY'
import hashlib
from pathlib import Path
import sys
import sysconfig

digest = hashlib.sha256()
digest.update(sys.version.encode("utf-8"))
digest.update(b"\0")
digest.update(sysconfig.get_platform().encode("utf-8"))
digest.update(b"\0")
for raw_path in sys.argv[1:]:
    path = Path(raw_path)
    digest.update(path.name.encode("utf-8"))
    digest.update(b"\0")
    digest.update(path.read_bytes())
    digest.update(b"\0")
print(digest.hexdigest())
PY
    )"
    [[ "$dependency_key" =~ ^[0-9a-f]{64}$ ]] || fail "invalid Python dependency cache key"
    venv_path="$VENV_CACHE_DIR/$dependency_key"

    if [[ -e "$venv_path" || -L "$venv_path" ]]; then
        [[ -d "$venv_path" && ! -L "$venv_path" && -f "$venv_path/.venv-ready" ]] || fail "incomplete Python environment cache: $venv_path"
        printf 'reusing Python environment %s\n' "$dependency_key"
    else
        printf 'building Python environment %s\n' "$dependency_key"
        venv_build_dir="$venv_path"
        install -d -m 0755 "$venv_build_dir"
        python3 -m venv "$venv_build_dir"
        "$venv_build_dir/bin/python" -m pip install \
            --disable-pip-version-check \
            --constraint "$staging_dir/backend/constraints.txt" \
            --requirement "$staging_dir/backend/requirements.txt"
        printf '%s\n' "$dependency_key" >"$venv_build_dir/.venv-ready"
        chown -R root:root "$venv_build_dir"
        chmod -R u=rwX,go=rX "$venv_build_dir"
        venv_build_dir=""
    fi

    ln -s "$venv_path" "$staging_dir/backend/.venv"

    [[ -f "$staging_dir/dist/index.html" ]] || fail "frontend build did not create dist/index.html"
    [[ -f "$staging_dir/backend/app/main.py" ]] || fail "backend entrypoint backend/app/main.py is missing"

    printf '%s\n' "$commit_sha" >"$staging_dir/.release-ready"
    chown -R root:root "$staging_dir"
    chmod -R u=rwX,go=rX "$staging_dir"
    mv -- "$staging_dir" "$release_dir"
    staging_dir=""
    trap - EXIT
fi

prune_old_releases() {
    local active_release="$1"
    local kept_previous=0
    local release_entry
    local release_name
    local release_path

    [[ "$active_release" == "$RELEASES_DIR"/* && -d "$active_release" ]] || fail "refusing to prune with invalid active release: $active_release"

    while IFS= read -r release_entry; do
        release_path="${release_entry#* }"
        release_name="${release_path##*/}"

        [[ "$release_name" =~ ^[0-9a-f]{40}$ ]] || continue
        [[ -d "$release_path" && ! -L "$release_path" && -f "$release_path/.release-ready" ]] || continue
        [[ "$release_path" != "$active_release" ]] || continue

        if ((kept_previous < RELEASES_TO_KEEP - 1)); then
            ((kept_previous += 1))
            continue
        fi

        [[ "$release_path" == "$RELEASES_DIR"/* ]] || fail "refusing to remove unexpected release path: $release_path"
        rm -rf -- "$release_path"
        printf 'removed old release %s\n' "$release_name"
    done < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -nr)
}

previous_release=""
if [[ -L "$CURRENT_LINK" ]]; then
    previous_release="$(readlink -f "$CURRENT_LINK")"
elif [[ -e "$CURRENT_LINK" ]]; then
    fail "$CURRENT_LINK exists and is not a symlink"
fi

next_link="$APP_ROOT/.current-$commit_sha-$$"
ln -s "$release_dir" "$next_link"
mv -Tf "$next_link" "$CURRENT_LINK"

rollback() {
    printf 'health check failed; rolling back\n' >&2
    if [[ -n "$previous_release" && -d "$previous_release" && "$previous_release" == "$RELEASES_DIR"/* ]]; then
        rollback_link="$APP_ROOT/.current-rollback-$$"
        ln -s "$previous_release" "$rollback_link"
        mv -Tf "$rollback_link" "$CURRENT_LINK"
        systemctl restart "$SERVICE_NAME" || true
    else
        rm -f -- "$CURRENT_LINK"
        systemctl stop "$SERVICE_NAME" || true
    fi
    systemctl status "$SERVICE_NAME" --no-pager || true
    exit 1
}

systemctl restart "$SERVICE_NAME" || rollback

healthy=false
for ((attempt = 1; attempt <= 30; attempt++)); do
    if curl --fail --silent --show-error --max-time 3 "$HEALTHCHECK_URL" >/dev/null; then
        healthy=true
        break
    fi
    sleep 1
done

[[ "$healthy" == true ]] || rollback

active_release="$(readlink -f "$CURRENT_LINK")"
[[ "$active_release" == "$release_dir" ]] || fail "current release changed unexpectedly: $active_release"
prune_old_releases "$active_release"

printf 'deployed %s\n' "$commit_sha"
printf 'release: %s\n' "$release_dir"
printf 'health:  %s\n' "$HEALTHCHECK_URL"
