// The GPU converter's worker script, bundled as a string. The ESM build emits this module as its own chunk
// (headless-gpu-worker.js), fetched the first time a converter starts.
export { default } from './gpu-worker?worker-source';
