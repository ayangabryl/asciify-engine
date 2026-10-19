import { expect, it } from 'vitest';
import { HoverPacer } from './pacer';

const PERIOD = 1000 / 120;
/** Runs display frames of `interval` ms for `ms`, returning the time reached and the strides seen. */
function run(pacer: HoverPacer, from: number, ms: number, interval: number, load: number, missed = false) {
  const strides: number[] = [];
  let now = from;
  for (const end = from + ms; now < end;) { now += interval; strides.push(pacer.tick(now, missed, load)); }
  return { now, strides };
}

it('keeps a cheap hover at full rate through display hiccups and a stalled main thread', () => {
  const pacer = new HoverPacer();
  let { now } = run(pacer, 0, 500, PERIOD, 1);
  // Another page or the compositor slows the display for a second: not this hover's doing.
  ({ now } = run(pacer, now, 1000, PERIOD * 2, 1));
  // A 200 ms busy loop on the main thread.
  now += 200; pacer.tick(now, true, 1);
  const { strides } = run(pacer, now, 1000, PERIOD, 1);
  expect(strides.every(s => s === 1)).toBe(true);
});

it('steps down only on a sustained run of late frames, and is back at full rate within a second once they recover', () => {
  const pacer = new HoverPacer();
  let { now } = run(pacer, 0, 500, PERIOD, 6);
  // Seven late frames in a row are not a run.
  for (let i = 0; i < 7; i++) { now += PERIOD * 2; pacer.tick(now, false, 6); }
  now += PERIOD; expect(pacer.tick(now, false, 6)).toBe(1);
  // A heavy hover that keeps the display late steps down.
  ({ now } = run(pacer, now, 200, PERIOD * 1.6, 6));
  expect(pacer.stride).toBeGreaterThan(1);
  const { strides } = run(pacer, now, 1000, PERIOD, 6);
  expect(strides[strides.length - 1]).toBe(1);
  expect(strides.findIndex(s => s === 1) * PERIOD).toBeLessThan(1000);
});

it('counts a display frame with no hover frame ready as late', () => {
  const pacer = new HoverPacer();
  let { now } = run(pacer, 0, 500, PERIOD, 6);
  ({ now } = run(pacer, now, 100, PERIOD, 6, true));
  expect(pacer.stride).toBe(2);
});

it('backs off a failed step up, but keeps trying every second', () => {
  const pacer = new HoverPacer();
  let { now } = run(pacer, 0, 500, PERIOD, 6);
  // A hover that is always too heavy at full rate: every try at full rate is late again.
  const ups: number[] = [];
  for (let t = 0; t < 8000;) {
    const stride = pacer.stride;
    const step = stride === 1 ? PERIOD * 1.6 : PERIOD;
    now += step; t += step;
    if (pacer.tick(now, false, 6) === 1 && stride > 1) ups.push(now);
  }
  const gaps = ups.slice(1).map((t, i) => t - ups[i]);
  expect(gaps.length).toBeGreaterThan(2);
  expect(Math.max(...gaps)).toBeLessThan(1300);
});

it('starts every new hover at full rate', () => {
  const pacer = new HoverPacer();
  let { now } = run(pacer, 0, 500, PERIOD, 6);
  ({ now } = run(pacer, now, 300, PERIOD * 1.6, 6));
  expect(pacer.stride).toBeGreaterThan(1);
  pacer.reset();
  expect(pacer.tick(now + 5000, false, 6)).toBe(1);
});
