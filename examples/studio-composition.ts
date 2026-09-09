import {
  mountStudio,
  loadStudioMedia,
  exportStudio,
  normalizeStudioSettings,
  updateStudioSettings,
  serializeStudioSettings,
  parseStudioSettings,
  type StudioInput,
} from "asciify-engine/studio";

/** Supply your own local File or permitted CORS URL. */
export async function createComposition(
  canvas: HTMLCanvasElement,
  source: File | string,
  signal?: AbortSignal,
) {
  let settings = normalizeStudioSettings({
    aspectRatio: "16:9",
    style: "ascii",
    ink: "#e8b900",
    backdrop: { mode: "blurred", opacity: 0.4 },
  });
  const player = await mountStudio(canvas, source, { settings, signal });
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
    async exportMp4(signal?: AbortSignal) {
      const frozen = normalizeStudioSettings(settings);
      const media = await loadStudioMedia(source, signal);
      try {
        return await exportStudio(
          {
            frame: async (time, signal) => {
              await media.seek(time, signal);
              return media.frame(time);
            },
          },
          frozen,
          {
            format: "mp4",
            width: 1280,
            height: 720,
            referenceWidth: canvas.width,
            maxCells: player.maxCells,
            duration: 8,
            fps: 24,
            signal,
          },
        );
      } finally {
        media.destroy();
      }
    },
    destroy: () => player.destroy(),
  };
}
