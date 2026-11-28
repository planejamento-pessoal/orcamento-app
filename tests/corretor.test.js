'use strict';
// Corretor ortográfico (1.6.1): as caixas de texto livre (nome de conta, de simulação e de compra, categoria)
// pedem o corretor do aparelho. No Android (WebView do APK) ele só aparece se a página pedir (spellcheck="true").
// Senha, e-mail, código do convite e valores NÃO ganham corretor. Só dados inventados e sem rede.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

// Mini-DOM: o bastante para o dom.js carregar e montar uma caixa de texto.
function el(tag) {
  const attrs = {}, kids = [];
  return {
    tagName: String(tag).toUpperCase(), attrs, kids, style: {}, dataset: {}, value: '',
    setAttribute(k, v) { attrs[k] = String(v); }, getAttribute(k) { return k in attrs ? attrs[k] : null; },
    appendChild(c) { kids.push(c); return c; }, addEventListener() {}, removeEventListener() {},
    classList: { add() {}, remove() {}, toggle() {} }, querySelector() { return null; }, querySelectorAll() { return []; }
  };
}
function carregaDom() {
  const document = {
    createElement: el, createElementNS: (ns, t) => el(t), createTextNode: (t) => ({ nodeType: 3, text: String(t) }),
    body: el('body'), documentElement: el('html'), addEventListener() {}, querySelector() { return null; }, getElementById() { return null; }
  };
  const window = { Format: require('../docs/js/format.js'), document, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), navigator: {}, location: { protocol: 'https:' } };
  vm.runInContext(read('docs', 'js', 'dom.js'), vm.createContext({ window, document, console, setTimeout, clearTimeout, navigator: window.navigator, location: window.location }), { filename: 'dom.js' });
  return window.App.dom;
}

test('dom.textInput: liga o corretor (spellcheck e autocorrect), mantém o resto e repassa o que vier', () => {
  const d = carregaDom();
  const calls = [];
  const x = d.textInput({ maxlength: 80, placeholder: 'Ex.: Nubank', value: 'Enel', 'aria-label': 'Nome', on: { input: (e) => calls.push(e) } });
  assert.equal(x.tagName, 'INPUT');
  assert.equal(x.attrs.type, 'text');
  assert.equal(x.attrs['class'], 'entrada');
  assert.equal(x.attrs.spellcheck, 'true');
  assert.equal(x.attrs.autocorrect, 'on');
  assert.equal(x.attrs.autocomplete, 'off');   // continua sem o histórico/preenchimento automático do navegador
  assert.equal(x.attrs.maxlength, '80');
  assert.equal(x.attrs.placeholder, 'Ex.: Nubank');
  assert.equal(x.attrs['aria-label'], 'Nome');
  assert.equal(x.value, 'Enel');
  // sem argumentos também funciona
  assert.equal(d.textInput().attrs.spellcheck, 'true');
});

test('dom.textInput: quem chama pode trocar o padrão (ex.: tirar o corretor de um campo)', () => {
  const d = carregaDom();
  const x = d.textInput({ spellcheck: 'false', autocorrect: 'off' });
  assert.equal(x.attrs.spellcheck, 'false');
  assert.equal(x.attrs.autocorrect, 'off');
});

test('campo de valor (dinheiro) não ganha corretor', () => {
  const d = carregaDom();
  const m = d.moneyInput(0);
  assert.equal(m.attrs.spellcheck, undefined);
  assert.equal(m.attrs.autocorrect, undefined);
  assert.equal(m.attrs.inputmode, 'decimal');
});

test('telas: nome do item (editar e novo), nome da simulação, nome da compra e categoria usam d.textInput', () => {
  const sheets = read('docs', 'js', 'sheets.js');
  const sim = read('docs', 'js', 'sim-view.js');
  assert.equal((sheets.match(/\bd\.textInput\(/g) || []).length, 2, 'sheets.js: nome do item ao editar e ao criar');
  assert.equal((sim.match(/\bd\.textInput\(/g) || []).length, 3, 'sim-view.js: nome da simulação, nome da compra e categoria');
  assert.match(sheets, /var name = d\.textInput\(\{ maxlength: 80, value: item\.name \}\);/);
  assert.match(sheets, /var name = d\.textInput\(\{ maxlength: 80, placeholder: 'Ex\.: Nubank, Internet, Salário' \}\);/);
  assert.match(sim, /var cat = d\.textInput\(\{ maxlength: 40,/);
});

test('guarda: nenhuma caixa de texto livre nova pode ficar sem decisão (usar d.textInput ou entrar na lista de exceções)', () => {
  // Exceções de propósito (corretor ali só atrapalha ou o campo é um código): nome da pessoa no cadastro,
  // código do convite (2 telas), lembrete do convite ("Ex.: Maria"), loja/pessoa e modelo da compra.
  const EXCECOES = { 'auth-view.js': 3, 'account-view.js': 1, 'sim-view.js': 2 };
  const dir = path.join(root, 'docs', 'js');
  const achou = {};
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    const src = read('docs', 'js', f);
    // uma caixa "crua": h('input', { ... type: 'text' ... })
    const n = (src.match(/h\('input',\s*\{[^}]*type:\s*'text'/g) || []).length;
    if (f === 'dom.js') continue;   // moneyInput (valor) e textInput (o próprio corretor) moram aqui
    if (n) achou[f] = n;
  }
  assert.deepEqual(achou, EXCECOES,
    'Há uma caixa de texto livre fora da lista. Se for um nome/descrição, use d.textInput({...}); se não for (código, nome de pessoa...), acrescente aqui de propósito.');
});

test('e-mail, senha e código do convite continuam sem corretor', () => {
  const auth = read('docs', 'js', 'auth-view.js');
  assert.match(auth, /type: 'email'[^}]*spellcheck: 'false'/);
  assert.equal((auth.match(/autocapitalize: 'characters', spellcheck: 'false'/g) || []).length, 2, 'código do convite nas 2 telas');
  assert.doesNotMatch(read('docs', 'js', 'account-view.js'), /type: 'password'[^}]*spellcheck: 'true'/);
});

test('versão 1.6.1 e só arquivos que já existiam: index.html, sw.js e a lista de arquivos ficam como estão', () => {
  assert.match(read('docs', 'js', 'app.js'), /App\.version = '1\.6\.1';/);
  const idx = read('docs', 'index.html');
  assert.doesNotMatch(idx, /corretor|textInput/);          // o carregador não precisa saber disso
  assert.equal(fs.existsSync(path.join(root, 'docs', 'js', 'corretor.js')), false);
});
