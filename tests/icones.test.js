'use strict';
// Confere os ícones (Chrome, iPhone e APK) e as referências dos recursos do Android.
// Não há Android SDK nos testes: aqui só dá para ver se cada arquivo existe, tem o formato e o tamanho
// certos e se nenhum recurso aponta para algo que não existe (o que quebraria a compilação do APK).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const docs = path.join(root, 'docs');
const res = path.join(root, 'android', 'app', 'src', 'main', 'res');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

// ── leitor mínimo de PNG ────────────────────────────────────────────────
function png(file) {
  const b = fs.readFileSync(file);
  assert.equal(b.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', path.relative(root, file) + ' não é um PNG');
  const chunks = [];
  for (let i = 8; i + 8 <= b.length;) {
    const len = b.readUInt32BE(i);
    const type = b.subarray(i + 4, i + 8).toString('latin1');
    chunks.push(type);
    i += 12 + len;
    if (type === 'IEND') break;
  }
  assert.equal(chunks[0], 'IHDR', 'PNG sem IHDR');
  assert.equal(chunks[chunks.length - 1], 'IEND', path.relative(root, file) + ' está cortado (sem IEND)');
  const colorType = b[25];
  // 4 e 6 têm canal de transparência; 3 (paleta) só tem se houver o bloco tRNS
  const transparent = colorType === 4 || colorType === 6 || chunks.includes('tRNS');
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), depth: b[24], colorType, interlace: b[28], transparent, bytes: b.length };
}

// ── ícones do site (Chrome / iPhone) ────────────────────────────────────
const manifest = JSON.parse(read('docs', 'manifest.webmanifest'));

test('manifest: tem ícone 192 e 512 "any" e um 512 "maskable", todos PNG do tamanho que dizem ter', () => {
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 3, 'manifest sem ícones');
  for (const ic of manifest.icons) {
    assert.equal(ic.type, 'image/png', ic.src);
    const f = path.join(docs, ic.src);
    assert.ok(fs.existsSync(f), 'ícone do manifest não existe: ' + ic.src);
    const p = png(f);
    assert.equal(ic.sizes, `${p.w}x${p.h}`, `${ic.src}: o manifest diz ${ic.sizes}, o arquivo tem ${p.w}x${p.h}`);
    assert.equal(p.w, p.h, ic.src + ' não é quadrado');
    assert.equal(p.interlace, 0, ic.src + ': PNG entrelaçado (evite)');
    assert.ok(p.bytes <= 400 * 1024, `${ic.src}: ${Math.round(p.bytes / 1024)} KB é pesado demais para um ícone`);
  }
  const has = (purpose, size) => manifest.icons.some((i) => i.purpose === purpose && i.sizes === size);
  assert.ok(has('any', '192x192'), 'falta ícone "any" 192x192');
  assert.ok(has('any', '512x512'), 'falta ícone "any" 512x512');
  assert.ok(has('maskable', '512x512'), 'falta ícone "maskable" 512x512');
  assert.ok(!manifest.icons.some((i) => /any\s+maskable|maskable\s+any/.test(i.purpose || '')), '"any maskable" junto: separe em dois ícones');
});

test('ícone maskable: sem transparência (o Android recorta e pinta por cima do que for transparente)', () => {
  const m = manifest.icons.find((i) => i.purpose === 'maskable');
  const p = png(path.join(docs, m.src));
  assert.equal(p.transparent, false, 'o ícone maskable precisa ser opaco');
});

test('index.html: ícone da aba e do iPhone existem (apple-touch-icon 180x180 sem transparência)', () => {
  const html = read('docs', 'index.html');
  const links = [...html.matchAll(/<link\s+rel="(icon|apple-touch-icon)"\s+href="([^"]+)"([^>]*)>/g)];
  assert.ok(links.some((l) => l[1] === 'icon'), 'sem <link rel="icon">');
  const apple = links.find((l) => l[1] === 'apple-touch-icon');
  assert.ok(apple, 'sem <link rel="apple-touch-icon">');
  for (const l of links) assert.ok(fs.existsSync(path.join(docs, l[2])), 'ícone apontado pelo index.html não existe: ' + l[2]);
  const a = png(path.join(docs, apple[2]));
  assert.deepEqual([a.w, a.h], [180, 180], 'apple-touch-icon deve ser 180x180');
  assert.equal(a.transparent, false, 'o iPhone pinta preto o que for transparente: apple-touch-icon deve ser opaco');
  for (const l of links.filter((x) => x[1] === 'icon')) {
    const sz = /sizes="(\d+)x(\d+)"/.exec(l[3]);
    if (sz) { const p = png(path.join(docs, l[2])); assert.deepEqual([p.w, p.h], [Number(sz[1]), Number(sz[2])], l[2]); }
  }
});

test('docs/icons: nenhum arquivo esquecido (todo ícone é usado pelo manifest ou pelo index.html)', () => {
  const html = read('docs', 'index.html');
  const used = new Set([...manifest.icons.map((i) => i.src), ...[...html.matchAll(/href="(icons\/[^"]+)"/g)].map((m) => m[1])]);
  for (const f of fs.readdirSync(path.join(docs, 'icons'))) assert.ok(used.has('icons/' + f), 'ícone sem uso (apague ou use): icons/' + f);
});

// ── Android: ícone adaptativo e referências de recursos ─────────────────
test('Android: ícone adaptativo usa fundo e frente que existem; frente é PNG 648x648 com transparência', () => {
  const man = read('android', 'app', 'src', 'main', 'AndroidManifest.xml');
  assert.match(man, /android:icon="@mipmap\/ic_launcher"/);
  assert.match(man, /android:roundIcon="@mipmap\/ic_launcher_round"/);
  const a = read('android', 'app', 'src', 'main', 'res', 'mipmap-anydpi', 'ic_launcher.xml');
  const b = read('android', 'app', 'src', 'main', 'res', 'mipmap-anydpi', 'ic_launcher_round.xml');
  assert.equal(a, b, 'ic_launcher e ic_launcher_round deviam ser iguais');
  assert.match(a, /<adaptive-icon\b/);
  assert.match(a, /<background android:drawable="@drawable\/ic_launcher_background"\s*\/>/);
  assert.match(a, /<foreground android:drawable="@drawable\/ic_launcher_foreground"\s*\/>/);
  assert.ok(!/<monochrome/.test(a.replace(/<!--[\s\S]*?-->/g, '')), 'sem camada monochrome (o ícone temático mostraria uma silhueta no lugar do desenho)');
  const fg = png(path.join(res, 'drawable-nodpi', 'ic_launcher_foreground.png'));
  assert.deepEqual([fg.w, fg.h], [648, 648], 'a camada do ícone adaptativo é 108 dp a 6x = 648x648');
  assert.equal(fg.depth, 8);
  assert.equal(fg.interlace, 0);
  assert.equal(fg.transparent, true, 'a frente precisa ter transparência (o fundo aparece em volta do cartão)');
  assert.ok(fg.bytes <= 600 * 1024, 'frente do ícone pesada demais: ' + fg.bytes);
  assert.ok(!fs.existsSync(path.join(res, 'drawable', 'ic_launcher_foreground.xml')), 'sobrou o ic_launcher_foreground.xml antigo (conflita com o PNG)');
});

// Toda referência @tipo/nome dos XMLs do Android precisa existir. Sem isso o AAPT2 (compilador de recursos) falha
// e o APK não sai. Aqui não há AAPT2, então conferimos na mão.
function allFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) allFiles(p, out); else out.push(p);
  }
  return out;
}

test('Android: toda referência @tipo/nome (manifesto e res/) aponta para um recurso que existe', () => {
  const defined = {};
  const add = (t, n) => { (defined[t] = defined[t] || new Set()).add(n); };
  const files = allFiles(res);
  for (const f of files) {
    const rel = path.relative(res, f).split(path.sep);
    const type = rel[0].split('-')[0];
    if (type === 'values') {
      const x = fs.readFileSync(f, 'utf8');
      for (const m of x.matchAll(/<(color|string|style|dimen|bool|integer)\s+name="([^"]+)"/g)) add(m[1], m[2]);
    } else {
      add(type, path.basename(rel[rel.length - 1]).replace(/\.[^.]+$/, ''));
    }
  }
  const sources = files.filter((f) => f.endsWith('.xml')).concat(path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'));
  let checked = 0;
  const bad = [];
  for (const f of sources) {
    const x = fs.readFileSync(f, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    for (const m of x.matchAll(/@(drawable|mipmap|color|string|style|xml|layout|dimen|bool|integer)\/([A-Za-z0-9_.]+)/g)) {
      checked++;
      if (!(defined[m[1]] && defined[m[1]].has(m[2]))) bad.push(`${path.relative(root, f)}: @${m[1]}/${m[2]} não existe`);
    }
  }
  assert.ok(checked >= 10, 'achei poucas referências (' + checked + '): o teste parou de enxergar os arquivos?');
  assert.deepEqual(bad, []);
  // e o fundo do ícone é um degradê com cores definidas
  const bg = fs.readFileSync(path.join(res, 'drawable', 'ic_launcher_background.xml'), 'utf8');
  assert.match(bg, /<shape\b[\s\S]*<gradient\b/);
  assert.match(bg, /android:angle="(0|45|90|135|180|225|270|315)"/, 'o ângulo do degradê precisa ser múltiplo de 45');
});

test('Android: os XMLs de recursos são XML bem formado (tags abertas e fechadas)', () => {
  for (const f of allFiles(res).filter((x) => x.endsWith('.xml')).concat(path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'))) {
    const x = fs.readFileSync(f, 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/<\?xml[^>]*\?>/, '');
    const stack = [];
    for (const m of x.matchAll(/<(\/?)([A-Za-z][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g)) {
      if (m[4]) continue;                                   // <tag ... />
      if (!m[1]) stack.push(m[2]);
      else assert.equal(stack.pop(), m[2], `${path.relative(root, f)}: </${m[2]}> sem abertura certa`);
    }
    assert.deepEqual(stack, [], `${path.relative(root, f)}: tag aberta e não fechada`);
  }
});
