import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // The front talks to /api/* and is served from a different origin in dev.
  app.enableCors();
  app.setGlobalPrefix('api', { exclude: [''] });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
    }),
  );

  const port = Number(process.env.PORT) || 5000;
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
