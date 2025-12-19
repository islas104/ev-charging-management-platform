import { Module, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { AppController } from './app.controller';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot({
      pinoHttp: {
        customProps: (req) => ({
          requestId: req.headers['x-request-id'],
        }),
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            singleLine: true,
          },
        },
      },
    }),
  ],
  controllers: [AppController],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
