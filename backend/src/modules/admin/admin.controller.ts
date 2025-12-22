import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('admin')
export class AdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('chargers')
  async getChargers() {
    return this.prisma.charger.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get('transactions')
  async getTransactions() {
    const transactions = await this.prisma.transaction.findMany({
      orderBy: { startedAt: 'desc' },
      include: {
        charger: {
          select: {
            chargerId: true,
          },
        },
      },
    });

    return transactions.map(t => ({
      chargerId: t.charger.chargerId,
      ocppTransactionId: t.ocppTransactionId,
      idTag: t.idTag,
      meterStart: t.meterStart,
      meterStop: t.meterStop,
      startedAt: t.startedAt,
      stoppedAt: t.stoppedAt,
      stopReason: t.stopReason,
    }));
  }
}
