// Confere o contraste (WCAG) dos pares de cores do app, nos dois temas,
// lendo os valores direto do app.css — se alguém mudar uma cor, o teste avisa.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '../docs/app.css'), 'utf8');
function tokens(block) {
  const out = {};
  for (const m of block.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\b/g)) out[m[1]] = m[2];
  return out;
}
function blockAfter(marker) {
  const i = css.indexOf(marker);
  assert.ok(i >= 0, 'bloco não encontrado: ' + marker);
  const start = css.indexOf('{', i), end = css.indexOf('}', start);
  return css.slice(start + 1, end);
}
const light = tokens(blockAfter(':root {'));
const dark = tokens(blockAfter(':root[data-theme="dark"]'));
const darkMedia = tokens(blockAfter(':root:not([data-theme="light"])'));

function lum(hex) {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }

const TEXT = [ // [texto, fundo]
  ['tinta', 'folha'], ['tinta', 'folha-2'], ['tinta-2', 'folha'], ['tinta-2', 'folha-2'], ['tinta-3', 'folha'], ['tinta-3', 'folha-2'],
  ['azul', 'folha'], ['azul', 'folha-2'], ['azul', 'azul-fundo'], ['tinta', 'azul-fundo'],
  ['vermelho', 'folha'], ['vermelho', 'folha-2'], ['vermelho', 'vermelho-fundo'],
  ['ambar', 'folha'], ['ambar', 'folha-2'], ['ambar', 'ambar-fundo'], ['tinta', 'ambar-fundo'],
  ['ok', 'folha'], ['ok', 'folha-2'], ['ok', 'ok-fundo'],
  ['sobre-azul', 'azul'], ['sobre-vermelho', 'vermelho'], ['folha', 'tinta'],
  ['sobre-ok', 'ok'], ['ok', 'sobre-ok'], // chavinha ligada: bolinha sobre o trilho e o "visto" dentro da bolinha
];
const GRAFICO = [ // marcas e bordas de campo: mínimo 3:1
  ['azul', 'folha'], ['azul', 'folha-2'], ['serie', 'folha'], ['serie', 'folha-2'], ['regua-forte', 'folha'], ['regua-forte', 'folha-2'], ['ambar', 'folha'], ['tinta-3', 'folha'],
  ['ok', 'folha'], ['ok', 'folha-2'], ['sobre-ok', 'ok'], // chavinha: trilho ligado sobre o papel e bolinha sobre o trilho
  ['regua-forte', 'folha-2'], // chavinha desligada: bolinha e borda do trilho sobre o fundo do trilho
];

for (const [nome, t] of [['claro', light], ['escuro', dark]]) {
  test(`contraste do texto (4,5:1) no tema ${nome}`, () => {
    const falhas = [];
    for (const [a, b] of TEXT) {
      assert.ok(t[a] && t[b], `token ausente: ${a} ou ${b}`);
      const r = ratio(t[a], t[b]);
      if (r < 4.5) falhas.push(`${a} ${t[a]} sobre ${b} ${t[b]} = ${r.toFixed(2)}`);
    }
    assert.deepEqual(falhas, []);
  });
  test(`contraste de marcas e bordas (3:1) no tema ${nome}`, () => {
    const falhas = [];
    for (const [a, b] of GRAFICO) {
      const r = ratio(t[a], t[b]);
      if (r < 3) falhas.push(`${a} ${t[a]} sobre ${b} ${t[b]} = ${r.toFixed(2)}`);
    }
    assert.deepEqual(falhas, []);
  });
}

test('o tema escuro automático (media query) é igual ao tema escuro manual', () => {
  assert.deepEqual(darkMedia, dark);
});
