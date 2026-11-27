'use strict';
// Apagar convite (aba Conta, só admin). Tudo com dados INVENTADOS e sem rede:
//  • data.js num "navegador" mínimo, com um Supabase de mentira, para ver QUAL função do banco cada caso chama;
//  • o arquivo 04_apagar_convite.sql só acrescenta a função nova (e confere tudo antes de valer);
//  • travas estáticas da tela (botão de apagar para qualquer convite; confirmação só no já usado).
// (A tela em si é conferida num navegador de verdade; isso não cabe nos testes sem dependências.)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const Format = require('../docs/js/format.js');
const plain = (x) => JSON.parse(JSON.stringify(x));
const URL_OK = 'https://abcdefghijklmnopqrst.supabase.co';
const PUB = 'sb_publishable_TesteLocal0123456789abcdefXYZ';

function app(rpc) {
  const calls = [];
  const ctx = { URL, atob, console, Promise, setTimeout, clearTimeout };
  ctx.window = ctx;
  ctx.Engine = {};
  ctx.Format = Format;
  ctx.APP_CONFIG = { SUPABASE_URL: URL_OK, SUPABASE_ANON_KEY: PUB };
  ctx.supabase = {
    createClient: () => ({
      auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: 'u1' } } }, error: null }) },
      rpc: (nome, args) => { calls.push([nome, args]); return Promise.resolve().then(() => rpc(nome, args)); }
    })
  };
  vm.createContext(ctx);
  vm.runInContext(read('docs', 'js', 'data.js'), ctx, { filename: 'data.js' });
  assert.equal(ctx.App.data.init(), true, 'init() do data.js falhou: ' + ctx.App.data.problem());
  return { D: ctx.App.data, calls };
}

// ── data.js ─────────────────────────────────────────────────────────────
test('deleteInvite: convite ainda não usado usa a função que já existia (funciona antes de rodar o 04)', async () => {
  const { D, calls } = app(() => ({ data: null, error: null }));
  const r = await D.deleteInvite('ABCDEFGHJKMN', false);
  assert.equal(r.ok, true);
  assert.deepEqual(plain(calls), [['admin_revoke_invite', { p_code: 'ABCDEFGHJKMN' }]]);
});

test('deleteInvite: convite já usado usa admin_delete_invite e manda só o código', async () => {
  const { D, calls } = app(() => ({ data: null, error: null }));
  const r = await D.deleteInvite('ABCDEFGHJKMN', true);
  assert.equal(r.ok, true);
  assert.deepEqual(plain(calls), [['admin_delete_invite', { p_code: 'ABCDEFGHJKMN' }]]);
});

test('deleteInvite: banco ainda sem o 04 vira aviso em português que cita o arquivo (nada de texto técnico na tela)', async () => {
  const { D } = app(() => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.admin_delete_invite(p_code) in the schema cache' } }));
  const r = await D.deleteInvite('ABCDEFGHJKMN', true);
  assert.equal(r.ok, false);
  assert.match(r.error, /04_apagar_convite\.sql/);
  assert.ok(!/PGRST|schema cache|public\./.test(r.error), r.error);
});

test('deleteInvite: quem não é admin recebe o aviso de permissão; sem internet, o aviso de internet', async () => {
  const sem = app(() => ({ data: null, error: { code: '42501', message: 'sem_permissao' } }));
  assert.match((await sem.D.deleteInvite('ABCDEFGHJKMN', true)).error, /não tem permissão/);
  const off = app(() => ({ data: null, error: { message: 'Failed to fetch' } }));
  assert.match((await off.D.deleteInvite('ABCDEFGHJKMN', false)).error, /Sem conexão/);
});

test('revokeInvite continua igual (o que já existia não muda)', async () => {
  const { D, calls } = app(() => ({ data: null, error: null }));
  assert.equal((await D.revokeInvite('ABCDEFGHJKMN')).ok, true);
  assert.deepEqual(plain(calls), [['admin_revoke_invite', { p_code: 'ABCDEFGHJKMN' }]]);
});

// ── a tela ──────────────────────────────────────────────────────────────
test('aba Conta: apagar vale para convite ativo, vencido e usado; só o ativo tem "compartilhar"; o usado pede confirmação', () => {
  const a = read('docs', 'js', 'account-view.js');
  // a lixeira não depende mais de o convite estar valendo
  assert.equal([...a.matchAll(/'aria-label': 'Apagar convite'/g)].length, 1);
  assert.match(a, /!used && !expired \? h\('button', \{ 'class': 'icon-btn', type: 'button', 'aria-label': 'Compartilhar convite'/);
  assert.ok(!/!used && !expired \? h\('div'/.test(a), 'a lixeira voltou a ficar dentro da condição "só convite valendo"');
  assert.match(a, /dropInvite\(c, nameOf\[c\.used_by\] \|\| 'alguém', box\)/);
  // convite não usado some na hora; o usado pergunta antes e explica que a pessoa continua com acesso
  assert.match(a, /if \(!used\) return go\(\);/);
  assert.match(a, /d\.confirmBox\(\{ title: 'Apagar este convite\?'/);
  assert.match(a, /A pessoa continua com acesso ao app/);
  assert.match(a, /D\.deleteInvite\(c\.code, used\)/);
  assert.ok(!/D\.revokeInvite/.test(a), 'a tela deve apagar por D.deleteInvite');
  assert.ok(!/innerHTML/.test(a));
});

// ── 04_apagar_convite.sql ───────────────────────────────────────────────
test('04_apagar_convite.sql: só ACRESCENTA a função nova, fecha para anon/service_role e confere tudo antes de valer', () => {
  const sql = read('supabase', '04_apagar_convite.sql');
  const codigo = sql.replace(/--.*$/gm, '');
  // blocos entre $$ ... $$ (corpo da função e conferências) ficam de fora desta leitura dos comandos "de cima"
  const corpos = [...codigo.matchAll(/\$\$([\s\S]*?)\$\$/g)].map((m) => m[1]);
  const comandos = codigo.replace(/\$\$[\s\S]*?\$\$/g, '$$$$').replace(/'(?:[^']|'')*'/g, "''");
  assert.match(comandos, /^\s*begin;/m);
  assert.match(comandos, /commit;/);
  const stmts = comandos.split(';').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  // (os blocos $$...$$ viram "$$" e os textos entre aspas viram '')
  assert.deepEqual(stmts, [
    'begin',
    'do $$',
    "create or replace function public.admin_delete_invite(p_code text) returns void language plpgsql security definer set search_path = '' as $$",
    'revoke all on function public.admin_delete_invite(text) from public, anon, authenticated, service_role',
    'grant execute on function public.admin_delete_invite(text) to authenticated',
    'do $$',
    'commit',
    "select '' as apagar_convite_instalado, (select count(*) from public.invites) as convites_na_lista"
  ]);
  // o corpo da função: só confere que é admin e apaga em public.invites (nunca em profiles nem em outra tabela)
  const fn = corpos.find((c) => /delete\s+from/i.test(c));
  assert.ok(fn, 'não achei o corpo da função');
  assert.equal([...fn.matchAll(/delete\s+from\s+public\.invites\b/gi)].length, 1);
  assert.equal([...fn.matchAll(/\b(delete|update|insert|drop|truncate|alter|create|grant|revoke)\b/gi)].length, 1, 'a função só faz UM delete');
  assert.match(fn, /public\.app_role\(\)\) is distinct from 'admin'/);
  assert.match(fn, /errcode = '42501'/);
  assert.ok(!/profiles/.test(fn), 'apagar convite não pode mexer em quem tem acesso');
  // as conferências (blocos "do") só olham; não mudam nada
  // (os textos entre aspas ficam de fora: as mensagens de erro citam "revoke" para ensinar o conserto)
  for (const c of corpos.filter((x) => x !== fn)) assert.ok(!/\b(delete|update|insert|drop|truncate|alter|grant|revoke)\b/i.test(c.replace(/'(?:[^']|'')*'/g, "''")), 'uma conferência altera o banco: ' + c.slice(0, 80));
  assert.match(codigo, /RODE_O_01_ANTES/);
  assert.match(codigo, /VERIFICACAO_FALHOU/);
  assert.match(codigo, /has_function_privilege\('anon', v_f, 'execute'\)/);
  assert.match(codigo, /has_function_privilege\('service_role', v_f, 'execute'\)/);
  // nenhum valor do orçamento é citado
  assert.ok(!/budget_|carry_over|app_settings|purchases/i.test(codigo));
});
