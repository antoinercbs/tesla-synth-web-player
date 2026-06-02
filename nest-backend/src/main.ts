import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
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

  const port = Number(process.env.PORT) || 5000;
  // Bind all interfaces by default (Docker); the Electron app passes
  // HOST=127.0.0.1 so the embedded backend is not exposed on the LAN.
  const host = process.env.HOST || '0.0.0.0';
  await app.listen(port, host);
}

void bootstrap();
