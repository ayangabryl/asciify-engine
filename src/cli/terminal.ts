/* The terminal: what it can show, and a full-screen player for animations and 3D models. */

/** Colours the terminal shows: 24-bit, 256, or none. Honours NO_COLOR and FORCE_COLOR. */
export function terminalColors(stream: NodeJS.WriteStream = process.stdout): 'truecolor' | '256' | false {
  const env = process.env;
  if ('NO_COLOR' in env && env.NO_COLOR !== '') return false;
  const force = env.FORCE_COLOR;
  if (force === '0' || force === 'false') return false;
  if (force === '3' || force === 'truecolor') return 'truecolor';
  if (!stream.isTTY && !force) return false;
  if (env.TERM === 'dumb') return false;
  if (/^(truecolor|24bit)$/i.test(env.COLORTERM ?? '')) return 'truecolor';
  if (env.WT_SESSION || env.KITTY_WINDOW_ID || env.WEZTERM_PANE || env.GHOSTTY_RESOURCES_DIR) return 'truecolor';
  if (/^(iTerm\.app|WezTerm|vscode|Hyper|ghostty|Tabby|rio|WarpTerminal)$/.test(env.TERM_PROGRAM ?? '')) return 'truecolor';
  if (/kitty|alacritty|foot|ghostty|wezterm|direct/.test(env.TERM ?? '')) return 'truecolor';
  return '256';
}

/** Whether the terminal's background is light, from COLORFGBG where the terminal sets it. */
export function terminalIsLight(): boolean {
  const bg = (process.env.COLORFGBG ?? '').split(';').pop();
  return bg === '7' || bg === '15';
}

export function terminalSize(stream: NodeJS.WriteStream = process.stdout) {
  return { columns: stream.columns || 80, rows: stream.rows || 24 };
}

export interface PlayerControls {
  /** Arrow keys and mouse drags turn a model: degrees across and up. */
  turn?(dx: number, dy: number): void;
  /** + and - and the wheel. */
  zoom?(factor: number): void;
  reset?(): void;
  /** Space. */
  pause?(paused: boolean): void;
  /** The terminal changed size. */
  resize?(): void;
}

/**
 * Takes over the terminal for an animation: the alternate screen, no cursor, frames drawn in place (synchronised where the
 * terminal supports it, so they never tear), keys and the mouse read, and everything put back on the way out.
 */
export class Player {
  private closed = false;
  private paused = false;
  private readonly out = process.stdout;
  private readonly onData = (chunk: Buffer) => this.input(chunk.toString('latin1'));
  private readonly onResize = () => { this.out.write('\x1b[2J'); this.controls.resize?.(); };
  private readonly onSignal = () => this.close();
  private dragging: { x: number; y: number } | null = null;
  readonly done: Promise<void>;
  private finish!: () => void;

  constructor(private readonly controls: PlayerControls = {}, private readonly mouse = false) {
    this.done = new Promise(resolve => { this.finish = resolve; });
    this.out.write('\x1b[?1049h\x1b[?25l\x1b[2J' + (mouse ? '\x1b[?1002h\x1b[?1006h' : ''));
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on('data', this.onData);
    }
    this.out.on('resize', this.onResize);
    process.once('SIGINT', this.onSignal);
    process.once('SIGTERM', this.onSignal);
    process.once('exit', () => this.restore());
  }

  get isClosed() { return this.closed; }
  get isPaused() { return this.paused; }

  /** Draws a frame in place. */
  draw(frame: string) {
    if (this.closed) return;
    this.out.write(`\x1b[?2026h\x1b[H${frame.replace(/\n/g, '\x1b[K\n')}\x1b[K\x1b[J\x1b[?2026l`);
  }

  private input(text: string) {
    // Mouse (SGR): ESC [ < button ; x ; y M|m
    const mouse = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
    let match: RegExpExecArray | null, rest = text;
    while ((match = mouse.exec(text))) {
      const button = Number(match[1]), x = Number(match[2]), y = Number(match[3]), release = match[4] === 'm';
      if (button === 64) this.controls.zoom?.(1.1);
      else if (button === 65) this.controls.zoom?.(1 / 1.1);
      else if (release) this.dragging = null;
      else if ((button & 3) === 0) {
        if (this.dragging && (button & 32)) this.controls.turn?.((x - this.dragging.x) * 4, (y - this.dragging.y) * 6);
        this.dragging = { x, y };
      }
    }
    rest = text.replace(mouse, '');
    if (!rest) return;
    if (rest === '\x03' || rest === 'q' || rest === 'Q' || rest === '\x1b') { this.close(); return; }
    if (rest === ' ') { this.paused = !this.paused; this.controls.pause?.(this.paused); return; }
    if (rest === '+' || rest === '=') this.controls.zoom?.(1.15);
    else if (rest === '-' || rest === '_') this.controls.zoom?.(1 / 1.15);
    else if (rest === 'r' || rest === 'R') this.controls.reset?.();
    else if (rest === '\x1b[D') this.controls.turn?.(-10, 0);
    else if (rest === '\x1b[C') this.controls.turn?.(10, 0);
    else if (rest === '\x1b[A') this.controls.turn?.(0, -8);
    else if (rest === '\x1b[B') this.controls.turn?.(0, 8);
  }

  private restored = false;
  private restore() {
    if (this.restored) return;
    this.restored = true;
    if (process.stdin.isTTY) { try { process.stdin.setRawMode(false); } catch { /* already gone */ } }
    this.out.write((this.mouse ? '\x1b[?1006l\x1b[?1002l' : '') + '\x1b[?25h\x1b[?1049l');
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    process.stdin.off('data', this.onData);
    process.stdin.pause();
    this.out.off('resize', this.onResize);
    process.off('SIGINT', this.onSignal);
    process.off('SIGTERM', this.onSignal);
    this.restore();
    this.finish();
  }
}

/** Resolves after `ms`, or at once when the player closes. */
export function wait(player: Player, ms: number) {
  return new Promise<void>(resolve => {
    if (player.isClosed || ms <= 0) { resolve(); return; }
    const timer = setTimeout(resolve, ms);
    void player.done.then(() => { clearTimeout(timer); resolve(); });
  });
}
