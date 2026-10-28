/* ════════════════════════════════════════════════════════════════════════
   chart.js — gráfico de linha do saldo (SVG puro, sem biblioteca).

   • 1 ou 2 séries no mesmo eixo (nunca dois eixos).
   • Linha de 2px, marcador de 8px com anel da cor do papel, grade fina sólida,
     linha tracejada só para o saldo mínimo (é um limite, não grade).
   • Rótulo direto só no último ponto e no menor saldo; o resto fica na dica
     (toque/passe o dedo) e na tabela logo abaixo da tela.
   • Setas do teclado percorrem os meses.
   ════════════════════════════════════════════════════════════════════════ */
(function (App) {
  'use strict';
  var d = App.dom, F = App.fmt, h = d.h, s = d.s;
  var uid = 0;

  function niceStep(range, target) {
    var raw = range / target, mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), n = raw / mag;
    var step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return step * mag;
  }

  // opt: { series:[{key,label,color,pts:[{month,saldo,entradas,saidas,resultado}]}],
  //        minCents, height, ariaLabel, extras(i)->[[rótulo,texto]], onPick(i) }
  function lineChart(host, opt) {
    var id = ++uid, selected = -1, ro = null, destroyed = false, lastW = 0;

    function draw() {
      d.clear(host);
      var series = opt.series, n = series[0].pts.length;
      if (n < 2) { host.appendChild(h('p', { 'class': 'vazio', text: 'Escolha pelo menos 2 meses para ver o gráfico.' })); return; }
      var W = Math.max(280, Math.round(host.clientWidth || 340)), H = opt.height || 232;
      lastW = W;
      var pad = { l: 46, r: 16, t: 18, b: 28 }, iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;

      var vals = [0];
      series.forEach(function (sr) { sr.pts.forEach(function (p) { if (p.saldo != null) vals.push(p.saldo); }); });
      if (opt.minCents != null) vals.push(opt.minCents);
      var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
      if (hi === lo) hi = lo + 100000;
      var step = niceStep(hi - lo, 4);
      lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
      function X(i) { return pad.l + i * iw / (n - 1); }
      function Y(v) { return pad.t + (hi - v) * ih / (hi - lo); }
      var y0 = Y(0);

      var svg = s('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'group', tabindex: '0', 'aria-label': (opt.ariaLabel || 'Gráfico do saldo') + '. Use as setas para percorrer os meses.' });
      var defs = s('defs');
      var cpPos = 'cp-pos-' + id, cpNeg = 'cp-neg-' + id;
      defs.appendChild(s('clipPath', { id: cpPos }, s('rect', { x: 0, y: 0, width: W, height: Math.max(0, y0) })));
      defs.appendChild(s('clipPath', { id: cpNeg }, s('rect', { x: 0, y: y0, width: W, height: Math.max(0, H - y0) })));
      svg.appendChild(defs);

      // grade e eixo Y
      for (var v = lo; v <= hi + 1; v += step) {
        var yy = Y(v);
        svg.appendChild(s('line', { 'class': v === 0 ? 'g-zero' : 'g-grade', x1: pad.l, x2: W - pad.r, y1: yy, y2: yy }));
        svg.appendChild(s('text', { 'class': 'g-txt', x: pad.l - 8, y: yy + 4, 'text-anchor': 'end', text: F.compact(v) }));
      }
      // eixo X
      var maxLabels = Math.max(2, Math.floor(iw / 52)), every = Math.ceil(n / maxLabels);
      for (var i = 0; i < n; i += every) {
        var anchor = i === 0 ? 'start' : (i >= n - 1 ? 'end' : 'middle');
        svg.appendChild(s('text', { 'class': 'g-txt', x: X(i), y: H - 8, 'text-anchor': anchor, text: F.monthTick(series[0].pts[i].month) }));
      }

      // saldo mínimo
      if (opt.minCents != null) {
        var ym = Y(opt.minCents);
        svg.appendChild(s('line', { 'class': 'g-min', x1: pad.l, x2: W - pad.r, y1: ym, y2: ym }));
        svg.appendChild(s('text', { 'class': 'g-rot', x: W - pad.r, y: ym - 6, 'text-anchor': 'end', text: 'mínimo ' + F.money(opt.minCents) }));
      }

      // linhas (a série com `emphasis` por último, para ficar por cima)
      var order = series.slice().sort(function (a, b) { return (a.emphasis ? 1 : 0) - (b.emphasis ? 1 : 0); });
      order.forEach(function (sr) {
        var dpath = '', pen = false, first = -1, last = -1;
        sr.pts.forEach(function (p, i) {
          if (p.saldo == null) { pen = false; return; }
          dpath += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(p.saldo).toFixed(1);
          pen = true; if (first < 0) first = i; last = i;
        });
        if (!dpath) return;
        if (sr.area) { // lavagem a ~10% sob a linha; vermelha onde o saldo fica negativo
          var area = dpath + 'L' + X(last).toFixed(1) + ' ' + y0.toFixed(1) + 'L' + X(first).toFixed(1) + ' ' + y0.toFixed(1) + 'Z';
          svg.appendChild(s('path', { d: area, 'clip-path': 'url(#' + cpPos + ')', style: 'fill:' + sr.color + ';opacity:.10;stroke:none' }));
          svg.appendChild(s('path', { d: area, 'clip-path': 'url(#' + cpNeg + ')', style: 'fill:var(--vermelho);opacity:.22;stroke:none' }));
        }
        svg.appendChild(s('path', { 'class': 'g-linha', d: dpath, style: 'stroke:' + sr.color }));
        sr.lastIndex = last;
      });

      // marcadores: ponto final de cada série; no gráfico de uma série também o menor saldo
      function dot(cx, cy, color) {
        svg.appendChild(s('circle', { 'class': 'g-anel', cx: cx, cy: cy, r: 6 }));
        svg.appendChild(s('circle', { cx: cx, cy: cy, r: 4, style: 'fill:' + color }));
      }
      order.forEach(function (sr) { if (sr.lastIndex >= 0) dot(X(sr.lastIndex), Y(sr.pts[sr.lastIndex].saldo), sr.color); });
      if (series.length === 1) {
        var sr0 = series[0], mn = null, mi = -1;
        sr0.pts.forEach(function (p, i) { if (p.saldo != null && (mn === null || p.saldo < mn)) { mn = p.saldo; mi = i; } });
        var li = sr0.lastIndex;
        function label(i, txt) {
          var cx = X(i), cy = Y(sr0.pts[i].saldo), anchor = cx < pad.l + 50 ? 'start' : (cx > W - pad.r - 50 ? 'end' : 'middle');
          var above = cy - 12 > pad.t + 6;
          svg.appendChild(s('text', { 'class': 'g-rot', x: cx, y: above ? cy - 12 : cy + 20, 'text-anchor': anchor, text: txt }));
        }
        if (li >= 0) label(li, F.money(sr0.pts[li].saldo));
        if (mi >= 0 && mi !== li && mi !== 0 && (li < 0 || Math.abs(X(li) - X(mi)) > 60)) { dot(X(mi), Y(mn), sr0.color); label(mi, F.money(mn)); }
      }

      // camada de leitura: mira + pontos + área de toque do tamanho da coluna
      var mira = s('line', { 'class': 'g-mira', y1: pad.t, y2: pad.t + ih, x1: 0, x2: 0, visibility: 'hidden' });
      var mirasDots = series.map(function (sr) {
        var g = s('g', { visibility: 'hidden' });
        g.appendChild(s('circle', { 'class': 'g-anel', r: 7 }));
        g.appendChild(s('circle', { r: 4.5, style: 'fill:' + sr.color }));
        return g;
      });
      svg.appendChild(mira);
      mirasDots.forEach(function (g) { svg.appendChild(g); });
      var hit = s('rect', { x: pad.l - 10, y: pad.t, width: iw + 20, height: ih + 14, fill: 'transparent' });
      svg.appendChild(hit);

      var dica = h('div', { 'class': 'dica', role: 'status', hidden: true });
      host.appendChild(svg);
      host.appendChild(dica);

      function show(i) {
        i = Math.max(0, Math.min(n - 1, i));
        selected = i;
        var cx = X(i);
        mira.setAttribute('x1', cx); mira.setAttribute('x2', cx); mira.setAttribute('visibility', 'visible');
        series.forEach(function (sr, k) {
          var p = sr.pts[i], g = mirasDots[k];
          if (p.saldo == null) { g.setAttribute('visibility', 'hidden'); return; }
          g.setAttribute('visibility', 'visible');
          var cs = g.childNodes;
          for (var c = 0; c < cs.length; c++) { cs[c].setAttribute('cx', cx); cs[c].setAttribute('cy', Y(p.saldo)); }
        });
        // conteúdo da dica (sempre textContent)
        d.clear(dica);
        dica.appendChild(h('span', { 'class': 't', text: F.monthLong(series[0].pts[i].month) }));
        series.forEach(function (sr) {
          var p = sr.pts[i];
          dica.appendChild(h('div', { 'class': 'l' },
            h('span', null, h('i', { 'class': 'k', style: 'border-top-color:' + sr.color }), sr.label || 'Saldo acumulado'),
            h('b', { text: p.saldo == null ? '—' : F.money(p.saldo) })));
        });
        (opt.extras ? opt.extras(i) : []).forEach(function (row) {
          dica.appendChild(h('div', { 'class': 'l' }, h('span', { text: row[0] }), h('b', { text: row[1] })));
        });
        dica.hidden = false;
        var scale = host.clientWidth / W, left = cx * scale, w = dica.offsetWidth || 180;
        var x = left > host.clientWidth * 0.55 ? left - w - 12 : left + 12;
        dica.style.left = Math.max(4, Math.min(host.clientWidth - w - 4, x)) + 'px';
        dica.style.top = (pad.t * scale + 4) + 'px';
        if (opt.onPick) opt.onPick(i);
      }
      function hide() {
        mira.setAttribute('visibility', 'hidden');
        mirasDots.forEach(function (g) { g.setAttribute('visibility', 'hidden'); });
        dica.hidden = true;
      }
      function indexFromEvent(ev) {
        var r = svg.getBoundingClientRect(), x = (ev.clientX - r.left) * (W / r.width);
        return Math.round((x - pad.l) / (iw / (n - 1)));
      }
      var down = false;
      svg.addEventListener('pointerdown', function (ev) { down = true; show(indexFromEvent(ev)); });
      svg.addEventListener('pointermove', function (ev) { if (ev.pointerType === 'mouse' || down) show(indexFromEvent(ev)); });
      svg.addEventListener('pointerup', function () { down = false; });
      svg.addEventListener('pointercancel', function () { down = false; });
      svg.addEventListener('pointerleave', function (ev) { if (ev.pointerType === 'mouse') hide(); });
      svg.addEventListener('focus', function () { show(selected >= 0 ? selected : n - 1); });
      svg.addEventListener('blur', hide);
      svg.addEventListener('keydown', function (ev) {
        var k = ev.key, cur = selected >= 0 ? selected : n - 1;
        if (k === 'ArrowRight') { show(cur + 1); ev.preventDefault(); }
        else if (k === 'ArrowLeft') { show(cur - 1); ev.preventDefault(); }
        else if (k === 'Home') { show(0); ev.preventDefault(); }
        else if (k === 'End') { show(n - 1); ev.preventDefault(); }
        else if (k === 'Escape') { hide(); }
      });
      api.select = show;
      api.hide = hide;
    }

    var api = { select: function () {}, hide: function () {}, destroy: function () { destroyed = true; if (ro) ro.disconnect(); } };
    draw();
    if (window.ResizeObserver) {
      ro = new ResizeObserver(function () {
        if (destroyed || !host.isConnected) return;
        var w = Math.round(host.clientWidth || 0);
        if (w && Math.abs(w - lastW) > 8) draw();
      });
      ro.observe(host);
    }
    return api;
  }

  App.chart = { line: lineChart };
})(window.App = window.App || {});
