import { scenePreset } from './gpu';

/** Still water: drops land here and there and ring outward; the pointer drops its own as it moves. */
export const ripple = scenePreset({
  id: 'ripple', name: 'Ripple', description: 'Still water: drops land here and there and ring outward, and the pointer drops its own.',
  cellSize: 11, scene: 'ripple', charset: ' .·:-~=', hover: 'none',
  extra(context, run) {
    const { host } = context;
    let at = -1e9, x = -1e4, y = -1e4;
    const drop = (event: PointerEvent) => {
      const now = performance.now(), s = context.settings();
      if (s.cursor === false || now - at < 260 || Math.hypot(event.clientX - x, event.clientY - y) < 48) return;
      at = now; x = event.clientX; y = event.clientY;
      const box = run.canvas.getBoundingClientRect();
      run.field?.pulse({ x: event.clientX - box.left, y: event.clientY - box.top, strength: 0.5 });
    };
    host.addEventListener('pointermove', drop, { passive: true });
    return () => host.removeEventListener('pointermove', drop);
  },
});
