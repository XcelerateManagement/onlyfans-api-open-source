# Security Documentation

This document outlines the security features implemented in the OnlyFans CRM API and provides guidance on secure deployment.

## Table of Contents

- [Security Features](#security-features)
- [Environment Variables](#environment-variables)
- [Password Security](#password-security)
- [Rate Limiting](#rate-limiting)
- [CORS Configuration](#cors-configuration)
- [Security Headers](#5-security-headers)
- [Deployment Checklist](#deployment-checklist)
- [Security Update History](#security-update-history)

---

## Security Features

### 1. **bcrypt Password Hashing**
- All user passwords are hashed using bcrypt with a cost factor of 12
- Replaces insecure SHA-256 hashing
- Resistant to brute-force and rainbow table attacks

### 2. **Fernet Encryption for Stored Credentials**
- OnlyFans account passwords are encrypted using Fernet symmetric encryption
- Encryption key derived from `ENCRYPTION_KEY` environment variable
- Credentials encrypted at rest in SQLite database

### 3. **Rate Limiting**
- Flask-Limiter integrated for all API endpoints
- Different rate limits for different endpoint sensitivity — see
  [Rate Limiting](#rate-limiting) below for the actual figures, which are
  keyed off `config.py` rather than repeated here

### 4. **CORS Restrictions**
- CORS configured to allow only specific origins
- Credentials support enabled for authenticated requests
- Methods and headers explicitly whitelisted

### 5. **Security Headers**
All responses include security headers:
- `Strict-Transport-Security`: HSTS with 1 year max-age
- `X-Content-Type-Options`: nosniff
- `X-Frame-Options`: DENY
- `X-XSS-Protection`: 1; mode=block
- `Referrer-Policy`: strict-origin-when-cross-origin

### 6. **Input Validation**
- Comprehensive input validation on all endpoints
- Email format validation
- Password strength requirements (min 8 characters)
- SQL injection prevention via parameterized queries
- XSS prevention via HTML escaping
- Path traversal prevention

---

## Environment Variables

### Required Variables

Only two. `config.py` raises at import if either is missing or shorter than 32
characters, before Flask binds a port.

| Variable | Description | Generation |
|----------|-------------|------------|
| `SECRET_KEY` | Flask secret key for sessions | `openssl rand -base64 32` |
| `ENCRYPTION_KEY` | Key for encrypting stored passwords | `openssl rand -base64 32` |

### Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TWOCAPTCHA_API_KEY` | `''` | Server-wide default captcha key. **Optional** — the stack starts without it. A panel can set its own from Settings → Captcha provider, which takes precedence. With neither set, an OnlyFans login fails with a message saying so and nothing else is affected |
| `FLASK_DEBUG` | `False` | Enable debug mode (NEVER in production) |
| `FLASK_HOST` | `0.0.0.0` | Server bind address |
| `FLASK_PORT` | `5000` | Server port |
| `CORS_ORIGINS` | `http://localhost:3000,http://localhost:3181` | Allowed CORS origins |
| `PROXY_URL` | None | Default proxy URL |

---

## Password Security

### User Passwords (Dashboard Login)
- **Hashing Algorithm**: bcrypt with 12 rounds
- **Storage**: Salted hash in `crm_users.password_hash`
- **Minimum Length**: 8 characters

### OnlyFans Account Passwords
- **Encryption**: Fernet (AES-128 in CBC mode with HMAC)
- **Storage**: Encrypted in `of_accounts.encrypted_password`
- **Key Derivation**: SHA-256 of `ENCRYPTION_KEY` environment variable

---

## Rate Limiting

Rate limits are applied per API key or IP address (fallback):

| Endpoint Category | Env var | Default | Examples |
|---|---|---|---|
| Login | `RATE_LIMIT_LOGIN` | 20/min | `/accounts/login`, 2FA |
| Sensitive | `RATE_LIMIT_SENSITIVE` | 100/min | CRUD writes, payout requests, price updates |
| Default | `RATE_LIMIT_DEFAULT` | 1000/min | Notifications, earnings, campaigns |
| SSE | — | Exempt | A long-lived stream would exhaust any per-minute limit |
| Health | — | Exempt | `/health`, `/ready` |

Defaults live in `config.py`; override them in `.env`. Keep the two in agreement.

**Note**: rate limiting uses in-process memory storage (`storage_uri="memory://"`),
and that is correct for this application rather than a shortcut. The stack runs a
single API process by design — `gunicorn.conf.py` refuses to start otherwise —
because the scheduler, the refresh store and the SSE hub all hold authoritative
in-process state. With one process, in-memory limits are exact.

Moving to Redis only makes sense as part of externalising all four of those at
once, which is a substantial project rather than a configuration change. See
[SELF-HOSTING.md](../SELF-HOSTING.md#the-single-instance-constraint).

---

## CORS Configuration

Default allowed origins:
- `http://localhost:3000` (Next.js dev server)
- `http://localhost:3181` (Production frontend)

Configure for production:
```bash
CORS_ORIGINS=https://panel.example.com
```

---

## Deployment Checklist

### Pre-Deployment

- [ ] Generate strong `SECRET_KEY` (32+ characters)
- [ ] Generate strong `ENCRYPTION_KEY` (32+ characters) — and back it up off the
      server; there is no recovery path
- [ ] Set `ALLOW_PUBLIC_REGISTRATION=false` once your owner account exists
- [ ] Set up a 2captcha account and add the key (in the panel under
      Settings → Captcha provider, or as `TWOCAPTCHA_API_KEY`) — needed before
      you connect an account, not before you start
- [ ] Configure `CORS_ORIGINS` with production domains
- [ ] Set `FLASK_DEBUG=False` (default)
- [ ] Rotate any previously exposed credentials

### Security Hardening

- [ ] Deploy behind nginx reverse proxy
- [ ] Enable HTTPS only (HSTS header configured)
- [ ] Configure firewall rules (block port 5000 from public)
- [ ] Set up log monitoring and alerting
- [ ] Enable database backup encryption
- [ ] Keep GUNICORN_WORKERS at 1 (enforced at startup)

### Post-Deployment

- [ ] Test all endpoints with missing/invalid API keys
- [ ] Verify rate limiting is working
- [ ] Confirm CORS blocks unauthorized origins
- [ ] Check security headers in responses
- [ ] Monitor for suspicious activity

---

## Security Contact

If you discover a security vulnerability, please:
1. Do NOT open a public issue
2. See [SECURITY.md](../SECURITY.md) for how to report it privately
3. Allow time for remediation before disclosure

---

## Security Update History

| Date | Change | Description |
|------|--------|-------------|
| 2026-02-02 | Initial Security Hardening | Implemented bcrypt, encryption, rate limiting, CORS, validation |
