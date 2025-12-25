import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminApiKeyGuard } from '../../common/guards/admin-api-key.guard';

@Module({
  controllers: [AdminController],
  providers: [PrismaService, AdminApiKeyGuard],
})
export class AdminModule {}
