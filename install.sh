#!/usr/bin/env bash
# =============================================================================
#  The Only API - one-command installer for a bare Ubuntu 22.04 / 24.04 server
# =============================================================================
#
#  Target: a fresh Hetzner CX23 (2 vCPU / 4 GB / 40 GB) or anything comparable.
#  Also fine on DigitalOcean, Vultr, Linode, Netcup, OVH, Contabo, Scaleway.
#
#  What it does, in order:
#    1. Sanity-checks the OS, privileges and available memory
#    2. Adds swap if the box has under ~6 GB of RAM (`next build` needs it)
#    3. Installs Docker Engine + the compose plugin (skipped if present)
#    4. Asks for your domain (a 2captcha key is optional and can wait)
#    5. Generates SECRET_KEY, ENCRYPTION_KEY and NEXTAUTH_SECRET
#    6. Writes .env from .env.example - and REFUSES to touch an existing one
#    7. Opens ports 80/443 (or 3000 without TLS) if ufw is active
#    8. Builds and starts api + web + Caddy (automatic Let's Encrypt TLS)
#
#  Safe to re-run. Every step checks whether it has already been done.
#
#  USAGE
#      sudo ./install.sh
#
#  Unattended (skips every prompt):
#      sudo APP_DOMAIN=crm.example.com ./install.sh
#      sudo APP_DOMAIN=crm.example.com TWOCAPTCHA_API_KEY=xxxx ./install.sh
#
#  WHERE TO RUN IT
#      From the repository root - the directory holding docker-compose.yml,
#      api/ and web/. That is where this script and every other deployment
#      file lives.
#
#  BEFORE YOU RUN IT
#    - Point an A record for your domain at this server's IPv4 address.
#      Caddy cannot issue a certificate until DNS resolves here.
#
#  YOU DO NOT NEED A CAPTCHA KEY TO INSTALL.
#      The stack starts, the dashboard loads and you can create your account
#      without one. A 2captcha key is only needed before you connect an
#      OnlyFans account, because OnlyFans gates login behind a Cloudflare
#      Turnstile challenge that has to be solved and paid for. Add it later
#      in the panel under Settings -> Captcha provider, which validates the
#      key with the provider before saving it.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ENV_FILE="$SCRIPT_DIR/.env"
ENV_EXAMPLE="$SCRIPT_DIR/.env.example"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"

# --- output helpers ----------------------------------------------------------
if [ -t 1 ]; then
    C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'
    C_BLUE=$'\033[34m'; C_GREEN=$'\033[32m'
    C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'
else
    C_RESET=''; C_BOLD=''; C_BLUE=''; C_GREEN=''; C_YELLOW=''; C_RED=''
fi

step() { printf '\n%s==>%s %s%s%s\n' "$C_BLUE" "$C_RESET" "$C_BOLD" "$1" "$C_RESET"; }
ok()   { printf '    %sok%s   %s\n' "$C_GREEN" "$C_RESET" "$1"; }
skip() { printf '    skip %s\n' "$1"; }
warn() { printf '    %swarn%s %s\n' "$C_YELLOW" "$C_RESET" "$1"; }
die()  { printf '\n%serror:%s %s\n\n' "$C_RED" "$C_RESET" "$1" >&2; exit 1; }


# =============================================================================
step "Checking the environment"
# =============================================================================

[ "$(id -u)" -eq 0 ] || die "Run as root:  sudo ./install.sh"

[ -f "$ENV_EXAMPLE" ]   || die "No .env.example next to this script. Run it from the directory it ships in."
[ -f "$COMPOSE_FILE" ]  || die "No docker-compose.yml next to this script."

# The deployment files live at the REPOSITORY ROOT. The backend source is in
# ./api (the build context for Dockerfile) and the dashboard in ./web (the
# build context for Dockerfile.web). If either is missing this is the wrong
# directory or an incomplete checkout, and the build would otherwise fail
# minutes later with a confusing Docker error instead of here.
[ -d "$SCRIPT_DIR/api" ] || die "No ./api directory here. Run install.sh from the repository root - the directory holding docker-compose.yml, api/ and web/."
[ -d "$SCRIPT_DIR/web" ] || die "No ./web directory here. Run install.sh from the repository root - the directory holding docker-compose.yml, api/ and web/."
[ -f "$SCRIPT_DIR/Dockerfile" ]     || die "No Dockerfile next to this script."
[ -f "$SCRIPT_DIR/Dockerfile.web" ] || die "No Dockerfile.web next to this script."

if [ -r /etc/os-release ]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    case "${ID:-}:${VERSION_ID:-}" in
        ubuntu:22.04|ubuntu:24.04) ok "Ubuntu ${VERSION_ID}" ;;
        ubuntu:*|debian:*)         warn "Untested on ${PRETTY_NAME:-this release}; continuing." ;;
        *)                         warn "Not Ubuntu or Debian (${PRETTY_NAME:-unknown}); continuing, but you are off the tested path." ;;
    esac
else
    warn "Cannot identify the OS; continuing."
fi

ARCH="$(uname -m)"
case "$ARCH" in
    x86_64|aarch64) ok "Architecture ${ARCH}" ;;
    *) die "Unsupported architecture ${ARCH}. This stack needs x86_64 or aarch64." ;;
esac


# =============================================================================
step "Checking memory and swap"
# =============================================================================
# `next build` is the memory-hungry step. On a 4 GB box with no swap it gets
# OOM-killed part way through and the failure looks like a mysterious
# "exit code 137" from the web build.

MEM_MB=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)
SWAP_MB=$(awk '/SwapTotal/ {printf "%d", $2/1024}' /proc/meminfo)
ok "RAM ${MEM_MB} MB, swap ${SWAP_MB} MB"

if [ "$MEM_MB" -lt 6000 ] && [ "$SWAP_MB" -lt 2000 ]; then
    if [ -f /swapfile ]; then
        warn "/swapfile exists but is not active; leaving it alone."
    else
        step "Adding a 4 GB swapfile (needed for the Next.js build on a small box)"
        fallocate -l 4G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=4096
        chmod 600 /swapfile
        mkswap /swapfile >/dev/null
        swapon /swapfile
        grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
        ok "Swap enabled and persisted in /etc/fstab"
    fi
else
    skip "enough memory or swap already present"
fi


# =============================================================================
step "Installing Docker"
# =============================================================================

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    skip "Docker $(docker --version | awk '{print $3}' | tr -d ,) with the compose plugin is already installed"
else
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq ca-certificates curl gnupg

    install -m 0755 -d /etc/apt/keyrings
    if [ ! -f /etc/apt/keyrings/docker.asc ]; then
        curl -fsSL "https://download.docker.com/linux/${ID:-ubuntu}/gpg" -o /etc/apt/keyrings/docker.asc
        chmod a+r /etc/apt/keyrings/docker.asc
    fi

    # Written unconditionally: the contents are identical every run, so this is
    # idempotent, and it self-heals a half-finished previous attempt.
    cat > /etc/apt/sources.list.d/docker.list <<EOF
deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID:-ubuntu} ${VERSION_CODENAME:-jammy} stable
EOF

    apt-get update -qq
    apt-get install -y -qq \
        docker-ce docker-ce-cli containerd.io \
        docker-buildx-plugin docker-compose-plugin

    systemctl enable --now docker
    ok "Docker installed"
fi

docker compose version >/dev/null 2>&1 || die "The Docker compose plugin is missing. Install docker-compose-plugin and re-run."


# =============================================================================
step "Configuration"
# =============================================================================

if [ -f "$ENV_FILE" ]; then
    # --- THE CLOBBER GUARD ---------------------------------------------------
    # .env holds ENCRYPTION_KEY. Overwriting it makes every stored password and
    # bot token in the database permanently unreadable, with no recovery path.
    # So an existing .env is never rewritten, never merged, never touched -
    # the script moves straight on to bringing the stack up with it.
    warn ".env already exists - leaving it exactly as it is."
    warn "Nothing in it will be read, changed or regenerated by this script."
    warn "To start over: back up .env (it holds ENCRYPTION_KEY), delete it, re-run."
    APP_DOMAIN="$(sed -n 's/^APP_DOMAIN=//p' "$ENV_FILE" | head -n1)"
    APP_DOMAIN="${APP_DOMAIN:-localhost}"
    ok "Using APP_DOMAIN=${APP_DOMAIN} from the existing .env"

    # Whether to start Caddy is read back out of the existing .env rather than
    # defaulted to on. Re-running over a no-TLS install must not suddenly bind
    # :80/:443 and start asking Let's Encrypt for a certificate for what is
    # probably a bare IP address.
    EXISTING_URL="$(sed -n 's/^NEXTAUTH_URL=//p' "$ENV_FILE" | head -n1)"
    case "$EXISTING_URL" in
        https://*) USE_TLS=1 ;;
        *)         USE_TLS=0 ;;
    esac
    if [ "$USE_TLS" -eq 1 ]; then
        ok "Existing install uses TLS - Caddy will be started"
    else
        ok "Existing install is plain HTTP - Caddy will not be started"
    fi
else
    # --- domain ---------------------------------------------------------------
    APP_DOMAIN="${APP_DOMAIN:-}"
    if [ -z "$APP_DOMAIN" ]; then
        printf '\n'
        printf '    The domain you will open the dashboard at, e.g. crm.example.com\n'
        printf '    An A record for it must already point at this server, or Caddy\n'
        printf '    cannot issue a TLS certificate.\n'
        printf '    Leave blank to run on http://<this server> with no TLS.\n\n'
        read -r -p "    Domain: " APP_DOMAIN || APP_DOMAIN=""
    fi
    APP_DOMAIN="$(printf '%s' "$APP_DOMAIN" | tr -d '[:space:]')"

    if [ -n "$APP_DOMAIN" ]; then
        case "$APP_DOMAIN" in
            http://*|https://*) die "Enter the bare hostname, without http:// or https://" ;;
            */*)                die "Enter the bare hostname, without a path" ;;
        esac
        SCHEME="https"
        USE_TLS=1
    else
        APP_DOMAIN="$(hostname -I 2>/dev/null | awk '{print $1}')"
        [ -n "$APP_DOMAIN" ] || APP_DOMAIN="localhost"
        SCHEME="http"
        USE_TLS=0
        warn "No domain given. Running on http://${APP_DOMAIN}:3000 without TLS."
        warn "Credentials will cross the network in the clear. Do not use this for real accounts."
    fi

    # --- 2captcha (OPTIONAL) --------------------------------------------------
    # config.py reads TWOCAPTCHA_API_KEY with a default of '' and does NOT
    # require it at import, so the stack comes up without one. It is needed only
    # before an OnlyFans account can log in, and each panel can set its own key
    # from Settings -> Captcha provider. So this must never block the install.
    TWOCAPTCHA_API_KEY="${TWOCAPTCHA_API_KEY:-}"
    if [ -z "$TWOCAPTCHA_API_KEY" ]; then
        printf '\n'
        printf '    2captcha API key (https://2captcha.com) - OPTIONAL, press Enter to skip.\n'
        printf '    You do NOT need one to install, to start the stack, or to create your\n'
        printf '    account. It is only needed before you connect an OnlyFans account:\n'
        printf '    OnlyFans gates login behind a Cloudflare Turnstile challenge and each\n'
        printf '    solve is paid for. You can add it afterwards in the panel, under\n'
        printf '    Settings -> Captcha provider.\n\n'
        read -r -p "    2captcha API key (Enter to skip): " TWOCAPTCHA_API_KEY || TWOCAPTCHA_API_KEY=""
    fi
    TWOCAPTCHA_API_KEY="$(printf '%s' "$TWOCAPTCHA_API_KEY" | tr -d '[:space:]')"
    if [ -z "$TWOCAPTCHA_API_KEY" ]; then
        warn "No captcha key. Everything installs and runs; add one under"
        warn "Settings -> Captcha provider before connecting an OnlyFans account."
    elif [ "${#TWOCAPTCHA_API_KEY}" -lt 10 ]; then
        warn "That key is shorter than any real 2captcha key. Writing it anyway -"
        warn "correct it in Settings once the panel is up."
    else
        ok "Captcha key recorded"
    fi

    # --- secrets --------------------------------------------------------------
    step "Generating secrets"
    command -v openssl >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq openssl; }
    gen_secret() { openssl rand -base64 48 | tr -d '\n='; }

    SECRET_KEY="$(gen_secret)"
    ENCRYPTION_KEY="$(gen_secret)"
    NEXTAUTH_SECRET="$(gen_secret)"
    ok "SECRET_KEY, ENCRYPTION_KEY and NEXTAUTH_SECRET generated (64 chars each)"

    # --- write .env -----------------------------------------------------------
    step "Writing .env"
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    chmod 600 "$ENV_FILE"

    # Replaces `KEY=` or `#KEY=` with `KEY=value`, appending if absent.
    # `|` is the sed delimiter and appears in none of these values (base64 uses
    # only A-Z a-z 0-9 + /, and the = padding is stripped above).
    set_env() {
        local key="$1" value="$2"
        if grep -qE "^#?${key}=" "$ENV_FILE"; then
            sed -i "s|^#\?${key}=.*|${key}=${value}|" "$ENV_FILE"
        else
            printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
        fi
    }

    BASE_URL="${SCHEME}://${APP_DOMAIN}"
    [ "$USE_TLS" -eq 1 ] || BASE_URL="${SCHEME}://${APP_DOMAIN}:3000"

    set_env SECRET_KEY                "$SECRET_KEY"
    set_env ENCRYPTION_KEY            "$ENCRYPTION_KEY"
    set_env TWOCAPTCHA_API_KEY        "$TWOCAPTCHA_API_KEY"
    set_env NEXTAUTH_SECRET           "$NEXTAUTH_SECRET"
    set_env NEXTAUTH_URL              "$BASE_URL"
    set_env APP_DOMAIN                "$APP_DOMAIN"
    set_env BACKEND_URL               "http://api:5000"
    set_env CORS_ORIGINS              "$BASE_URL"
    # Two dashboard routes (/api/mcp/whoami and /api/mcp/test) read CRM_API_BASE
    # rather than BACKEND_URL, and fall back to http://127.0.0.1:5020 - which is
    # nothing at all inside the web container. Pin it to the same address.
    set_env CRM_API_BASE              "http://api:5000"
    # With TLS terminated by a proxy, Next.js sees a loopback Host but the
    # browser's real Origin, and rejects server actions (the OAuth consent
    # form) unless the public host is listed here. Next compares against the
    # Origin header's HOST, which carries the port whenever it is not the
    # scheme default - so this is BASE_URL with the scheme stripped, not the
    # bare domain.
    set_env SERVER_ACTION_ORIGINS     "${BASE_URL#*://}"
    # Left OPEN so you can create the first account. Close it straight after -
    # the instructions are printed when this script finishes.
    set_env ALLOW_PUBLIC_REGISTRATION ""
    # NEXT_PUBLIC_* are compiled into the browser bundle by `next build`, which
    # is why they must be correct BEFORE the image is built below.
    set_env NEXT_PUBLIC_SITE_URL      "$BASE_URL"
    set_env NEXT_PUBLIC_APP_URL       "$BASE_URL"

    # The URL the dashboard's API-docs page tells your API clients to call.
    # `/flask` exists ONLY because the Caddyfile has a `handle_path /flask/*`
    # block, so it is a valid address only when Caddy is in front. Without TLS
    # there is no Caddy and the API is simply the published port 5000.
    if [ "$USE_TLS" -eq 1 ]; then
        set_env NEXT_PUBLIC_API_URL   "${BASE_URL}/flask"
    else
        set_env NEXT_PUBLIC_API_URL   "http://${APP_DOMAIN}:5000"
    fi

    ok ".env written, mode 600"

    printf '\n'
    printf '    %s############################################################%s\n' "$C_YELLOW" "$C_RESET"
    printf '    %s#  BACK UP %s NOW, OFF THIS SERVER.%s\n' "$C_YELLOW" "$ENV_FILE" "$C_RESET"
    printf '    %s#  ENCRYPTION_KEY in it is the ONLY thing that can decrypt  #%s\n' "$C_YELLOW" "$C_RESET"
    printf '    %s#  the stored account passwords. There is no recovery.      #%s\n' "$C_YELLOW" "$C_RESET"
    printf '    %s############################################################%s\n' "$C_YELLOW" "$C_RESET"
fi


# =============================================================================
step "Firewall"
# =============================================================================

if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active'; then
    if [ "${USE_TLS:-1}" -eq 1 ]; then
        ufw allow 80/tcp  >/dev/null
        ufw allow 443/tcp >/dev/null
        ok "ufw: opened 80/tcp and 443/tcp"
    else
        # No Caddy in this mode - the dashboard is served straight off :3000.
        ufw allow 3000/tcp >/dev/null
        ok "ufw: opened 3000/tcp (no TLS terminator in this mode)"
    fi
elif [ "${USE_TLS:-1}" -eq 1 ]; then
    skip "ufw not active - make sure 80 and 443 reach this box"
else
    skip "ufw not active - make sure 3000 reaches this box"
fi


# =============================================================================
step "Building and starting the stack"
# =============================================================================
# The first build compiles the Next.js dashboard and can take 5-15 minutes on
# a 2-vCPU box. Subsequent runs reuse the Docker layer cache.

COMPOSE=(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE")

if [ "${USE_TLS:-1}" -eq 1 ]; then
    COMPOSE+=(--profile tls)
fi

"${COMPOSE[@]}" build
"${COMPOSE[@]}" up -d

ok "Containers started"

printf '\n'
"${COMPOSE[@]}" ps


# =============================================================================
step "Done"
# =============================================================================

APP_DOMAIN_OUT="$(sed -n 's/^APP_DOMAIN=//p' "$ENV_FILE" | head -n1)"
NEXTAUTH_URL_OUT="$(sed -n 's/^NEXTAUTH_URL=//p' "$ENV_FILE" | head -n1)"

cat <<EOF

    Dashboard:  ${NEXTAUTH_URL_OUT:-http://${APP_DOMAIN_OUT}}
    API health: docker compose -f "$COMPOSE_FILE" exec api curl -fsS http://127.0.0.1:5000/health

    DO THESE THREE THINGS NOW
    -------------------------

    1. Open the dashboard and create your account. Registration is open so
       that you can - which means anyone who finds the URL could too.

    2. Close registration the moment your account exists:

           cd $SCRIPT_DIR
           sed -i 's|^#\?ALLOW_PUBLIC_REGISTRATION=.*|ALLOW_PUBLIC_REGISTRATION=false|' .env
           docker compose up -d web

       Only the exact string "false" closes it. Anything else leaves it open.

    3. Add a 2captcha key before you connect an OnlyFans account, in the panel
       under Settings -> Captcha provider. OnlyFans gates login behind a
       Cloudflare Turnstile challenge, so a connect attempt without a key
       fails with a message telling you exactly that. Nothing else needs it.

EOF

if [ "${USE_TLS:-1}" -eq 1 ]; then
cat <<EOF
    The first HTTPS request may take a few seconds while Caddy obtains a
    certificate. If it fails, check that the A record for ${APP_DOMAIN_OUT}
    resolves to this server and that ports 80 and 443 are reachable:

        docker compose -f "$COMPOSE_FILE" logs caddy

EOF
fi

cat <<EOF
    Useful commands (run them from $SCRIPT_DIR):

        docker compose logs -f api        # backend, scheduler and poller logs
        docker compose logs -f web        # dashboard logs
        docker compose restart api        # restart the backend
        docker compose down               # stop everything (keeps the volume)
        git pull && docker compose up -d --build              # upgrade

    Back up the database and saved sessions. The volume is named
    onlyfans-api_api_data whatever you cloned the repository into, because
    docker-compose.yml pins the compose project name to "onlyfans-api":

        docker run --rm -v onlyfans-api_api_data:/data -v "\$PWD:/backup" \\
            alpine tar czf /backup/onlyapi-backup-\$(date +%F).tar.gz -C /data .

    Do NOT run more than one api container. gunicorn.conf.py refuses to boot
    with more than one worker because the scheduler, the SSE hub, the refresh
    state store and the rate limiter all live inside the process.

EOF
