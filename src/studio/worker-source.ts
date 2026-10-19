// The render worker's script, bundled as a string. The ESM build emits this module as its own chunk (studio-worker.js).
export { default } from "./render-worker?worker-source";
