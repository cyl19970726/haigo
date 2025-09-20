import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './modules/app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true
  });

  // CORS: allow Next dev server (3000) to call BFF (3001) in development
  const corsOrigins = (process.env.BFF_CORS_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  app.enableCors({
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'authorization', 'x-requested-with', 'x-haigo-trace-id'],
    exposedHeaders: ['x-haigo-trace-id'],
    credentials: true,
    optionsSuccessStatus: 204
  });
  const port = process.env.PORT || 3001;
  // Startup self-check: print effective endpoints and API key presence (masked)
  try {
    const cfg = app.get(ConfigService);
    const indexerUrls = cfg.get<string[]>('indexerUrls') ?? [];
    const indexerUrl = cfg.get<string>('indexerUrl');
    const nodeApiUrl = cfg.get<string>('nodeApiUrl');
    const hasKey = Boolean(cfg.get<string>('aptosApiKey'));
    Logger.log(
      `Config: indexerUrl=${indexerUrl} indexerUrls=[${indexerUrls.join(', ')}] nodeApiUrl=${nodeApiUrl} apiKeyDetected=${hasKey}`,
      'Bootstrap'
    );
  } catch {}
  await app.listen(port);
  Logger.log(`BFF listening on http://localhost:${port}`, 'Bootstrap');
}

bootstrap().catch((error) => {
  try {
    Logger.error('Failed to bootstrap BFF', error);
  } catch {}
  // Ensure visibility even if Nest Logger is not ready
  // eslint-disable-next-line no-console
  console.error('[BootstrapError]', error?.stack || error);
  process.exit(1);
});
