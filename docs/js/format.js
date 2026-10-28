/* ════════════════════════════════════════════════════════════════════════
   format.js — formatação e leitura de dinheiro, meses e códigos (pt-BR).
   Sem dependências; roda no navegador e no Node (tests/).
   Não usa Intl de propósito: o resultado é igual em qualquer WebView.
   ════════════════════════════════════════════════════════════════════════ */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Format = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var NOMES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  var ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  function parts(m) {
    if (typeof m !== 'string' || !/^\d{4}-\d{2}/.test(m)) throw new Error('mês inválido: ' + m);
    return { y: parseInt(m.slice(0, 4), 10), m: parseInt(m.slice(5, 7), 10) };
  }
  function monthName(m) { return NOMES[parts(m).m - 1]; }              // "outubro"
  function monthAbbr(m) { return ABREV[parts(m).m - 1]; }              // "out"
  function monthShort(m) { var p = parts(m); return ABREV[p.m - 1] + '/' + p.y; }       // "out/2026"
  function monthLong(m) { var p = parts(m); return NOMES[p.m - 1] + ' de ' + p.y; }     // "outubro de 2026"
  function monthTick(m) { var p = parts(m); return ABREV[p.m - 1] + '/' + String(p.y).slice(2); } // "out/26"
  function currentMonth(now) { var d = now || new Date(); return d.getFullYear() + '-' + (d.getMonth() < 9 ? '0' : '') + (d.getMonth() + 1); }

  // 123456 -> "1.234,56"
  function groupInt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function plain(cents) {
    var neg = cents < 0, a = Math.abs(Math.round(cents));
    var whole = Math.floor(a / 100), frac = a % 100;
    return (neg ? '-' : '') + groupInt(whole) + ',' + (frac < 10 ? '0' : '') + frac;
  }
  // opts.sign: mostra "+" nos positivos; opts.bare: sem "R$ "
  function money(cents, opts) {
    opts = opts || {};
    if (cents == null || isNaN(cents)) return '—';
    var neg = cents < 0, a = Math.abs(Math.round(cents));
    var whole = Math.floor(a / 100), frac = a % 100;
    var body = groupInt(whole) + ',' + (frac < 10 ? '0' : '') + frac;
    var prefix = opts.bare ? '' : 'R$ ';
    var sign = neg ? '-' : (opts.sign && a > 0 ? '+' : '');
    return sign + prefix + body;
  }
  // Para eixos: 0, 500, 1 mil, 2,5 mil, 12 mil, 1,2 mi
  function compact(cents) {
    var v = Math.abs(cents) / 100, s = cents < 0 ? '-' : '';
    function trim(x) { var t = (Math.round(x * 10) / 10).toFixed(1); return t.replace(/\.0$/, '').replace('.', ','); }
    if (v >= 1000000) return s + trim(v / 1000000) + ' mi';
    if (v >= 10000) return s + Math.round(v / 1000) + ' mil';
    if (v >= 1000) return s + trim(v / 1000) + ' mil';
    return s + String(Math.round(v));
  }

  // "1.234,56" | "1234,56" | "1234.56" | "R$ 50" | "-50" | "(50)" -> centavos (ou NaN)
  function parseMoney(str) {
    if (typeof str === 'number') return isFinite(str) ? Math.round(str * 100) : NaN;
    var s = String(str == null ? '' : str).trim();
    if (s === '') return NaN;
    var neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/R\$/gi, '').replace(/[\s ]/g, '');
    if (s.charAt(0) === '-' || s.charAt(0) === '−') { neg = true; s = s.slice(1); }
    else if (s.charAt(0) === '+') s = s.slice(1);
    if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return NaN;
    var lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
    var intPart, fracPart = '';
    if (lastComma >= 0) {                       // vírgula decimal; pontos são milhar
      intPart = s.slice(0, lastComma).replace(/\./g, '');
      fracPart = s.slice(lastComma + 1);
      if (/[.,]/.test(fracPart)) return NaN;
    } else if (lastDot >= 0) {
      var tail = s.slice(lastDot + 1);
      var dots = (s.match(/\./g) || []).length;
      if (dots === 1 && tail.length <= 2) { intPart = s.slice(0, lastDot); fracPart = tail; } // 13.87 = decimal
      else if (/^\d{1,3}(\.\d{3})+$/.test(s)) { intPart = s.replace(/\./g, ''); }          // 1.234 = milhar
      else return NaN;
    } else intPart = s;
    if (intPart === '') intPart = '0';
    if (!/^\d+$/.test(intPart) || (fracPart !== '' && !/^\d{1,2}$/.test(fracPart))) return NaN;
    if (intPart.length > 11) return NaN;
    var cents = parseInt(intPart, 10) * 100 + (fracPart === '' ? 0 : parseInt((fracPart + '0').slice(0, 2), 10));
    return neg ? -cents : cents;
  }

  // Código de convite
  function normalizeCode(s) { return String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function prettyCode(s) { var c = normalizeCode(s); return c.length === 12 ? c.slice(0, 4) + '-' + c.slice(4, 8) + '-' + c.slice(8) : c; }

  // Senha nova: pelo menos 10 caracteres e nada óbvio (o servidor também confere o tamanho).
  // Devolve o aviso em português, ou '' se a senha serve. Sem dependências, roda no Node.
  var SEQUENCIAS = ['01234567890123456789', '98765432109876543210', 'qwertyuiopasdfghjklzxcvbnm', 'abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz'];
  var SO_PALAVRA = ['senha', 'senhas', 'minhasenha', 'password', 'passw0rd', 'qwerty', 'asdfgh', 'zxcvbn', 'abcdef', 'brasil', 'admin', 'administrador', 'orcamento', 'financeiro', 'teste', 'amor', 'familia', 'deus', 'iloveyou', 'letmein', 'welcome'];
  function passwordProblem(pw, email) {
    var s = String(pw == null ? '' : pw);
    if (s.length < 10) return 'A senha precisa de pelo menos 10 caracteres.';
    var low = s.toLowerCase(), seen = {}, distinct = 0;
    for (var i = 0; i < low.length; i++) if (!seen[low.charAt(i)]) { seen[low.charAt(i)] = 1; distinct++; }
    var letters = low.replace(/[^a-zà-ú]/g, '');
    var local = String(email || '').toLowerCase().split('@')[0];
    var weak = distinct < 5 || (letters !== '' && SO_PALAVRA.indexOf(letters) >= 0) || (local.length >= 4 && low.indexOf(local) >= 0);
    for (var k = 0; !weak && k < SEQUENCIAS.length; k++) if (SEQUENCIAS[k].indexOf(low) >= 0) weak = true;
    return weak ? 'Essa senha é fácil de adivinhar. Use algo menos óbvio: uma frase com 3 ou 4 palavras funciona bem.' : '';
  }

  // "Dia 7" etc.
  function dueText(day) { return day ? 'dia ' + day : ''; }

  // O Supabase manda horários com 6 casas de fração ("...:00.123456+00:00"); alguns navegadores
  // só aceitam 3. Cortamos o excesso antes de ler a data.
  function toDate(iso) { return new Date(String(iso == null ? '' : iso).replace(/(\.\d{3})\d+/, '$1')); }
  // Texto de data/hora curto: "14/10 às 20:09"
  function whenShort(iso) {
    var d = toDate(iso);
    if (isNaN(d)) return '';
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + ' às ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function dateShort(iso) {
    var d = toDate(iso);
    if (isNaN(d)) return '';
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear();
  }

  return {
    monthName: monthName, monthAbbr: monthAbbr, monthShort: monthShort, monthLong: monthLong, monthTick: monthTick,
    currentMonth: currentMonth, money: money, plain: plain, compact: compact, parseMoney: parseMoney,
    normalizeCode: normalizeCode, prettyCode: prettyCode, passwordProblem: passwordProblem, dueText: dueText, whenShort: whenShort, dateShort: dateShort
  };
});
