import {
  mountStudio,
  loadStudioMedia,
  exportStudio,
  normalizeStudioSettings,
  updateStudioSettings,
  serializeStudioSettings,
  parseStudioSettings,
  type StudioInput,
  type StudioExportFormat,
} from 'asciify-engine/studio';

/** One live composition. Source pixels stay in the browser. */
export async function createComposition(
  canvas: HTMLCanvasElement,
  source: File | string,
  signal?: AbortSignal,
) {
  let settings = normalizeStudioSettings({
    style: 'ascii',
    cellSize: 6,
    ink: '#b3ed82',
    backdrop: { mode: 'solid', color: '#0c1711' },
    hover: { effect: 'trail', strength: .55, radius: .45 },
  });
  const player = await mountStudio(canvas, source, {settings, maxDimension: 960, signal});
  async function exportComposition(format: StudioExportFormat, cancellation?: AbortSignal) {
    // Snapshot before loading another media instance. Export never seeks the
    // live preview or picks up slider edits made while encoding.
    const frozen = player.settings;
    const time = player.time;
    const motionTime = player.motionTime;
    const referenceWidth = canvas.width / player.pixelRatio;
    const maxCells = player.maxCells;
    const scale = 1280 / Math.max(canvas.width, canvas.height);
    const width = Math.max(2, Math.round(canvas.width * scale / 2) * 2);
    const height = Math.max(2, Math.round(canvas.height * scale / 2) * 2);
    const media = await loadStudioMedia(source, cancellation);
    try {
      const still = format === 'png' || format === 'jpeg';
      const duration = !media.animated && frozen.motion.type !== 'none' && (frozen.motion.amount ?? 1) > 0
        ? 12 / frozen.motion.speed : Math.max(1, Math.min(60, media.duration || 5));
      // A low-speed ambient loop may exceed the export limit. Explain that
      // instead of silently cutting its cycle and calling the result seamless.
      if (!still && duration > 60) throw new Error('Raise motion speed to at least 0.2 for a complete loop within 60 seconds.');
      return await exportStudio({frame: async (t, signal) => {
        await media.seek(t, signal);
        return media.frame(t);
      }}, frozen, {format, width, height, referenceWidth, maxCells,
        time, motionTime, duration: still ? 5 : duration, fps: 24, signal: cancellation});
    } finally {
      media.destroy();
    }
  }
  return {
    player,
    update(patch: StudioInput) {
      settings = updateStudioSettings(settings, patch);
      player.update(settings);
    },
    saveLook: () => serializeStudioSettings(settings),
    restoreLook(json: string) {
      settings = parseStudioSettings(json);
      player.update(settings);
    },
    exportPng: (signal?: AbortSignal) => exportComposition('png', signal),
    exportMp4: (signal?: AbortSignal) => exportComposition('mp4', signal),
    destroy: () => player.destroy(),
  };
}
