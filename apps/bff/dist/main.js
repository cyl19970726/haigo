"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const app_module_1 = require("./modules/app.module");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule, {
        bufferLogs: true
    });
    const port = process.env.PORT || 3001;
    await app.listen(port);
    common_1.Logger.log(`BFF listening on http://localhost:${port}`, 'Bootstrap');
}
bootstrap().catch((error) => {
    common_1.Logger.error('Failed to bootstrap BFF', error);
    process.exit(1);
});
