# 3D models to ASCII (4.33, experimental)

`asciify-engine/model` reads 3D model files, draws them, and turns them into characters, in any runtime. Use it for a product,
logo or character as ASCII: a spinning model in a terminal, an animated SVG for a README, an OG image, or a live hero on a page.
For a scene you already render with three.js or React Three Fiber, pass that canvas to a field instead
([glyph-field.md](glyph-field.md#live-sources-3d-scenes-and-app-canvases-433)).

```ts
import { loadModel, modelToGrid, modelToGrids, shapeModel } from 'asciify-engine/model';
import { gridToAnsi, gridToSvg, gridsToAnimatedSvg } from 'asciify-engine/headless';

const model = await loadModel('/models/helmet.glb');          // glTF/GLB, OBJ (+MTL), STL, PLY; a URL, bytes or a Blob
const grid = modelToGrid(model, { columns: 100, yaw: 30, pitch: 20 }); // shape mode, lit, outlined
gridToAnsi(grid); gridToSvg(grid, { title: 'Helmet' });

// A full turn for a README: an animated SVG with no script.
const turn = modelToGrids(model, { columns: 80, frames: 36 });
fs.writeFileSync('turn.svg', gridsToAnimatedSvg(turn, { fps: 12, dark: { ink: '#eee' }, ink: '#111' }));
```

`shapeModel('torus' | 'knot' | 'sphere' | 'cube' | 'icosahedron')` makes a built-in shape, with no file.

## Files

| Format | Read |
| --- | --- |
| glTF 2.0 (`.gltf`, `.glb`) | Meshes in the default scene with node transforms and instancing, base colour factors and textures (`decodeModelTextures`), vertex colours, emissive, quantised accessors, sparse accessors, triangle strips and fans, points. Draco and meshopt compression are not read: export without them. Skins and morphs draw in their bind pose. |
| OBJ (`.obj` + `.mtl`) | Polygons, normals, uvs, vertex colours, `usemtl` materials (`Kd`, `Ke`, `d`, `map_Kd`). |
| STL | Binary and ASCII. Normals are worked out with a crease angle (`withNormals`), z-up. |
| PLY | ASCII and binary, vertex colours, faces; with no faces, a point cloud (Gaussian splats included). |

`parseModel(bytes, { format?, name?, resources? })` reads one file synchronously (`resources` maps the paths a glTF or OBJ
refers to onto their bytes). `loadModel(url | bytes | Blob, { read?, fetch? })` fetches what the file refers to as well.
Models without normals get them from `withNormals(model, creaseAngle = 40)`, so cubes stay sharp and spheres smooth (the
command line does it for you; call it yourself after `parseModel`/`loadModel` for STL and other files without normals).
`decodeModelTextures(model, decode)` fills in texture images with a decoder you pass, such as `asciify-engine/decode`'s:
`decodeModelTextures(model, bytes => { const i = decodeImage(bytes); return { width: i.width, height: i.height, data: i.frames[0].data }; })`.

`loadModel` follows a file's references wherever they point (other folders, absolute URLs). On a server that loads models
people upload, pass a `read` that refuses anything outside the upload. Errors name the format, the file and the line
(`OBJ: face refers to vertex 120 of 3 (bad.obj, line 5)`), and damaged files throw rather than hang.

## Drawing: `renderModel` and `modelToGrid`

`renderModel(model, options)` draws RGBA pixels on the CPU, in Node, workers and edge runtimes: a visibility buffer, then each
pixel lit once. `modelToGrid(model, options)` draws at the size a grid needs and converts it, with the light spread evenly
over the character ramp (`MODEL_GAMMA`). Both take:

| Option | Default | What it does |
| --- | --- | --- |
| `yaw`, `pitch`, `roll` | 30, 20, 0 | The view, in degrees (pitch looks down from above). |
| `fov` | 30 | Field of view in degrees; 0 is orthographic. |
| `zoom` | 1 | 1 frames the whole model. |
| `up` | the file's | `'z'` for z-up files the parser did not mark (STL is z-up already). |
| `shading` | `'lit'` | `'toon'` (flat bands), `'normals'`, `'depth'`. |
| `paint` | none | One colour for the whole model, in place of its own. |
| `light`, `ambient`, `rim`, `specular`, `exposure` | upper left, 0.04, 0.3, 0.3, 1 | The light. A low ambient keeps the shadowed side dark, so it reads as depth in characters. |
| `outline` | 0.65 | Dark lines where a surface passes in front of another and along sharp creases, which shape mode turns into edge characters. |
| `background` | transparent | `renderModel` only: a hex colour behind the model. |
| `samples` | 1 | `renderModel` only: supersampling each way. |

`modelToGrid` also takes the grid's options: `columns`, `rows` (default a square view), `cellAspect` (default 2, a terminal),
`mode` (`'shape'`, `'tone'`, `'braille'`, `'half'`, `'quad'`, `'sextant'`), `charset`, `color`, `background: 'light'`, `dither`,
`previous`. `modelToGrids(model, { frames, turn })` makes a turn, each frame steadied by the one before.

A 120 × 40 view takes about 15–20 ms to draw and 10–15 ms to convert on a laptop core.

## On a page: `modelSource`

`modelSource(model, options)` draws the model on the GPU (WebGL2) into a canvas of its own, with the same light, outline and
framing as `renderModel`, and keeps it turning. Pass the canvas to a glyph field as a live source:

```ts
import { loadModel, modelSource } from 'asciify-engine/model';
import { mountGlyphField } from 'asciify-engine/field';

const model = modelSource(await loadModel('/models/shoe.glb'), { width: 960, height: 540, spin: 20, orbit: hero, orbitMode: 'drag' });
const field = mountGlyphField(heroCanvas, { source: model.canvas, live: true, sample: 'shape', worker: true });
// model.update({ yaw: 90 }); model.destroy(); field.destroy();
```

- `spin` is degrees a second (0 holds it still); reduced motion holds it still. It draws only while something moves and pauses
  in hidden tabs.
- `orbit` is an element whose pointer turns the model: `orbitMode: 'drag'` (default) or `'hover'` (it leans toward the pointer).
- Without WebGL2 it falls back to `renderModel` on the CPU (`model.gpu` is false).
- A still model needs no `live`: draw it once, mount the field with `live: false`, and call `field.setSource(model.canvas)`
  after `model.update(…)`.

## In a terminal

`npx asciify-engine model.glb` opens a live view: drag with the mouse or use the arrow keys to turn it, `+`/`-` to zoom, space
to pause, `q` to quit. `--spin 45 -o turn.svg` writes a turn. See [cli.md](cli.md).
