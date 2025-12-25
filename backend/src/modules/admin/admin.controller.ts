import { Body, Controller, Get, Param, Put, Query, Post, Patch } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('admin')
export class AdminController {
  constructor(private readonly prisma: PrismaService) {}

  // quick probe route to confirm AdminController is mounted
  @Get('ping')
  ping() {
    return { ok: true, scope: 'admin', at: new Date().toISOString() };
  }

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

    const markupRaw =
      body.platformMarkup === undefined ? 0.1 : Number(body.platformMarkup);
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
   * Uses connector statuses from ConnectorStatus (StatusNotification).
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
        name: c.chargerId,
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
   * Revenue analytics for admin dashboard charts.
   * GET /admin/revenue?range=30d&meterUnit=wh
   *
   * Notes:
   * - "Revenue" here is platform fee revenue (ex VAT), derived from transactions + PricingConfig.
   * - meterUnit:
   *    - wh  => kWh = (meterStop - meterStart) / 1000
   *    - kwh => kWh = (meterStop - meterStart) / 1
   */
  @Get('revenue')
  async getRevenue(
    @Query('range') range?: string,
    @Query('meterUnit') meterUnit?: string,
  ) {
    const days = parseRangeDays(range ?? '30d');
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

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

    const platformFeePerKwhExVat = round4(base * markup);

    const unit = (meterUnit ?? 'wh').trim().toLowerCase() === 'kwh' ? 'kwh' : 'wh';
    const divisor = unit === 'kwh' ? 1 : 1000;

    const txs = await this.prisma.transaction.findMany({
      where: {
        startedAt: { gte: since },
        meterStop: { not: null },
      },
      select: {
        meterStart: true,
        meterStop: true,
        startedAt: true,
        charger: {
          select: {
            chargerId: true,
            site: { select: { name: true } },
          },
        },
      },
      orderBy: { startedAt: 'asc' },
    });

    const dailyMap = new Map<string, number>();
    const locMap = new Map<string, number>();

    for (const t of txs) {
      const ms = Number(t.meterStart);
      const me = Number(t.meterStop);
      if (!Number.isFinite(ms) || !Number.isFinite(me)) continue;

      const kwh = (me - ms) / divisor;
      if (!Number.isFinite(kwh) || kwh <= 0) continue;

      const revenue = kwh * platformFeePerKwhExVat; // no rounding while aggregating

      const day = toYmd(t.startedAt);
      dailyMap.set(day, (dailyMap.get(day) ?? 0) + revenue);

      const loc = t.charger?.site?.name ?? 'Unknown';
      locMap.set(loc, (locMap.get(loc) ?? 0) + revenue);
    }

    const daily: Array<{ date: string; revenue: number }> = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const key = toYmd(d);

      daily.push({ date: key, revenue: round4(dailyMap.get(key) ?? 0) });
    }

    const byLocation = [...locMap.entries()]
      .map(([location, revenue]) => ({ location, revenue: round4(revenue) }))
      .sort((a, b) => b.revenue - a.revenue);

    return {
      currency: cfg.currency ?? 'GBP',
      daily,
      byLocation,
      meta: {
        range: `${days}d`,
        since,
        platformFeePerKwhExVat,
        meterUnit: unit,
        generatedAt: new Date(),
      },
    };
  }

  // Debug endpoint to explain why revenue is 0
  @Get('revenue/debug')
  async getRevenueDebug(
    @Query('range') range?: string,
    @Query('meterUnit') meterUnit?: string,
  ) {
    const days = parseRangeDays(range ?? '30d');
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const unit = (meterUnit ?? 'wh').trim().toLowerCase() === 'kwh' ? 'kwh' : 'wh';
    const divisor = unit === 'kwh' ? 1 : 1000;

    const totalInRange = await this.prisma.transaction.count({
      where: { startedAt: { gte: since } },
    });

    const withMeterStop = await this.prisma.transaction.count({
      where: { startedAt: { gte: since }, meterStop: { not: null } },
    });

    const sample = await this.prisma.transaction.findMany({
      where: { startedAt: { gte: since } },
      orderBy: { startedAt: 'desc' },
      take: 10,
      select: {
        id: true,
        chargerId: true,
        startedAt: true,
        stoppedAt: true,
        meterStart: true,
        meterStop: true,
      },
    });

    return {
      since,
      meterUnit: unit,
      divisor,
      counts: { totalInRange, withMeterStop },
      sample: sample.map(t => {
        const ms = Number(t.meterStart);
        const me = t.meterStop === null ? null : Number(t.meterStop);
        const delta = me === null ? null : me - ms;
        const kwh = delta === null ? null : delta / divisor;
        return {
          id: t.id,
          chargerId: t.chargerId,
          startedAt: t.startedAt,
          stoppedAt: t.stoppedAt,
          meterStart: ms,
          meterStop: me,
          delta,
          kwh,
        };
      }),
    };
  }

  /**
   * Analytics: top drivers by energy delivered.
   * GET /admin/analytics/top-drivers?range=30d&meterUnit=wh
   */
  @Get('analytics/top-drivers')
  async getTopDrivers(
    @Query('range') range?: string,
    @Query('meterUnit') meterUnit?: string,
  ) {
    const days = parseRangeDays(range ?? '30d');
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const unit = (meterUnit ?? 'wh').trim().toLowerCase() === 'kwh' ? 'kwh' : 'wh';
    const divisor = unit === 'kwh' ? 1 : 1000;

    const txs = await this.prisma.transaction.findMany({
      where: {
        startedAt: { gte: since },
        meterStop: { not: null },
      },
      select: {
        idTag: true,
        meterStart: true,
        meterStop: true,
        startedAt: true,
      },
      orderBy: { startedAt: 'asc' },
    });

    const byTag = new Map<string, { sessions: number; kwh: number; lastSeen: Date }>();
    for (const t of txs) {
      const tag = String(t.idTag ?? '').trim();
      if (!tag) continue;

      const ms = Number(t.meterStart);
      const me = Number(t.meterStop);
      if (!Number.isFinite(ms) || !Number.isFinite(me)) continue;

      const kwh = (me - ms) / divisor;
      if (!Number.isFinite(kwh) || kwh <= 0) continue;

      const cur = byTag.get(tag) ?? { sessions: 0, kwh: 0, lastSeen: t.startedAt };
      cur.sessions += 1;
      cur.kwh += kwh;
      if (t.startedAt > cur.lastSeen) cur.lastSeen = t.startedAt;
      byTag.set(tag, cur);
    }

    const tags = [...byTag.keys()];
    const fobs = tags.length
      ? await this.prisma.rfidFob.findMany({
          where: { uid: { in: tags } },
          include: { driver: true },
        })
      : [];

    const fobByUid = new Map<string, typeof fobs[number]>();
    for (const f of fobs) fobByUid.set(f.uid, f);

    const items = tags.map(tag => {
      const agg = byTag.get(tag)!;
      const fob = fobByUid.get(tag);
      const driverName = fob?.driver?.name ?? fob?.label ?? tag;

      return {
        idTag: tag,
        driverName,
        driverId: fob?.driver?.id ?? null,
        sessions: agg.sessions,
        energyKwh: round4(agg.kwh),
        lastSessionAt: agg.lastSeen,
      };
    });

    items.sort((a, b) => b.energyKwh - a.energyKwh);

    return {
      range: `${days}d`,
      meterUnit: unit,
      totalDrivers: items.length,
      items,
    };
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
        ? operation
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
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

  // ===== Drivers + RFID fobs (admin) =====

  @Get('drivers')
  async listDrivers() {
    return this.prisma.driver.findMany({
      orderBy: { createdAt: 'desc' },
      include: { fobs: true },
    });
  }

  @Post('drivers')
  async createDriver(@Body() body: { name: string; email?: string | null }) {
    const name = String(body.name ?? '').trim();
    if (!name) return { ok: false, error: 'name is required' };

    const email = body.email ? String(body.email).trim() : null;

    const driver = await this.prisma.driver.create({
      data: { name, email: email || null },
    });

    return { ok: true, driver };
  }

  @Get('rfid-fobs')
  async listFobs(@Query('active') active?: string) {
    const activeFilter =
      active === undefined ? undefined : String(active).toLowerCase() === 'true';

    return this.prisma.rfidFob.findMany({
      where: activeFilter === undefined ? {} : { active: activeFilter },
      orderBy: { createdAt: 'desc' },
      include: { driver: true },
    });
  }

  @Post('rfid-fobs')
  async createFob(
    @Body() body: { uid: string; label?: string; driverId?: number },
  ) {
    const uid = String(body.uid ?? '').trim();
    if (!uid) return { ok: false, error: 'uid is required' };

    const label = body.label ? String(body.label).trim() : null;
    const driverId =
      body.driverId === undefined ? undefined : Number(body.driverId);

    const fob = await this.prisma.rfidFob.create({
      data: {
        uid,
        label,
        ...(driverId ? { driver: { connect: { id: driverId } } } : {}),
      },
      include: { driver: true },
    });

    return { ok: true, fob };
  }

  @Put('rfid-fobs/:id/assign')
  async assignFob(
    @Param('id') id: string,
    @Body() body: { driverId: number | null },
  ) {
    const fobId = Number(id);
    if (!Number.isFinite(fobId)) return { ok: false, error: 'invalid fob id' };

    const driverId =
      body.driverId === null ? null : Number(body.driverId);

    const fob = await this.prisma.rfidFob.update({
      where: { id: fobId },
      data: {
        driverId: driverId === null ? null : driverId,
      },
      include: { driver: true },
    });

    return { ok: true, fob };
  }

  @Patch('rfid-fobs/:id')
  async updateFob(
    @Param('id') id: string,
    @Body() body: { label?: string | null; active?: boolean },
  ) {
    const fobId = Number(id);
    if (!Number.isFinite(fobId)) return { ok: false, error: 'invalid fob id' };

    const fob = await this.prisma.rfidFob.update({
      where: { id: fobId },
      data: {
        ...(body.label !== undefined
          ? { label: body.label ? String(body.label).trim() : null }
          : {}),
        ...(body.active !== undefined ? { active: !!body.active } : {}),
      },
      include: { driver: true },
    });

    return { ok: true, fob };
  }
}

function round4(n: number) {
  return Math.round((n + Number.EPSILON) * 10_000) / 10_000;
}

function toYmd(d: Date) {
  const x = new Date(d);
  const yyyy = x.getFullYear();
  const mm = String(x.getMonth() + 1).padStart(2, '0');
  const dd = String(x.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseRangeDays(range: string) {
  const r = String(range || '').trim().toLowerCase();
  const m = r.match(/^(\d+)\s*d$/);
  const n = m ? Number(m[1]) : 30;
  if (!Number.isFinite(n)) return 30;
  return Math.min(Math.max(n, 1), 365);
}
