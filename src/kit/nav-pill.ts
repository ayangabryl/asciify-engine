import { prefersReduced, resolveColor, styleKeeper, type KitOptions } from './core';

export interface NavPillOptions extends Pick<KitOptions, 'reducedMotion'> {
  /** The items the pill moves between, inside the nav. Default `a`. */
  selector?: string;
  /** The pill's fill, a CSS colour or token. Default the nav's text colour at 16%. */
  color?: string;
  /** Room around an item's box, in CSS pixels: `[x, y]`. Default `[12, 6]`. */
  padding?: [number, number];
  /** Ms the pill takes to slide to the next item. Default 260. */
  duration?: number;
}

export interface NavPillHandle {
  /** Moves the pill to an item (as hovering it does), or hides it with `null`. */
  to(item: Element | null): void;
  update(next: Partial<NavPillOptions>): void;
  destroy(): void;
}

/**
 * A soft pill behind a nav's links that slides from one to the next under the pointer and keyboard focus, and fades when the
 * pointer leaves: plain DOM and a CSS transition, no canvas. It sits behind the links in the nav's own stacking context.
 */
export function navPill(nav: HTMLElement, options: NavPillOptions = {}): NavPillHandle {
  let o = { selector: 'a', padding: [12, 6] as [number, number], duration: 260, ...options };
  const styles = styleKeeper();
  if (getComputedStyle(nav).position === 'static') styles.set(nav, 'position', 'relative');
  styles.set(nav, 'isolation', 'isolate');
  const pill = document.createElement('span');
  pill.setAttribute('aria-hidden', 'true');
  nav.prepend(pill);
  let shown = false;
  const fill = () => o.color ? resolveColor(o.color, nav) ?? o.color : 'color-mix(in srgb, currentColor 16%, transparent)';
  const reduced = () => !!(o.reducedMotion ?? prefersReduced());
  const base = () => `position:absolute;left:0;top:0;z-index:-1;pointer-events:none;border-radius:999px;background:${fill()};`;
  pill.style.cssText = `${base()}opacity:0`;
  const to = (item: Element | null) => {
    if (!item) { pill.style.opacity = '0'; shown = false; return; }
    const a = nav.getBoundingClientRect(), b = item.getBoundingClientRect(), [px, py] = o.padding;
    const x = b.left - a.left - px + (nav.scrollLeft || 0), y = b.top - a.top - py, w = b.width + px * 2, h = b.height + py * 2;
    // The first show lands in place and fades in; after that the pill slides between items.
    const move = shown && !reduced() ? `transform ${o.duration}ms cubic-bezier(.2,.8,.2,1),width ${o.duration}ms cubic-bezier(.2,.8,.2,1),height ${o.duration}ms cubic-bezier(.2,.8,.2,1),` : '';
    pill.style.cssText = `${base()}transform:translate(${x}px,${y}px);width:${w}px;height:${h}px;opacity:1;transition:${move}opacity ${reduced() ? 0 : 160}ms ease`;
    shown = true;
  };
  const item = (target: EventTarget | null) => (target as Element | null)?.closest?.(o.selector) ?? null;
  const over = (event: Event) => { const el = item(event.target); if (el && nav.contains(el)) to(el); };
  const leave = () => to(null);
  const focus = (event: FocusEvent) => { const el = item(event.target); if (el) to(el); };
  const blur = (event: FocusEvent) => { if (!nav.contains(event.relatedTarget as Node | null)) to(null); };
  nav.addEventListener('pointerover', over);
  nav.addEventListener('pointerleave', leave);
  nav.addEventListener('focusin', focus);
  nav.addEventListener('focusout', blur);
  return {
    to,
    update(next) { o = { ...o, ...next }; pill.style.background = fill(); },
    destroy() {
      nav.removeEventListener('pointerover', over);
      nav.removeEventListener('pointerleave', leave);
      nav.removeEventListener('focusin', focus);
      nav.removeEventListener('focusout', blur);
      pill.remove();
      styles.restore();
    },
  };
}
