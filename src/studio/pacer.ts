/** Display frames in a row that must be late before a hover steps down. */
const LATE_RUN = 8;
/** A hover whose frames cost less than this share of a display frame never steps down: its frames are not the cause. */
const LIGHT = 0.4;
/** How soon a stepped-down hover tries a faster rate again, and the longest it waits after repeated failed tries, in ms. */
const PROBE = 500, PROBE_MAX = 1000;
/** A faster rate that has held this long, in ms, has recovered: the next step down waits the shortest time again. */
const SETTLED = 500;

/**
 * Paces a hover drawn in workers. Frames drawn there cost the page nothing, but the browser still rasters and composites
 * each one; when the hover's own frames are what slows the display, it is drawn on every second, third or fourth display
 * frame instead. Only a sustained run of late display frames counts (a frame that took more than a display interval, or
 * a display frame with no hover frame ready to show), only for a hover whose measured cost is a real share of the frame,
 * and a slower rate always tries full rate again within a second. One stall (a busy main thread, a page that
 * hitched) breaks no run of frames and changes nothing.
 */
export class HoverPacer {
  /** Draw a hover frame on every `stride`-th display frame. */
  stride = 1;
  /** The display's own frame interval: the quickest run of 8 frames (single intervals jitter around it). */
  period = Infinity;
  private last = 0;
  private short = 0;
  private shortCount = 0;
  private lateRun = 0;
  /** Display frames left before lateness counts again: a new rate refills the workers' pipeline first. */
  private grace = 0;
  private probeAt = 0;
  private delay = PROBE;
  /** When the last step back up happened, while it is still being tried. */
  private probing = -1;

  /**
   * One display frame. `missed`: the hover wanted a frame shown and none was ready. `load`: the hover's measured cost per
   * display frame, in ms (worker time divided by the workers taking turns).
   */
  tick(now: number, missed: boolean, load: number) {
    const interval = this.last ? now - this.last : 0;
    this.last = now;
    // A long gap is a stall, a hidden page or an idle stretch: nothing about this hover's rate.
    if (interval < 3 || interval > 100) { this.lateRun = 0; return this.stride; }
    this.short += interval;
    if (++this.shortCount === 8) { this.period = Math.min(this.period, this.short / 8); this.short = this.shortCount = 0; }
    if (!Number.isFinite(this.period)) return this.stride;
    const late = missed || interval > this.period * 1.25;
    if (this.grace > 0) { this.grace--; this.lateRun = 0; }
    else this.lateRun = late ? this.lateRun + 1 : 0;
    if (this.probing >= 0 && now - this.probing >= SETTLED) { this.probing = -1; this.delay = PROBE; }
    if (this.lateRun >= LATE_RUN && load > this.period * LIGHT && this.stride < 4) {
      // A step up that slowed the display again waits longer before the next try, up to PROBE_MAX.
      if (this.probing >= 0) this.delay = Math.min(PROBE_MAX, this.delay * 2);
      this.probing = -1;
      this.stride++;
      this.lateRun = 0;
      this.grace = LATE_RUN;
      this.probeAt = now + this.delay;
    } else if (this.stride > 1 && now >= this.probeAt) {
      // Straight back to full rate: a hover the display can draw again recovers at once, not a step a probe.
      this.stride = 1;
      this.lateRun = 0;
      this.grace = LATE_RUN;
      this.probing = now;
      this.probeAt = now + this.delay;
    }
    return this.stride;
  }

  /** A new hover (or mount): full rate, nothing carried over but the display's measured interval. */
  reset() {
    this.stride = 1;
    this.lateRun = this.grace = 0;
    this.delay = PROBE;
    this.probing = -1;
    this.last = 0;
  }
}
