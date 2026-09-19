// Dashboard 2FA + signed-in sessions: real TS source, synthetic fetch. No app startup/network.
//   node --test tests/account-security.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../node_modules/typescript');

const ROOT = path.resolve(__dirname, '..');
const SERVICE_TOKEN = 'synthetic-inter-service-test-token-only';
const ENV = {
  BACKEND_URL: 'https://backend.example.test',
  XCELERATE_DASHBOARD_URL: 'https://dashboard.example.test',
  NEXTAUTH_URL: 'http://localhost:3000',
  NEXTAUTH_SECRET: 'synthetic-nextauth-secret-only',
  INTER_SERVICE_TOKEN: SERVICE_TOKEN,
  ACCOUNT_SECURITY_CRM_IDS: 'crm_other, crm_synthetic',
};

// Loads app modules with `@/` imports resolved to source and everything the
// test cares about routed through the supplied fetch.
function app({ fetch, token = null, env = {} }) {
  const cache = new Map();
  const calls = [];
  const trackedFetch = async (url, options = {}) => {
    calls.push({ url: String(url), body: options.body ? JSON.parse(options.body) : undefined, headers: options.headers });
    return fetch(String(url), options.body ? JSON.parse(options.body) : undefined);
  };
  const mocks = {
    'next-auth/jwt': { getToken: async () => token },
    'next-auth/providers/credentials': (opts) => opts,
    'next/server': { NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200 }) } },
    'qrcode-generator': () => ({ addData() {}, make() {}, createSvgTag: () => '<svg/>' }),
  };
  const load = (file) => {
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} };
    cache.set(file, mod);
    const out = ts.transpileModule(fs.readFileSync(path.join(ROOT, file), 'utf8'), {
      fileName: file,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const context = {
      exports: mod.exports, module: mod, process: { env: { ...ENV, ...env } }, fetch: trackedFetch,
      Headers, URL, URLSearchParams, AbortSignal, Buffer, setTimeout, clearTimeout, console, Promise, Error,
      require(name) {
        if (name in mocks) return mocks[name];
        if (name.startsWith('@/')) return load(`${name.slice(2)}.ts`);
        throw new Error('Unexpected isolated import: ' + name);
      },
    };
    vm.runInNewContext(out, context);
    return mod.exports;
  };
  return { load, calls };
}

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const down = async () => { throw new TypeError('fetch failed'); };
const activeToken = { email: 'morgan@example.test', crmId: 'crm_synthetic', apiKey: 'key', sessionId: 'sid_1', iat: 100 };

test('explicit "not active" signs out; unreachable backend does not', async () => {
  let answer = { active: false };
  const revoked = app({ fetch: async () => reply(200, answer) });
  const security = revoked.load('lib/account-security.ts');
  assert.equal(await security.isSessionActive(activeToken), false);
  answer = { active: true };
  assert.equal(await security.isSessionActive(activeToken), false, 'answer is cached for 30s');
  assert.equal(revoked.calls.length, 1);
  security.forgetSessionChecks('crm_synthetic');
  assert.equal(await security.isSessionActive(activeToken), true);
  const call = revoked.calls[0];
  assert.equal(call.url, 'https://backend.example.test/internal/account-security/sessions/check');
  assert.equal(call.headers['X-Service-Token'], SERVICE_TOKEN);
  assert.deepEqual(call.body, { crm_id: 'crm_synthetic', session_id: 'sid_1', issued_at: 100 });

  for (const fetch of [down, async () => reply(502, {}), async () => reply(401, { error: 'Unauthorized' })]) {
    const offline = app({ fetch }).load('lib/account-security.ts');
    assert.equal(await offline.isSessionActive(activeToken), true);
  }
  assert.equal(await security.isSessionActive(null), false);
});

test('getActiveToken returns null without a cookie or for a removed session', async () => {
  assert.equal(await app({ fetch: down }).load('lib/account-security.ts').getActiveToken({}), null);
  const removed = app({ fetch: async () => reply(200, { active: false }), token: activeToken });
  assert.equal(await removed.load('lib/account-security.ts').getActiveToken({}), null);
  const live = app({ fetch: async () => reply(200, { active: true }), token: activeToken });
  assert.equal((await live.load('lib/account-security.ts').getActiveToken({})).sessionId, 'sid_1');
});

function loginBackend({ mfa = false, securityDown = false } = {}) {
  return async (url, body) => {
    if (url.endsWith('/api/auth/login') && url.startsWith(ENV.XCELERATE_DASHBOARD_URL)) {
      return body.password === 'right' ? reply(200, { user: { id: 'dash_1', name: 'Morgan' } }) : reply(401, {});
    }
    if (url.includes('/api/subscription/check')) return reply(200, { found: true, subscription: { isActive: true } });
    if (url.endsWith('/api/auth/login')) return reply(200, { success: true, crm_id: 'crm_synthetic', api_key: 'key' });
    if (url.endsWith('/save-crm')) return reply(200, {});
    if (url.includes('/internal/account-security/')) {
      if (securityDown) throw new TypeError('fetch failed');
      if (url.endsWith('/challenge/create')) return reply(200, mfa ? { mfa_required: true, challenge: 'chal_1' } : { mfa_required: false });
      if (url.endsWith('/sessions/create')) return reply(200, { session_id: 'sid_new' });
      if (url.endsWith('/challenge/verify')) {
        return body.code === '123456'
          ? reply(200, { crm_id: 'crm_synthetic', pending: { method: 'password', email: 'morgan@example.test', name: 'Morgan', xcelerateUserId: 'dash_1' } })
          : reply(401, { error: 'That code is not valid' });
      }
      if (url.endsWith('/sessions/check')) return reply(200, { active: body.session_id !== 'sid_revoked' });
    }
    if (url.includes('/internal/crm-for-email')) return reply(200, { crm_id: 'crm_synthetic', api_key: 'key', is_suspended: false });
    throw new Error('Unexpected synthetic URL ' + url);
  };
}
const headers = { headers: { 'user-agent': 'Synthetic UA', 'cf-connecting-ip': '198.51.100.7', 'cf-ipcountry': 'NZ' } };
const authorizeWith = (options = {}) => {
  const env = app({ fetch: loginBackend(options), env: options.env });
  return { authOptions: env.load('lib/auth-options.ts').authOptions, calls: env.calls };
};

test('password sign-in without 2FA registers the session with device details', async () => {
  const { authOptions, calls } = authorizeWith();
  const user = await authOptions.providers[0].authorize({ email: 'morgan@example.test', password: 'right' }, headers);
  assert.equal(user.sessionId, 'sid_new');
  const created = calls.find((c) => c.url.endsWith('/sessions/create'));
  assert.deepEqual(created.body, { crm_id: 'crm_synthetic', method: 'password', ip: '198.51.100.7', country: 'NZ', user_agent: 'Synthetic UA' });
  await assert.rejects(authOptions.providers[0].authorize({ email: 'morgan@example.test', password: 'wrong' }, headers), /Invalid email or password/);
});

test('2FA: password step asks for a code, code step completes, wrong code is readable', async () => {
  const { authOptions, calls } = authorizeWith({ mfa: true });
  const authorize = authOptions.providers[0].authorize;
  await assert.rejects(authorize({ email: 'morgan@example.test', password: 'right' }, headers), { message: 'MFA_REQUIRED:chal_1' });
  assert.equal(calls.some((c) => c.url.endsWith('/sessions/create')), false, 'no session before the code');
  await assert.rejects(authorize({ challenge: 'chal_1', code: '000000', recovery: 'false' }, headers), { message: 'That code is not valid' });
  const user = await authorize({ challenge: 'chal_1', code: '123456', recovery: 'false' }, headers);
  assert.equal(user.sessionId, 'sid_new');
  assert.equal(user.apiKey, 'key');
  assert.equal(user.email, 'morgan@example.test');
  assert.deepEqual(calls.find((c) => c.url.endsWith('/challenge/verify')).body, { challenge: 'chal_1', code: '000000', recovery: false });
});

test('sign-in fails closed when 2FA state cannot be checked', async () => {
  const { authOptions } = authorizeWith({ securityDown: true });
  await assert.rejects(
    authOptions.providers[0].authorize({ email: 'morgan@example.test', password: 'right' }, headers),
    /Could not start your session/
  );
});

test('refreshing a removed session throws so NextAuth clears the cookie', async () => {
  const { authOptions } = authorizeWith();
  await assert.rejects(authOptions.callbacks.jwt({ token: { ...activeToken, sessionId: 'sid_revoked' } }), { message: 'SessionRevoked' });
  const kept = await authOptions.callbacks.jwt({ token: { ...activeToken } });
  assert.equal(kept.sessionId, 'sid_1');
});

test('settings route rejects cross-site requests and removed sessions', async () => {
  const request = (origin) => ({ headers: new Headers({ origin }), nextUrl: { origin: 'http://127.0.0.1:3181' }, json: async () => ({}) });
  const params = { params: Promise.resolve({ action: ['status'] }) };
  const live = app({ fetch: async (url) => reply(200, url.endsWith('/sessions/check') ? { active: true } : url.endsWith('/sessions/list') ? { sessions: [] } : { enabled: false }), token: activeToken });
  const route = live.load('app/api/user/security/[...action]/route.ts');
  assert.equal((await route.POST(request('https://evil.example'), params)).status, 403);
  const ok = await route.POST(request('http://localhost:3000'), params);
  assert.equal(ok.status, 200);
  // Built inside the vm realm, so compare by value.
  assert.deepEqual(JSON.parse(JSON.stringify(ok.body)), { available: true, mfa: { enabled: false }, sessions: [] });
  const statusCall = live.calls.find((c) => c.url.endsWith('/mfa/status'));
  assert.deepEqual(statusCall.body, { crm_id: 'crm_synthetic' }, 'acts on the cookie identity only');

  const removed = app({ fetch: async () => reply(200, { active: false }), token: activeToken });
  const denied = await removed.load('app/api/user/security/[...action]/route.ts').POST(request('http://localhost:3000'), params);
  assert.equal(denied.status, 401);
});

test('panels outside ACCOUNT_SECURITY_CRM_IDS keep the old login and never call the backend', async () => {
  for (const allowed of ['', 'crm_someone_else']) {
    const { authOptions, calls } = authorizeWith({ mfa: true, env: { ACCOUNT_SECURITY_CRM_IDS: allowed } });
    const user = await authOptions.providers[0].authorize({ email: 'morgan@example.test', password: 'right' }, headers);
    assert.equal(user.sessionId, undefined);
    const kept = await authOptions.callbacks.jwt({ token: { ...activeToken, sessionId: undefined } });
    assert.equal(kept.sessionId, undefined, 'old cookies are not upgraded');
    await authOptions.callbacks.jwt({ token: { ...activeToken, sessionId: 'sid_revoked' } });
    assert.equal(calls.some((c) => c.url.includes('/internal/account-security/')), false);
  }
  const everyone = app({ fetch: async () => reply(200, { active: false }), env: { ACCOUNT_SECURITY_CRM_IDS: '*' } });
  assert.equal(await everyone.load('lib/account-security.ts').isSessionActive(activeToken), false);

  const hidden = app({ fetch: down, token: activeToken, env: { ACCOUNT_SECURITY_CRM_IDS: '' } });
  const route = hidden.load('app/api/user/security/[...action]/route.ts');
  const request = { headers: new Headers({ origin: 'http://localhost:3000' }), nextUrl: { origin: 'x' }, json: async () => ({}) };
  const status = await route.POST(request, { params: Promise.resolve({ action: ['status'] }) });
  assert.equal(status.status, 200);
  assert.equal(status.body.available, false);
  const setup = await route.POST(request, { params: Promise.resolve({ action: ['2fa', 'setup'] }) });
  assert.equal(setup.status, 404);
  assert.equal(hidden.calls.length, 0);
});
