import { Module, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import Joi from 'joi';

import { AppController } from './app.controller';
import { PublicController } from './modules/public/public.controller';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { OcppModule } from './modules/ocpp/ocpp.module';
import { AdminModule } from './modules/admin/admin.module';
import { AuthModule } from './modules/auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { BootstrapService } from './modules/bootstrap/bootstrap.service';
import { EaseeModule } from './modules/easee/easee.module';

@Module({
  imports: [
    PrismaModule, // ✅ REQUIRED for database access
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
        PORT: Joi.number().default(3000),
        DATABASE_URL: Joi.string().uri().required(),
        CORS_ORIGINS: Joi.string().allow('').optional(),
        HTTP_BODY_LIMIT: Joi.string().default('1mb'),
        THROTTLE_TTL: Joi.number().default(60),
        THROTTLE_LIMIT: Joi.number().default(120),
        OCPP_SHARED_SECRET: Joi.string().allow('').optional(),
        OCPP_MAX_MESSAGE_BYTES: Joi.number().default(1000000),
        OCPP_ALLOW_UNKNOWN_IDTAG: Joi.boolean().default(false),
        JWT_SECRET: Joi.string().min(8).required(),
        JWT_EXPIRES_IN: Joi.string().default('8h'),
        AUTH_MAX_LOGIN_ATTEMPTS: Joi.number().default(5),
        AUTH_LOCK_MINUTES: Joi.number().default(15),
        AUTH_RESET_TOKEN_TTL_MIN: Joi.number().default(30),
        IDEMPOTENCY_TTL_HOURS: Joi.number().default(24),
        REMOTE_COMMAND_TTL_SECONDS: Joi.number().default(45),
        SEED_DEFAULTS: Joi.boolean().default(true),
        EASEE_ENABLED: Joi.boolean().default(false),
        EASEE_BASE_URL: Joi.string().allow('').default('https://api.easee.cloud'),
        EASEE_USERNAME: Joi.string().allow('').default(''),
        EASEE_PASSWORD: Joi.string().allow('').default(''),
        EASEE_ACCESS_TOKEN: Joi.string().allow('').default(''),
        EASEE_POLL_SECONDS: Joi.number().default(20),
        EASEE_CHARGERS_PATH: Joi.string().allow('').default('/api/chargers'),
        EASEE_START_PATH_TEMPLATE: Joi.string().allow('').default(''),
        EASEE_STOP_PATH_TEMPLATE: Joi.string().allow('').default(''),
        EASEE_DYNAMIC_CURRENT_PATH_TEMPLATE: Joi.string().allow('').default(''),
      }),
    }),
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: Number(process.env.THROTTLE_TTL ?? 60),
          limit: Number(process.env.THROTTLE_LIMIT ?? 120),
        },
      ],
    }),
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
    OcppModule,
    EaseeModule,
    AdminModule,
    AuthModule,
  ],
  controllers: [
    AppController,
    PublicController,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    BootstrapService,
  ],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
