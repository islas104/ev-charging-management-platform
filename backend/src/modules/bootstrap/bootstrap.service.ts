import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';

@Injectable()
export class BootstrapService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    const seedDefaults = String(this.config.get('SEED_DEFAULTS') ?? 'true').toLowerCase() === 'true';
    if (!seedDefaults) return;

    const [account, tariff, pricing] = await Promise.all([
      this.prisma.account.findFirst({ orderBy: { id: 'asc' } }),
      this.prisma.tariff.findFirst({ orderBy: { id: 'asc' } }),
      this.prisma.pricingConfig.findFirst({ orderBy: { id: 'asc' } }),
    ]);

    const ensuredAccount =
      account ??
      (await this.prisma.account.create({
        data: {
          name: 'Default Account',
          type: 'OWNER',
        },
      }));

    if (!tariff) {
      await this.prisma.tariff.create({
        data: {
          accountId: ensuredAccount.id,
          name: 'Default Tariff',
          startFee: new Prisma.Decimal('0.00'),
          energyFee: new Prisma.Decimal('0.45'),
          idleFee: new Prisma.Decimal('0.20'),
          vatRate: new Prisma.Decimal('0.20'),
          currency: 'GBP',
        },
      });
    }

    if (!pricing) {
      await this.prisma.pricingConfig.create({
        data: {
          baseEnergyGbpKwh: new Prisma.Decimal('0.46'),
          platformMarkup: new Prisma.Decimal('0.10'),
          currency: 'GBP',
        },
      });
    }
  }
}
