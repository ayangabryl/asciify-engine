import { boxBlur, buildHoverGuide } from './hover-guide';

/**
 * What a photograph says about its own light, depth and surfaces, per cell, so motion can come from the image
 * rather than being laid over it. Eleven floats per cell:
 * 0 local light (luminance softened over a few cells), 1 depth (0 far, 1 near), 2 glow (nearness to a highlight),
 * 3 detail (local contrast), 4–5 surface normal from the luminance relief, 6–7 the subject's center,
 * 8 water, 9 sky (open sky and its clouds), 10 falling water, each 0..1.
 */
export const PHOTO_CUE_STRIDE = 11;
export type PhotoCues = Float32Array;

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };

/** The value below which `share` of the samples fall; robust normalization without a full sort. */
function quantile(values: Float32Array, share: number, bins = 256) {
  let max = 0;
  for (let i = 0; i < values.length; i++) if (values[i] > max) max = values[i];
  if (max <= 0) return 0;
  const counts = new Uint32Array(bins);
  for (let i = 0; i < values.length; i++) counts[Math.min(bins - 1, Math.floor(Math.max(0, values[i]) / max * bins))]++;
  let seen = 0;
  const target = values.length * share;
  for (let b = 0; b < bins; b++) { seen += counts[b]; if (seen >= target) return (b + 1) / bins * max; }
  return max;
}

/** Long side of the grid depth and surfaces are read on; larger grids are averaged down first. */
const ANALYSIS_CELLS = 12000;

/** A shared scratch pool: analysis runs for every source frame, so it allocates once per grid size. */
class Pool {
  private arrays: Float32Array[] = [];
  private next = 0;
  constructor(readonly n: number) {}
  take(from?: Float32Array) {
    if (this.next === this.arrays.length) this.arrays.push(new Float32Array(this.n));
    const a = this.arrays[this.next++];
    if (from) a.set(from); else a.fill(0);
    return a;
  }
  reset() { this.next = 0; }
}
let pool: Pool | null = null;

/**
 * Edge-aware smoothing of `p`, guided by the colour image (a colour guided filter, He et al.): the result follows the
 * photo's own object boundaries instead of bleeding across them. Linear in the cell count.
 */
function guidedFilter(p: Float32Array, r: Float32Array, g: Float32Array, b: Float32Array, w: number, h: number, radius: number, eps: number, P: Pool) {
  const n = w * h, s = P.take();
  const blur = (a: Float32Array) => { boxOnce(a, s, w, h, radius); return a; };
  const product = (a: Float32Array, c: Float32Array) => { const o = P.take(); for (let i = 0; i < n; i++) o[i] = a[i] * c[i]; return blur(o); };
  const mr = blur(P.take(r)), mg = blur(P.take(g)), mb = blur(P.take(b)), mp = blur(P.take(p));
  const rr = product(r, r), rg = product(r, g), rb = product(r, b), gg = product(g, g), gb = product(g, b), bb = product(b, b);
  const rp = product(r, p), gp = product(g, p), bp = product(b, p);
  const ar = P.take(), ag = P.take(), ab = P.take(), bo = P.take();
  for (let i = 0; i < n; i++) {
    const sr = rp[i] - mr[i] * mp[i], sg = gp[i] - mg[i] * mp[i], sb = bp[i] - mb[i] * mp[i];
    const a11 = rr[i] - mr[i] * mr[i] + eps, a12 = rg[i] - mr[i] * mg[i], a13 = rb[i] - mr[i] * mb[i];
    const a22 = gg[i] - mg[i] * mg[i] + eps, a23 = gb[i] - mg[i] * mb[i], a33 = bb[i] - mb[i] * mb[i] + eps;
    const c11 = a22 * a33 - a23 * a23, c12 = a13 * a23 - a12 * a33, c13 = a12 * a23 - a13 * a22;
    const c22 = a11 * a33 - a13 * a13, c23 = a12 * a13 - a11 * a23, c33 = a11 * a22 - a12 * a12;
    const det = a11 * c11 + a12 * c12 + a13 * c13;
    const k = Math.abs(det) > 1e-12 ? 1 / det : 0;
    ar[i] = (c11 * sr + c12 * sg + c13 * sb) * k;
    ag[i] = (c12 * sr + c22 * sg + c23 * sb) * k;
    ab[i] = (c13 * sr + c23 * sg + c33 * sb) * k;
    bo[i] = mp[i] - ar[i] * mr[i] - ag[i] * mg[i] - ab[i] * mb[i];
  }
  blur(ar); blur(ag); blur(ab); blur(bo);
  for (let i = 0; i < n; i++) p[i] = ar[i] * r[i] + ag[i] * g[i] + ab[i] * b[i] + bo[i];
}

/** One box pass: the guided filter needs local means, not the smoother two-pass blur. */
function boxOnce(values: Float32Array, scratch: Float32Array, w: number, h: number, radius: number) {
  const span = radius * 2 + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += values[row + Math.max(0, Math.min(w - 1, x))];
    for (let x = 0; x < w; x++) {
      scratch[row + x] = sum / span;
      sum += values[row + Math.min(w - 1, x + radius + 1)] - values[row + Math.max(0, x - radius)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += scratch[Math.max(0, Math.min(h - 1, y)) * w + x];
    for (let y = 0; y < h; y++) {
      values[y * w + x] = sum / span;
      sum += scratch[Math.min(h - 1, y + radius + 1) * w + x] - scratch[Math.max(0, y - radius) * w + x];
    }
  }
}

/** The gray-guided filter: cheaper, enough to snap a soft mask to the photo's tonal edges. */
function grayGuidedFilter(p: Float32Array, I: Float32Array, w: number, h: number, radius: number, eps: number, P: Pool) {
  const n = w * h, s = P.take();
  const mi = P.take(I), mp = P.take(p), ii = P.take(), ip = P.take();
  for (let i = 0; i < n; i++) { ii[i] = I[i] * I[i]; ip[i] = I[i] * p[i]; }
  boxOnce(mi, s, w, h, radius); boxOnce(mp, s, w, h, radius); boxOnce(ii, s, w, h, radius); boxOnce(ip, s, w, h, radius);
  for (let i = 0; i < n; i++) {
    const a = (ip[i] - mi[i] * mp[i]) / (ii[i] - mi[i] * mi[i] + eps);
    ii[i] = a; ip[i] = mp[i] - a * mi[i];
  }
  boxOnce(ii, s, w, h, radius); boxOnce(ip, s, w, h, radius);
  for (let i = 0; i < n; i++) p[i] = ii[i] * I[i] + ip[i];
}

/** Soft "reachable from" propagation: a value spreads through cells whose `pass` allows it, losing a little per step. */
function propagate(value: Float32Array, pass: Float32Array, w: number, h: number, loss: number, sweeps = 2) {
  for (let s = 0; s < sweeps; s++) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let best = value[i];
      if (x > 0) best = Math.max(best, Math.min(pass[i], value[i - 1] * loss));
      if (y > 0) best = Math.max(best, Math.min(pass[i], value[i - w] * loss), x > 0 ? Math.min(pass[i], value[i - w - 1] * loss) : 0, x < w - 1 ? Math.min(pass[i], value[i - w + 1] * loss) : 0);
      value[i] = best;
    }
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let best = value[i];
      if (x < w - 1) best = Math.max(best, Math.min(pass[i], value[i + 1] * loss));
      if (y < h - 1) best = Math.max(best, Math.min(pass[i], value[i + w] * loss), x > 0 ? Math.min(pass[i], value[i + w - 1] * loss) : 0, x < w - 1 ? Math.min(pass[i], value[i + w + 1] * loss) : 0);
      value[i] = best;
    }
  }
}

function minFilter(values: Float32Array, scratch: Float32Array, w: number, h: number, radius: number) {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 1;
    for (let k = Math.max(0, x - radius); k <= Math.min(w - 1, x + radius); k++) m = Math.min(m, values[y * w + k]);
    scratch[y * w + x] = m;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 1;
    for (let k = Math.max(0, y - radius); k <= Math.min(h - 1, y + radius); k++) m = Math.min(m, scratch[k * w + x]);
    values[y * w + x] = m;
  }
}

interface Analysis { depth: Float32Array; water: Float32Array; sky: Float32Array; falls: Float32Array }

/**
 * Monocular depth and open surfaces from several cues read once per source frame, at a small grid:
 * focus (defocus is far), atmospheric perspective (haze lifts the darkest channel, lowers contrast and cools),
 * a ground-plane prior that is only trusted when the frame has a horizon, texture gradient (finer is farther)
 * and colour saliency (a distinct, saturated, central region is near). The fused estimate is smoothed with a
 * colour guided filter so it follows object boundaries. Water and sky come from hue, texture, direction and
 * position, grown from confident seeds through compatible cells, and are kept off everything else.
 */
function analyse(rgba: ArrayLike<number>, color: ArrayLike<number>, w: number, h: number, P: Pool): Analysis {
  const n = w * h, short = Math.min(w, h);
  const R = P.take(), G = P.take(), B = P.take(), L = P.take(), A = P.take();
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3] / 255;
    A[i] = a;
    R[i] = color[i * 4] / 255 * a; G[i] = color[i * 4 + 1] / 255 * a; B[i] = color[i * 4 + 2] / 255 * a;
    L[i] = (rgba[i * 4] * .299 + rgba[i * 4 + 1] * .587 + rgba[i * 4 + 2] * .114) / 255 * a;
  }
  const s = P.take();
  const blurred = (src: Float32Array, radius: number) => { const o = P.take(src); boxBlur(o, s, w, h, radius); return o; };
  const r2 = Math.max(2, Math.round(short * .04)), r3 = Math.max(r2 + 2, Math.round(short * .12)), rw = Math.max(2, Math.round(short * .05));
  const L1 = blurred(L, 1), L2 = blurred(L, r2), L3 = blurred(L, r3);
  // Band energies: fine (one cell), mid and coarse structure.
  const e1 = P.take(), e2 = P.take(), e3 = P.take(), gx = P.take(), gy = P.take();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    e1[i] = Math.abs(L[i] - L1[i]); e2[i] = Math.abs(L1[i] - L2[i]); e3[i] = Math.abs(L2[i] - L3[i]);
    gx[i] = Math.abs(L[y * w + Math.min(w - 1, x + 1)] - L[y * w + Math.max(0, x - 1)]);
    gy[i] = Math.abs(L[Math.min(h - 1, y + 1) * w + x] - L[Math.max(0, y - 1) * w + x]);
  }
  boxBlur(e1, s, w, h, rw); boxBlur(e2, s, w, h, rw); boxBlur(e3, s, w, h, rw); boxBlur(gx, s, w, h, 2); boxBlur(gy, s, w, h, 2);
  const textured = Math.max(.01, quantile(e1, .9) + quantile(e2, .9));
  // Colour: blurred a little so single cells do not decide hue.
  const cr = blurred(R, 1), cg = blurred(G, 1), cb = blurred(B, 1);
  const hue = P.take(), sat = P.take(), val = P.take();
  let chromaSum = 0;
  for (let i = 0; i < n; i++) {
    const r = cr[i], g = cg[i], b = cb[i], max = Math.max(r, g, b), min = Math.min(r, g, b), c = max - min;
    val[i] = max; sat[i] = max > 1e-3 ? c / max : 0; chromaSum += c;
    let hh = 0;
    if (c > 1e-4) hh = max === r ? ((g - b) / c + 6) % 6 : max === g ? (b - r) / c + 2 : (r - g) / c + 4;
    hue[i] = hh * 60;
  }
  // An accent ink or grayscale grid has no hue to read; colour cues then stay silent.
  const colorful = smooth(.02, .07, chromaSum / n);

  // Horizon: a long horizontal boundary where colour and brightness step across most of the width, with
  // smoother ground above than below. How clearly one exists decides how far the ground prior is trusted.
  const band = Math.max(2, Math.round(h * .06));
  const rowTex = new Float32Array(h);
  for (let y = 0; y < h; y++) { let t = 0; for (let x = 0; x < w; x++) t += e1[y * w + x] + e2[y * w + x]; rowTex[y] = t / w; }
  let horizon = .5, horizonScore = 0;
  for (let y = Math.max(band, Math.round(h * .12)); y <= Math.min(h - band, Math.round(h * .88)); y++) {
    let step = 0, across = 0, above = 0, below = 0;
    for (let x = 0; x < w; x++) {
      let ar = 0, ag = 0, ab = 0, br = 0, bg = 0, bb = 0;
      for (let k = 1; k <= band; k++) {
        const i = (y - k) * w + x, j = (y + k - 1) * w + x;
        ar += cr[i]; ag += cg[i]; ab += cb[i]; br += cr[j]; bg += cg[j]; bb += cb[j];
      }
      const d = (Math.abs(ar - br) + Math.abs(ag - bg) + Math.abs(ab - bb)) / band;
      step += d; across += d > .12 ? 1 : 0;
    }
    // Compared just above and below the line: palms or a tower can make the whole upper half busy.
    const reach = Math.max(2, Math.round(h * .15)), top = Math.max(0, y - reach), bottom = Math.min(h, y + reach);
    for (let k = top; k < y; k++) above += rowTex[k];
    for (let k = y; k < bottom; k++) below += rowTex[k];
    above /= y - top; below /= bottom - y;
    const rougher = smooth(-.05, .3, (below - above) / (below + above + 1e-4));
    const score = smooth(.08, .35, step / w) * (across / w) * rougher;
    if (score > horizonScore) { horizonScore = score; horizon = y / h; }
  }
  const horizonLike = smooth(.15, .45, horizonScore);

  // Monocular cues, each with its own confidence.
  const dark = P.take(), contrast = P.take(), sal = P.take();
  for (let i = 0; i < n; i++) dark[i] = Math.min(R[i], G[i], B[i]);
  minFilter(dark, s, w, h, 1); boxBlur(dark, s, w, h, r2);
  for (let i = 0; i < n; i++) contrast[i] = e2[i] + e3[i];
  let mr = 0, mg = 0, mb = 0;
  for (let i = 0; i < n; i++) { mr += cr[i]; mg += cg[i]; mb += cb[i]; }
  mr /= n; mg /= n; mb /= n;
  const sr = blurred(cr, r2), sg = blurred(cg, r2), sb = blurred(cb, r2), wr = blurred(cr, r3), wg = blurred(cg, r3), wb = blurred(cb, r3);
  for (let i = 0; i < n; i++) {
    const distinct = Math.hypot(sr[i] - mr, sg[i] - mg, sb[i] - mb);
    const surround = Math.hypot(sr[i] - wr[i], sg[i] - wg[i], sb[i] - wb[i]);
    sal[i] = (distinct + surround * 1.5) * (.4 + .6 * sat[i] * colorful + .4 * (1 - colorful));
  }
  // Sky first: smooth blue, warm gradient or night, reachable from the top edge above the horizon; clouds only
  // a few cells out from it, so snow and pale walls that touch the sky stay put.
  const sky = P.take(), skyPass = P.take(), cloudPass = P.take(), water = P.take(), waterPass = P.take(), foreign = P.take(), falls = P.take(), mirror = P.take(), reflect = P.take();
  // Falling water churns along its length; a column or a pleat is smooth from top to bottom.
  const churn = P.take();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) churn[y * w + x] = Math.abs(L[Math.min(h - 1, y + 1) * w + x] - L[Math.max(0, y - 1) * w + x]);
  boxBlur(churn, s, w, h, 1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, v = (y + .5) / h, hh = hue[i], st = sat[i] * colorful, vl = val[i], tx = e1[i] + e2[i];
    const blue = smooth(175, 200, hh) * (1 - smooth(250, 275, hh)) * smooth(.08, .25, st);
    const warm = (1 - smooth(45, 65, hh) + smooth(290, 330, hh)) * smooth(.2, .45, st) * smooth(.3, .55, vl);
    // White and night skies look like plain walls and grounds: they only count when the frame has a horizon.
    const cloud = (1 - smooth(.15, .35, st)) * smooth(.45, .7, vl) * horizonLike;
    const night = (1 - smooth(.08, .2, vl)) * horizonLike;
    const above = horizonLike > .3 ? 1 - smooth(horizon, horizon + .1, v) : 1 - smooth(.4, .8, v);
    const calm = 1 - smooth(.02, .06, tx), soft = 1 - smooth(.03, .09, tx);
    // A night sky must be still darker and plainer than the dark city under it, or lit windows would drift with it.
    skyPass[i] = Math.max(blue * calm, night * .7 * (1 - smooth(.008, .025, tx)), warm * soft * .9) * above;
    cloudPass[i] = Math.max(skyPass[i], cloud * calm * above);
    sky[i] = y === 0 ? skyPass[i] : 0;
    // Water: blue-green to cyan anywhere it is not sky (a sea that is not blue is found by its reflection below).
    water[i] = smooth(150, 172, hh) * (1 - smooth(232, 250, hh)) * smooth(.25, .45, st);
    // Falling water: bright, nearly colourless, finely streaked up and down (a waterfall, a fountain, rain).
    falls[i] = smooth(1.3, 2.2, (gx[i] + .004) / (gy[i] + .004)) * smooth(.35, .55, L1[i]) * (1 - smooth(.1, .18, sat[i] * colorful)) * smooth(.025, .07, tx) * smooth(.025, .045, churn[i]);
    // Foam, spray, glints and dark water carry water on from a seed; a hued object (skin, a shell, a hull) stops it.
    const neutral = 1 - smooth(.18, .4, st), spray = smooth(.55, .8, vl) * smooth(.05, .12, tx);
    waterPass[i] = Math.max(water[i], neutral * .85, spray * .8);
  }
  propagate(sky, skyPass, w, h, .995, 1);
  propagate(sky, cloudPass, w, h, .8, 1);
  // With a sky above it, water lies below the horizon; without one (a pool, the sea from above) it may be anywhere.
  let skyCells = 0;
  for (let i = 0; i < n; i++) skyCells += sky[i];
  const skyAbove = skyCells > n * .04 && horizonLike > .3;
  if (skyAbove) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) water[y * w + x] *= smooth(horizon, horizon + .05, (y + .5) / h);
  // A sea of any colour reflects what stands above it: below a straight waterline each cell echoes the colour of the
  // cell mirrored above it, clearly darker, and itself looks like water (level ripples, or the dark of a night sea).
  // Every straight line is tried, and the one whose echo explains the most cells wins.
  if (skyAbove) {
    const ls = P.take(), slope = P.take(), echo = P.take();
    for (let i = 0; i < n; i++) ls[i] = sr[i] * .299 + sg[i] * .587 + sb[i] * .114;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) slope[y * w + x] = L1[Math.min(h - 1, y + 1) * w + x] - L1[Math.max(0, y - 1) * w + x];
    // A shore, a ridge or a bank of mist wanders; count the columns whose strongest nearby step is on the line.
    const peak = new Uint8Array(n);
    for (let y = 1; y < h - 1; y++) for (let x = 0; x < w; x++) {
      const edge = Math.abs(slope[y * w + x]);
      let top = edge > .03;
      for (let k = -3; k <= 3 && top; k++) if (k && y + k >= 0 && y + k < h && Math.abs(slope[(y + k) * w + x]) > edge) top = false;
      peak[y * w + x] = top ? 1 : 0;
    }
    const echoAt = (line: number, i: number, j: number, strict = true) => {
      const a = sr[i] + sg[i] + sb[i] + .05, b = sr[j] + sg[j] + sb[j] + .05;
      const chroma = Math.abs(sr[i] / a - sr[j] / b) + Math.abs(sg[i] / a - sg[j] / b) + Math.abs(sb[i] / a - sb[j] / b);
      const turn = Math.min(Math.abs(hue[i] - hue[j]), 360 - Math.abs(hue[i] - hue[j]));
      const like = Math.max(1 - smooth(.1, .25, chroma), (1 - smooth(15, 35, turn)) * smooth(.15, .3, Math.min(sat[i], sat[j])));
      const self = Math.max(smooth(2, 3, (gy[i] + .004) / (gx[i] + .004)) * smooth(.015, .04, e1[i] + e2[i]) * smooth(.4, .55, e1[i] / (e1[i] + e2[i] + 1e-4)), 1 - smooth(.12, .25, ls[i]));
      return like * (strict ? self : 1) * (1 - smooth(ls[j] * .82 + .02, ls[j] * 1.02 + .05, ls[i]));
    };
    let line = 0, best = 0;
    for (let y = Math.max(3, Math.round(h * Math.max(.25, horizon))); y < Math.round(h * .88); y++) {
      let straight = 0;
      for (let x = 0; x < w; x++) if (peak[(y - 1) * w + x] || peak[y * w + x] || peak[(y + 1) * w + x]) straight++;
      if (straight < w * .5) continue;
      let total = 0;
      for (let yy = y + 1; yy < Math.min(h, 2 * y); yy++) for (let x = 0; x < w; x++) total += echoAt(y, yy * w + x, (2 * y - yy) * w + x);
      // Explained cells, as a share of the frame: a thin strip at the foot or a scatter of matches is not a sea.
      if (total > best) { best = total; line = y; }
    }
    const sure = smooth(.05, .1, best / n);
    if (sure > 0) for (let y = line + 1; y < Math.min(h, 2 * line); y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      mirror[i] = echoAt(line, i, (2 * line - y) * w + x) * sure;
      // Cells that echo the sky but are not plainly water themselves may still be reached from those that are.
      reflect[i] = echoAt(line, i, (2 * line - y) * w + x, false) * sure;
      echo[i] = mirror[i];
    }
    // Only as deep as there is sky above to mirror; the rest of the sea is reached by the water's own growth.
    boxBlur(echo, s, w, h, 1);
    for (let i = 0; i < n; i++) { mirror[i] = Math.max(mirror[i], echo[i]); water[i] = Math.max(water[i], mirror[i]); }
  }
  // Water is an expanse: a few blue cells (chrome, a shirt, a sign) are not.
  const expanse = blurred(water, r3);
  for (let i = 0; i < n; i++) water[i] *= smooth(.15, .35, expanse[i]);
  const seeds = blurred(water, r2);
  for (let i = 0; i < n; i++) {
    water[i] *= 1 - skyPass[i] * .8;
    // A clearly hued cell far from water's own hues (skin, a shell, a painted hull) is never water.
    const off = Math.min(Math.abs(hue[i] - 200), 360 - Math.abs(hue[i] - 200));
    foreign[i] = smooth(.28, .45, sat[i] * colorful) * smooth(55, 80, off) * (1 - smooth(.3, .6, reflect[i]));
  }
  // Specks of saturated light inside water are glints and reflected sun, not objects: they move with it.
  const crowd = blurred(foreign, r2);
  for (let i = 0; i < n; i++) {
    foreign[i] = Math.max(foreign[i] * (1 - (1 - smooth(.15, .3, crowd[i])) * smooth(.55, .7, val[i]) * smooth(.5, .65, sat[i])), 1 - A[i]);
    waterPass[i] = Math.min(Math.max(waterPass[i], reflect[i] * .9), Math.max(water[i], smooth(.25, .6, seeds[i]))) * (1 - sky[i]) * (1 - foreign[i]);
  }
  propagate(water, waterPass, w, h, .97);
  // A fall is tall: a streaked band that does not run a good part of the frame's height is a column or a fold.
  const tall = P.take(falls), span = Math.max(2, Math.round(h * .12));
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -span; y <= span; y++) sum += falls[Math.max(0, Math.min(h - 1, y)) * w + x];
    for (let y = 0; y < h; y++) {
      tall[y * w + x] = sum / (span * 2 + 1);
      sum += falls[Math.min(h - 1, y + span + 1) * w + x] - falls[Math.max(0, y - span) * w + x];
    }
  }
  boxBlur(tall, s, w, h, 1);
  for (let i = 0; i < n; i++) falls[i] = smooth(.2, .45, tall[i]) * smooth(.2, .5, falls[i] + tall[i] * .5) * (1 - sky[i]);
  // Edges snap to the photo, then an erosion keeps motion from sampling across onto the subject.
  grayGuidedFilter(sky, L, w, h, Math.max(2, Math.round(short * .04)), .002, P);
  grayGuidedFilter(water, L, w, h, Math.max(2, Math.round(short * .04)), .002, P);
  grayGuidedFilter(falls, L, w, h, Math.max(2, Math.round(short * .03)), .002, P);
  boxBlur(foreign, s, w, h, 1);
  for (let i = 0; i < n; i++) {
    sky[i] = smooth(.3, .7, sky[i]) * A[i];
    falls[i] = smooth(.3, .7, falls[i]) * A[i] * (1 - sky[i]);
    water[i] = smooth(.3, .7, water[i]) * (1 - sky[i]) * (1 - falls[i]) * (1 - smooth(.15, .4, foreign[i]));
  }
  // Drift moves water about a cell and sky less: two cells of margin keep it from sampling a subject's edge.
  minFilter(sky, s, w, h, 2); minFilter(water, s, w, h, 2); minFilter(falls, s, w, h, 1);
  boxBlur(sky, s, w, h, 1); boxBlur(water, s, w, h, 1); boxBlur(falls, s, w, h, 1);

  const salScale = 1 / Math.max(.02, quantile(sal, .97));
  const contrastScale = 1 / Math.max(.01, quantile(contrast, .9));
  const darkHigh = quantile(dark, .97), darkLow = quantile(dark, .1);
  const hazeSpread = smooth(.06, .25, darkHigh - darkLow);
  const fused = P.take();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, u = (x + .5) / w, v = (y + .5) / h, open = Math.max(sky[i], water[i]);
    const band = e1[i] + e2[i] + e3[i];
    // Focus: in-focus regions keep their fine and mid detail; defocus leaves only coarse structure.
    const focus = clamp(((e1[i] + e2[i] * .6) / (band + .004) - .25) / .55) * .6 + clamp((e1[i] + e2[i]) / textured) * .4;
    const focusSure = smooth(.04, .35, band / textured) * (1 - open);
    // Atmospheric perspective: haze raises the darkest channel, lowers contrast and cools; dark areas say nothing.
    const haze = clamp((dark[i] - darkLow) / Math.max(.05, darkHigh - darkLow)) * .55 + (1 - clamp(contrast[i] * contrastScale)) * .25
      + clamp((cb[i] - cr[i]) * 2 + .3) * .2 * colorful;
    const hazeSure = hazeSpread * smooth(.12, .35, L2[i]) * (.4 + .6 * horizonLike);
    // A ground plane below the horizon nears toward the bottom. Above it only the sky is known to be far:
    // whatever stands against it (a tree, a tower, a cable car) is left to the other cues.
    const ground = v < horizon ? .45 : .45 + .55 * smooth(0, 1, (v - horizon) / Math.max(.15, 1 - horizon));
    const prior = horizonLike * ground + (1 - horizonLike) * (.5 + (v - .5) * .4);
    // Texture gradient: on a receding textured surface the elements shrink with distance.
    const fineness = e1[i] / (e1[i] + e2[i] + 1e-4);
    const textureSure = smooth(.2, .7, (e1[i] + e2[i]) / textured) * (.35 + .65 * horizonLike) * (1 - open);
    const central = 1 - clamp(Math.hypot((u - .5) * 1.2, v - .52) * 1.5);
    const salient = clamp(sal[i] * salScale) * (.55 + .45 * central);
    const wf = .3 * focusSure, wa = .25 * hazeSure, wv = .12 + .45 * horizonLike, wt = .12 * textureSure, ws = .35 * (1 - .4 * horizonLike) * (1 - open);
    fused[i] = (wf * focus + wa * (1 - haze) + wv * prior + wt * clamp(1.6 - fineness * 1.6) + ws * salient + .08 * .5)
      / (wf + wa + wv + wt + ws + .08) * (1 - .85 * sky[i]) * (1 - .45 * water[i] * (1 - horizonLike));
  }
  const guide = buildHoverGuide(rgba, w, h);
  if (guide.key !== 'none') for (let i = 0; i < n; i++) fused[i] = guide.subject[i] * .7 + fused[i] * .3;
  // Regions first, then boundaries: a soft blur gathers the cues, the guided filter snaps them to edges.
  boxBlur(fused, s, w, h, Math.max(1, Math.round(short * .03)));
  guidedFilter(fused, cr, cg, cb, w, h, Math.max(2, Math.round(short * .07)), .004, P);
  return { depth: fused, water, sky, falls };
}

/** Bilinear read of an analysis channel at a full-grid cell. */
function upsample(values: Float32Array, aw: number, ah: number, x: number, y: number, w: number, h: number) {
  if (aw === w && ah === h) return values[y * w + x];
  const gx = Math.max(0, Math.min(aw - 1, (x + .5) * aw / w - .5)), gy = Math.max(0, Math.min(ah - 1, (y + .5) * ah / h - .5));
  const ix = Math.min(aw - 2, Math.floor(gx)), iy = Math.min(ah - 2, Math.floor(gy)), fx = gx - ix, fy = gy - iy;
  if (ix < 0 || iy < 0) return values[Math.round(gy) * aw + Math.round(gx)];
  const a = iy * aw + ix, b = a + aw;
  return (values[a] * (1 - fx) + values[a + 1] * fx) * (1 - fy) + (values[b] * (1 - fx) + values[b + 1] * fx) * fy;
}

/**
 * Straight-alpha RGBA at the cell grid in; cues out. Cheap enough to rebuild for every video frame.
 * `color` reads hue from other pixels than the tone (a renderer whose tone grid is gray); it defaults to `rgba`.
 */
export function buildPhotoCues(rgba: ArrayLike<number>, width: number, height: number, previous?: PhotoCues | null, color: ArrayLike<number> = rgba): PhotoCues {
  const n = width * height;
  const cues = previous?.length === n * PHOTO_CUE_STRIDE ? previous : new Float32Array(n * PHOTO_CUE_STRIDE);
  if (!n) return cues;
  const short = Math.min(width, height);
  const lum = new Float32Array(n), soft = new Float32Array(n), relief = new Float32Array(n);
  const detail = new Float32Array(n), glow = new Float32Array(n), scratch = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3] / 255;
    lum[i] = (rgba[i * 4] * .299 + rgba[i * 4 + 1] * .587 + rgba[i * 4 + 2] * .114) / 255 * a;
  }
  soft.set(lum); boxBlur(soft, scratch, width, height, Math.max(1, Math.round(short * .012)));
  relief.set(lum); boxBlur(relief, scratch, width, height, Math.max(1, Math.round(short * .03)));
  for (let i = 0; i < n; i++) {
    detail[i] = Math.abs(lum[i] - soft[i]);
    const h = Math.max(0, lum[i] - .55) / .45;
    glow[i] = h * h;
  }
  boxBlur(detail, scratch, width, height, Math.max(1, Math.round(short * .02)));
  const detailScale = 1 / Math.max(.02, quantile(detail, .95));
  boxBlur(glow, scratch, width, height, Math.max(1, Math.round(short * .05)));
  const glowScale = 1 / Math.max(.03, quantile(glow, .98));

  // Depth and surfaces are read on at most ANALYSIS_CELLS cells, averaged down from larger grids.
  const f = Math.max(1, Math.ceil(Math.sqrt(n / ANALYSIS_CELLS)));
  const aw = Math.max(1, Math.floor(width / f)), ah = Math.max(1, Math.floor(height / f)), an = aw * ah;
  let tone: ArrayLike<number> = rgba, hueSource: ArrayLike<number> = color;
  if (f > 1) {
    const t = new Uint8ClampedArray(an * 4), c = color === rgba ? t : new Uint8ClampedArray(an * 4);
    for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
      const sum = [0, 0, 0, 0, 0, 0, 0];
      for (let yy = y * f; yy < (y + 1) * f; yy++) for (let xx = x * f; xx < (x + 1) * f; xx++) {
        const i = (yy * width + xx) * 4;
        for (let k = 0; k < 4; k++) sum[k] += rgba[i + k];
        if (c !== t) for (let k = 0; k < 3; k++) sum[4 + k] += color[i + k];
      }
      const o = (y * aw + x) * 4, area = f * f;
      for (let k = 0; k < 4; k++) t[o + k] = sum[k] / area;
      if (c !== t) { for (let k = 0; k < 3; k++) c[o + k] = sum[4 + k] / area; c[o + 3] = t[o + 3]; }
    }
    tone = t; hueSource = c;
  }
  if (pool?.n !== an) pool = new Pool(an);
  pool.reset();
  const { depth, water, sky, falls } = analyse(tone, hueSource, aw, ah, pool);
  const low = quantile(depth, .03), high = quantile(depth, .97), span = Math.max(.05, high - low);

  let cx = 0, cy = 0, weight = 0;
  const gradient = new Float32Array(n);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, o = i * PHOTO_CUE_STRIDE;
    const d = clamp((upsample(depth, aw, ah, x, y, width, height) - low) / span);
    cues[o + 1] = d;
    cues[o + 8] = clamp(upsample(water, aw, ah, x, y, width, height));
    cues[o + 9] = clamp(upsample(sky, aw, ah, x, y, width, height));
    cues[o + 10] = clamp(upsample(falls, aw, ah, x, y, width, height));
    const wgt = d * d * d * (.25 + lum[i]);
    cx += (x + .5) / width * wgt; cy += (y + .5) / height * wgt; weight += wgt;
    gradient[i] = Math.hypot(relief[y * width + Math.min(width - 1, x + 1)] - relief[y * width + Math.max(0, x - 1)],
      relief[Math.min(height - 1, y + 1) * width + x] - relief[Math.max(0, y - 1) * width + x]);
  }
  cx = weight > 0 ? Math.max(.3, Math.min(.7, cx / weight)) : .5;
  cy = weight > 0 ? Math.max(.3, Math.min(.7, cy / weight)) : .5;
  const gradientScale = 1 / Math.max(.004, quantile(gradient, .97));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, o = i * PHOTO_CUE_STRIDE;
    const gx = (relief[y * width + Math.min(width - 1, x + 1)] - relief[y * width + Math.max(0, x - 1)]) * gradientScale;
    const gy = (relief[Math.min(height - 1, y + 1) * width + x] - relief[Math.max(0, y - 1) * width + x]) * gradientScale;
    cues[o] = relief[i];
    cues[o + 2] = Math.min(1, glow[i] * glowScale);
    cues[o + 3] = Math.min(1, detail[i] * detailScale);
    // Bright reads as raised: a slope's normal leans away from the brighter side.
    cues[o + 4] = Math.max(-1, Math.min(1, -gx));
    cues[o + 5] = Math.max(-1, Math.min(1, -gy));
    cues[o + 6] = cx; cues[o + 7] = cy;
  }
  return cues;
}

/**
 * Packs four channels for the GPU: light, depth, glow and detail; normals are taken from the light channel there.
 * Drift reads water in z and, in w, sky below one half and falling water above it (the two rarely touch).
 */
export function packPhotoCues(cues: PhotoCues, out?: Uint8Array, surfaces = false) {
  const n = cues.length / PHOTO_CUE_STRIDE;
  const pixels = out?.length === n * 4 ? out : new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const o = i * PHOTO_CUE_STRIDE;
    pixels[i * 4] = Math.round(cues[o] * 255); pixels[i * 4 + 1] = Math.round(cues[o + 1] * 255);
    pixels[i * 4 + 2] = Math.round(cues[o + (surfaces ? 8 : 2)] * 255);
    pixels[i * 4 + 3] = Math.round((surfaces ? cues[o + 10] > cues[o + 9] ? .5 + cues[o + 10] * .5 : cues[o + 9] * .5 : cues[o + 3]) * 255);
  }
  return pixels;
}

const frameCache = new WeakMap<object, PhotoCues>();
/** Cues for an engine frame of cells, cached per frame so a looping still is analysed once. */
export function frameCues(frame: readonly (readonly { r: number; g: number; b: number; a: number }[])[]) {
  const cached = frameCache.get(frame);
  if (cached) return cached;
  const rows = frame.length, cols = frame[0]?.length ?? 0, rgba = new Uint8ClampedArray(cols * rows * 4);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const cell = frame[y][x], i = (y * cols + x) * 4;
    rgba[i] = cell.r; rgba[i + 1] = cell.g; rgba[i + 2] = cell.b; rgba[i + 3] = cell.a;
  }
  const cues = buildPhotoCues(rgba, cols, rows);
  frameCache.set(frame, cues);
  return cues;
}
