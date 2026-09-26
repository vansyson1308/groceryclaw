import test from 'node:test';
import assert from 'node:assert/strict';
import { numberToWords, speakable } from '../../demo/video/lib/speakable.mjs';

test('numberToWords: American style, no "and"', () => {
  assert.equal(numberToWords(0), 'zero');
  assert.equal(numberToWords(19), 'nineteen');
  assert.equal(numberToWords(45), 'forty-five');
  assert.equal(numberToWords(120), 'one hundred twenty');
  assert.equal(numberToWords(1100), 'one thousand one hundred');
  assert.equal(numberToWords(2000001), 'two million one');
});

test('speakable: money, percentages, units and plain numbers', () => {
  assert.equal(speakable('about $210.'), 'about two hundred ten dollars.');
  assert.equal(speakable('$1,234.50'), 'one thousand two hundred thirty-four dollars fifty');
  assert.equal(speakable('$1'), 'one dollar');
  assert.equal(speakable("That's 68% of"), "That's sixty-eight percent of");
  assert.equal(speakable('Fresh Milk 1L and Eggs 10-pack'), 'Fresh Milk one liter and Eggs ten pack');
  assert.equal(speakable('482 items'), 'four hundred eighty-two items');
});

test('speakable: brand names, acronyms and codes', () => {
  assert.equal(speakable('ShopVoice'), 'Shop Voice');
  assert.equal(speakable('an MCP server that Alexa+ can call'), 'an M C P server that Alexa Plus can call');
  assert.equal(speakable('one AWS CDK stack'), 'one A W S C D K stack');
  assert.equal(speakable('invoice SRB-10442 arrived'), 'invoice S R B one oh four four two, arrived');
  assert.equal(speakable('synced to KiotViet yet'), 'synced to Key-ott Vee-et yet');
  assert.equal(speakable('Want a reorder draft?'), 'Want uh re-order draft?');
  assert.equal(speakable('Dairy & Eggs'), 'Dairy and Eggs');
});

test('speakable leaves plain prose alone', () => {
  const s = 'Money never moves by accident.';
  assert.equal(speakable(s), s);
});
