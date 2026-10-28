'use strict';
// Trava do config.js (chave errada) e varredura de segredos no projeto inteiro.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const docs = path.join(root, 'docs');

// Carrega data.js num "navegador" mínimo, só para chamar configProblem().
function loadData() {
  const ctx = { URL, atob, console, Promise, setTimeout, clearTimeout };
  ctx.window = ctx;
  ctx.Engine = {};
  ctx.Format = require('../docs/js/format.js');
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(docs, 'js', 'data.js'), 'utf8'), ctx, { filename: 'data.js' });
  return ctx.App.data;
}
const D = loadData();
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (role) => `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u({ iss: 'supabase', ref: 'abcdefghijklmnopqrst', role, iat: 1, exp: 2 })}.assinatura_de_teste_0123456789`;
const URL_OK = 'https://abcdefghijklmnopqrst.supabase.co';
const PUB = 'sb_publishable_TesteLocal0123456789abcdefXYZ';
const SECRET = 'sb_' + 'secret_TesteLocal0123456789abcdefXYZ'; // emendado para a varredura de segredos não achar este arquivo
const cfg = (u, k) => ({ SUPABASE_URL: u, SUPABASE_ANON_KEY: k });

test('config.js: URL do projeto e chave pública valem', () => {
  assert.equal(D.configProblem(cfg(URL_OK, PUB)), null);
  assert.equal(D.configProblem(cfg(URL_OK + '/', PUB)), null, 'barra no fim é tolerada');
  assert.equal(D.configProblem(cfg('  ' + URL_OK + ' ', ' ' + PUB + ' ')), null, 'espaços nas pontas são tolerados');
  assert.equal(D.configProblem(cfg(URL_OK, jwt('anon'))), null, 'chave antiga (JWT anon) ainda serve');
  assert.equal(D.configured(cfg(URL_OK, PUB)), true);
});

test('config.js: modelo sem preencher e valores ausentes', () => {
  assert.equal(D.configProblem(cfg('COLE_AQUI_A_URL_DO_PROJETO', 'COLE_AQUI_A_CHAVE_PUBLICA')), 'modelo');
  assert.equal(D.configProblem(cfg(URL_OK, 'COLE_AQUI_A_CHAVE_PUBLICA')), 'modelo');
  assert.equal(D.configProblem(cfg('', '')), 'modelo');
  assert.equal(D.configProblem(undefined), 'ausente');
  assert.equal(D.configProblem({}), 'ausente');
  assert.equal(D.configProblem({ SUPABASE_URL: 5, SUPABASE_ANON_KEY: PUB }), 'ausente');
});

test('config.js: chave SECRETA é recusada, mesmo com o resto errado', () => {
  assert.equal(D.configProblem(cfg(URL_OK, SECRET)), 'chave-secreta');
  assert.equal(D.configProblem(cfg('COLE_AQUI_A_URL_DO_PROJETO', SECRET)), 'chave-secreta');
  assert.equal(D.configProblem(cfg(URL_OK, SECRET.toUpperCase())), 'chave-secreta');
  assert.equal(D.configProblem(cfg(URL_OK, jwt('service_role'))), 'chave-secreta', 'service_role antiga');
  assert.equal(D.configured(cfg(URL_OK, jwt('service_role'))), false);
});

test('config.js: chave que não é a pública', () => {
  assert.equal(D.configProblem(cfg(URL_OK, 'sb_publishable_curta')), 'chave');
  assert.equal(D.configProblem(cfg(URL_OK, 'qualquer-coisa-com-mais-de-20-letras')), 'chave');
  assert.equal(D.configProblem(cfg(URL_OK, jwt('authenticated'))), 'chave');
  assert.equal(D.configProblem(cfg(URL_OK, 'eyJabc.eyJdef.ghi')), 'chave', 'JWT que não decodifica');
  assert.equal(D.configProblem(cfg(URL_OK, 'sb_publishable_TesteLocal0123456789 abcdefXYZ')), 'chave', 'espaço no meio');
});

test('config.js: endereço do projeto errado', () => {
  for (const bad of ['http://abcdefghijklmnopqrst.supabase.co', 'https://abcdefghijklmnopqrst.supabase.co/rest/v1/',
    'https://abcdefghijklmnopqrst.supabase.co/?x=1', 'https://abcdefghijklmnopqrst.supabase.co#a', 'https://abcdefghijklmnopqrst.supabase.co:8443',
    'https://user:senha@abcdefghijklmnopqrst.supabase.co', 'https://supabase.com/dashboard/project/abcdefghijklmnopqrst',
    'https://abcdefghijklmnopqrst.supabase.com', 'https://evil.example.com', 'https://abc.supabase.co.evil.com', 'abcdefghijklmnopqrst.supabase.co', 'https://.supabase.co']) {
    assert.equal(D.configProblem(cfg(bad, PUB)), 'url', bad);
  }
});

test('o config.js do projeto só tem modelo vazio ou uma configuração pública válida', () => {
  const ctx = {}; ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(docs, 'config.js'), 'utf8'), ctx);
  const p = D.configProblem(ctx.APP_CONFIG);
  assert.ok(p === null || p === 'modelo', 'docs/config.js com problema: ' + p + (p === 'chave-secreta' ? ' (CHAVE SECRETA! apague e gere outra no Supabase)' : ''));
});

// ── varredura de segredos em tudo que vai para o GitHub ─────────────────
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'build', '.gradle'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
test('nenhum segredo nem arquivo privado no projeto', () => {
  const bad = [];
  for (const f of walk(root)) {
    const rel = path.relative(root, f);
    if (/\.(jks|keystore|p12|pfx|pem|key)$/i.test(f) || /^PRIVADO/i.test(rel) || /(^|\/)(local\.properties|\.env[^/]*)$/.test(rel)) bad.push('arquivo que não deve subir: ' + rel);
    if (/\.(png|jpe?g|gif|ico|woff2?|jar|zip|apk)$/i.test(f)) continue;
    const txt = fs.readFileSync(f, 'utf8');
    if (/sb_secret_[A-Za-z0-9_-]{16,}/.test(txt)) bad.push('chave sb_secret_ em ' + rel);
    if (/-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/.test(txt)) bad.push('chave privada em ' + rel);
    for (const m of txt.matchAll(/eyJ[\w-]{10,}\.(eyJ[\w-]{10,})\.[\w-]{10,}/g)) {
      try { if (JSON.parse(Buffer.from(m[1], 'base64url').toString()).role === 'service_role') bad.push('JWT service_role em ' + rel); } catch (e) { /* não é JWT */ }
    }
  }
  assert.deepEqual(bad, []);
});
