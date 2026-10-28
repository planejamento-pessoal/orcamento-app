#!/usr/bin/env node
/* Rode depois de mudar o docs/index.html:   node tools/sync-launcher.js
   Faz duas coisas:
   1. Recalcula os hashes dos blocos de script do docs/index.html e grava na política de
      segurança (meta Content-Security-Policy). Sem isso o navegador recusa o bloco que mudou.
   2. Copia o docs/index.html para dentro do projeto Android (assets/index.html), a
      "abertura de emergência" do APK quando a internet falha ou trava.
   O teste automático (tests/launcher.test.js) avisa se você esquecer de rodar. */
const fs = require('fs');
const path = require('path');
const { cspHashes, withHashes } = require('./csp.js');
const root = path.join(__dirname, '..');
const from = path.join(root, 'docs', 'index.html');
const to = path.join(root, 'android', 'app', 'src', 'main', 'assets', 'index.html');

const before = fs.readFileSync(from, 'utf8');
const after = withHashes(before);
if (after !== before) fs.writeFileSync(from, after);
console.log('ok: hashes dos scripts na política de segurança: ' + cspHashes(after).length + (after !== before ? ' (atualizados)' : ' (já estavam certos)'));

fs.mkdirSync(path.dirname(to), { recursive: true });
fs.copyFileSync(from, to);
console.log('ok: ' + path.relative(root, from) + ' -> ' + path.relative(root, to));
