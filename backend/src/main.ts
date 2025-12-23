import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from 'nestjs-pino';
import { WsAdapter } from '@nestjs/platform-ws';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const logger = app.get(Logger);

  app.useLogger(logger);
  app.useGlobalFilters(new HttpExceptionFilter(logger));
  app.useWebSocketAdapter(new WsAdapter(app));

  // Enable CORS so the static frontend (VS Code Live Server on a random localhost port)
  // can call the API at http://localhost:3000
  app.enableCors({
    origin: (origin, cb) => {
      // allow curl/postman/no-origin
      if (!origin) return cb(null, true);

      const allowed =
        origin.startsWith('http://localhost:') ||
        origin.startsWith('http://127.0.0.1:');

      return allowed ? cb(null, true) : cb(new Error(`CORS blocked origin: ${origin}`), false);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();