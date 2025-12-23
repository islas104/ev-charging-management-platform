import { Controller, Get, Param, Query } from '@nestjs/common';
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

        // Use persisted connector status; fallback to Unknown if we have none yet.
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
                { connectorId: 1, status: isOnline ? 'Unknown' : 'Unknown' },
                { connectorId: 2, status: isOnline ? 'Unknown' : 'Unknown' },
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