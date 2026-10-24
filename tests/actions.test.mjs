import test from 'node:test';
import assert from 'node:assert/strict';
import fixtures from './fixtures/assets.cjs';
import { ACTION_POOLS, ActionPlayer, actionPlan, randomAfkDelay } from '../app/actions.js';

const forms = fixtures.forms();
function pick(kind, id, durationRandom = .5) {
  let calls = 0;
  const index = ACTION_POOLS[kind].indexOf(id);
  assert.notEqual(index, -1);
  return () => calls++ === 0 ? (index + .5) / ACTION_POOLS[kind].length : durationRandom;
}
function player(form = forms[0], random = Math.random) {
  const starts = [], samples = [], finished = [];
  const playback = new ActionPlayer({
    durations: new Map(form.clips.map(clip => [clip.id, clip.durationSeconds])), random,
    start: step => starts.push(step.id), sample: time => samples.push(time),
    onIdle: () => finished.push(true),
  });
  playback.idle();
  return { playback, starts, samples, finished };
}

test('trigger pools match the requested feeding, click and AFK actions exactly', () => {
  assert.deepEqual(ACTION_POOLS.feed, ['Happy','Relax','Show','Skill3Start']);
  assert.deepEqual(ACTION_POOLS.click, ['Alert','Anger','Fear','Happy','Relax','Shock','Show','Die','Skill3Start','Stun','Hit2']);
  assert.deepEqual(ACTION_POOLS.afk, ['Alert','Happy','Relax','Sad','Sleep','Walk','SleepStand','JumpFall']);
  assert.equal(randomAfkDelay(() => 0), 25000);
  assert.ok(randomAfkDelay(() => 1) <= 45000);
});

test('every requested action loads for all three forms and returns to Idle', () => {
  for (const form of forms) for (const [kind, choices] of Object.entries(ACTION_POOLS)) for (const id of choices) {
    const { playback, starts, finished } = player(form, pick(kind, id));
    const plan = playback.trigger(kind);
    assert.equal(playback.source, kind);
    playback.advance(100);
    assert.equal(playback.isIdle, true, `${form.name} / ${id}`);
    assert.deepEqual(starts, ['Idle', ...plan.map(step => step.id), 'Idle']);
    assert.equal(finished.length, 1);
  }
});

test('timed actions really loop for the chosen 5–10 seconds instead of ending with the short clip', () => {
  for (const [kind, id] of [['click','Stun'], ['afk','Walk'], ['afk','SleepStand'], ['afk','JumpFall']]) {
    for (const random of [0, .5, 1]) {
      const plan = actionPlan(kind, pick(kind, id, random));
      assert.ok(plan[0].seconds >= 5 && plan[0].seconds <= 10);
      const { playback, samples } = player(forms[0], pick(kind, id, random));
      playback.trigger(kind);
      playback.advance(plan[0].seconds - .01);
      assert.equal(playback.current.id, id);
      assert.ok(samples.at(-1) < playback.current.clipSeconds);
      playback.advance(.02);
      assert.equal(playback.current.id, 'Idle');
    }
  }
});

test('sleep plays enter, timed sleep, wake and Idle in order, with no intermediate Idle', () => {
  const { playback, starts } = player(forms[0], pick('afk', 'Sleep', .5));
  playback.trigger('afk');
  playback.advance(playback.current.seconds);
  assert.equal(playback.current.id, 'SleepLoop');
  playback.advance(7.49);
  assert.equal(playback.current.id, 'SleepLoop');
  playback.advance(.02);
  assert.equal(playback.current.id, 'SleepEnd');
  playback.advance(2);
  assert.deepEqual(starts, ['Idle','SleepStart','SleepLoop','SleepEnd','Idle']);
});

test('click and feeding interrupt sleep and discard its wake-up step; form reload can reset to Idle', () => {
  const { playback, starts } = player(forms[0], pick('afk', 'Sleep'));
  playback.trigger('afk');playback.advance(1);
  playback.random = pick('click', 'Stun');playback.trigger('click');
  playback.advance(3);
  assert.equal(playback.current.id, 'Stun');
  playback.random = pick('feed', 'Skill3Start');playback.trigger('feed');
  playback.advance(2);
  assert.equal(playback.isIdle, true);
  assert.equal(starts.includes('SleepEnd'), false);
  playback.random = pick('afk', 'Sleep');playback.trigger('afk');
  playback.idle();playback.advance(20);
  assert.equal(playback.isIdle, true);
  assert.equal(starts.includes('SleepEnd'), false);
});

test('Idle stays Idle, and a rejected clip does not replace a valid running action', () => {
  const { playback, finished } = player();
  playback.advance(300);
  assert.equal(playback.current.id, 'Idle');
  assert.equal(finished.length, 0);
  assert.throws(() => playback.play([{id:'missing'}]), /模型没有动作/);
  assert.equal(playback.current.id, 'Idle');
});
