/*
 * Tiny no-op used by the "Run app" entry in launch.json.
 *
 * The two dev servers are started by the preLaunchTask ("dev: servers"), which
 * opens them in two side-by-side terminals — no debugger attaches to them.
 * This script does nothing except keep the Run and Debug session alive so the
 * Stop button works; stopping it triggers the postDebugTask that frees the
 * ports. Nothing in your server code is ever debugged.
 */
const timer = setInterval(() => {}, 1 << 30);

function stop() {
  clearInterval(timer);
  process.exit(0);
}

process.on('SIGTERM', stop);
process.on('SIGINT', stop);
