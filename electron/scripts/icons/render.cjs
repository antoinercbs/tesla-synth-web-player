// Electron entry used by make-icons.mjs: rasterises SVG sources to PNG in a hidden
// window (Chromium's renderer, so no extra image dependency).
//   electron render.cjs <jobs.json> <out.json>
// jobs.json = { sources: { name: svg }, jobs: [[outName, sourceName, sizePx], ...] }
// out.json  = { outName: base64 PNG, ... }
const { app, BrowserWindow } = require('electron');
const fs = require('fs');

const [jobsPath, outPath] = process.argv.slice(-2);

// runs in the page
async function renderAll(sources, jobs) {
  const out = {};
  for (const [name, src, size] of jobs) {
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(sources[src]);
    await img.decode();
    const c = document.createElement('canvas');
    c.width = c.height = size;
    c.getContext('2d').drawImage(img, 0, 0, size, size);
    out[name] = c.toDataURL('image/png').split(',')[1];
  }
  return out;
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  try {
    const { sources, jobs } = JSON.parse(fs.readFileSync(jobsPath, 'utf8'));
    const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
    await win.loadURL('about:blank');
    const out = await win.webContents.executeJavaScript(
      `(${renderAll.toString()})(${JSON.stringify(sources)}, ${JSON.stringify(jobs)})`);
    fs.writeFileSync(outPath, JSON.stringify(out));
    app.exit(0);
  } catch (err) {
    console.error(err);
    app.exit(1);
  }
});
