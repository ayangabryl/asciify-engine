// The worker a glyph field draws in, bundled as a string. The ESM build emits this module as its own chunk
// (field-worker.js), fetched the first time a field mounts with `worker: true`.
export { default } from './field-worker?worker-source';
