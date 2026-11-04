// A three.js scene drawn live as characters: the field reads the renderer's canvas every frame it draws.
import * as THREE from 'three';
import { mountGlyphField, isGlyphFieldSupported } from 'asciify-engine/field';

export function threeLive(host: HTMLCanvasElement) {
  // The scene renders off screen at the size the field samples it; the field draws the characters into `host`.
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(480, 270, false);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 480 / 270, 0.1, 100);
  camera.position.set(0, 0, 4);
  const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(0.8, 0.28, 160, 24), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }));
  scene.add(knot, new THREE.DirectionalLight(0xffffff, 3), new THREE.AmbientLight(0xffffff, 0.2));

  if (!isGlyphFieldSupported()) return () => renderer.dispose();
  // `live` uploads the canvas each frame at the display's rate; `redraw()` right after rendering reads that exact frame
  // (a WebGL canvas without preserveDrawingBuffer is only readable in the task that drew it).
  const field = mountGlyphField(host, { source: renderer.domElement, live: true, hover: 'lantern', charset: ' .:-=+*#%@' });
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let raf = 0;
  const loop = (t: number) => {
    knot.rotation.set(t / 2400, t / 1700, 0);
    renderer.render(scene, camera);
    field.redraw();
    if (!reduced) raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  return () => { cancelAnimationFrame(raf); field.destroy(); renderer.dispose(); };
}
