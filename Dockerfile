# syntax=docker/dockerfile:1.7
# ============================================================================
#  The Only API — backend image  (Flask + APScheduler + the OnlyFans signer)
# ============================================================================
#
#  WHY PYTHON *AND* NODE LIVE IN THE SAME IMAGE
#  --------------------------------------------
#  This is not a convenience. `header_generator.py` shells out to
#  `node onlyfans-sign-generator.js` for EVERY signed OnlyFans request:
#
#      cmd = ['node', generator_script, path]        # header_generator.py:47
#      ...
#      except FileNotFoundError:
#          raise SignerUnavailableError('`node` not found on PATH')
#
#  No `node` on PATH  =>  every signed call fails and the product does nothing.
#  The signer itself needs no npm packages (it only requires the Node builtins
#  vm / fs / path / crypto), so there is no `npm install` step here.
#
#  BUILD
#  -----
#  This Dockerfile lives at the REPOSITORY ROOT, but its build context is the
#  `api/` directory — the one holding crm_api.py, requirements.txt,
#  gunicorn.conf.py and onlyfans-sign-generator.js:
#
#      docker build -f Dockerfile -t onlyfans-api:latest ./api
#
#  docker-compose.yml expresses the same thing as
#      context: ./api
#      dockerfile: ../Dockerfile
#  and render.yaml / fly.toml each carry their own version of it. If you move
#  the backend source, all four have to move with it.
#
#  RUN
#  ---
#  Entry point is gunicorn, exactly as the production systemd unit runs it:
#      gunicorn -c gunicorn.conf.py crm_api:app
#
#  gunicorn.conf.py binds "${HOST}:${PORT}" (defaults 0.0.0.0:5020) and REFUSES
#  to start with GUNICORN_WORKERS != 1 — the scheduler, refresh_state, sse_hub
#  and the in-memory rate limiter all hold authoritative state in-process.
#  Never run more than one replica of this image against the same volume.
# ============================================================================


# ---------------------------------------------------------------------------
# Stage 1 — build the Python virtualenv.
# Separated so compilers never ship in the runtime image, and so the (slow)
# dependency layer is only rebuilt when requirements.txt changes.
# ---------------------------------------------------------------------------
FROM python:3.11-slim-bookworm AS pybuild

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

# Most wheels here are prebuilt manylinux (curl-cffi, cryptography, bcrypt),
# but keep a toolchain available so a platform without a wheel still builds.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libffi-dev \
        libssl-dev \
    && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Dependency layer first — cached until requirements.txt actually changes.
COPY requirements.txt /tmp/requirements.txt
RUN pip install --upgrade pip setuptools wheel \
    && pip install -r /tmp/requirements.txt


# ---------------------------------------------------------------------------
# Stage 2 — runtime.
# ---------------------------------------------------------------------------
FROM python:3.11-slim-bookworm AS runtime

# curl is used by HEALTHCHECK; ca-certificates for outbound TLS to OnlyFans,
# Fansly, 2captcha, webhook targets and proxies.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        tini \
    && rm -rf /var/lib/apt/lists/*

# Node 20 LTS, lifted straight out of the official image. Both images are
# bookworm/glibc-based, so the binary is ABI-compatible. This is deliberately
# NOT a NodeSource install script: no network scripts, no apt key handling,
# reproducible, and it pins the exact Node the official image ships.
COPY --from=node:20-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:20-bookworm-slim /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -sf /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && node --version

COPY --from=pybuild /opt/venv /opt/venv

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app

# --- Non-root ---------------------------------------------------------------
# uid/gid 10001 is arbitrary but fixed, so a bind-mounted host directory can be
# chowned to a stable id if someone prefers a bind mount over the named volume.
RUN groupadd --system --gid 10001 onlyapi \
    && useradd --system --uid 10001 --gid 10001 --home-dir /app --shell /usr/sbin/nologin onlyapi

# --- Application source -----------------------------------------------------
WORKDIR /app
COPY --chown=onlyapi:onlyapi . /app

# Scrub anything a local checkout may be carrying that must never be baked into
# an image. All of it is gitignored, so a fresh `git clone` has none of it — but
# a maintainer building from a working tree they have actually run the API in
# would otherwise ship a live database, real saved platform sessions, their
# OAuth signing keys and their own .env inside the image layers.
#
# The runtime reads all of this from /data instead (set below), so removing it
# from /app changes nothing about how the container behaves.
RUN rm -rf /app/.env /app/.env.* \
           /app/saved_sessions /app/oauth_keys /app/exports /app/rate-budgets \
    && find /app -maxdepth 2 \( -name '*.db' -o -name '*.db-wal' -o -name '*.db-shm' \) -delete \
    && find /app -name '__pycache__' -type d -prune -exec rm -rf {} + \
    && mkdir -p /app/saved_sessions \
    && chown -R onlyapi:onlyapi /app

# --- Mutable state ----------------------------------------------------------
#  /data is the ONLY directory that must survive a container rebuild, and the
#  process runs with /data as its working directory. That is load-bearing:
#
#    * multi_tenant_auth.py builds session paths as the RELATIVE string
#      `saved_sessions/<crm_id>/<of_user_id>.json` (multi_tenant_auth.py:35).
#      There is no env var for it — it resolves against the process CWD. So the
#      CWD *is* the persistence root, and everything else is pointed at /data
#      explicitly below to keep the whole working set in one volume.
#    * crm_database.py defaults DB_FILE to the relative 'crm_data.db'.
#    * scheduler.py puts its APScheduler jobstore next to the database file.
#    * oauth_keys.py defaults OAUTH_KEYS_DIR to the relative 'oauth_keys'.
#
#  Lose /data and you lose the database, every saved platform session and the
#  OAuth signing keys.
WORKDIR /data
RUN mkdir -p /data/saved_sessions /data/exports /data/oauth_keys /data/rate-budgets \
    && chown -R onlyapi:onlyapi /data

ENV DATABASE_PATH=/data/crm_data.db \
    SCHEDULER_JOBSTORE_PATH=/data/scheduler_jobs.db \
    EXPORTS_DIR=/data/exports \
    OAUTH_KEYS_DIR=/data/oauth_keys \
    OF_RATE_STATE_DIR=/data/rate-budgets \
    OF_SIGNED_JOBS_PAUSE_FILE=/data/.signed-jobs-paused

# gunicorn.conf.py reads HOST/PORT (its own defaults are 0.0.0.0:5020). Pinned
# to 5000 here so the compose file, Caddyfile, render.yaml and fly.toml all
# agree on one number.
ENV HOST=0.0.0.0 \
    PORT=5000
EXPOSE 5000

VOLUME ["/data"]

USER onlyapi

# /health is a liveness probe and always answers when the WSGI app is up.
# Deliberately NOT /ready: /ready returns 503 whenever the signer is
# unavailable or the scheduler is down, which is a degraded-but-recoverable
# state. Wiring an orchestrator restart loop to it would kill the container in
# exactly the situation where you want to read its logs.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT}/health" || exit 1

# tini reaps the short-lived `node` signer subprocesses; without an init, PID 1
# leaves a zombie behind for every signed request.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["gunicorn", "-c", "/app/gunicorn.conf.py", "crm_api:app"]
