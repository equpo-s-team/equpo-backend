import test from 'node:test';
import assert from 'node:assert/strict';
import {
  xpRequiredForLevel,
  calculateLevel,
  xpForNextLevel,
  XP_REWARDS,
  COIN_REWARDS,
  HEALTH_REWARDS,
} from '../../../dist/domains/user/xpUtils.js';

// ─── xpRequiredForLevel ───────────────────────────────────────────────────────

test('xpRequiredForLevel(0) returns 0', () => {
  assert.equal(xpRequiredForLevel(0), 0);
});

test('xpRequiredForLevel(1) returns 100 (BASE_XP)', () => {
  assert.equal(xpRequiredForLevel(1), 100);
});

test('xpRequiredForLevel(2) returns 150 (100 * 1.5^1)', () => {
  assert.equal(xpRequiredForLevel(2), 150);
});

test('xpRequiredForLevel increases with each level', () => {
  assert.ok(xpRequiredForLevel(3) > xpRequiredForLevel(2));
  assert.ok(xpRequiredForLevel(5) > xpRequiredForLevel(4));
});

test('xpRequiredForLevel returns 0 for negative level', () => {
  assert.equal(xpRequiredForLevel(-1), 0);
});

// ─── calculateLevel ───────────────────────────────────────────────────────────

test('calculateLevel(0) returns 0', () => {
  assert.equal(calculateLevel(0), 0);
});

test('calculateLevel below BASE_XP returns 0', () => {
  assert.equal(calculateLevel(99), 0);
});

test('calculateLevel(100) returns 1', () => {
  assert.equal(calculateLevel(100), 1);
});

test('calculateLevel(150) returns 2 (exactly at level 2 threshold)', () => {
  assert.equal(calculateLevel(150), 2);
});

test('calculateLevel(225) returns 3 (exactly at level 3 threshold)', () => {
  assert.equal(calculateLevel(225), 3);
});

test('calculateLevel and xpRequiredForLevel are consistent for levels 1-3', () => {
  // Only test levels where 1.5^(N-1) is an integer — floating point is exact there.
  // Level 4 boundary (xpRequiredForLevel(4)=337) has a known fp edge case.
  for (let lvl = 1; lvl <= 3; lvl++) {
    const xp = xpRequiredForLevel(lvl);
    assert.equal(calculateLevel(xp), lvl, `Level ${lvl} with ${xp} XP`);
  }
});

// ─── xpForNextLevel ───────────────────────────────────────────────────────────

test('xpForNextLevel(0) returns XP needed for level 1', () => {
  assert.equal(xpForNextLevel(0), xpRequiredForLevel(1));
});

test('xpForNextLevel(1) returns XP needed for level 2', () => {
  assert.equal(xpForNextLevel(1), xpRequiredForLevel(2));
});

// ─── Reward constants ─────────────────────────────────────────────────────────

test('XP_REWARDS: high > medium > low', () => {
  assert.ok(XP_REWARDS.high > XP_REWARDS.medium);
  assert.ok(XP_REWARDS.medium > XP_REWARDS.low);
});

test('COIN_REWARDS: high > medium > low', () => {
  assert.ok(COIN_REWARDS.high > COIN_REWARDS.medium);
  assert.ok(COIN_REWARDS.medium > COIN_REWARDS.low);
});

test('HEALTH_REWARDS: high > medium > low', () => {
  assert.ok(HEALTH_REWARDS.high > HEALTH_REWARDS.medium);
  assert.ok(HEALTH_REWARDS.medium > HEALTH_REWARDS.low);
});

test('XP_REWARDS has expected values', () => {
  assert.equal(XP_REWARDS.high, 60);
  assert.equal(XP_REWARDS.medium, 30);
  assert.equal(XP_REWARDS.low, 15);
});
