import { asciify, asciifyVideo } from 'asciify-engine';

/** Client-side example. Supply data-video and data-poster on the hero element.
 * @param {HTMLElement} hero
 */
export function mountLayeredHero(hero) {
  const canvas = hero.querySelector('canvas');
  const button = hero.querySelector('button[data-motion]');
  const status = hero.querySelector('[data-status]');
  if (!(button instanceof HTMLButtonElement) || !canvas || !status) throw new Error('Layered hero requires its canvas, motion button, and status element.');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  /** @type {Partial<import('asciify-engine').AsciiOptions>} */
  const mediaOptions = { charset: ' .:-=+*#%@', colorMode: 'fullcolor', normalize: false, animationStyle: 'none', hoverStrength: 0 };
  let disposed = false, stop, video, visible = false, userPaused = false;
  let loading = false, started = false, failed = false, revision = 0;

  const wantsMotion = () => !disposed && visible && !document.hidden && !reduced.matches && !userPaused;
  const label = () => {
    button.disabled = reduced.matches || failed || !video;
    button.textContent = reduced.matches ? 'Motion off' : failed ? 'Still preview' : !video ? 'Loading artwork…' : userPaused || video.paused ? 'Play motion' : 'Pause motion';
  };
  const release = () => { stop?.(); stop = undefined; video?.pause(); video = undefined; };

  async function start() {
    if (loading || started || failed || !wantsMotion()) return;
    loading = true; started = true;
    const version = ++revision;
    try {
      const cleanup = await asciifyVideo(hero.dataset.video, canvas, {
        fitTo: hero, objectFit: 'cover', objectPosition: 'center',
        fontSize: 7, fps: 24, maxRenderDimension: Number(hero.dataset.renderLimit) || 720, options: mediaOptions,
        onReady: readyVideo => {
          if (disposed || version !== revision) { readyVideo.pause(); return; }
          video = readyVideo;
          if (!wantsMotion()) video.pause();
          label();
        },
      });
      if (disposed || version !== revision) cleanup();
      else { stop = cleanup; if (!wantsMotion()) video?.pause(); }
    } catch {
      if (!disposed && version === revision) { failed = true; status.textContent = 'Motion unavailable. The artwork remains a still preview.'; }
    } finally {
      if (version === revision) { loading = false; label(); }
    }
  }
  async function sync() {
    if (disposed) return;
    if (!wantsMotion()) video?.pause();
    else if (video) {
      try { await video.play(); }
      catch { if (!disposed) { userPaused = true; status.textContent = 'Press Play motion to start.'; } }
    } else await start();
    if (!disposed) label();
  }
  // Keep explicit user pause separate from temporary offscreen/tab suspension.
  const onClick = () => { userPaused = video ? !video.paused : false; status.textContent = ''; void sync(); };
  button.addEventListener('click', onClick);
  document.addEventListener('visibilitychange', sync);
  reduced.addEventListener('change', sync);
  const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; void sync(); }, { threshold: .05 });

  // Paint a small still first. Reduced motion does not request the video URL.
  void asciify(hero.dataset.poster, canvas, { fontSize: 7, options: mediaOptions }).then(cleanup => {
    if (disposed) { if (typeof cleanup === 'function') cleanup(); return; }
    if (typeof cleanup === 'function') cleanup(); // This example uses a static poster.
    observer.observe(hero); label();
  }).catch(() => {
    if (!disposed) { status.textContent = 'Still preview unavailable.'; observer.observe(hero); label(); }
  });

  return () => {
    disposed = true; revision++; release(); observer.disconnect();
    button.removeEventListener('click', onClick);
    document.removeEventListener('visibilitychange', sync);
    reduced.removeEventListener('change', sync);
  };
}
