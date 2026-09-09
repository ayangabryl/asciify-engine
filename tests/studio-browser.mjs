import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import assert from "node:assert/strict";
import { build } from "esbuild";
const root = fileURLToPath(new URL("..", import.meta.url));
const out = process.env.ASCIIFY_AUDIT_OUTPUT || "/tmp/asciify-studio-browser";
await fs.mkdir(out, { recursive: true });
const bundle = await fs.mkdtemp("/tmp/asciify-studio-bundle-");
await build({
  entryPoints: [root + "/src/studio.ts"],
  outdir: bundle,
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "browser",
  logLevel: "warning",
});
const { default: puppeteer } = await import(
  pathToFileURL(
    process.env.ASCIIFY_PUPPETEER ??
      root + "/../site/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js",
  ).href
);
const server = http.createServer(async (req, res) => {
  try {
    const name = decodeURIComponent(req.url.split("?")[0]);
    if (name === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<style>body{margin:0;background:#080808;color:#eee;font:12px monospace}canvas{display:block;max-width:100%}</style><canvas id="view"></canvas>',
      );
      return;
    }
    if (name.includes("..")) throw Error();
    const file = await fs.readFile(path.join(bundle, name));
    res.setHeader("Content-Type", "text/javascript");
    res.end(file);
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await puppeteer.launch({
  headless: true,
  executablePath:
    process.env.PUPPETEER_EXECUTABLE_PATH ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 640 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(async () => {
    window.api = await import("/studio.js");
    window.source = document.createElement("canvas");
    source.width = 640;
    source.height = 360;
    window.paint = (t = 0) => {
      const c = source.getContext("2d"),
        g = c.createLinearGradient(0, 0, 640, 360);
      g.addColorStop(0, "#0a2441");
      g.addColorStop(0.45, "#c8944d");
      g.addColorStop(1, "#f7dfbf");
      c.fillStyle = g;
      c.fillRect(0, 0, 640, 360);
      c.fillStyle = "#142513";
      c.fillRect(40, 40, 180, 100);
      c.fillStyle = "#edcb78";
      c.beginPath();
      c.arc(360 + Math.sin(t * 3) * 100, 180, 75, 0, Math.PI * 2);
      c.fill();
      c.font = "bold 60px monospace";
      c.fillStyle = "#fff";
      c.fillText("Asciify", 150, 320);
    };
    paint();
    window.view = document.querySelector("#view");
    window.renderer = api.createStudioRenderer(view);
    window.config = api.normalizeStudioSettings();
    window.fingerprint = () => view.toDataURL();
    window.render = (config, t = 0) => {
      renderer.configure(config);
      renderer.invalidate();
      renderer.render(source, t, 640, 360);
      return fingerprint();
    };
  });
  const styles = await page.evaluate(() => {
    const list = [];
    for (const style of api.STUDIO_STYLES) {
      const s = api.normalizeStudioSettings({
        style,
        colorMode: "source",
        cellSize: 12,
        dither: { algorithm: "bayer4" },
      });
      list.push([style, render(s)]);
    }
    return list;
  });
  assert.equal(
    new Set(styles.map((x) => x[1])).size,
    styles.length,
    "Every named style must differ",
  );
  for (const [name, url] of styles)
    await fs.writeFile(
      out + `/style-${name}.png`,
      Buffer.from(url.split(",")[1], "base64"),
    );
  const effects = await page.evaluate(() => {
    const base = render(config),
      results = [];
    for (const effect of [
      "bloom",
      "characterBloom",
      "grain",
      "dust",
      "scanlines",
      "crt",
      "prism",
      "vignette",
      "glitch",
      "pixelate",
      "halftone",
    ]) {
      const image = render(
        api.normalizeStudioSettings({ effects: { [effect]: 0.8 } }),
        0.6,
      );
      results.push({ effect, visible: base !== image });
    }
    for (const blurType of ["gaussian", "directional", "radial", "progressive"])
      results.push({
        effect: blurType,
        visible:
          base !==
          render(
            api.normalizeStudioSettings({ effects: { blur: 8, blurType } }),
          ),
      });
    return results;
  });
  effects.forEach((e) => assert.ok(e.visible, e.effect));
  const masks = await page.evaluate(() => {
    const cfg = api.normalizeStudioSettings({
      style: "pixel",
      colorMode: "source",
      backdrop: { mode: "transparent" },
      mask: {
        enabled: true,
        shapes: [
          { kind: "rectangle", x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
        ],
      },
      color: { amount: 0.5 },
      lights: [{ x: 0.5, y: 0.5 }],
    });
    render(cfg);
    const ctx = view.getContext("2d"),
      inside = ctx.getImageData(320, 180, 1, 1).data[3],
      outside = ctx.getImageData(10, 10, 1, 1).data[3];
    cfg.mask.invert = true;
    render(cfg);
    return {
      inside,
      outside,
      invertedInside: ctx.getImageData(320, 180, 1, 1).data[3],
      invertedOutside: ctx.getImageData(10, 10, 1, 1).data[3],
    };
  });
  assert.deepEqual(masks, {
    inside: 255,
    outside: 0,
    invertedInside: 0,
    invertedOutside: 255,
  });
  const fonts = await page.evaluate(async () => {
    const fonts = [];
    for (const font of api.STUDIO_TEXT_FONTS) {
      const t = await api.createStudioText("ASCII", font);
      fonts.push({ font, width: t.canvas.width, ascii: t.ascii });
    }
    return fonts;
  });
  assert.equal(new Set(fonts.map((x) => x.ascii)).size, fonts.length);
  const hover = [];
  for (const effect of [
    "trail",
    "water",
    "contour",
    "dissolve",
    "silk",
    "vortex",
  ]) {
    const result = await page.evaluate((effect) => {
      renderer.destroy();
      renderer = api.createStudioRenderer(view, {
        hover: { effect, strength: 1, radius: 1 },
      });
      renderer.render(source, 0, 640, 360);
      const before = fingerprint();
      for (let i = 0; i < 45; i++) {
        renderer.pointer(
          0.1 + i * 0.017,
          0.5 + Math.sin(i * 0.3) * 0.15,
          i * 16.67,
        );
        renderer.render(source, i / 60, 640, 360);
      }
      return before !== fingerprint();
    }, effect);
    hover.push({ effect, visible: result });
    assert.ok(result, effect);
  }
  const motion = await page.evaluate(() => {
    const results = [];
    for (const style of ["ascii", "dither", "pixel"])
      for (const type of [
        "breathe",
        "wave",
        "reveal",
        "glitch",
        "rainbow",
        "hologram",
        "fire",
        "chrome",
        "ripple",
        "vapor",
      ]) {
        const s = api.normalizeStudioSettings({
          style,
          colorMode: "source",
          motion: { type },
          dither: { algorithm: "bayer4", palette: "original" },
        });
        results.push({
          style,
          type,
          visible: render(s, 0.1) !== render(s, 1.1),
        });
      }
    return results;
  });
  motion.forEach((m) => assert.ok(m.visible, JSON.stringify(m)));
  const lower = await page.evaluate(() => {
    const sourcePixels = source
      .getContext("2d")
      .getImageData(10, 10, 1, 1).data;
    const settings = api.normalizeStudioSettings({
      style: "pixel",
      cellSize: 3,
      colorMode: "source",
      effects: { grain: 0.001 },
    });
    render(settings);
    const top = view.getContext("2d").getImageData(10, 10, 1, 1).data;
    return Math.abs(top[2] - sourcePixels[2]) < 10;
  });
  assert.ok(lower, "Optical pass must keep source orientation");
  const timings = await page.evaluate(() => {
    renderer.destroy();
    renderer = api.createStudioRenderer(view, {
      cellSize: 3,
      hover: { effect: "trail", strength: 1, radius: 1 },
      effects: { prism: 0.8, blur: 4, grain: 0.3 },
    });
    const times = [];
    for (let i = 0; i < 120; i++) {
      renderer.pointer(
        0.1 + (i % 90) / 110,
        0.5 + Math.sin(i * 0.2) * 0.2,
        i * 16.67,
      );
      const start = performance.now();
      renderer.render(source, i / 60, 960, 540);
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    return {
      median: times[60],
      p95: times[114],
      max: times[119],
      size: [view.width, view.height],
    };
  });
  await page.screenshot({ path: out + "/stress-preview.png" });
  const exports = [];
  for (const format of ["png", "jpeg", "gif", "mp4", "webm"]) {
    const result = await page.evaluate(async (format) => {
      try {
        const settings = api.normalizeStudioSettings({
            style: "mosaic",
            cellSize: 12,
            colorMode: "source",
            effects: { prism: 0.5 },
          }),
          progress = [], sampleTimes = [];
        const blob = await api.exportStudio(
          {
            frame: (t) => {
              sampleTimes.push(t);
              paint(t);
              return source;
            },
          },
          settings,
          {
            format,
            width: 320,
            height: 180,
            duration: 1,
            time: 1.5,
            fps: 12,
            onProgress: (p) => progress.push(p),
          },
        );
        const data = await new Promise((r) => {
          const f = new FileReader();
          f.onload = () => r(f.result);
          f.readAsDataURL(blob);
        });
        return { format, type: blob.type, size: blob.size, data, progress, sampleTimes };
      } catch (error) {
        return { format, error: error.message };
      }
    }, format);
    assert.equal(result.error, undefined, JSON.stringify(result));
    assert.ok(result.size > 100);
    assert.equal(result.sampleTimes[0], ["png","jpeg"].includes(format) ? 1.5 : 0);
    assert.equal(result.progress.at(-1), 1);
    await fs.writeFile(
      out + "/export." + (format === "jpeg" ? "jpg" : format),
      Buffer.from(result.data.split(",")[1], "base64"),
    );
    delete result.data;
    exports.push(result);
  }
  const decodedGif = await page.evaluate(async () => {
    paint();
    const blob = await api.exportStudio(
      {
        frame: (t) => {
          paint(t);
          return source;
        },
      },
      config,
      { format: "gif", width: 160, height: 90, duration: 1, fps: 10 },
    );
    const media = await api.loadStudioMedia(
      new File([blob], "loop.gif", { type: "image/gif" }),
    );
    const first = media.frame(0).toDataURL(),
      second = media.frame(0.5).toDataURL(),
      again = media.frame(0).toDataURL();
    media.destroy();
    return { animated: first !== second, loopReset: first === again };
  });
  assert.deepEqual(decodedGif, { animated: true, loopReset: true });
  const cancellation = await page.evaluate(async () => {
    const abort = new AbortController();
    abort.abort();
    try {
      await api.exportStudio({ frame: () => source }, config, {
        format: "mp4",
        width: 320,
        height: 180,
        signal: abort.signal,
      });
      return false;
    } catch (error) {
      return error.name === "AbortError";
    }
  });
  assert.ok(cancellation);
  const lifecycle = await page.evaluate(async () => {
    renderer.destroy();
    let ticks = 0,
      destroyed = false;
    const media = {
      source,
      width: 640,
      height: 360,
      duration: 0,
      animated: false,
      seek: async () => {},
      frame: () => source,
      destroy: () => {
        destroyed = true;
      },
    };
    const instance = api.mountStudioMedia(view, media, {
      settings: { hover: { effect: "none" } },
      onFrame: () => ticks++,
    });
    await new Promise((r) => setTimeout(r, 200));
    const idle = ticks;
    await new Promise((r) => setTimeout(r, 150));
    const sleeps = ticks === idle;
    instance.update({ motion: { type: "breathe" } });
    await new Promise((r) => setTimeout(r, 200));
    const animates = ticks > idle;
    instance.pause();
    await new Promise((r) => setTimeout(r, 100));
    const paused = ticks;
    await new Promise((r) => setTimeout(r, 150));
    const stops = ticks === paused;
    instance.destroy();
    const final = ticks;
    await new Promise((r) => setTimeout(r, 100));
    return { sleeps, animates, stops, cleans: destroyed && ticks === final };
  });
  assert.deepEqual(lifecycle, {
    sleeps: true,
    animates: true,
    stops: true,
    cleans: true,
  });
  const fallback = await page.evaluate(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return type === "webgl" ? null : get.call(this, type, ...args);
    };
    const c = document.createElement("canvas"),
      r = api.createStudioRenderer(c, { effects: { prism: 1 } });
    r.render(source);
    const result = {
      available: r.capabilities.gpuFinish,
      status: c.dataset.studioFinish,
      baseVisible: c.width > 1,
    };
    r.destroy();
    HTMLCanvasElement.prototype.getContext = get;
    return result;
  });
  assert.deepEqual(fallback, {
    available: false,
    status: "unavailable",
    baseVisible: true,
  });
  assert.deepEqual(errors, []);
  const report = {
    lifecycle,
    fallback,
    motion,
    styles: styles.map((x) => x[0]),
    effects,
    masks,
    fonts: fonts.map(({ ascii, ...rest }) => rest),
    hover,
    timings,
    exports,
    decodedGif,
    cancellation,
    errors,
  };
  await fs.writeFile(out + "/report.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  server.close();
  await fs.rm(bundle, { recursive: true, force: true });
}
