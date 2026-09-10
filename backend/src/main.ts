import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Runs behind Caddy (and Cloudflare); trust the proxy so req.ip / rate-limiting
  // reflect the real client address from X-Forwarded-For.
  app.set('trust proxy', 1);

  const origins = (process.env.CORS_ORIGINS || '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins.length === 1 && origins[0] === '*' ? true : origins });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  const port = parseInt(process.env.PORT || '3000', 10);
  await app.listen(port);
  new Logger('Bootstrap').log(`Backend listening on http://localhost:${port}/api (ws: /control)`);
}
bootstrap();
