import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './modules/app.module.js';
async function bootstrap() {
    const app = await NestFactory.create(AppModule, {
        bufferLogs: true
    });
    const port = process.env.PORT || 3001;
    await app.listen(port);
    Logger.log(`BFF listening on http://localhost:${port}`, 'Bootstrap');
}
bootstrap().catch((error) => {
    Logger.error('Failed to bootstrap BFF', error);
    process.exit(1);
});
