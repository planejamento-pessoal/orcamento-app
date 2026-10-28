'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const docs = fs.readFileSync(path.join(root, 'docs', 'index.html'));
const apk = fs.readFileSync(path.join(root, 'android', 'app', 'src', 'main', 'assets', 'index.html'));

test('a abertura de emergência do APK é igual ao docs/index.html', () => {
  assert.ok(docs.equals(apk), 'Diferentes. Rode:  node tools/sync-launcher.js');
});

// ── política de segurança (CSP) ─────────────────────────────────────────
const { cspHashes, policyOf } = require('../tools/csp.js');
const html = docs.toString('utf8');
const policy = policyOf(html) || '';
const dir = (name) => (policy.split(';').map((s) => s.trim()).find((s) => s.split(/\s+/)[0] === name) || '').split(/\s+/).slice(1);

test('CSP: os hashes dos scripts do index.html estão em dia', () => {
  assert.ok(policy, 'index.html sem a meta Content-Security-Policy');
  const want = cspHashes(html);
  assert.equal(want.length, 2, 'esperava 2 blocos de script escritos no index.html (tema e carregador)');
  assert.deepEqual(dir('script-src'), [...want, 'blob:'], 'hashes velhos. Rode:  node tools/sync-launcher.js');
});

test('CSP: nada de unsafe-inline/unsafe-eval em script, nada de curinga nem http', () => {
  assert.ok(!/unsafe-eval/.test(policy), 'unsafe-eval na política');
  assert.ok(!dir('script-src').includes("'unsafe-inline'"), "script-src com 'unsafe-inline'");
  assert.ok(!/(^|[\s;])\*([\s;]|$)/.test(policy), 'curinga * sozinho na política');
  assert.ok(!/http:/.test(policy), 'http: na política');
  assert.deepEqual(dir('default-src'), ["'none'"]);
  for (const d of ['object-src', 'base-uri', 'form-action', 'frame-src']) assert.deepEqual(dir(d), ["'none'"], d);
  assert.deepEqual(dir('connect-src'), ["'self'", 'https://*.supabase.co'], 'só este site e o Supabase');
  for (const d of ['img-src', 'font-src', 'manifest-src', 'worker-src']) assert.deepEqual(dir(d), ["'self'"], d);
});

test('o carregador não depende de código inline nem de eval (a CSP bloquearia)', () => {
  const loader = html.slice(html.indexOf('Carregador.'));
  assert.ok(!/\.text\s*=|innerHTML|eval\(|new Function|document\.write/.test(loader.replace(/textContent/g, '')), 'o carregador usa algo que a CSP bloqueia');
  assert.ok(/createObjectURL/.test(loader), 'o carregador deveria rodar os arquivos como blob:');
});

test('o carregador lista todos os arquivos do app que existem em docs/', () => {
  const html = docs.toString('utf8');
  const listed = [...html.matchAll(/'((?:js\/|vendor\/)?[A-Za-z0-9_.-]+\.js)'/g)].map((m) => m[1]);
  assert.ok(listed.length >= 15, 'lista de arquivos do carregador parece incompleta: ' + listed.length);
  for (const f of listed) assert.ok(fs.existsSync(path.join(root, 'docs', f)), 'arquivo listado no carregador não existe: ' + f);
  const onDisk = fs.readdirSync(path.join(root, 'docs', 'js')).map((f) => 'js/' + f);
  for (const f of onDisk) assert.ok(listed.includes(f), 'arquivo em docs/js que o carregador não lista (não chegaria ao app): ' + f);
});
