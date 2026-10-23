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
“Make a ⌘K command palette for [our app] with Asciify: it opens by condensing out of characters at the trigger, a soft highlight glides between rows, rows a search brings in resolve out of characters, and the AI row shimmers as a crest turns its letters to characters and back. Enter runs the action with a pulse.”

```ts
import { commandPalette } from 'asciify-engine/kit';

// ⌘K or the trigger opens it; arrows, Enter and Escape are wired; rows are [role="option"] with an id, AI rows carry data-ai
commandPalette(palettePanel, { trigger: paletteTrigger, onRun: (i, row) => commands[row.dataset.id!].run() });
searchInput.oninput = () => renderRows(searchInput.value); // the kit re-selects the first row; new rows resolve out of characters
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
“Make [our status badges] Asciify pills: soft tinted pills with one glyph before the label, a dot in the status tone that breathes while live, turns as a half-filled spinner while syncing and blinks when a job fails; a solid ink New pill whose sparkle twinkles on hover; and a count that rolls through glyphs. Keep every character inside its pill and off the text.”

```ts
import { pill } from 'asciify-engine/kit';

// <span class="pill" data-tone="green" data-live><span data-dot></span><span>Live</span></span>
// <span class="pill" data-tone="new"><span data-dot></span><span>New</span></span>, <span class="pill" data-count>12</span>
const pills = pill(document.querySelectorAll<HTMLElement>('.pill'));
statusPill.dataset.tone = 'red';
pills.refresh(); // tone changes ease over 240ms; red blinks the dot
pills.count(14); // only the changed digits roll
```

## ascii-tabs: Character tabs
Category: Components

Prompt:
“Make [our segmented tabs] Asciify tabs: a crisp pill glides to the active tab, its leading end first, with a row of characters along its foot that streaks toward the new tab and settles into a tapered line. The panel's figure rolls like an odometer and its text slides in from the direction of travel; arrow keys, Home and End switch tabs.”

```ts
import { odometer, tabs } from 'asciify-engine/kit';

// <span class="thumb"> in the tablist, placed from --tabs-x / --tabs-y / --tabs-w / --tabs-h; role="tab" buttons
const figure = odometer(valueEl, { value: 1_280_000, format: compact });
const t = tabs(tablist, { panels: 'none', onChange: i => figure.update({ value: VALUES[i], format: FORMATS[i] }) });
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
“Build [our visitors analytics card] with bars drawn in Asciify characters: crisp glyph columns with a denser cap, today lit, growing in left to right. Hover or touch scrubs the bars and rolls the headline to that day; the 7d/30d toggle glides the shared days into place while the rest grow in.”

```ts
import { blockChart, odometer } from 'asciify-engine/kit';

let range = '7d';
const headline = odometer(totalEl, { value: total[range] });
// plot: touch-action: pan-y; draw the axis labels in HTML below it.
const chart = blockChart(plot, {
  values: visits['7d'], labels: days['7d'], look: { cellSize: 4.5 }, // small cells keep a gap between 30 bars
  onHover: (i, v, day) => { label.textContent = day ?? 'Visitors'; headline.set(i === null ? total[range] : v!); },
});
rangeToggle.onchange = () => { range = rangeToggle.value; chart.set(visits[range], days[range]); headline.set(total[range]); };
```

## route-transition: Page transition
Category: Transitions

Prompt:
“When someone switches [tabs] in [our app], break the view into its own Asciify characters from the clicked tab, swap it, and condense the next view out of characters in about 400ms. At rest, keep [its chart] in characters.”

```ts
import { pageDissolve, blockChart } from 'asciify-engine/kit';

const page = pageDissolve(view); // one wave from the clicked tab, about 430ms
const chart = blockChart(chartSlot, { values: series.overview, lazy: false }); // at rest the chart stays in characters
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
“Make [our toasts] with Asciify: each one rises in and gathers out of characters, the stack layers by tone and soft shadow with no outlines, hover fans it out, and dismissing or swiping a toast away breaks it into glyphs that drift the way it went. Include Undo.”

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
“Show [our assistant]'s thinking state with Asciify: a wave runs through the Thinking… label, each letter rolling up through glyphs and back like an odometer; when the answer starts the label rolls into Thought for 2s and the answer opens beneath it, word by word.”

```ts
import { thinking } from 'asciify-engine/kit';

const reply = thinking(answer, { label: statusLabel }); // "Thinking…" with a rolling wave, then "Thought for 2s"
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
“Build an image accordion for [our prints]: [five photos] as panels drawn in Asciify characters. The hovered, tapped or focused panel widens on one smooth spring while its characters cross over to the full photo, with a caption; a quick sweep across the strip doesn't open every panel on the way.”

```ts
import { accordion } from 'asciify-engine/kit';

// give the strip a height; panels open on hover (with intent), tap, press or focus
accordion(printStrip, {
  images: [{ src: '/prints/stairwell.webp', title: 'Stairwell', meta: 'Silver print · $120' }, '/prints/shell.webp', '/prints/fern.webp', '/prints/dune.webp', '/prints/pier.webp'],
  duration: 420,
});
```

## ascii-dropzone: Image dropzone
Category: Media

Prompt:
“Make an image dropzone with Asciify: a quiet ring of the lightest characters frames the drop area. On drag-over, packets of denser characters chase round it and a halo leans in toward the file. A dropped image opens out from the drop point in characters, with Replace and Download PNG.”

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
“Add pull to refresh to [our feed]: pulling draws a small, iOS-sized ring of Asciify characters round in the gap, closing with a small pop at the threshold. Let go and it opens into a spinning arc while refreshing, draws a check, and new [posts] resolve in from characters. Include a Refresh button.”

```ts
import { pullRefresh } from 'asciify-engine/kit';

// feedScreen: overflow auto, content in its first child; the 26px ring spins until onRefresh resolves, then draws a check
// rows marked data-new resolve in from characters as the content springs back
const pull = pullRefresh(feedScreen, { threshold: 64, reveal: '[data-new]', onRefresh: () => loadNewPosts() });
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
“Make a split sign-in page with Asciify: [image] in characters on the left that trail under the cursor, and on the right a labelled email field (a filled pill with a mail icon, a focus ring on :focus-visible, the error in the label row so nothing reflows), Continue and Continue with GitHub. Continue pulses the art and shows a loading glyph while the link sends.”

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

## nav-scramble: Scrambling links
Category: Text

Prompt:
“Make [our header's links] scramble on hover with Asciify: the link's letters flip through other alphabets (kana, Hangul, accented Latin, Greek) and land back on the word, drawn in characters in the link's own font, then hand back to the plain HTML link.”

```ts
import { decode } from 'asciify-engine/kit';

// manual: each link rests as plain HTML and only scrambles when the pointer enters it
const links = [...nav.querySelectorAll<HTMLElement>('a')].map(a => decode(a, { scramble: true, trigger: 'manual', settle: 'text', duration: 700, look: { cellSize: 3 } }));
```

## morph-hero: Morphing hero
Category: Pages

Prompt:
“Build [our event hero] with Asciify: on our brand-coloured ground, [our 3–5 images or drawn scenes] morph into one another as diagonal hatched lines whose weight follows the tone, a small counter shows which frame is up, and the headline flips through alphabets before landing on the real words. Keep the headline and buttons in HTML.”

```ts
import { morphField, decode } from 'asciify-engine/kit';

// frames: image URLs, canvases, videos, or (pen, w, h, now) => void drawings in white on black
const hero = morphField(heroSection, { sources: frames, ink: '#ffffff', hold: 3200, transition: 1000, onChange: i => (counter.textContent = `${i + 1}/${frames.length}`) });
const title = decode(heroTitle, { scramble: true, settle: 'text' });
nextButton.onclick = () => hero.next();
```

## stir-grow-ripple: Interactive hero background
Category: Backgrounds

Prompt:
“Put an interactive ASCII background behind [our dark hero] with Asciify that visitors can stir, grow and ripple, with a small pill switcher: Estuary (smoke-soft currents of letters the cursor stirs and lights), Capillary (a faint network of veins the cursor lights, the light running along them) and Shockwave (wind streaks; a click sends one ring out that eases to a stop). Faint by default so the headline reads, in our text token's ink, still under reduced motion.”

```ts
import { background, capillary, estuary, shockwave } from 'asciify-engine/kit';

const modes = { estuary, capillary, shockwave };
const bg = background(hero, { preset: estuary, clear: headline });
pills.forEach(pill => (pill.onclick = () => bg.setPreset(modes[pill.dataset.mode])));
```

## ascii-ocean: Ocean
Category: Backgrounds

Prompt:
“Put an ASCII ocean behind [our landing hero] with Asciify: [three sharks of different sizes, a hammerhead and schools of small fish] seen from above as tiles of shaded letters, swimming with real tail beats, the school keeping together, far ones smaller and fainter. The cursor scatters the fish and the sharks turn to investigate; a click sends a ripple. Inked from our text token, behind the headline, still under reduced motion.”

```ts
import { ocean } from 'asciify-engine/kit';

ocean(hero, { creatures: [{ kind: 'shark' }, { kind: 'shark', size: 0.7 }, { kind: 'hammerhead', size: 0.85 }, { kind: 'school', count: 24 }], label: 'Sharks and fish swimming' });
```

## ascii-globe: Globe of dots
Category: Media

Prompt:
“Show [where we are: our venues, regions or network] on a globe of dots with Asciify: land, a faint ocean, latitude lines and the far side showing through, turning slowly, draggable, with a ring spreading from each place. Buttons turn it to a region.”

```ts
import { globe } from 'asciify-engine/kit';

const earth = globe(globeBox, { ink: '--brand', points: [{ lat: 37.8, lon: -122.4 }, { lat: 51.5, lon: -0.1 }, { lat: 1.35, lon: 103.8 }], label: 'Our three venues' });
regionButtons.forEach(b => (b.onclick = () => earth.rotateTo(Number(b.dataset.lon))));
```

## dither-glow: Dithered glow
Category: Backgrounds

Prompt:
“Light [our call-to-action panel] with Asciify: a sunrise glow rising from the bottom edge, drawn as a printed glow, a smooth wash through a warm ramp from [our brand colour] to [a cream tint] under a fine dithered screen of upright ticks, drifting slowly, leaning toward the cursor with a soft light that follows it. The button and copy sit over the quiet part.”

```ts
import { ditherGradient } from 'asciify-engine/kit';

// the panel has the brand background; the ramp runs from just above it to the glow's cream core
const glow = ditherGradient(ctaPanel, { colors: ['#ff7a2e', '#ff9445', '#ffb56c', '#ffd8a0', '#fff4dc'], lights: [{ x: 0.5, y: 1.04, radius: 0.5, aspect: 0.5 }] });
```

## dither-image: Two-tone photo
Category: Media

Prompt:
“Draw [our photo] in our two brand tones with Asciify, as [dither / pixels / dots / engraving], developing in from its lightest marks as it scrolls into view. Keep the image's alt text.”

```ts
import { ditherImage } from 'asciify-engine/kit';

// draws the <img> inside the figure (hidden while drawn; its alt names the canvas)
const photo = ditherImage(figure, { tones: ['--brand-deep', '--brand'], mark: 'dither', cellSize: 5 });
markPicker.onchange = () => photo.update({ mark: markPicker.value });
```

## assemble-wordmark: Assembling wordmark
Category: Text

Prompt:
“Close [our footer] on our name, [name], set large in characters that gather out of scattered pieces as the visitor scrolls down to it, and scatter again as they scroll away. Keep the name in HTML.”

```ts
import { wordmark } from 'asciify-engine/kit';

// draws the element's own text; scroll ties the assembly to the footer's way into view
const mark = wordmark(footerName, { assemble: 'scroll', font: 'Georgia, "Times New Roman", serif', fontWeight: 600 });
```

## hero-background: Background
Category: Backgrounds

Prompt:
“Put the Asciify Swell background behind our hero: a fine grid that swells in slow rolling waves, quiet in the middle. Dots by default, or characters. Keep it clear around the headline and let it answer the cursor.”

```ts
import { background, swell } from 'asciify-engine/kit';

// One of 12 presets. Import only the one you use; bg.setPreset(other) cross-fades to another.
const bg = background(heroSection, { preset: swell, clear: heroText });
```

Any preset from [the kit reference](kit.md#backgrounds) fits the same call: `swell`, `drift`, `halo`, `caustics`, `contour`, `ripple`, `mesh`, `interference`, `constellation`, `cascade`, `wordField` and `fluid`, all on the GPU glyph field. `cursor: false` turns the pointer response off; `swell` takes `mark: 'glyph'` or a `charset` for characters instead of dots. For asciify.org's own hero ground, with the frosted veil and `pulse()`, use `fieldBackground(heroSection, { preset: 'hero', clear: heroText })`.

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
