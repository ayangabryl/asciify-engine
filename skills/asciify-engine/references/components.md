# Asciify components

Ready-made ASCII components for product interfaces. Each one has the prompt a person gives you and the reference code you should arrive at. Every component runs live at https://asciify.org/components, where an agent cursor demonstrates its interaction, so the person can see the result before asking for it.

Build them in the project's own framework, design tokens and lifecycle. Read [design matching](design-matching.md) first. The shared rules:

- Keep text and controls in HTML. The field is a decorative canvas behind or inside them, with `aria-hidden` on the canvas.
- Give the field a transparent background and an ink from the project's tokens, for each theme.
- Check `isGlyphFieldSupported()`, and keep the static design (or a poster image of the field) as the fallback.
- Honor reduced motion. Fields draw one still frame and skip pulses by default.
- Call `destroy()` on unmount. Mount fields that start off screen lazily, when they come near the viewport.
- GPU fields need asciify-engine 4.12 or later for `mark`, `clear` and `pulse()`.

## The shared helper

Every component below uses this helper. It mounts a field that takes its ink from a CSS custom property, follows light and dark, and cleans up after itself. Put it in the project once.

```ts
import { isGlyphFieldSupported, mountGlyphField, type GlyphField, type GlyphFieldOptions } from 'asciify-engine/field';

/** A field inked from a CSS variable that follows the theme. Returns null when the GPU field isn't available. */
export function asciiField(canvas: HTMLCanvasElement, options: GlyphFieldOptions = {}, inkVar = '--ascii-ink') {
  if (!isGlyphFieldSupported()) return null;
  const ink = () => getComputedStyle(canvas).getPropertyValue(inkVar).trim() || '#8f8d86';
  const field: GlyphField = mountGlyphField(canvas, { color: 'ink', background: 'transparent', ...options, ink: ink() });
  const scheme = matchMedia('(prefers-color-scheme: dark)');
  const retint = () => field.update({ ink: ink() });
  scheme.addEventListener('change', retint);
  return { field, destroy() { scheme.removeEventListener('change', retint); field.destroy(); } };
}
```

```css
:root { --ascii-ink: #76746e; --ascii-ink-strong: #1d1d1b; }
@media (prefers-color-scheme: dark) { :root { --ascii-ink: #7a7872; --ascii-ink-strong: #d8d6cf; } }
```

In React, wrap it once and reuse it:

```tsx
import { useEffect, useRef } from 'react';
import type { GlyphField, GlyphFieldOptions } from 'asciify-engine/field';

export function AsciiField({ options, onField, className }: { options: GlyphFieldOptions; onField?: (field: GlyphField | null) => void; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const mounted = canvas.current ? asciiField(canvas.current, options) : null;
    onField?.(mounted?.field ?? null);
    return () => { onField?.(null); mounted?.destroy(); };
  }, []); // mount once; call field.update() for later changes
  return <canvas ref={canvas} className={className} aria-hidden="true" />;
}
```

## image-card: ASCII image card
Category: Components

Prompt:
“Make a card whose image is drawn in characters with Asciify. Use [image]. Characters trail behind the cursor, the title, details and a save button stay as HTML under the image, and the ink follows our light and dark theme.”

```ts
const image = asciiField(canvas, {
  source: '/images/statue.jpg', fit: 'cover', focus: { x: 0.5, y: 0.35 },
  charset: ' .:-=+*#%@', cellSize: 6, contrast: 1.25,
  hover: 'trail', label: 'A marble statue drawn in characters',
}, '--ascii-ink-strong');
```

## hero-background: Hero background
Category: Backgrounds

Prompt:
“Put a calm ASCII background behind our hero with Asciify. Characters drift slowly, clear around the headline and buttons so they stay readable, and follow our light and dark theme.”

```ts
const hero = asciiField(canvas, {
  mark: 'glyph', scene: 'drift', charset: ' .:+*#', cellSize: 12,
  clear: { element: heroText, padding: 24, feather: 0.32, shape: 'ellipse' },
  hover: 'trail',
});
```

## cli-banner: CLI banner
Category: Text

Prompt:
“Greet people in ASCII when our CLI starts, using asciifyText from Asciify with [word].”

```ts
import { asciifyText } from 'asciify-engine';

console.log(asciifyText('Hey', { char: '#' }));
```

## cursor-field: Cursor field
Category: Backgrounds

Prompt:
“Add a halftone dot field to [section] with Asciify that drifts, clears around the content, and answers the cursor with [trail, fluid or lantern].”

```ts
const dots = asciiField(canvas, {
  mark: 'dot', scene: 'drift', dotScale: 0.72, cellSize: 8,
  clear: { element: content, padding: 40, shape: 'rect' },
  hover: 'fluid',
});
```

## wordmark: Brand wordmark
Category: Text

Prompt:
“Draw our name, [name], in moving characters with Asciify for [the footer or a hero]. The word stays crisp, characters trail under the cursor, and the real name stays in HTML for screen readers.”

```ts
const word = document.createElement('canvas');
word.width = 1800; word.height = 480;
const ctx = word.getContext('2d')!;
ctx.fillStyle = '#000'; ctx.fillRect(0, 0, word.width, word.height);
ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
ctx.font = '600 400px Georgia, serif';
ctx.fillText('asciify', word.width / 2, word.height / 2 + 20);

const wordmark = asciiField(canvas, {
  source: word, fit: 'contain', charset: ' .:-=+*#%@', cellSize: 9,
  hover: 'trail', label: 'asciify, drawn in characters',
}, '--ascii-ink-strong');
```

## video: Video in characters
Category: Media

Prompt:
“Play [video] in characters with Asciify as [a section background or a card]. Muted, looping, paused off screen, with a play and pause control, and the poster for reduced motion.”

```ts
const video = asciiField(canvas, {
  source: '/media/magnolia.mp4', fit: 'cover', charset: ' .:-=+*#%@', cellSize: 7,
  contrast: 1.2, hover: 'trail', label: 'A magnolia opening, drawn in characters',
}, '--ascii-ink-strong');

let paused = false;
playButton.addEventListener('click', () => {
  paused = !paused;
  if (paused) video?.field.pause(); else video?.field.play();
});
```

## not-found: 404 page
Category: Pages

Prompt:
“Make our 404 page with Asciify: a calm field of characters that clears around the message, trails under the cursor, and pulses when someone presses Go home.”

```ts
const lost = asciiField(canvas, {
  mark: 'glyph', scene: 'drift', charset: ' .:+*#', cellSize: 12, hover: 'trail',
  clear: { element: message, padding: 28, feather: 0.3, shape: 'ellipse' },
});

homeLink.addEventListener('click', () => lost?.field.pulse({ element: homeLink }));
```

## avatar: ASCII avatar
Category: Components

Prompt:
“Draw [person]'s avatar in characters with Asciify, inside our round avatar frame. Characters trail under the cursor, and the name, role and follow button stay as HTML.”

```ts
const avatar = asciiField(canvas, {
  source: '/images/portrait.jpg', fit: 'cover',
  charset: ' .:-=+*#%@', cellSize: 5, contrast: 1.1,
  hover: 'trail', label: 'Portrait of Elias Varga',
}, '--ascii-ink-strong');
```

## empty-state: Empty state
Category: Components

Prompt:
“Give our empty state a quiet ASCII field with Asciify. Keep the icon, message and primary action readable, and send a pulse through the field from the button when it is pressed.”

```ts
const empty = asciiField(canvas, {
  scene: 'flow', charset: ' .:-=+*#', cellSize: 11, hover: 'none',
  clear: { element: emptyMessage, padding: 24, shape: 'rect' },
});

primaryButton.addEventListener('click', () => empty?.field.pulse({ element: primaryButton }));
```

## loading: Loading state
Category: Components

Prompt:
“Show [upload or sync] progress with Asciify: a small character field above the file name and progress bar that sends a soft pulse each second while it runs, and stops when it settles.”

```ts
const loading = asciiField(canvas, { mark: 'glyph', scene: 'drift', charset: ' .:+*#', cellSize: 9, hover: 'none' });
const beat = setInterval(() => loading?.field.pulse({ strength: 0.8 }), 1000);
request.finally(() => clearInterval(beat));
```

## copy-pulse: Copy feedback
Category: Components

Prompt:
“When someone copies [the coupon code], answer with Asciify: a pulse travels through a halftone field from the copy button.”

```ts
const ground = asciiField(canvas, { mark: 'dot', scene: 'drift', cellSize: 7, dotScale: 0.8, hover: 'none' });

copyButton.addEventListener('click', async () => {
  await navigator.clipboard.writeText(code);
  ground?.field.pulse({ element: copyButton });
});
```

## brand-field: Brand color field
Category: Backgrounds

Prompt:
“Make an ASCII field in our brand color with Asciify, drifting slower than the default, for [section].”

```ts
const brand = asciiField(canvas, {
  mark: 'glyph', scene: 'drift', charset: ' .:+*#', cellSize: 10,
  speed: 0.5, hover: 'none',
}, '--brand');
```

## coming-soon: Coming soon page
Category: Pages

Prompt:
“Make a coming-soon page for [product] with Asciify: our mark and name, one headline, and an email field with a Join waitlist button. A drifting field of characters clears around the form, and pulses from the button when someone joins.”

```ts
const waitlist = asciiField(canvas, {
  mark: 'glyph', scene: 'drift', charset: ' .:+*#', cellSize: 10, hover: 'trail',
  clear: { element: form, padding: 14, feather: 0.24, shape: 'ellipse' },
});

form.addEventListener('submit', event => {
  event.preventDefault();
  waitlist?.field.pulse({ element: joinButton });
  form.dataset.state = 'joined';
});
```

## sign-in: Sign-in page
Category: Pages

Prompt:
“Make a split sign-in page with Asciify: [image] in characters on the left, trailing under the cursor, and an email field, Continue and a quiet Continue with GitHub on the right. Continue shows a loading state and pulses the art.”

```ts
const art = asciiField(artCanvas, {
  source: '/images/wing.jpg', fit: 'cover', focus: { x: 0.5, y: 0.4 },
  charset: ' .:-=+*#%@', cellSize: 6, contrast: 1.3,
  hover: 'trail', label: 'A carved wing drawn in characters',
}, '--ascii-ink-strong');

signInForm.addEventListener('submit', event => {
  event.preventDefault();
  continueButton.setAttribute('aria-busy', 'true');
  art?.field.pulse({ element: continueButton });
});
```

## pricing: Pricing highlight
Category: Pages

Prompt:
“Make a two-plan pricing section with a monthly and yearly toggle, using Asciify. The recommended plan, [plan], gets a halftone field that lights up under the cursor and pulses from its button.”

```ts
const featured = asciiField(canvas, {
  mark: 'dot', scene: 'drift', cellSize: 7, dotScale: 0.86, speed: 0.7,
  interactionTarget: featuredCard, hover: 'lantern',
  lantern: { radius: 0.3, strength: 0.75 },
});

trialButton.addEventListener('click', () => featured?.field.pulse({ element: trialButton }));
```

## text-decode: Decode headline
Category: Text

Prompt:
“Make [our hero headline] decode into place through ASCII characters when it scrolls into view and on hover, left to right in about 900ms, without moving the layout. Screen readers get the real words, and reduced motion shows them at once.”

```ts
const words = headline.textContent ?? '', ramp = '.:-=+*#%@abcdefghijklmnopqrstuvwxyz', cells = [...words].map(ch => Object.assign(document.createElement('span'), { textContent: ch }));
const layer = Object.assign(document.createElement('span'), { ariaHidden: 'true', style: 'position:absolute;inset:0;pointer-events:none;color:var(--ink-3)' });
headline.setAttribute('aria-label', words);
headline.replaceChildren(layer, ...cells); // the headline is position: relative

function decode(duration = 900, hold = 380) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || layer.childElementCount) return;
  const stagger = (duration - hold) / Math.max(1, cells.length - 1), start = performance.now();
  const glyphs = cells.map(({ offsetLeft: x, offsetTop: y, offsetWidth: w }) => layer.appendChild(Object.assign(document.createElement('span'), { style: `position:absolute;left:${x}px;top:${y}px;width:${w}px;display:flex;justify-content:center;line-height:normal` })));
  requestAnimationFrame(function frame(now) {
    cells.forEach((cell, i) => {
      const t = (now - start - i * stagger) / hold, busy = t >= 0 && t < 1 && words[i] !== ' ';
      cell.style.color = busy ? 'transparent' : '';
      if (!busy || Math.random() < 0.4) glyphs[i].textContent = busy ? ramp[Math.floor(Math.random() * (t < 0.56 ? 9 : ramp.length))] : '';
    });
    if (now - start < duration) requestAnimationFrame(frame); else layer.replaceChildren();
  });
}
new IntersectionObserver(([entry]) => { if (entry.isIntersecting) decode(); }, { threshold: 0.5 }).observe(headline);
headline.addEventListener('pointerenter', () => decode());
```

## image-reveal: Photo from characters
Category: Transitions

Prompt:
“Show [photo] drawn in characters with Asciify. On hover or focus the real photo grows out of the characters in a soft circle from the cursor, and on leave it closes back with a pulse where the pointer left.”

```ts
const art = asciiField(canvas, {
  source: '/images/egret.jpg', fit: 'cover', charset: ' .:-=+*#%@', cellSize: 6,
  contrast: 1.3, hover: 'trail', label: 'A great egret, drawn in characters',
}, '--ascii-ink-strong');

// The photo lies over the canvas, masked by radial-gradient(circle at var(--x) var(--y), #000 calc(var(--r) - 56px), transparent var(--r)),
// with --r registered as a <length> through @property so it can transition.
function reveal(open: boolean, x = frame.clientWidth / 2, y = frame.clientHeight / 2) {
  const ms = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : open ? 520 : 440;
  if (open) photo.style.cssText += `--x:${x}px;--y:${y}px`;
  else art?.field.pulse({ x, y });
  photo.style.transition = `--r ${ms}ms cubic-bezier(.16, 1, .3, 1)`;
  photo.style.setProperty('--r', open ? `${Math.hypot(frame.clientWidth, frame.clientHeight) + 56}px` : '0px');
}
frame.addEventListener('pointerenter', event => reveal(true, event.offsetX, event.offsetY));
frame.addEventListener('pointerleave', event => reveal(false, event.offsetX, event.offsetY));
frame.addEventListener('focus', () => reveal(true));
frame.addEventListener('blur', () => reveal(false));
```

## route-transition: Page transition
Category: Transitions

Prompt:
“When someone switches [tabs or pages] in [our app], sweep a dense Asciify character field out from the clicked tab, swap the page underneath, and sweep it away, all in about half a second. Swap instantly under reduced motion.”

```ts
const veil = asciiField(canvas, {
  mark: 'glyph', scene: 'flow', charset: ' .:-=+*#%@', cellSize: 10, scale: 2.4,
  speed: 1.6, contrast: 1.4, brightness: 0.34, hover: 'none',
});
veil?.field.pause();

// cover holds the canvas on background: var(--surface), visibility: hidden at rest, masked by radial-gradient(circle at var(--x) var(--y),
// transparent var(--hole), #000 calc(var(--hole) + 36px), #000 var(--front), transparent calc(var(--front) + 36px)); --hole and --front are @property lengths.
async function navigate(tab: HTMLElement, swap: () => void) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return swap();
  const box = cover.getBoundingClientRect(), t = tab.getBoundingClientRect(), ease = 'cubic-bezier(.16, 1, .3, 1)';
  const x = t.left + t.width / 2 - box.left, y = t.top + t.height / 2 - box.top, reach = `${Math.hypot(box.width, box.height) + 36}px`;
  cover.style.cssText += `--x:${x}px;--y:${y}px;visibility:visible`;
  veil?.field.play();
  veil?.field.pulse({ x, y });
  await cover.animate({ '--hole': ['-72px', '-72px'], '--front': ['-36px', reach] }, { duration: 180, easing: ease, fill: 'forwards' }).finished;
  swap();
  await cover.animate({ '--hole': ['-72px', reach], '--front': [reach, reach] }, { duration: 320, easing: ease }).finished;
  cover.style.visibility = 'hidden';
  veil?.field.pause();
}
```

## scramble-button: Scramble button
Category: Transitions

Prompt:
“Make [our primary button]'s label scramble through ASCII characters on hover and focus without changing width, with a small Asciify dot halo behind it that follows the cursor and pulses on press.”

```ts
const halo = asciiField(canvas, {
  mark: 'dot', scene: 'drift', cellSize: 6, dotScale: 0.8, scale: 2.2, hover: 'lantern',
  clear: { element: button, padding: 4, feather: 0.12, shape: 'rect' },
});
button.addEventListener('click', () => halo?.field.pulse({ element: button }));

const text = label.textContent ?? '', ramp = '.:-=+*#%@abcdefghijklmnopqrstuvwxyz';
const live = Object.assign(document.createElement('span'), { ariaHidden: 'true', textContent: text, style: 'position:absolute;inset:0;white-space:nowrap' });
button.setAttribute('aria-label', text);
label.replaceChildren(Object.assign(document.createElement('span'), { textContent: text, style: 'visibility:hidden;white-space:nowrap' }), live); // label is position: relative; the hidden copy holds the width
function scramble() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const start = performance.now();
  requestAnimationFrame(function frame(now) {
    const settled = Math.floor((now - start - 120) / 28);
    live.textContent = [...text].map((ch, i) => (i < settled || ch === ' ' ? ch : ramp[Math.floor(Math.random() * ramp.length)])).join('');
    if (settled < text.length) requestAnimationFrame(frame);
  });
}
button.addEventListener('pointerenter', scramble);
button.addEventListener('focus', () => { if (button.matches(':focus-visible')) scramble(); });
```

## thinking: Thinking state
Category: AI

Prompt:
“Show [our assistant]'s thinking state with Asciify: dot lines shimmer where the answer will appear under a Thinking… label, then the answer streams in word by word as the dots fade. Regenerate runs it again.”

```ts
import { play } from 'cuelume';

const dots = asciiField(canvas, { mark: 'dot', scene: 'drift', cellSize: 5, dotScale: 0.86, scale: 3, speed: 2.4, hover: 'none' });

// The canvas fills the answer area under line-shaped mask bands; CSS fades it out, and each .word in 38ms apart, once data-phase leaves "thinking".
async function regenerate(ask: () => Promise<string>) {
  play('loading', { emphasis: 'subtle' });
  reply.dataset.phase = 'thinking';
  dots?.field.play();
  const beat = setInterval(() => dots?.field.pulse({ x: Math.random() * canvas.clientWidth, y: canvas.clientHeight / 2, strength: 0.7 }), 640);
  const answer = await ask().finally(() => clearInterval(beat));
  answerText.replaceChildren(...answer.split(' ').map((word, i) => {
    const span = Object.assign(document.createElement('span'), { className: 'word', textContent: `${word} ` });
    span.style.setProperty('--i', String(i));
    return span;
  }));
  reply.dataset.phase = 'done';
  setTimeout(() => dots?.field.pause(), 420);
  play('ready', { emphasis: 'subtle' });
}
```

## image-generation: Image generation
Category: AI

Prompt:
“While [our image model] generates [prompt], fill the frame with drifting Asciify characters that pulse beside a progress label. When the image arrives, develop it in characters, then fade to the photo from blur to sharp.”

```ts
const art = asciiField(canvas, {
  mark: 'glyph', scene: 'flow', charset: ' .:-=+*#%@', cellSize: 7, scale: 2.6, speed: 1.4, contrast: 1.3, hover: 'trail',
}, '--ascii-ink-strong');
const ease = (ms: number, step: (k: number) => void) => new Promise<void>(done => {
  const start = performance.now(), still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  requestAnimationFrame(function frame(now) { const t = still ? 1 : Math.min(1, (now - start) / ms); step(1 - (1 - t) ** 4); if (t < 1) requestAnimationFrame(frame); else done(); });
});

generate.addEventListener('click', async () => {
  const field = art?.field;
  if (!field) return;
  const beat = setInterval(() => field.pulse({ strength: 0.8 }), 640);
  const url = await createImage(promptInput.value).finally(() => clearInterval(beat));
  await ease(200, k => field.update({ brightness: -k }));
  await field.setSource(url);
  field.pulse();
  await ease(900, k => field.update({ brightness: k - 1 }));
  photo.src = url;
  imageFrame.dataset.done = ''; // CSS fades the photo in from opacity 0 and blur(14px), 760ms on cubic-bezier(.16, 1, .3, 1)
});
```
