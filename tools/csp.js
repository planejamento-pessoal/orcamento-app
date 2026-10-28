/* Ajudante da política de segurança (CSP) do docs/index.html.
   Usado por tools/sync-launcher.js (grava) e por tests/launcher.test.js (confere). */
'use strict';
const crypto = require('crypto');

// Os navegadores trocam CRLF por LF antes de formar o texto do script; fazemos igual.
function norm(s) { return s.replace(/\r\n?/g, '\n'); }

// Hash (sha256, base64) de cada bloco <script> escrito direto no HTML (sem src).
function cspHashes(html) {
  const out = [];
  for (const m of norm(html).matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    out.push("'sha256-" + crypto.createHash('sha256').update(m[1], 'utf8').digest('base64') + "'");
  }
  return out;
}

const META = /(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(")/;

function policyOf(html) {
  const m = META.exec(html);
  return m ? m[2] : null;
}

// Devolve o HTML com o script-src da política refeito com os hashes de agora.
function withHashes(html) {
  if (!META.test(html)) throw new Error('docs/index.html sem a meta Content-Security-Policy');
  const hashes = cspHashes(html);
  if (!hashes.length) throw new Error('nenhum bloco de script encontrado no docs/index.html');
  return html.replace(META, (all, a, csp, c) => a + csp.replace(/script-src [^;]*/, 'script-src ' + hashes.join(' ') + ' blob:') + c);
}

module.exports = { cspHashes, withHashes, policyOf };
