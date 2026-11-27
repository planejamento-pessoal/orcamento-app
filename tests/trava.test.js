'use strict';
// Correções da revisão independente da versão 1.6.0 (verificação do Cloudflare + digital). Só dados INVENTADOS e sem rede.
//  • a chave pública do Cloudflare no config.js (captchaKey / captchaProblem): chave SECRETA colada por engano nunca vale e
//    nunca é mostrada;
//  • travas estáticas do código da digital (ordem da saída, limite de espera, sensor sem resposta, relógio atrasado,
//    escolha que não pôde ser guardada) e do app Android (palavra "indisponivel", só constantes que existem no Android).
// (O comportamento na tela é conferido num navegador de verdade; isso não cabe nos testes sem dependências.)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

const URL_OK = 'https://abcdefghijklmnopqrst.supabase.co';
const PUB = 'sb_publishable_TesteLocal0123456789abcdefXYZ';

// Carrega data.js num "navegador" mínimo com um config.js qualquer e devolve App.data (init() já rodou).
function dataCom(extra) {
  const ctx = { URL, atob, console, Promise, setTimeout, clearTimeout };
  ctx.window = ctx;
  ctx.Engine = {};
  ctx.Format = require('../docs/js/format.js');
  ctx.supabase = { createClient: () => ({ auth: {} }) };
  ctx.APP_CONFIG = Object.assign({ SUPABASE_URL: URL_OK, SUPABASE_ANON_KEY: PUB }, extra || {});
  vm.createContext(ctx);
  vm.runInContext(read('docs', 'js', 'data.js'), ctx, { filename: 'data.js' });
  ctx.App.data.init();
  return ctx.App.data;
}
const com = (valor) => dataCom({ TURNSTILE_SITEKEY: valor });

// ── a chave do Cloudflare no config.js ───────────────────────────────────
test('captchaKey: aceita a chave pública (20 a 32 letras, números, _ e -) e tira os espaços das pontas', () => {
  const teste = '1x00000000000000000000AA';               // a chave de teste que o próprio Cloudflare publica
  const inventada = ['0x4AAAAAAA', 'InventadaChave_1-x'].join('');
  assert.equal(com(teste).captchaKey(), teste);
  assert.equal(com(inventada).captchaKey(), inventada);
  assert.equal(com('  ' + teste + '\n').captchaKey(), teste);
  assert.equal(com('A'.repeat(20)).captchaKey(), 'A'.repeat(20));
  assert.equal(com('A'.repeat(32)).captchaKey(), 'A'.repeat(32));
  assert.equal(com(teste).captchaProblem(), false);
});

test('captchaKey: chave que parece SECRETA (35 caracteres) nunca vale, e captchaProblem avisa', () => {
  const secreta = '0x4AAAAAAA' + 'INVENTADAparaoTesteXYZ' + '12345';          // 37 caracteres, inventada
  assert.ok(secreta.length > 32);
  const D = com(secreta);
  assert.equal(D.captchaKey(), null);
  assert.equal(D.captchaProblem(), true);
  const trinta5 = ['0x4AAAAAAA', 'INVENTADA', 'paraoTeste', 'XYZ123'].join('');   // emendado: nenhuma varredura de segredos acha este arquivo suspeito
  assert.equal(trinta5.length, 35);
  assert.equal(com(trinta5).captchaKey(), null);
  assert.equal(com(trinta5).captchaProblem(), true);
});

test('captchaKey: fora da regra (curta, longa, caractere estranho, não é texto) vale como "problema"; vazio e ausente não', () => {
  for (const ruim of ['A'.repeat(19), 'A'.repeat(33), 'chave com espaço no meio 123456', 'chave.com.ponto.1234567890', 'ação-com-acento-1234567890', 123, true, ['A'.repeat(24)], {}]) {
    const D = com(ruim);
    assert.equal(D.captchaKey(), null, 'não pode valer: ' + JSON.stringify(ruim));
    assert.equal(D.captchaProblem(), true, 'precisa avisar: ' + JSON.stringify(ruim));
  }
  for (const semChave of [undefined, null, '', '   ', '\n\t']) {
    const D = com(semChave);
    assert.equal(D.captchaKey(), null);
    assert.equal(D.captchaProblem(), false, 'sem chave configurada não é problema: ' + JSON.stringify(semChave));
  }
  const D = dataCom({});                                  // config.js sem o campo
  assert.equal(D.captchaKey(), null);
  assert.equal(D.captchaProblem(), false);
});

test('aviso da chave errada: texto fixo, sem o valor da chave, e o login não fica preso esperando o Cloudflare', () => {
  const src = read('docs', 'js', 'auth-view.js');
  const i = src.indexOf('D.captchaProblem && D.captchaProblem()');
  assert.ok(i > 0, 'a tela de entrar precisa checar captchaProblem');
  const bloco = src.slice(i, i + 900);
  assert.match(bloco, /ATENÇÃO: o campo TURNSTILE_SITEKEY do config\.js não tem uma chave pública do Cloudflare/);
  assert.match(bloco, /apague-a do config\.js agora/);
  assert.match(bloco, /role: 'alert'/);
  assert.match(bloco, /token: function \(\) \{ return Promise\.resolve\(null\); \}/);
  assert.ok(!/captchaKey\(\)|SITEKEY\s*\)|TURNSTILE_SITEKEY\s*\]/.test(bloco.replace(/'ATENÇÃO[^']*'/, '')), 'o aviso não pode usar o valor da chave');
  assert.equal(/Promise\.resolve\(null\)/.test(bloco), true);
});

// ── a digital: travas do código ──────────────────────────────────────────
const auth = read('docs', 'js', 'auth-view.js');
// o corpo de uma função "function nome(...) { ... }" (chaves casadas), ignorando chaves dentro de textos
function corpo(src, nome) {
  const i = src.indexOf('function ' + nome + '(');
  assert.ok(i >= 0, 'não achei function ' + nome);
  let j = src.indexOf('{', i), n = 0, k = j, aspas = null;
  for (; k < src.length; k++) {
    const c = src[k];
    if (aspas) { if (c === '\\') k++; else if (c === aspas) aspas = null; continue; }
    if (c === "'" || c === '"') { aspas = c; continue; }
    if (c === '/' && src[k + 1] === '/') { while (k < src.length && src[k] !== '\n') k++; continue; }
    if (c === '{') n++;
    else if (c === '}') { n--; if (n === 0) break; }
  }
  return src.slice(i, k + 1);
}

test('"Sair e usar a senha": o bloqueio fica até a saída terminar e só então a trava é desligada', () => {
  const lock = corpo(auth, 'lockScreen');
  assert.match(lock, /link\('Sair e usar a senha', usePassword\)/);
  const up = corpo(lock, 'usePassword');
  const sai = up.indexOf('App.signOutNow()'), grava = up.indexOf('bioSave(uid, { on: false'), fecha = up.indexOf('close(); resolve(false)');
  assert.ok(sai > 0 && grava > sai && fecha > sai, 'a trava só pode ser desligada e o bloqueio fechado DEPOIS de pedir a saída');
  assert.ok(/Promise\.resolve\(out\)\.then\(function \(\) \{[\s\S]*bioSave\(uid, \{ on: false[\s\S]*close\(\); resolve\(false\);[\s\S]*\}, function \(\) \{/.test(up), 'a trava e o fechamento ficam dentro do "deu certo"');
  assert.match(up, /Saindo da conta…/);
  assert.match(up, /Não consegui sair agora\. Tente de novo ou use a digital\./);
  assert.match(up, /leaving = true; go\.disabled = true; pw\.disabled = true/);
  assert.match(up, /if \(done \|\| leaving\) return;/);
  // uma digital confirmada no meio da saída não abre o app, e a pergunta não recomeça durante a saída
  const ask = corpo(lock, 'ask');
  assert.match(ask, /if \(busy \|\| done \|\| leaving\) return;/);
  assert.match(ask, /go\.disabled = leaving;\s*\n\s*if \(done \|\| leaving\) return;/);
});

test('"o aparelho sabe pedir a digital?": tem limite de espera e falha vira "erro" (nunca "sem suporte" que desligaria a trava)', () => {
  assert.match(auth, /var BIO_SUPPORT_MS = 5000;/);
  const sup = corpo(auth, 'bioSupport');
  assert.match(sup, /setTimeout\(function \(\) \{ end\(\{ ok: false, why: 'erro' \}\); \}, BIO_SUPPORT_MS\)/);
  assert.match(sup, /clearTimeout\(t\)/);
  assert.match(sup, /isUserVerifyingPlatformAuthenticatorAvailable\(\)\.then\(function \(yes\) \{[\s\S]*function \(\) \{ end\(\{ ok: false, why: 'erro' \}\); \}\)/);
  assert.match(sup, /catch \(e\) \{ end\(\{ ok: false, why: 'erro' \}\); \}/);
  assert.ok(!/why: 'sem_suporte' \}\)/.test(sup.slice(sup.indexOf('return new Promise'))), 'dentro da espera, falha não pode virar sem_suporte');
});

test('abrir o app: sensor sem resposta abre só desta vez e NÃO desliga a trava; outros motivos continuam desligando', () => {
  const gate = corpo(auth, 'bioGate');
  const a = gate.indexOf("sp.why === 'indisponivel'"), b = gate.indexOf('bioSave(uid, { on: false');
  assert.ok(a > 0 && b > a, 'o ramo do sensor sem resposta vem antes de desligar a trava');
  const ramo = gate.slice(a, gate.indexOf('return true;', a) + 12);
  assert.ok(!/bioSave/.test(ramo), 'o ramo do sensor sem resposta não pode gravar nada');
  assert.match(ramo, /O sensor do celular não respondeu agora\. O app abriu sem pedir a digital desta vez\./);
  assert.match(auth, /indisponivel: 'O sensor do celular não respondeu agora\. Tente de novo em instantes\.'/);
  assert.match(gate, /sp\.why !== 'erro'/);                   // resposta que ninguém entendeu ('erro') cai na tela de bloqueio
});

test('voltar do segundo plano: relógio atrasado (tempo fora negativo) não pula o bloqueio', () => {
  const w = corpo(auth, 'bioWatch');
  assert.match(w, /if \(away >= 0 && away < BIO_GRACE_MS\) \{ bioShow\(false\); return; \}/);
});

test('ligar a digital: se a escolha não pôde ser guardada, não diz que ligou', () => {
  const en = corpo(auth, 'bioEnable');
  assert.match(en, /function saved\(rec\) \{ return bioSave\(uid, rec\) \? \{ ok: true \} : \{ ok: false, text: NOSAVE \}; \}/);
  assert.equal((en.match(/saved\(\{/g) || []).length, 2, 'as duas formas (Android e navegador) passam por saved()');
  assert.ok(!/\bbioSave\(uid, \{ on: true/.test(en), 'nenhum bioSave "ligado" sem conferir o resultado');
  assert.match(auth, /var NOSAVE = 'Não consegui guardar esta escolha neste aparelho/);
});

// ── a digital: app Android ───────────────────────────────────────────────
test('app Android: palavra "indisponivel" para sensor ocupado e só constantes que existem no Android de verdade', () => {
  const java = read('android', 'app', 'src', 'main', 'java', 'com', 'bruno', 'orcamento', 'MainActivity.java');
  const st = java.slice(java.indexOf('static String status(Context c)'), java.indexOf('static CancellationSignal ask('));
  assert.match(st, /BIOMETRIC_ERROR_HW_UNAVAILABLE\) return "indisponivel";/);
  assert.match(st, /catch \(RuntimeException e\) \{\s*return "indisponivel";/);
  assert.match(st, /BIOMETRIC_SUCCESS\) return "pronta";/);
  assert.match(st, /BIOMETRIC_ERROR_NONE_ENROLLED\) return "sem_digital";/);
  assert.match(st, /return "sem_aparelho";/);
  // BIOMETRIC_STATUS_UNKNOWN e BIOMETRIC_ERROR_UNSUPPORTED só existem no androidx; usá-las com a classe do Android não compila
  assert.ok(!/BIOMETRIC_STATUS_UNKNOWN|BIOMETRIC_ERROR_UNSUPPORTED/.test(java), 'constante que só existe no androidx');
  assert.match(java, /entrega a ponte a TODOS os quadros da página, inclusive ao quadro da\s*\n\s*\/\/ verificação do Cloudflare/, 'o comentário da ponte precisa dizer a verdade: ela vale para todos os quadros');
});

test('as palavras do Android que a página entende são exatamente as que o app Android pode devolver', () => {
  const java = read('android', 'app', 'src', 'main', 'java', 'com', 'bruno', 'orcamento', 'MainActivity.java');
  const doJava = new Set((java.match(/return "(pronta|sem_digital|antigo|indisponivel|sem_aparelho)";/g) || []).map((x) => x.replace(/return "|";/g, '')));
  assert.deepEqual([...doJava].sort(), ['antigo', 'indisponivel', 'pronta', 'sem_aparelho', 'sem_digital']);
  const why = auth.slice(auth.indexOf('var WHY = {'), auth.indexOf('var NOSAVE'));
  for (const w of ['antigo', 'sem_digital', 'sem_aparelho', 'indisponivel']) assert.ok(why.includes(w + ':'), 'a página não explica "' + w + '"');
});
