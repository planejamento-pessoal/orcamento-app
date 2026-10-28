/* ════════════════════════════════════════════════════════════════════════
   sw.js — service worker MÍNIMO. Faz uma coisa só: deixar a página inicial
   (index.html) disponível sem internet, para o app instalado pelo Chrome abrir
   mesmo offline. Todo o resto (arquivos do app) é tratado pelo carregador do
   próprio index.html, que confere versão nova a cada abertura. Por isso este
   arquivo NÃO guarda código do app e nunca deixa uma versão velha "presa".

   Regra: rede primeiro. Se a rede falhar, ou demorar mais de 6 s, usa a última
   página inicial que deu certo.
   ════════════════════════════════════════════════════════════════════════ */
'use strict';
var CACHE = 'orc-inicio-v1';
var KEY = 'index';

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

function fromCache() {
  return caches.open(CACHE).then(function (c) { return c.match(KEY); });
}

function networkFirst(req) {
  return new Promise(function (resolve) {
    var done = false;
    function give(r) { if (!done && r) { done = true; resolve(r); } return !!r; }
    // sinal fraco: depois de 6 s entrega a cópia (o pedido continua e atualiza a cópia quando chegar)
    var timer = setTimeout(function () { fromCache().then(give).catch(function () {}); }, 6000);
    fetch(req).then(function (res) {
      clearTimeout(timer);
      if (res && res.ok && res.type === 'basic') {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { return c.put(KEY, copy); }).catch(function () {});
      }
      give(res);
    }, function () {
      clearTimeout(timer);
      fromCache().then(function (r) { if (!give(r)) give(Response.error()); }).catch(function () { give(Response.error()); });
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || req.mode !== 'navigate') return; // só a abertura do app
  e.respondWith(networkFirst(req));
});
