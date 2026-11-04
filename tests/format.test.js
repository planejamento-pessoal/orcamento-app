const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../docs/js/format.js');

test('dinheiro: milhar com ponto, decimal com vírgula, sinais', () => {
  assert.equal(F.money(0), 'R$ 0,00');
  assert.equal(F.money(5), 'R$ 0,05');
  assert.equal(F.money(1387), 'R$ 13,87');
  assert.equal(F.money(123456), 'R$ 1.234,56');
  assert.equal(F.money(-504007), '-R$ 5.040,07');
  assert.equal(F.money(1350000), 'R$ 13.500,00');
  assert.equal(F.money(123456789), 'R$ 1.234.567,89');
  assert.equal(F.money(496263, { sign: true }), '+R$ 4.962,63');
  assert.equal(F.money(0, { sign: true }), 'R$ 0,00');
  assert.equal(F.money(-100, { sign: true }), '-R$ 1,00');
  assert.equal(F.money(123456, { bare: true }), '1.234,56');
  assert.equal(F.money(null), '—');
  assert.equal(F.money(NaN), '—');
  assert.equal(F.plain(-5), '-0,05');
});

test('dinheiro compacto para eixos', () => {
  assert.equal(F.compact(0), '0');
  assert.equal(F.compact(50000), '500');
  assert.equal(F.compact(100000), '1 mil');
  assert.equal(F.compact(250000), '2,5 mil');
  assert.equal(F.compact(1200000), '12 mil');
  assert.equal(F.compact(1250000), '13 mil');
  assert.equal(F.compact(-250000), '-2,5 mil');
  assert.equal(F.compact(120000000), '1,2 mi');
});

test('leitura do que a pessoa digita', () => {
  const ok = [['1.234,56', 123456], ['1234,56', 123456], ['1234.56', 123456], ['13.87', 1387], ['13,87', 1387],
    ['R$ 50', 5000], ['R$ 1.000', 100000], ['1.000', 100000], ['1.234.567', 123456700], ['50', 5000], ['0,5', 50], ['0,05', 5],
    ['-50', -5000], ['−50,25', -5025], ['(50)', -5000], ['+7', 700], [' 12 ', 1200], ['1 234,5', 123450], [',5', 50], ['10,', 1000]];
  for (const [txt, want] of ok) assert.equal(F.parseMoney(txt), want, txt);
  for (const bad of ['', '   ', 'abc', '12a', '1,2,3', '1.2.3', '1,234.56', '--5', '12345678901234', null, undefined, '.', ',', 'R$']) {
    assert.ok(Number.isNaN(F.parseMoney(bad)), 'deveria rejeitar: ' + JSON.stringify(bad));
  }
  assert.equal(F.parseMoney(13.87), 1387);
  assert.ok(Number.isNaN(F.parseMoney(Infinity)));
});

test('ida e volta: dinheiro -> texto -> dinheiro', () => {
  for (const c of [0, 1, 99, 100, 123456, 100000000, 1350000, 33377]) {
    assert.equal(F.parseMoney(F.money(c, { bare: true })), c);
  }
});

test('meses em português', () => {
  assert.equal(F.monthName('2026-03'), 'março');
  assert.equal(F.monthAbbr('2026-10-01'), 'out');
  assert.equal(F.monthShort('2026-10'), 'out/2026');
  assert.equal(F.monthLong('2027-01'), 'janeiro de 2027');
  assert.equal(F.monthTick('2026-12'), 'dez/26');
  assert.equal(F.currentMonth(new Date(2026, 9, 14)), '2026-10');
  assert.equal(F.currentMonth(new Date(2027, 0, 1)), '2027-01');
  assert.throws(() => F.monthShort('xx'));
});

test('código de convite', () => {
  assert.equal(F.normalizeCode(' ab12-cd34 ef56 '), 'AB12CD34EF56');
  assert.equal(F.prettyCode('ab12cd34ef56'), 'AB12-CD34-EF56');
  assert.equal(F.prettyCode('curto'), 'CURTO');
  assert.equal(F.normalizeCode(null), '');
});

test('datas curtas', () => {
  assert.equal(F.dateShort('2026-10-14T12:00:00'), '14/10/2026');
  assert.equal(F.dateShort('lixo'), '');
  assert.match(F.whenShort('2026-10-14T20:09:00'), /^14\/10 às 20:09$/);
  assert.equal(F.dueText(7), 'dia 7');
  assert.equal(F.dueText(null), '');
});

test('horário do Supabase (6 casas de fração e fuso) é lido igual ao de 3 casas', () => {
  const longo = '2026-10-17T15:04:05.123456+00:00', curto = '2026-10-17T15:04:05.123+00:00';
  assert.notEqual(F.dateShort(longo), '');
  assert.equal(F.dateShort(longo), F.dateShort(curto));
  assert.equal(F.whenShort(longo), F.whenShort(curto));
  assert.equal(F.dateShort(null), '');
  assert.equal(F.dateShort(undefined), '');
});

test('senha nova: 10 ou mais caracteres e nada óbvio', () => {
  const bad = ['', 'curta', '123456789', '1234567890', '0123456789', '9876543210', 'qwertyuiop', 'asdfghjklz', 'qwertyuiopasdf', 'abcdefghij', 'aaaaaaaaaa', '1212121212', 'aaaaabbbbb',
    'senha12345', 'Senha@12345', 'MinhaSenha1', 'password123', 'Password!!99', 'orcamento2026', 'Orcamento-26'];
  for (const p of bad) assert.ok(F.passwordProblem(p, 'joao@exemplo.com') !== '', 'deveria recusar: ' + p);
  assert.match(F.passwordProblem('curta'), /10 caracteres/);
  assert.match(F.passwordProblem('1234567890'), /fácil de adivinhar/);
  // contém a parte do e-mail antes do @
  assert.ok(F.passwordProblem('maria.souza-2026!', 'maria.souza@exemplo.com') !== '');
  assert.equal(F.passwordProblem('maria.souza-2026!', 'outra@exemplo.com'), '');
  const good = ['cavalo-azul-bateria-grampo', 'sol nasce 7 vezes', 'Tr0ca-o-Pneu-do-Fusca', 'outra-senha-2x', 'minha-casa-tem-3-cachorros'];
  for (const p of good) assert.equal(F.passwordProblem(p, 'joao@exemplo.com'), '', 'deveria aceitar: ' + p);
  assert.equal(F.passwordProblem(null), 'A senha precisa de pelo menos 10 caracteres.');
});
