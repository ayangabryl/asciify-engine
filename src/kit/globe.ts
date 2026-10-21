import type { GlyphFieldOptions } from '../field';
import { clamp, handle, house, mountSurface, srOnly, styleKeeper, type KitHandle, type KitOptions, type Surface } from './core';
import { isLand } from './land';

export interface GlobePoint {
  lat: number;
  lon: number;
}

export interface GlobeOptions extends KitOptions {
  /** Degrees a second the globe turns; negative turns it the other way, 0 holds it. Default 6. */
  speed?: number;
  /** Longitude facing the viewer at the start, in degrees. Default -30 (the Americas and the Atlantic). */
  lon?: number;
  /** Tilt toward the viewer in degrees; positive shows more of the north. Default 18. */
  tilt?: number;
  /** Where land is, as a tone from 0 to 1 (or a boolean) for a latitude and longitude in degrees. Default the built-in world map. */
  land?: (lat: number, lon: number) => number | boolean;
  /** Latitude and longitude lines every this many degrees; 0 for none. Default 15. */
  graticule?: number;
  /** Places marked with a bright dot and a ring that keeps spreading from it. */
  points?: GlobePoint[];
  /** How strongly the far side's land shows through the near side's ocean, 0 to 1. Default 0.22. */
  backside?: number;
  /** The globe's diameter as a share of the element's shorter side. Default 0.92. */
  size?: number;
  /** Drag to turn it, with a little momentum. Default true. */
  drag?: boolean;
  /** Read to assistive technology. Without one the globe is decoration. */
  label?: string;
}

export interface GlobeHandle extends KitHandle<GlobeOptions> {
  /** Turns the globe until `lon` (and `lat`, when given, through the tilt) faces the viewer. */
  rotateTo(lon: number, lat?: number): void;
  /** The longitude facing the viewer now. */
  readonly lon: number;
}

const DEFAULTS = { speed: 6, lon: -30, tilt: 18, graticule: 15, backside: 0.22, size: 0.92, drag: true };
const RAD = Math.PI / 180;
const MAX_SOURCE = 320;
const wrap = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;

/** One frame of the globe as tones, white the densest. Exported for tests. */
export function globeFrame(image: ImageData, centre: number, tilt: number, size: number, land: (lat: number, lon: number) => number, graticule: number, backside: number) {
  const { width: w, height: h, data } = image;
  const R = (Math.min(w, h) / 2) * size, cx = w / 2, cy = h / 2;
  const ct = Math.cos(tilt * RAD), st = Math.sin(tilt * RAD);
  const world = (vx: number, vy: number, vz: number) => {
    const wy = vy * ct + vz * st, wz = -vy * st + vz * ct;
    return [Math.asin(clamp(wy, -1, 1)) / RAD, wrap(Math.atan2(vx, wz) / RAD + centre)];
  };
  for (let y = 0; y < h; y++) {
    const ny = (cy - y - 0.5) / R;
    for (let x = 0; x < w; x++) {
      const nx = (x + 0.5 - cx) / R, r2 = nx * nx + ny * ny, k = (y * w + x) * 4;
      let tone = 0;
      if (r2 <= 1) {
        const z = Math.sqrt(1 - r2);
        const [lat, lon] = world(nx, ny, z);
        const ground = land(lat, lon);
        tone = ground > 0 ? ground * (0.5 + 0.5 * z) : 0.05 * z;
        if (graticule > 0) {
          // A line about a source pixel wide wherever it falls on the sphere: wider in degrees toward the rim.
          const tol = (0.7 / (R * Math.max(z, 0.2))) / RAD;
          const dLat = Math.abs(lat - Math.round(lat / graticule) * graticule), dLon = Math.abs(lon - Math.round(lon / graticule) * graticule) * Math.cos(lat * RAD);
          if (dLat < tol || dLon < tol) tone = Math.max(tone, 0.22 * (0.4 + 0.6 * z));
        }
        if (backside > 0 && ground <= 0) {
          const [blat, blon] = world(nx, ny, -z);
          const far = land(blat, blon);
          if (far > 0) tone = Math.max(tone, far * backside * (0.35 + 0.65 * z));
        }
      } else if (r2 < 1.1) tone = 0.18 * (1 - (Math.sqrt(r2) - 1) / (Math.sqrt(1.1) - 1));
      const n = Math.round(clamp(tone) * 255);
      data[k] = data[k + 1] = data[k + 2] = n;
      data[k + 3] = 255;
    }
  }
}

/** Where a point falls, in source pixels, and whether it faces the viewer. Exported for tests. */
export function globeProject(point: GlobePoint, centre: number, tilt: number, w: number, h: number, size: number) {
  const R = (Math.min(w, h) / 2) * size, lat = point.lat * RAD, lon = (point.lon - centre) * RAD;
  const wx = Math.cos(lat) * Math.sin(lon), wy = Math.sin(lat), wz = Math.cos(lat) * Math.cos(lon);
  const ct = Math.cos(tilt * RAD), st = Math.sin(tilt * RAD);
  const vy = wy * ct - wz * st, vz = wy * st + wz * ct;
  return { x: w / 2 + wx * R, y: h / 2 - vy * R, front: vz > 0, depth: vz };
}

/**
 * A globe of dots: land, a faint ocean, latitude and longitude lines and the far side's land showing through, turning slowly.
 * Drag turns it; `points` mark places with a spreading ring. It holds still under reduced motion, and a globe with `speed: 0`
 * and no points draws once and idles.
 */
export function globe(element: HTMLElement, options: GlobeOptions = {}): GlobeHandle {
  const state = { current: { ...DEFAULTS, ...options } };
  const o = () => state.current;
  const styles = styleKeeper();
  let centre = o().lon, velocity = 0, dragging = false, lastX = 0, lastAt = 0, paintedAt = 0, image: ImageData | null = null;
  let turn: { from: number; to: number; tiltFrom: number; tiltTo: number; start: number } | null = null;
  let tilt = o().tilt;
  const label = o().label ? srOnly(o().label) : null;
  const land = (lat: number, lon: number) => {
    const own = o().land;
    if (!own) return isLand(lat, lon) ? 1 : 0;
    const v = own(lat, lon);
    return typeof v === 'boolean' ? (v ? 1 : 0) : clamp(v);
  };
  const look = (): GlyphFieldOptions => ({
    mark: 'dot', charset: ' .:-=+*#%@', cellSize: 5, cellAspect: 1, dotScale: 0.86, contrast: 1, ...o().look,
  });

  let surface: Surface | null = null;
  surface = mountSurface({
    host: element,
    kit: state,
    look,
    ink: () => o().ink ?? '--ascii-ink-strong',
    reducedMotion: () => o().reducedMotion,
    resolution: (w, h) => { const k = Math.min(1, MAX_SOURCE / Math.max(w, h)); return [Math.max(8, Math.round(w * k)), Math.max(8, Math.round(h * k))]; },
    onFail: () => { surface = null; styles.restore(); },
    paint: ({ pen, width, height, now, still }) => {
      const dt = paintedAt ? Math.min(0.1, Math.max(0, now - paintedAt) / 1000) : 0;
      paintedAt = now;
      if (turn) {
        const k = still ? 1 : house(clamp((now - turn.start) / 900));
        centre = turn.from + (turn.to - turn.from) * k;
        tilt = turn.tiltFrom + (turn.tiltTo - turn.tiltFrom) * k;
        if (k >= 1) turn = null;
      } else if (!still && !dragging) {
        centre += o().speed * dt + velocity * dt;
        velocity *= Math.exp(-dt * 3);
        if (Math.abs(velocity) < 0.5) velocity = 0;
      }
      centre = wrap(centre);
      if (!image || image.width !== width || image.height !== height) image = pen.createImageData(width, height);
      globeFrame(image, centre, tilt, o().size, land, o().graticule, o().backside);
      pen.putImageData(image, 0, 0);
      const points = o().points ?? [];
      const R = (Math.min(width, height) / 2) * o().size;
      for (const [i, point] of points.entries()) {
        const at = globeProject(point, centre, tilt, width, height, o().size);
        if (!at.front) continue;
        pen.fillStyle = '#fff';
        pen.beginPath();
        pen.arc(at.x, at.y, Math.max(1.5, R * 0.03), 0, Math.PI * 2);
        pen.fill();
        if (still) continue;
        const age = ((now + i * 537) % 1800) / 1800;
        pen.strokeStyle = `rgba(255,255,255,${(1 - age) * 0.9 * at.depth})`;
        pen.lineWidth = Math.max(1, R * 0.012);
        pen.beginPath();
        pen.arc(at.x, at.y, R * (0.03 + age * 0.12), 0, Math.PI * 2);
        pen.stroke();
      }
      return !still && (o().speed !== 0 || points.length > 0 || dragging || velocity !== 0 || !!turn);
    },
  });

  const down = (event: PointerEvent) => {
    if (!o().drag || event.button !== 0 || !surface) return;
    dragging = true; velocity = 0; turn = null;
    lastX = event.clientX; lastAt = event.timeStamp || performance.now();
    (event.currentTarget as Element | null)?.setPointerCapture?.(event.pointerId);
    surface.kick();
  };
  const move = (event: PointerEvent) => {
    if (!dragging || !surface) return;
    const rect = element.getBoundingClientRect();
    const R = (Math.min(rect.width, rect.height) / 2) * o().size || 1;
    const at = event.timeStamp || performance.now();
    const turned = -((event.clientX - lastX) / R) / RAD;
    centre += turned;
    velocity = at > lastAt ? clamp((turned / (at - lastAt)) * 1000, -240, 240) : velocity;
    lastX = event.clientX; lastAt = at;
    surface.kick();
  };
  const up = () => { if (!dragging) return; dragging = false; surface?.kick(); };
  if (surface) {
    if (label) element.appendChild(label);
    if (o().drag) { styles.set(element, 'touch-action', 'pan-y'); styles.set(element, 'cursor', 'grab'); }
    element.addEventListener('pointerdown', down);
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', up);
  }

  return handle(() => surface, state, next => {
    if (next.tilt !== undefined && !turn) tilt = next.tilt;
    if (label) label.textContent = next.label ?? '';
    surface?.refresh();
  }, {
    rotateTo(lon: number, lat?: number) {
      if (!surface) { centre = wrap(lon); return; }
      const to = centre + wrap(lon - centre);
      turn = { from: centre, to, tiltFrom: tilt, tiltTo: lat === undefined ? tilt : clamp(lat, -80, 80), start: performance.now() };
      velocity = 0;
      surface.kick();
    },
    get lon() { return wrap(centre); },
  }, () => {
    element.removeEventListener('pointerdown', down);
    element.removeEventListener('pointermove', move);
    element.removeEventListener('pointerup', up);
    element.removeEventListener('pointercancel', up);
    label?.remove();
    styles.restore();
  });
}
