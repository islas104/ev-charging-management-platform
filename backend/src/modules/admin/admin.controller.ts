import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

  /**
   * Global pricing config (single row):
   * - baseEnergyGbpKwh: ex VAT base tariff (CPO payout)
   * - platformMarkup: markup added on top so driver pays more (0.10 = 10%)
   */
  @Get('pricing')
  async getPricing() {
    const cfg =
      (await this.prisma.pricingConfig.findFirst({ orderBy: { id: 'asc' } })) ??
      (await this.prisma.pricingConfig.create({
        data: {
          baseEnergyGbpKwh: new Prisma.Decimal('0.46'),
          platformMarkup: new Prisma.Decimal('0.10'),
          currency: 'GBP',
        },
      }));

    const base = cfg.baseEnergyGbpKwh.toNumber();
    const markup = cfg.platformMarkup.toNumber();

    const driverEnergyGbpKwhExVat = round4(base * (1 + markup));
    const platformFeeGbpKwhExVat = round4(base * markup);

    return {
      id: cfg.id,
      currency: cfg.currency,
      baseEnergyGbpKwh: base,
      platformMarkup: markup,
      driverEnergyGbpKwhExVat,
      platformFeeGbpKwhExVat,
      updatedAt: cfg.updatedAt,
      createdAt: cfg.createdAt,
    };
  }

  /**
   * Update global pricing settings.
   * Note:
   * - UI currently only edits baseEnergyGbpKwh
   * - platformMarkup defaults to 10% if not provided
   */
  @Put('pricing')
  async updatePricing(
    @Body()
    body: {
      baseEnergyGbpKwh: number;
      platformMarkup?: number;
    },
  ) {
    const baseEnergy = Number(body.baseEnergyGbpKwh);
    if (!Number.isFinite(baseEnergy) || baseEnergy < 0) {
      return { ok: false, error: 'baseEnergyGbpKwh must be a non-negative number' };
    }

    const markupRaw = body.platformMarkup === undefined ? 0.1 : Number(body.platformMarkup);
    if (!Number.isFinite(markupRaw) || markupRaw < 0 || markupRaw > 1) {
      return { ok: false, error: 'platformMarkup must be between 0 and 1 (e.g. 0.10)' };
    }

    const cfg =
      (await this.prisma.pricingConfig.findFirst({ orderBy: { id: 'asc' } })) ??
      (await this.prisma.pricingConfig.create({
        data: {
          baseEnergyGbpKwh: new Prisma.Decimal('0.46'),
          platformMarkup: new Prisma.Decimal('0.10'),
          currency: 'GBP',
        },
      }));

    const updated = await this.prisma.pricingConfig.update({
      where: { id: cfg.id },
      data: {
        baseEnergyGbpKwh: new Prisma.Decimal(baseEnergy),
        platformMarkup: new Prisma.Decimal(markupRaw),
      },
    });

    const base = updated.baseEnergyGbpKwh.toNumber();
    const markup = updated.platformMarkup.toNumber();

    const driverEnergyGbpKwhExVat = round4(base * (1 + markup));
    const platformFeeGbpKwhExVat = round4(base * markup);

    // Keep response shape consistent with GET /admin/pricing (return the object directly)
    return {
      id: updated.id,
      currency: updated.currency,
      baseEnergyGbpKwh: base,
      platformMarkup: markup,
      driverEnergyGbpKwhExVat,
      platformFeeGbpKwhExVat,
      updatedAt: updated.updatedAt,
      createdAt: updated.createdAt,
    };
  }

  /**
   * Dashboard card counts:
   * - Online: lastSeenAt within onlineWindowSeconds (default 120s)
   */
  @Get('overview')
  async getOverview(@Query('onlineWindowSeconds') onlineWindowSeconds?: string) {
    const windowSeconds = Number(onlineWindowSeconds ?? 120);
    const cutoff = new Date(Date.now() - windowSeconds * 1000);

    const [totalChargers, onlineChargers, chargeLocations] = await Promise.all([
      this.prisma.charger.count(),
      this.prisma.charger.count({ where: { lastSeenAt: { gte: cutoff } } }),
      this.prisma.site.count(),
    ]);

    return {
      totals: {
        chargers: totalChargers,
        onlineChargers,
        offlineChargers: Math.max(0, totalChargers - onlineChargers),
        chargeLocations,
      },
      meta: {
        onlineWindowSeconds: windowSeconds,
        cutoff,
        generatedAt: new Date(),
      },
    };
  }

  /**
   * UI-friendly charger list for a "Manage chargers" table.
   * Now uses real connector statuses from ConnectorStatus (StatusNotification).
   */
  @Get('chargers-view')
  async getChargersView(@Query('onlineWindowSeconds') onlineWindowSeconds?: string) {
    const windowSeconds = Number(onlineWindowSeconds ?? 120);
    const cutoff = new Date(Date.now() - windowSeconds * 1000);

    const chargers = await this.prisma.charger.findMany({
      include: {
        site: true,
        connectors: {
          orderBy: { connectorId: 'asc' },
          select: {
            connectorId: true,
            status: true,
            errorCode: true,
            vendorError: true,
            info: true,
            updatedAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return chargers.map(c => {
      const isOnline = !!c.lastSeenAt && c.lastSeenAt >= cutoff;

      return {
        id: c.id,
        chargerId: c.chargerId,
        name: c.chargerId, // replace when you add displayName to schema
        location: c.site?.name ?? null,

        connectivity: isOnline ? 'Online' : 'Offline',
        lastMessageAt: c.lastSeenAt,

        registrationStatus: c.registered ? 'Registered' : 'Unregistered',

        connectors:
          c.connectors?.length
            ? c.connectors.map(cs => ({
                connectorId: cs.connectorId,
                status: cs.status,
                errorCode: cs.errorCode ?? null,
                vendorError: cs.vendorError ?? null,
                info: cs.info ?? null,
                updatedAt: cs.updatedAt,
              }))
            : [
                { connectorId: 1, status: 'Unknown' },
                { connectorId: 2, status: 'Unknown' },
              ],
      };
    });
  }

  /**
   * For the "Filter by OCPP Operation" UI (unique list of operations)
   */
  @Get('ocpp/operations')
  async getOcppOperations() {
    const rows = await this.prisma.ocppMessageLog.findMany({
      distinct: ['operation'],
      select: { operation: true },
      orderBy: { operation: 'asc' },
    });

    return rows.map(r => r.operation);
  }

  /**
   * For the OCPP message log table + modal viewer.
   * Example:
   *  /admin/chargers/DEMO-CHARGER-001/messages?take=50&skip=0&operation=Heartbeat,StopTransaction
   */
  @Get('chargers/:chargerId/messages')
  async getChargerMessages(
    @Param('chargerId') chargerId: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
    @Query('operation') operation?: string,
  ) {
    const charger = await this.prisma.charger.findUnique({
      where: { chargerId },
      select: { id: true, chargerId: true },
    });

    if (!charger) return { total: 0, items: [] };

    const takeN = Math.min(Math.max(Number(take ?? 50), 1), 200);
    const skipN = Math.max(Number(skip ?? 0), 0);

    const ops =
      operation && operation.trim().length
        ? operation.split(',').map(s => s.trim()).filter(Boolean)
        : [];

    const where = {
      chargerId: charger.id,
      ...(ops.length ? { operation: { in: ops } } : {}),
    };

    const [total, items] = await Promise.all([
      this.prisma.ocppMessageLog.count({ where }),
      this.prisma.ocppMessageLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: takeN,
        skip: skipN,
        select: {
          id: true,
          createdAt: true,
          direction: true,
          operation: true,
          messageId: true,
          raw: true,
          status: true,
        },
      }),
    ]);

    return { total, items };
  }
}

function round4(n: number) {
  return Math.round((n + Number.EPSILON) * 10_000) / 10_000;
}