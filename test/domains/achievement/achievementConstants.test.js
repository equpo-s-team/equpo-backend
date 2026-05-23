import test from 'node:test';
import assert from 'node:assert/strict';
import { ACHIEVEMENT_KEYS } from '../../../dist/domains/achievement/achievementConstants.js';

test('ACHIEVEMENT_KEYS contains expected achievement identifiers', () => {
  assert.equal(ACHIEVEMENT_KEYS.PRIMER_PASO, 'primer-paso');
  assert.equal(ACHIEVEMENT_KEYS.NUEVA_ALIANZA, 'nueva-alianza');
  assert.equal(ACHIEVEMENT_KEYS.VIDA_NUEVA, 'vida-nueva');
  assert.equal(ACHIEVEMENT_KEYS.LA_VOZ_DE_TODOS, 'la-voz-de-todos');
  assert.equal(ACHIEVEMENT_KEYS.SINERGIA, 'sinergia');
  assert.equal(ACHIEVEMENT_KEYS.SUBIDA_DE_NIVEL, 'subida-de-nivel');
  assert.equal(ACHIEVEMENT_KEYS.TIEMPO_DE_RESURGIR, 'tiempo-de-resurgir');
  assert.equal(ACHIEVEMENT_KEYS.RED_DE_TRABAJO, 'red-de-trabajo');
  assert.equal(ACHIEVEMENT_KEYS.MENTOR_VIRTUAL, 'mentor-virtual');
  assert.equal(ACHIEVEMENT_KEYS.VELOCIDAD_LUZ, 'velocidad-luz');
});

test('ACHIEVEMENT_KEYS has exactly 10 entries', () => {
  assert.equal(Object.keys(ACHIEVEMENT_KEYS).length, 10);
});

test('all ACHIEVEMENT_KEYS values are non-empty strings', () => {
  for (const value of Object.values(ACHIEVEMENT_KEYS)) {
    assert.equal(typeof value, 'string');
    assert.ok(value.length > 0);
  }
});
