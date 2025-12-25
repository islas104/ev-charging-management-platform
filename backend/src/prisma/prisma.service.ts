import { INestApplication, Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    super({
      adapter: new PrismaPg({
        connectionString: process.env.DATABASE_URL!,
      }),
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async enableShutdownHooks(app: INestApplication) {
    const shutdown = async () => {
      try {
        await app.close();
      } catch {
        // ignore
      }
    };

    process.on('beforeExit', shutdown);
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }
}
