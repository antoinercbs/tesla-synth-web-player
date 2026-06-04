import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';

/**
 * Builds and fully configures the Nest application WITHOUT listening on a port.
 * Shared by two runtimes:
 *  - the hosted server (`bootstrap()` below calls `listen()`), and
 *  - the Electron desktop app, which `require()`s this module and runs the very
 *    same app IN-PROCESS behind a custom `app://` protocol (no TCP server).
 * It must stay side-effect-free beyond app construction so that merely importing
 * this module never opens a port.
 */
export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule);

  // The front talks to /api/* and is served from a different origin in dev.
  app.enableCors();
  app.setGlobalPrefix('api', { exclude: [''] });

  // A sync /apply batch can carry many songs/playlists, well over the 100kb
  // express default. Raise the JSON cap (multipart file uploads are bounded
  // separately by Multer's fileSize limit).
  app.use(json({ limit: '16mb' }));
  app.use(urlencoded({ extended: true, limit: '16mb' }));

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
    }),
  );

  return app;
}

async function bootstrap(): Promise<void> {
  const app = await createApp();

  const port = Number(process.env.PORT) || 5000;
  // Bind all interfaces by default (Docker); the Electron app no longer forks
  // this as a server (it runs createApp() in-process), so HOST is server-only.
  const host = process.env.HOST || '0.0.0.0';
  await app.listen(port, host);

  // Legacy readiness signal for any utilityProcess fork; harmless no-op when run
  // directly or in-process.
  const parentPort = (
    process as unknown as { parentPort?: { postMessage: (m: unknown) => void } }
  ).parentPort;
  parentPort?.postMessage({ type: 'ready' });
}

// Only auto-start the HTTP server when run as the entrypoint (`node dist/main.js`
// / Docker). When Electron `require()`s the bundle to run Nest in-process,
// `require.main !== module`, so no port is ever opened.
if (require.main === module) {
  void bootstrap();
}
