'use strict';
// Vigia as travas de segurança do Android e do GitHub Actions, para ninguém desfazer sem querer.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

// ── GitHub Actions ──────────────────────────────────────────────────────
const wfDir = path.join(root, '.github', 'workflows');
const workflows = fs.readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f)).map((f) => ({ f, txt: read('.github', 'workflows', f) }));

test('workflows: toda "action" de terceiros fixada por hash de 40 letras (não por versão flutuante)', () => {
  assert.ok(workflows.length >= 2);
  for (const { f, txt } of workflows) {
    for (const m of txt.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)) {
      assert.match(m[1], /^[\w.-]+\/[\w.-]+(\/[\w./-]+)?@[0-9a-f]{40}$/, `${f}: "${m[1]}" precisa estar fixada por hash (@<40 letras e números>)`);
    }
  }
});

test('workflows: permissões mínimas e escrita só onde precisa', () => {
  for (const { f, txt } of workflows) {
    assert.match(txt, /^permissions:/m, `${f}: sem "permissions:" no topo (o padrão do GitHub pode dar escrita)`);
    assert.ok(!/pull_request_target/.test(txt), `${f}: pull_request_target dá segredos a pedidos de estranhos`);
    const semIf = txt.split('\n').filter((l) => !/^\s*if:/.test(l)).join('\n');
    assert.ok(!/\$\{\{\s*(github\.event\.|github\.head_ref|inputs\.)/.test(semIf), `${f}: texto vindo de evento/entrada dentro do workflow fora de "if:" (risco de injeção de comando)`);
  }
  const tests = workflows.find((w) => w.f === 'tests.yml').txt;
  assert.match(tests, /^permissions:\s*\n\s+contents:\s*read\s*$/m, 'tests.yml deve ter só contents: read');
  assert.ok(!/secrets\./.test(tests), 'tests.yml não deve usar segredos');
  const apk = workflows.find((w) => w.f === 'android.yml').txt;
  assert.match(apk, /^permissions:\s*\{\}\s*$/m, 'android.yml: permissões vazias no topo');
  const writes = [...apk.matchAll(/contents:\s*write/g)].length;
  assert.equal(writes, 1, 'android.yml: só o trabalho de publicar pode ter contents: write');
  const jobs = apk.slice(apk.indexOf('\njobs:'));
  const build = jobs.slice(jobs.indexOf('\n  apk:'), jobs.indexOf('\n  publicar:'));
  assert.ok(build.length > 200 && /Compilar/.test(build), 'não achei o trabalho de compilar');
  assert.ok(!/contents:\s*write/.test(build), 'o trabalho que compila (roda código de terceiros) não pode ter escrita');
  assert.match(build, /persist-credentials:\s*false/, 'checkout do build sem persist-credentials: false');
  const pub = jobs.slice(jobs.indexOf('\n  publicar:'));
  assert.ok(/Criar a Release/.test(pub), 'não achei o trabalho de publicar');
  assert.ok(!/actions\/checkout|gradlew|node |npm /.test(pub), 'o trabalho que publica (com escrita) não deve rodar código do projeto');
});

test('workflows: o checksum do gradle-wrapper.jar bate com o arquivo do repositório', () => {
  const apk = read('.github', 'workflows', 'android.yml');
  const sum = /echo "([0-9a-f]{64})\s+android\/gradle\/wrapper\/gradle-wrapper\.jar"/.exec(apk);
  assert.ok(sum, 'checksum do wrapper não encontrado no android.yml');
  const real = require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root, 'android', 'gradle', 'wrapper', 'gradle-wrapper.jar'))).digest('hex');
  assert.equal(real, sum[1], 'o gradle-wrapper.jar do repositório não é o que o workflow espera');
});

test('Gradle: distribuição por https e com checksum', () => {
  const p = read('android', 'gradle', 'wrapper', 'gradle-wrapper.properties');
  assert.match(p, /^distributionUrl=https\\:\/\/services\.gradle\.org\/distributions\/gradle-[\d.]+-bin\.zip$/m);
  assert.match(p, /^distributionSha256Sum=[0-9a-f]{64}$/m, 'sem distributionSha256Sum');
  assert.match(p, /^validateDistributionUrl=true$/m);
});

// ── Android ─────────────────────────────────────────────────────────────
test('manifesto: sem backup, sem tráfego aberto, só as permissões necessárias, uma única porta de entrada', () => {
  const m = read('android', 'app', 'src', 'main', 'AndroidManifest.xml');
  assert.match(m, /android:allowBackup="false"/);
  assert.match(m, /android:usesCleartextTraffic="false"/);
  assert.match(m, /android:dataExtractionRules="@xml\/data_extraction_rules"/);
  assert.ok(!/android:debuggable/.test(m), 'debuggable no manifesto');
  const perms = [...m.matchAll(/<uses-permission android:name="([^"]+)"/g)].map((x) => x[1]).sort();
  assert.deepEqual(perms, ['android.permission.ACCESS_NETWORK_STATE', 'android.permission.INTERNET']);
  assert.equal([...m.matchAll(/android:exported="true"/g)].length, 1, 'só a tela principal pode ser exportada');
  assert.equal([...m.matchAll(/<(service|receiver|provider)\b/g)].length, 0, 'sem service/receiver/provider');
  assert.equal([...m.matchAll(/<intent-filter>/g)].length, 1, 'só o filtro de abrir pelo ícone (sem links externos que abram o app)');
  const rules = read('android', 'app', 'src', 'main', 'res', 'xml', 'data_extraction_rules.xml');
  for (const tag of ['cloud-backup', 'device-transfer']) assert.match(rules, new RegExp(`<${tag}>[\\s\\S]*<exclude domain="root"`), tag + ' deve excluir tudo');
});

test('MainActivity: tela protegida, links travados, rede só para o app e o Supabase, sem endereço escrito à mão', () => {
  const j = read('android', 'app', 'src', 'main', 'java', 'com', 'bruno', 'orcamento', 'MainActivity.java');
  assert.match(j, /TELA_PROTEGIDA\s*=\s*true/);
  assert.match(j, /FLAG_SECURE/);
  assert.match(j, /START_URL\s*=\s*BuildConfig\.START_URL/);
  assert.match(j, /setAllowFileAccess\(false\)/);
  assert.match(j, /setAllowContentAccess\(false\)/);
  assert.match(j, /setMixedContentMode\(WebSettings\.MIXED_CONTENT_NEVER_ALLOW\)/);
  assert.match(j, /setSupportMultipleWindows\(false\)/);
  assert.match(j, /shouldOverrideUrlLoading/);
  assert.match(j, /shouldInterceptRequest/);
  assert.ok(!/onReceivedSslError/.test(j), 'não pode aceitar certificado inválido');
  assert.ok(!/setWebContentsDebuggingEnabled\(true\)/.test(j.replace(/FLAG_DEBUGGABLE[\s\S]{0,200}setWebContentsDebuggingEnabled\(true\)/, '')), 'depuração remota ligada fora do build de teste');
  assert.ok(!/addJavascriptInterface\([^)]*\)/.test(j.replace(/w\.addJavascriptInterface\(new Bridge\(\), "OrcAndroid"\)/, '')), 'só a ponte OrcAndroid pode ser exposta à página');
  assert.equal([...j.matchAll(/@JavascriptInterface/g)].length, 1, 'a ponte deve ter UM método');
  const urls = [...j.matchAll(/https?:\/\/[^\s"')]+/g)].map((m) => m[0]).filter((u) => !/sdk|android|supabase\.co|ABCD|site-ruim|seu-site/.test(u));
  assert.deepEqual(urls, [], 'endereços escritos à mão no MainActivity.java');
});

test('build.gradle: endereço do app vem do ambiente e é validado; sem senha de assinatura escrita', () => {
  const g = read('android', 'app', 'build.gradle');
  assert.match(g, /System\.getenv\('ORC_START_URL'\)/);
  assert.match(g, /buildConfigField 'String', 'START_URL'/);
  assert.match(g, /GradleException/);
  assert.ok(!/storePassword\s+['"]/.test(g) && !/keyPassword\s+['"]/.test(g), 'senha de assinatura escrita no build.gradle');
  assert.ok(!/debuggable\s+true/.test(g));
});

test('.gitignore: chaves de assinatura, APK e arquivos privados nunca sobem', () => {
  const g = read('.gitignore').split(/\r?\n/).map((s) => s.trim());
  for (const pat of ['*.jks', '*.keystore', 'keystore.properties', 'PRIVADO*', '*.apk', 'android/local.properties']) assert.ok(g.includes(pat), '.gitignore sem ' + pat);
});

// ── páginas ─────────────────────────────────────────────────────────────
test('index.html: política de segurança, sem referrer, anti-moldura; sem scripts de fora', () => {
  const h = read('docs', 'index.html');
  assert.match(h, /<meta http-equiv="Content-Security-Policy"/);
  assert.match(h, /<meta name="referrer" content="no-referrer">/);
  assert.match(h, /window\.top !== window\.self/);
  assert.ok(!/<script[^>]+src=/i.test(h), 'script com src no index.html (a política só aceita os escritos aqui e blob:)');
  assert.ok(!/<(iframe|object|embed|form)\b/i.test(h));
});

test('sw.js: só cuida da abertura do app (nada de guardar dados nem respostas do Supabase)', () => {
  const s = read('docs', 'sw.js');
  assert.match(s, /req\.mode !== 'navigate'/);
  assert.ok(!/supabase/i.test(s), 'o service worker não pode tocar no Supabase');
});
