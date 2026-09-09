/** Cached mask for untransformed, horizontal HTML text. No per-frame DOM reads. */
export interface TextMaskFrame { canvas: HTMLCanvasElement; revision: number }
export function createTextMask(host: HTMLElement, targets: HTMLElement | readonly HTMLElement[], onChange: () => void = () => {}) {
  const elements = Array.isArray(targets) ? targets : [targets as HTMLElement];
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d')!;
  let dirty = true, disposed = false, revision = 0, frame: TextMaskFrame | undefined;
  const invalidate = () => { if (!disposed) { dirty = true; onChange(); } };
  const resize = new ResizeObserver(invalidate); resize.observe(host); elements.forEach(el => resize.observe(el));
  const mutation = new MutationObserver(invalidate);
  elements.forEach(el => mutation.observe(el, { subtree: true, childList: true, characterData: true, attributes: true }));
  document.fonts?.addEventListener('loadingdone', invalidate); void document.fonts?.ready.then(invalidate);
  window.addEventListener('resize', invalidate);
  return {
    invalidate,
    read(): TextMaskFrame | undefined {
      if (disposed) return;
      if (!dirty) return frame;
      dirty = false;
      const hostRect = host.getBoundingClientRect();
      const ratio = Math.min(devicePixelRatio || 1, 1.5, Math.sqrt(4_000_000 / Math.max(1, hostRect.width * hostRect.height)));
      canvas.width = Math.max(1, Math.round(hostRect.width * ratio)); canvas.height = Math.max(1, Math.round(hostRect.height * ratio));
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.fillStyle = '#fff'; ctx.textBaseline = 'alphabetic';
      for (const element of elements) {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const parent = node.parentElement; if (!parent) continue;
          const style = getComputedStyle(parent); if (style.visibility === 'hidden' || style.display === 'none') continue;
          ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
          const metrics = ctx.measureText('Hg');
          const ascent = metrics.fontBoundingBoxAscent ?? parseFloat(style.fontSize) * .8;
          const descent = metrics.fontBoundingBoxDescent ?? parseFloat(style.fontSize) * .2;
          const text = node.textContent ?? '', range = document.createRange();
          let offset = 0;
          for (const char of text) {
            range.setStart(node, offset); offset += char.length; range.setEnd(node, offset);
            if (/\s/.test(char)) continue;
            const rect = range.getBoundingClientRect(); if (!rect.width || !rect.height) continue;
            ctx.fillText(char, rect.left - hostRect.left, rect.top - hostRect.top + (rect.height - ascent - descent) / 2 + ascent);
          }
        }
      }
      frame = { canvas, revision: ++revision }; return frame;
    },
    destroy() { disposed = true; resize.disconnect(); mutation.disconnect(); document.fonts?.removeEventListener('loadingdone', invalidate); window.removeEventListener('resize', invalidate); canvas.width = canvas.height = 1; frame = undefined; },
  };
}

/** Canvas fallback: recolor only the intersection of existing ink and text. */
export function createTextMaskPainter() {
  const layer=document.createElement('canvas'), ctx=layer.getContext('2d')!;
  return {
    paint(target: CanvasRenderingContext2D, mask: TextMaskFrame | undefined, width: number, height: number) {
      if(!mask) return;
      if(layer.width!==target.canvas.width||layer.height!==target.canvas.height){layer.width=target.canvas.width;layer.height=target.canvas.height;}
      ctx.globalCompositeOperation='copy';ctx.drawImage(target.canvas,0,0);
      ctx.globalCompositeOperation='destination-in';ctx.drawImage(mask.canvas,0,0,layer.width,layer.height);
      ctx.globalCompositeOperation='source-in';ctx.fillStyle='#090909';ctx.fillRect(0,0,layer.width,layer.height);
      ctx.globalCompositeOperation='source-over';target.drawImage(layer,0,0,width,height);
    },
    destroy(){layer.width=layer.height=1;},
  };
}
