import { describe, expect, it, vi } from 'vitest';

const { mount, support } = vi.hoisted(() => ({ mount: vi.fn(), support: { on: true } }));
vi.mock('../field', () => ({ isGlyphFieldSupported: () => support.on, mountGlyphField: mount }));

import { cursorTrail, cursorTrailFrame } from './cursor-trail';
import { useFakeDom } from './fake-dom-2a';

const { env, run, flush, element, canvases } = useFakeDom(mount, support);

const layers = () => env.body.children.filter(el => el.dataset.asciiCursor !== undefined);
const moveOver = (target = env.body, x = 100, y = 100, pointerType = 'mouse') => target.dispatch('pointermove', { clientX: x, clientY: y, pointerType });
function sweep(target = env.body, from = 0) {
  for (let i = 0; i < 8; i++) { moveOver(target, from + i * 12, 100 + i * 4); run(16); }
}

/** A pen that keeps what each stroke and fill was drawn with. */
function recorder() {
  const marks: { style: string; width: number }[] = [];
  const pen = { strokeStyle: '', fillStyle: '', lineWidth: 1, beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, arc() {},
    stroke() { marks.push({ style: pen.strokeStyle, width: pen.lineWidth }); }, fillRect() { marks.push({ style: pen.fillStyle, width: 0 }); } };
  return { pen: pen as unknown as CanvasRenderingContext2D, marks };
}
const level = (rgb: string) => Number(/rgb\((\d+)/.exec(rgb)![1]);

describe('cursorTrail', () => {
  it('mounts nothing until the pointer moves, draws while the tail fades, then stops', async () => {
    const trail = cursorTrail();
    expect(layers()).toHaveLength(0);
    expect(trail.supported).toBe(true);
    sweep();
    await flush();
    const [layer] = layers();
    expect(layer.style.cssText).toContain('position:fixed');
    expect(layer.style.cssText).toContain('pointer-events:none');
    expect(layer.getAttribute('aria-hidden')).toBe('true');
    expect(canvases(layer)).toHaveLength(1);
    expect(trail.active).toBe(true);
    expect(env.field.setSource).toHaveBeenCalled();
    run(6000);
    expect(trail.active).toBe(false);
    // Idle: no frame is waiting once the last character has faded.
    const before = env.field.setSource.mock.calls.length;
    run(500);
    expect(env.field.setSource.mock.calls.length).toBe(before);
    trail.destroy();
    expect(layers()).toHaveLength(0);
  });

  it('stays quiet over inputs, dialogs, skipped elements and touch', () => {
    const trail = cursorTrail({ skip: '.hero' });
    const input = element('INPUT'), dialog = element('DIALOG'), inDialog = element('DIV', dialog), skipped = element('DIV'), hero = element('DIV');
    skipped.dataset.asciiCursorSkip = '';
    hero.matches = (s: string) => s.split(',').some(p => p.trim() === '.hero');
    for (const el of [input, inDialog, skipped, hero]) sweep(el);
    for (let i = 0; i < 6; i++) moveOver(env.body, i * 20, 100, 'touch');
    expect(trail.active).toBe(false);
    expect(layers()).toHaveLength(0);
    trail.destroy();
  });

  it('is off under reduced motion and without WebGL2', () => {
    env.reduced = true;
    const a = cursorTrail();
    sweep();
    expect(layers()).toHaveLength(0);
    a.destroy();
    env.reduced = false;
    support.on = false;
    const b = cursorTrail();
    sweep();
    expect(b.supported).toBe(false);
    expect(layers()).toHaveLength(0);
    b.destroy();
  });

  it('switches style live and stops listening once destroyed', async () => {
    const trail = cursorTrail({ style: 'wake', zIndex: 40 });
    sweep();
    await flush();
    expect(layers()[0].style.cssText).toContain('z-index:40');
    trail.update({ style: 'sparkle' });
    expect(trail.active).toBe(false);
    expect(env.field.update).toHaveBeenCalled();
    sweep();
    expect(trail.active).toBe(true);
    trail.destroy();
    sweep();
    expect(trail.active).toBe(false);
    expect(layers()).toHaveLength(0);
  });
});

describe('cursorTrail trail style', () => {
  it('draws a kit field\'s ink trail, eased like the field\'s trail hover, and keeps the wordmark\'s glyphs', async () => {
    const trail = cursorTrail({ trail: { span: 540, cell: 15 } });
    sweep();
    await flush();
    const looks = [...env.field.update.mock.calls.map(c => c[0]), ...mount.mock.calls.map(c => c[1])];
    expect(looks.some(l => l && l.cellAspect === 0.8 && l.glyphScale === 0.8 && l.shade === 0 && l.levels === 'none')).toBe(true);
    run(16);
    expect(trail.active).toBe(true);
    run(6000);
    expect(trail.active).toBe(false);
    trail.destroy();
  });

  it('measures the brush against the span, not the viewport, so it matches a field of that size', async () => {
    const { InkTrail } = await import('../surface/ink-trail');
    const lit = (t: InstanceType<typeof InkTrail>) => { let n = 0; for (let i = 0; i < t.width * t.height; i++) if (t.pixels[i * 4] > 8) n++; return n; };
    const small = new InkTrail(100, 60, 20), wide = new InkTrail(100, 60);
    for (const t of [small, wide]) { t.move(0.2, 0.5, 0.22, 0); t.move(0.5, 0.5, 0.22, 50); t.step(1 / 60); }
    expect(small.span).toBe(20);
    expect(wide.span).toBe(60);
    expect(lit(small)).toBeGreaterThan(0);
    expect(lit(small)).toBeLessThan(lit(wide));
  });
});

describe('cursorTrailFrame', () => {
  const path = Array.from({ length: 6 }, (_, i) => ({ x: i * 10, y: 0, t: i * 100, seed: 0.5, vx: 0, vy: 0 }));
  it('runs densest and widest at the cursor, thinning along the tail', () => {
    const { pen, marks } = recorder();
    cursorTrailFrame(pen, path, 'trail', 520, 800, 9, 0.5);
    const levels = marks.map(m => level(m.style)), widths = marks.map(m => m.width);
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
    expect(widths).toEqual([...widths].sort((a, b) => a - b));
    expect(levels[levels.length - 1]).toBeGreaterThan(200);
    expect(levels[0]).toBeLessThan(levels[levels.length - 1] / 2);
  });
  it('draws rings for water and glints for sparkle', () => {
    for (const style of ['water', 'sparkle', 'wake'] as const) {
      const { pen, marks } = recorder();
      cursorTrailFrame(pen, path, style, 520, 800, 9, 0.5);
      expect(marks.length).toBeGreaterThan(0);
    }
  });
});
