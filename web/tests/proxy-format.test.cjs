// checkProxy (lib/proxy-format.ts): accepted shapes, safe repairs, clear errors.
//   node --test tests/proxy-format.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../node_modules/typescript');

const ROOT = path.resolve(__dirname, '..');
const source = ts.transpileModule(fs.readFileSync(path.join(ROOT, 'lib/proxy-format.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const context = { exports: {} };
vm.runInNewContext(source, context);
const { checkProxy } = context.exports;

const ok = (input, value) => {
  const r = checkProxy(input);
  assert.equal(r.ok, true, `${input} → ${r.error}`);
  assert.equal(r.value, value, input);
  return r;
};
const bad = (input, fragment) => {
  const r = checkProxy(input);
  assert.equal(r.ok, false, `${input} should be rejected, got ${r.value}`);
  assert.match(r.error, fragment, input);
};

test('accepts every format the backend accepts, unchanged', () => {
  for (const v of [
    'http://user:pass@1.2.3.4:8080',
    'https://user:pass@proxy.example.com:443',
    'socks5://user:pass@1.2.3.4:1080',
    'socks5h://user:pass@gate.example.com:7000',
    'http://1.2.3.4:8080',
  ]) {
    const r = ok(v, v);
    assert.deepEqual([...r.fixes], [], v);
  }
});

test('host:port:user:pass becomes a URL, passwords may contain ":" and "@"', () => {
  assert.deepEqual([...ok('109.166.44.40:29842:trober05:nbc8xyRD', 'http://trober05:nbc8xyRD@109.166.44.40:29842').fixes], []);
  ok('gate.example.com:7000:user:pa:ss', 'http://user:pa:ss@gate.example.com:7000');
  ok('1.2.3.4:8080:user:p@ss', 'http://user:p@ss@1.2.3.4:8080');
});

test('repairs unambiguous copy-paste mistakes and says so', () => {
  const cases = [
    ['  http://user:pass@1.2.3.4:8080\n', 'http://user:pass@1.2.3.4:8080', 0],
    ['"http://user:pass@1.2.3.4:8080"', 'http://user:pass@1.2.3.4:8080', 1],
    ['HTTP://user:pass@1.2.3.4:8080', 'http://user:pass@1.2.3.4:8080', 1],
    ['http//user:pass@1.2.3.4:8080', 'http://user:pass@1.2.3.4:8080', 1],
    ['http:/user:pass@1.2.3.4:8080', 'http://user:pass@1.2.3.4:8080', 1],
    ['http://user:pass@1.2.3.4:8080/', 'http://user:pass@1.2.3.4:8080', 1],
    ['user:pass@1.2.3.4:8080', 'http://user:pass@1.2.3.4:8080', 1],
    ['1.2.3.4:8080@user:pass', 'http://user:pass@1.2.3.4:8080', 2],
    ['user:pass:1.2.3.4:8080', 'http://user:pass@1.2.3.4:8080', 1],
    ['user:12345:1.2.3.4:8080', 'http://user:12345@1.2.3.4:8080', 1],
    ['socks5://1.2.3.4:1080:user:pass', 'socks5://user:pass@1.2.3.4:1080', 1],
    ['1.2.3.4:8080', 'http://1.2.3.4:8080', 1],
  ];
  for (const [input, value, fixCount] of cases) {
    const r = ok(input, value);
    assert.equal(r.fixes.length, fixCount, `${input}: ${[...r.fixes]}`);
  }
});

test('flags a proxy with no credentials', () => {
  assert.equal(ok('http://1.2.3.4:8080', 'http://1.2.3.4:8080').noAuth, true);
  assert.equal(ok('1.2.3.4:8080:u:p', 'http://u:p@1.2.3.4:8080').noAuth, false);
});

test('rejects what the backend would reject, with a reason', () => {
  bad('', /Enter a proxy/);
  bad('   ', /Enter a proxy/);
  bad('http://user:pass@1.2.3.4:8080 http://x:y@5.6.7.8:80', /spaces/);
  bad('http://user:pass@1.2.3.4:8080\nhttp://x:y@5.6.7.8:80', /more than one line/);
  bad('socks4://1.2.3.4:1080', /isn't supported/);
  bad('ftp://user:pass@1.2.3.4:21', /isn't a proxy type/);
  bad('http://user:pass@1.2.3.4', /host:port/);
  bad('http://user@1.2.3.4:8080', /username or password is missing/);
  bad('http://user:@1.2.3.4:8080', /password is missing/);
  bad('1.2.3.4', /port is missing/);
  bad('1.2.3.4:8080:user', /One part is missing/);
  bad('1.2.3.4:99999', /port/);
  bad('http://user:pass@1.2.3.4:80/path', /isn't a valid proxy host|host:port/);
  bad('user:pass:host:port', /host and which is the port/);
  bad('http://user:pass@bad_host!:8080', /valid proxy host/);
});

test('masks the password for display', () => {
  const r = ok('1.2.3.4:8080:user:secretpassword', 'http://user:secretpassword@1.2.3.4:8080');
  assert.equal(r.masked, 'http://user:••••••••@1.2.3.4:8080');
  assert.ok(!r.masked.includes('secret'));
});
