// The desktop pet uses the same clip identifiers as the action studio.
export const ACTION_POOLS = Object.freeze({
  feed: Object.freeze(['Happy', 'Relax', 'Show', 'Skill3Start']),
  click: Object.freeze(['Alert', 'Anger', 'Fear', 'Happy', 'Relax', 'Shock', 'Show', 'Die', 'Skill3Start', 'Stun', 'Hit2']),
  afk: Object.freeze(['Alert', 'Happy', 'Relax', 'Sad', 'Sleep', 'Walk', 'SleepStand', 'JumpFall']),
});
export const AFK_INTERVAL = Object.freeze([25, 45]);
const TIMED = new Set(['Stun', 'Walk', 'SleepStand', 'JumpFall']);
const unitRandom = random => Math.max(0, Math.min(1 - Number.EPSILON, random()));
export const randomAfkDelay = (random = Math.random) => (AFK_INTERVAL[0] + unitRandom(random) * (AFK_INTERVAL[1] - AFK_INTERVAL[0])) * 1000;

export function actionPlan(kind, random = Math.random) {
  const pool = ACTION_POOLS[kind];
  if (!pool) throw new Error('未知动作触发场景：' + kind);
  const choice = pool[Math.floor(unitRandom(random) * pool.length)];
  const seconds = () => 5 + unitRandom(random) * 5;
  if (choice === 'Sleep') return [
    { id: 'SleepStart' },
    { id: 'SleepLoop', loop: true, seconds: seconds() },
    { id: 'SleepEnd' },
  ];
  return [TIMED.has(choice) ? { id: choice, loop: true, seconds: seconds() } : { id: choice }];
}

// One animation clock owns both complete clips and timed loops. Replacing a plan
// discards its remaining steps, so interrupted sleep can never wake a later pet.
export class ActionPlayer {
  constructor({ durations, start, sample, onIdle = () => {}, random = Math.random }) {
    this.durations = durations;
    this.start = start;
    this.sample = sample;
    this.onIdle = onIdle;
    this.random = random;
    this.steps = [];
  }
  get isIdle() { return this.source === 'idle'; }
  get current() { return this.steps[this.index]; }
  play(steps, source = 'direct') {
    const prepared = steps.map(step => {
      const clipSeconds = this.durations.get(step.id);
      if (!(clipSeconds > 0)) throw new Error('模型没有动作：' + step.id);
      const seconds = step.seconds ?? (step.loop ? Infinity : clipSeconds);
      if (!(seconds > 0)) throw new Error('动作时长必须大于零');
      return { ...step, clipSeconds, seconds };
    });
    if (!prepared.length) throw new Error('动作序列不能为空');
    this.steps = prepared;
    this.source = source;
    this.index = 0;
    this.beginStep();
  }
  beginStep() {
    this.elapsed = 0;
    this.start(this.current);
    this.sample(0);
  }
  idle() { this.play([{ id: 'Idle', loop: true }], 'idle'); }
  trigger(kind) {
    const plan = actionPlan(kind, this.random);
    this.play(plan, kind);
    return plan;
  }
  advance(delta) {
    if (!this.current || !Number.isFinite(delta) || delta < 0) return;
    let remaining = delta;
    while (remaining >= this.current.seconds - this.elapsed) {
      remaining -= this.current.seconds - this.elapsed;
      if (this.index + 1 < this.steps.length) { this.index++; this.beginStep(); }
      else { this.idle(); this.onIdle(); }
    }
    this.elapsed += remaining;
    const step = this.current;
    this.sample(step.loop ? this.elapsed % step.clipSeconds : Math.min(this.elapsed, step.clipSeconds));
  }
  status() {
    return { source: this.source, animation: this.current?.id, elapsed: this.elapsed,
      seconds: Number.isFinite(this.current?.seconds) ? this.current.seconds : null,
      loop: !!this.current?.loop, remaining: this.steps.slice(this.index + 1).map(step => step.id) };
  }
}
