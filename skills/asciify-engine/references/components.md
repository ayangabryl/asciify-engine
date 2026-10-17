# Asciify components

Ready-made ASCII components for product interfaces. Each one has the prompt a person gives you and the code you should arrive at. Every component runs live at https://asciify.org/components, where an agent cursor demonstrates its interaction, so the person can see the result before asking for it.

Every snippet uses `asciify-engine/kit`, one call per component. Start there by default: [the kit reference](kit.md) lists every option and method. Each kit function:

- mounts its own `aria-hidden` field over or inside your element, following its size and border radius, and keeps your text and controls in HTML;
- inks the field from your theme (`ink` takes a colour or a custom property such as `'--brand'`) and follows light and dark;
- honours `prefers-reduced-motion` by drawing each state settled, and pauses off screen;
- falls back without WebGL2 to an inert handle that leaves your HTML working as it was;
- cleans up on `destroy()`.

Before choosing one, read [applying Asciify](applying-asciify.md): when characters earn a place, ink from theme tokens, the clear zone and frosted veil for text, density, radii, motion limits, the field budget and accessibility. Build them in the project's own framework, design tokens and lifecycle. Free names in the snippets, such as `card`, `button` or `deployButton`, are the project's own DOM elements and functions. In React, create the handle in an effect and return its `destroy`:

```tsx
useEffect(() => { const b = beam(ref.current!); return () => b.destroy(); }, []);
```

For a look the kit doesn't offer, drop down to the raw field: see [Advanced: raw field](#advanced-raw-field) at the end of this file.

## voice-field: Voice orb
Category: AI

Prompt:
“Add a voice orb to [our assistant]: an Asciify sphere of characters that swells with loudness through Listening, Thinking and Done, in Mono, Aurora or Brand, its gradient shifting as it gets louder. Ask for the microphone only on click.”

```ts
import { voiceOrb } from 'asciify-engine/kit';

const orb = voiceOrb(orbButton, { palette: 'aurora' }); // or 'mono', 'brand', or your own hex stops
tintPicker.onchange = () => orb.update({ palette: tintPicker.value as 'mono' | 'aurora' | 'brand' });
orbButton.onclick = async () => { if (!(await orb.mic())) note.textContent = 'Microphone unavailable'; }; // asks only now
recognizer.onend = () => orb.think();
reply.then(() => orb.done());
```

## command-palette: Command palette
Category: AI

Prompt:
“Make a ⌘K command palette for [our app] with Asciify: it opens by condensing out of characters at the trigger, filters as you type, and a glyph column glides beside the selected row. Enter runs the action with a pulse.”

```ts
import { commandPalette } from 'asciify-engine/kit';

// ⌘K or the trigger opens it; arrows, Enter and Escape are wired; rows are [role="option"] with an id
commandPalette(palettePanel, { trigger: paletteTrigger, onRun: (i, row) => commands[row.dataset.id!].run() });
searchInput.oninput = () => renderRows(searchInput.value); // the kit re-selects the first row
```

## button-loading: Button loading
Category: Components

Prompt:
“Make [our Deploy button] show loading with Asciify: while the request runs, a wave cycles each letter of ‘Deploying’ through .:-=+*#%@, then resolves to ‘Deployed’ with a check, or ‘Retry’ with a short shake. Its width never changes.”

```ts
import { buttonLoading } from 'asciify-engine/kit';

const b = buttonLoading(deployButton, { announce: statusLine }); // the width never changes
deployButton.onclick = async () => {
  b.start('Deploying');
  await deploy().then(() => b.succeed('Deployed'), () => b.fail('Retry')); // a check, or a short shake
};
```

## ascii-pill: Badges and pills
Category: Components

Prompt:
“Make [our status badges] Asciify pills: tinted pills whose live state is a three-character indicator that breathes, a New pill with a gradient glyph sheen on hover, and a count that rolls through glyphs. Clip every character inside its pill.”

```ts
import { pill } from 'asciify-engine/kit';

// <span class="pill" data-tone="green" data-live><span data-dot></span>Live</span>, data-tone="new", data-count
const pills = pill(document.querySelectorAll<HTMLElement>('.pill'));
statusPill.dataset.tone = 'amber';
pills.refresh(); // tone changes ease over 240ms
pills.count(14); // only the changed digits roll
```

## ascii-tabs: Character tabs
Category: Components

Prompt:
“Make [our segmented tabs] Asciify tabs: the active indicator is a pill of characters that streams across as a glyph trail and condenses under the new tab within 280ms. Panels crossfade; arrow keys, Home and End switch tabs.”

```ts
import { tabs } from 'asciify-engine/kit';

// role="tab" buttons with aria-controls; panels crossfade on [data-active] in your CSS
const t = tabs(tablist, { duration: 280, panels: 'attribute' });
t.select(2);
```

## slide-to-confirm: Slide to confirm
Category: Components

Prompt:
“Add a slide to confirm to [our checkout]: ‘Slide to pay [$48]’. Asciify characters fill behind the thumb, drain when it springs back, then condense into a green check in a ring as the label becomes ‘Paid · [$48.00]’.”

```ts
import { slideToConfirm } from 'asciify-engine/kit';

// track: a [role="slider"] thumb, [data-label] "Slide to pay $48", and "Paid · $48.00" shown on [data-confirmed]
const pay = slideToConfirm(payTrack, { mark: doneIcon, onConfirm: () => void charge().catch(() => pay.reset()) });
```

## like-burst: Like burst
Category: Components

Prompt:
“Make [our Like button] burst in Asciify characters: on press a heart pops to about 1.6× the icon with a few glyph sparks and settles into the icon within 600ms while the count rolls. Unlike crumbles; rest is empty.”

```ts
import { likeBurst, odometer } from 'asciify-engine/kit';

const likes = odometer(likeCount);
likeBurst(likeButton, { kind: 'heart', limit: postBody, onChange: on => likes.set(likes.value + (on ? 1 : -1)) });
```

## loading-states: Status orb
Category: Components

Prompt:
“Give [our Publish button] an Asciify status orb: characters orbit while it runs, then the ring closes around a check, ‘!’ or X, tinting characters and label green, amber or red. Offer bare-mark and neutral options. Keep the label live.”

```ts
import { statusOrb } from 'asciify-engine/kit';

const orb = statusOrb(orbSlot, { ring: true, colourByState: true }); // ring: false for the bare mark, colourByState: false for neutral
const labels = { success: 'Published', warning: 'Published with warnings. Review?', error: 'Couldn’t publish. Retry?' };
publishButton.onclick = async () => {
  orb.loading(); statusLine.textContent = 'Publishing…';
  await save().then(r => (r.warnings ? orb.warning() : orb.success()), () => orb.error());
  statusLine.textContent = labels[orb.state as keyof typeof labels];
};
```

## text-decode: Decode headline
Category: Text

Prompt:
“Make [our hero headline] condense out of a drifting Asciify field: a soft cloud of characters drifts, then the words resolve left to right through a flickering band, with nothing left behind. Keep the real headline in the HTML.”

```ts
import { decode } from 'asciify-engine/kit';

const d = decode(headline, { duration: 900, settle: 'text' }); // plays when it comes into view; the real text stays in the DOM
replayButton.onclick = () => d.replay();
```

## ascii-chart: Block chart
Category: Components

Prompt:
“Build [our visitors analytics card] with bars drawn in Asciify characters: they grow in left to right, grow again on a 7d/30d toggle, and brighten under a hover readout.”

```ts
import { blockChart } from 'asciify-engine/kit';

const chart = blockChart(plot, {
  values: visits['7d'], labels: days['7d'],
  onHover: (i, v, day) => { readout.textContent = i === null ? '' : `${day} · ${v!.toLocaleString()}`; },
});
rangeToggle.onchange = () => chart.set(visits[rangeToggle.value], days[rangeToggle.value]);
```

## route-transition: Page transition
Category: Transitions

Prompt:
“When someone switches [tabs] in [our app], break the view into its own Asciify characters from the clicked tab, swap it, and condense the next view out of characters in about 400ms. At rest, keep [its chart] in characters.”

```ts
import { pageDissolve, blockChart } from 'asciify-engine/kit';

const page = pageDissolve(view, { dissolve: 180, condense: 220 }); // about 400ms, from the clicked tab
const chart = blockChart(chartSlot, { values: series.overview }); // at rest the chart stays in characters
for (const tab of navTabs) tab.onclick = () => page.swap(() => { renderView(tab.dataset.page!); chart.set(series[tab.dataset.page!]); }, tab);
```

## swipe-card: Swipe cards
Category: Components

Prompt:
“Make a swipeable card stack for [our stays] with Asciify: each [photo] drawn in characters. A swiped card dissolves into characters along the swipe while the next resolves; Pass and Save buttons and arrow keys do the same.”

```ts
import { swipeDeck } from 'asciify-engine/kit';

// stack: [data-card] children, each with an <img>; put captions outside the deck. Arrow keys are wired.
const deck = swipeDeck(stack, { threshold: 0.4, onSwipe: (dir, i) => (dir > 0 ? saveStay(stays[i]) : passStay(stays[i])) });
saveButton.onclick = () => deck.next(1);
passButton.onclick = () => deck.next(-1);
```

## otp-input: Verification code
Category: Components

Prompt:
“Make a 6-digit verification code input with Asciify: each digit resolves out of characters as it is typed, a wrong code shakes and crumbles back, and the right one condenses into a check. Support paste and one-time-code autofill.”

```ts
import { codeInput } from 'asciify-engine/kit';

// paste and autocomplete="one-time-code" are built in; a wrong code shakes, a right one draws a check
const code = codeInput(codeRow, { length: 6, onComplete: async c => code.verify(await api.checkCode(c)) });
```

## toast-stack: Toast stack
Category: Components

Prompt:
“Make [our toasts] with Asciify: each one gathers out of characters and stacks with depth, hover fans the stack out, and dismissing breaks a toast back into drifting glyphs. Include Undo.”

```ts
import { toastStack } from 'asciify-engine/kit';

const toasts = toastStack(toastCorner, { max: 3, duration: 6000 }); // a positioned box, such as fixed bottom-right, 360px wide
toasts.push({ title: 'Thread archived', body: 'Q3 planning · Ana', action: { label: 'Undo', onClick: restoreThread } });
clearButton.onclick = () => toasts.clear(); // each toast breaks back into drifting glyphs
```

## skeleton-loader: Skeleton loader
Category: Components

Prompt:
“Make a skeleton loader for [our post card] with Asciify: the placeholder blocks are drawn in characters with a shimmer sweeping across, then each block resolves into its real content and the image develops into the photo.”

```ts
import { skeleton } from 'asciify-engine/kit';

// blocks: [data-block="text" | "photo" | "avatar"] inside the card
const s = skeleton(postCard, { shimmer: 1600, stagger: 60 });
renderPost(await fetchPost());
await s.resolve(); // text wipes in, the photo develops in characters
reloadButton.onclick = async () => { s.reset(); renderPost(await fetchPost()); await s.resolve(); };
```

## thinking: Thinking state
Category: AI

Prompt:
“Show [our assistant]'s thinking state with Asciify: dot lines shimmer where the answer will appear under a Thinking… label, then the answer streams in word by word and the dots settle into a dotted rule beneath it.”

```ts
import { thinking } from 'asciify-engine/kit';

const reply = thinking(answer, { label: statusLabel, lines: 3 }); // "Thinking…", then "Thought for 2s"
await reply.stream(await ask(question)); // or an async iterable of chunks
regenerate.onclick = async () => { reply.think(); await reply.stream(await ask(question)); };
```

## stream-text: Streamed reply
Category: AI

Prompt:
“Stream [our assistant]’s reply with an Asciify write head: each character rolls up through glyphs in our own font and settles on the crisp letter, like an odometer, with the caret riding the front. Show reasoning lines, Stop and Regenerate.”

```ts
import { streamText } from 'asciify-engine/kit';

const out = streamText(answerText, { transition: 'roll', caret: true, stagger: 18, reasoningLines: 2 });
async function run() {
  out.reset();
  for await (const part of llm.stream(question)) {
    if (out.state === 'stopped') break;
    if (part.reasoning) out.reasoning(part.reasoning); else if (part.text) out.write(part.text); // the reasoning tail collapses on done()
  }
  await out.done();
}
stopButton.onclick = () => out.stop();
regenerate.onclick = () => void run();
void run();
```

## image-generation: Image generation
Category: AI

Prompt:
“While [our image API] generates [prompt], keep an Asciify field drifting with an elapsed clock, develop each streamed preview into it a step sharper, then the final image, and crossfade to the photo. Failures offer Retry; Regenerate dissolves back first.”

```ts
import { imageGenerate } from 'asciify-engine/kit';

// imageStream(prompt) wraps your provider as an async iterable of { preview?, final? }, each a Blob or URL
const gen = imageGenerate(imageFrame, { elapsed: clock, onState: s => { generateButton.textContent = s === 'failed' ? 'Retry' : 'Regenerate'; } });
generateButton.onclick = () => void gen.run(() => imageStream(promptInput.value)); // a finished image dissolves back first
```

## ascii-compare: Before and after
Category: Media

Prompt:
“Add a before and after slider to [our gallery]: [photo] on one side, the same photo drawn in its own colors in Asciify characters on the other. Drag the handle, or use the arrow keys in 5% steps.”

```ts
import { compare } from 'asciify-engine/kit';

// compareFrame: a dark 3:2 box; drag, or arrow keys in 5% steps on the handle
const c = compare(compareFrame, { image: '/images/kingfisher.jpg', position: 50, label: 'Photo and characters' });
resetButton.onclick = () => c.set(50, true);
```

## image-accordion: Image accordion
Category: Media

Prompt:
“Build an image accordion for [our prints]: [five photos] as panels drawn in Asciify characters. The hovered or focused panel widens and its characters give way to the full photo in 280ms, with a caption.”

```ts
import { accordion } from 'asciify-engine/kit';

// give the strip a height; panels open on hover, press or focus
accordion(printStrip, {
  images: [{ src: '/prints/stairwell.webp', title: 'Stairwell', meta: 'Silver print · $120' }, '/prints/shell.webp', '/prints/fern.webp', '/prints/dune.webp', '/prints/pier.webp'],
  duration: 280,
});
```

## ascii-dropzone: Image dropzone
Category: Media

Prompt:
“Make an image dropzone with Asciify: a quiet ring of characters frames the drop area and breathes on drag-over. A dropped image develops in characters, with Replace and Download PNG.”

```ts
import { dropzone } from 'asciify-engine/kit';

// buttons inside with data-dropzone="pick" (Replace) and "download" (Download PNG) are wired for you
const zone = dropzone(dropArea, { onImage: ({ file }) => { if (file) void upload(file); }, onError: message => showError(message) });
sampleButton.onclick = () => void zone.setImage('/images/sample.webp');
```

## ascii-disintegrate: Delete into characters
Category: Transitions

Prompt:
“When someone deletes a [file or notification] row in [our list], turn it into Asciify characters that thin out and drift up in about 620ms while the rows below close the gap in 260ms. Show an Undo toast.”

```ts
import { disintegrate, toastStack } from 'asciify-engine/kit';

const toasts = toastStack(toastCorner);
async function removeRow(row: HTMLElement, id: string) {
  toasts.push({ title: 'Moved to trash', action: { label: 'Undo', onClick: () => restoreItem(id) } });
  await disintegrate(row, { duration: 620 }); // the rows below close the gap
  deleteItem(id);
}
```

## pull-refresh: Pull to refresh
Category: Components

Prompt:
“Add pull to refresh to [our feed]: pulling reveals an Asciify character orb that densifies with distance. Past the threshold it spins while refreshing, condenses into a check, and new [posts] resolve in from characters. Include a Refresh button.”

```ts
import { pullRefresh } from 'asciify-engine/kit';

// feedScreen: overflow auto, content in its first child; the ring spins until onRefresh resolves, then draws a check
// rows marked data-new resolve in from characters as the content springs back
const pull = pullRefresh(feedScreen, { threshold: 88, reveal: '[data-new]', onRefresh: () => loadNewPosts() });
refreshButton.onclick = () => void pull.refresh();
```

## border-beam: Border beam
Category: Components

Prompt:
“Give [our card] an Asciify border beam: rainbow halftone dots inside its rounded border. Rotate or pulse; on deploy, a progress ring that flashes then fades green on success, or cracks red on error. Static under reduced motion.”

```ts
import { beam } from 'asciify-engine/kit';

const b = beam(card, { palette: 'colorful', mode: 'progress', grain: 'dots' }); // or mode 'rotate' or 'pulse'
deployButton.onclick = async () => {
  b.progress(0);
  await deploy(p => b.progress(p)).then(() => b.success(), () => b.error()); // flash then green, or cracks red
};
```

## glyph-odometer: Glyph odometer
Category: Text

Prompt:
“Show [our monthly revenue figure] as normal text, an Asciify odometer: on [Refresh] only changed digits hand over to the field, roll through glyphs leftmost first in under 600ms, and land back on the crisp digit. Keep an aria-live value.”

```ts
import { odometer } from 'asciify-engine/kit';

const mrr = odometer(revenueFigure, { value: 48290, format: n => `$${n.toLocaleString('en-US')}` }); // adds an aria-live copy
refreshButton.onclick = async () => mrr.set(await fetchMrr());
```

## sign-in: Sign-in page
Category: Pages

Prompt:
“Make a split sign-in page with Asciify: [image] in characters on the left that trail under the cursor, and an email field, Continue and Continue with GitHub on the right. Continue pulses the art while the link sends.”

```ts
import { artPanel } from 'asciify-engine/kit';

const art = artPanel(artSide, { image: '/images/wing.jpg', clear: brandMark, focus: { x: 0.5, y: 0.4 } });
signInForm.onsubmit = async event => {
  event.preventDefault();
  art.pulse(continueButton, 1.8);
  art.shimmer(true);
  await sendLink(emailInput.value).finally(() => art.shimmer(false));
};
```

```css
.sign-in { display: grid; grid-template-columns: 41% 1fr; padding: 14px; }
.sign-in-art { position: relative; border-radius: 18px; overflow: hidden; background: var(--surface); }
```

## pricing: Pricing highlight
Category: Pages

Prompt:
“Make a two-plan pricing section with Asciify: the recommended plan, [plan], has a soft halftone light that sweeps when the period toggles, shows the yearly saving in dots, and pulses from its button.”

```ts
import { pricingGlow } from 'asciify-engine/kit';

const glow = pricingGlow(featuredCard, { price: '.price' });
billingToggle.onchange = () => void glow.saving(billingToggle.value === 'yearly' ? '−25%' : null); // sweeps old out, new in
trialButton.onclick = () => glow.pulse(trialButton);
```

## not-found: 404 page
Category: Pages

Prompt:
“Make our 404 page with Asciify: draw 404 large in characters that scatter under the cursor and, on Go home, break apart and re-form. Keep the message and button in HTML.”

```ts
import { fieldBackground } from 'asciify-engine/kit';

const lost = fieldBackground(lostArt, { preset: 'notFound', text: '404' });
homeLink.onclick = async event => { event.preventDefault(); await lost.scatter(homeLink); location.href = '/'; };
```

## wordmark: Brand wordmark
Category: Text

Prompt:
“Draw our name, [name], in moving characters with Asciify for [the footer or a hero]. The word stays crisp, characters trail under the cursor, and the real name stays in HTML for screen readers.”

```ts
import { wordmark } from 'asciify-engine/kit';

// draws the element's own text, which stays in the DOM for screen readers
const mark = wordmark(brandName, { font: 'Georgia, "Times New Roman", serif', fontWeight: 600 });
nameInput.oninput = () => mark.setText(nameInput.value);
```

## video: Video in characters
Category: Media

Prompt:
“Play [video] in characters with Asciify as [a section background or a card]. Muted, looping, paused off screen, with a play and pause control, and the poster for reduced motion.”

```ts
import { asciiVideo } from 'asciify-engine/kit';

// muted and looping, paused off screen; the poster shows first and under reduced motion
const v = asciiVideo(player, { src: '/media/magnolia.mp4', poster: '/media/magnolia.jpg', label: 'A magnolia opening, drawn in characters' });
playButton.onclick = () => playButton.setAttribute('aria-label', v.toggle() ? 'Pause' : 'Play');
```

## hero-background: Hero background
Category: Backgrounds

Prompt:
“Put a calm ASCII background behind our hero with Asciify. Characters drift toward the headline and soften under a frosted veil, ripple under the cursor, and pulse when someone presses the main button.”

```ts
import { fieldBackground } from 'asciify-engine/kit';

const bg = fieldBackground(heroSection, { preset: 'hero', clear: heroText, ripple: true });
subscribeButton.onclick = () => bg.pulse(subscribeButton, 1.4);
```

```css
/* The veil: characters blur and fade toward the words instead of stopping at a box edge. */
.hero-text { position: relative; isolation: isolate; }
.hero-text::before {
  content: ""; position: absolute; z-index: -1; inset: -24px -40px; pointer-events: none;
  background: color-mix(in oklab, var(--bg) 58%, transparent);
  backdrop-filter: blur(9px);
  mask-image: radial-gradient(closest-side, #000 52%, rgb(0 0 0 / .6) 74%, transparent);
}
```

## Advanced: raw field

The kit is built on `mountGlyphField` from `asciify-engine/field`. When a component needs a look the kit has no option for, mount the field yourself. This helper needs no kit: it mounts a field that takes its ink from a CSS custom property, follows light and dark, and cleans up after itself. Without the kit you own the rest: check `isGlyphFieldSupported()` and keep the static design as the fallback, honour reduced motion, mount off-screen fields lazily and call `destroy()` on unmount. GPU fields need asciify-engine 4.12 or later for `mark`, `clear` and `pulse()`.

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
/* From the app's own tokens (see applying-asciify.md); the names on the right are examples. */
:root {
  --ascii-ink: color-mix(in oklab, var(--foreground) 50%, var(--background));
  --ascii-ink-strong: color-mix(in oklab, var(--foreground) 92%, var(--background));
}
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

A raw field draws whatever source you give it: paint white on black into an offscreen canvas (white is the densest glyph) and pass it to `field.setSource()` each frame, or use `scene`, `pulse()` and `update()` directly. To build your own component on the kit's plumbing instead (theme ink, reduced motion, fallback and cleanup included), use `mountSurface` from the kit; see [the kit reference](kit.md#your-own-components).
