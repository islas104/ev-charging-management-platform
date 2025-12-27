import { Body, Controller, Get, Param, Put, Query, Post, Patch, UseGuards, Req, ConflictException, ForbiddenException } from '@nestjs/common';
import { AdminRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthService } from '../auth/auth.service';
import { CreateAdminUserDto } from '../auth/dto/auth.dto';
import type { Request } from 'express';
import { checkIdempotency, storeIdempotency } from '../../common/utils/idempotency';
import {
  AssignFobDto,
  CreateDriverDto,
  CreateFobDto,
  UpdateFobDto,
  UpdatePricingDto,
} from './dto/admin.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  private getIdempotencyKey(req: Request) {
    const header = req.headers['idempotency-key'];
    if (Array.isArray(header)) return header[0]?.trim() ?? '';
    return String(header ?? '').trim();
  }

  private getIdempotencyOwner(req: Request) {
    const user = (req as any).user;
    return `admin:${user?.id ?? 'unknown'}`;
  }

  private getIdempotencyTtlHours() {
    const raw = Number(process.env.IDEMPOTENCY_TTL_HOURS ?? 24);
    return Number.isFinite(raw) && raw > 0 ? raw : 24;
  }

  private async checkIdempotency<T>(
    req: Request,
    scope: string,
    requestBody: unknown,
  ) {
    const key = this.getIdempotencyKey(req);
    if (!key) return { hit: false as const, requestHash: '' };

    return checkIdempotency<T>(this.prisma, {
      key,
      scope,
      ownerKey: this.getIdempotencyOwner(req),
      requestBody,
      ttlHours: this.getIdempotencyTtlHours(),
    });
  }

  private handleIdempotencyResult<T>(result: { hit: boolean; statusCode?: number; response?: T }) {
    if (!result.hit) return null;
    if (result.statusCode === 409) {
      throw new ConflictException(
        (result.response as any)?.error ?? 'Idempotency key conflict',
      );
    }
    return result.response ?? null;
  }

  private async storeIdempotency(
    req: Request,
    scope: string,
    requestBody: unknown,
    response: unknown,
    statusCode = 200,
  ) {
    const key = this.getIdempotencyKey(req);
    if (!key) return;

    await storeIdempotency(this.prisma, {
      key,
      scope,
      ownerKey: this.getIdempotencyOwner(req),
      requestBody,
      ttlHours: this.getIdempotencyTtlHours(),
    }, statusCode, response);
  }

  private async getAccountScope(req: Request) {
    const cached = (req as any)._accountScope;
    if (cached) return cached as {
      accountIds: number[] | null;
      accountId: number | null;
      role: string;
      accountType: string | null;
    };

    const user = (req as any).user;
    const role = String(user?.role ?? '').toUpperCase();
    if (role === 'SUPER_ADMIN') {
      const scope = { accountIds: null, accountId: null, role, accountType: null };
      (req as any)._accountScope = scope;
      return scope;
    }

    const accountId = Number(user?.accountId);
    if (!Number.isFinite(accountId)) throw new ForbiddenException('Account not assigned');

    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true, type: true },
    });
    if (!account) throw new ForbiddenException('Account not found');

    let accountIds = [accountId];
    if (account.type === 'OPERATOR') {
      const linked = await this.prisma.connectedAccount.findMany({
        where: { operatorAccountId: accountId },
        select: { ownerAccountId: true },
      });
      accountIds = Array.from(
        new Set([accountId, ...linked.map((c) => c.ownerAccountId)]),
      );
    }

    const scope = {
      accountIds,
      accountId,
      role,
      accountType: account.type,
    };
    (req as any)._accountScope = scope;
    return scope;
  }

  private async logAction(
    req: Request,
    action: string,
    entity?: string,
    entityId?: string,
    payload?: unknown,
  ) {
    const user = (req as any).user;
    const adminUserId = user?.id ?? null;
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
      req.socket?.remoteAddress ??
      null;

    await this.prisma.adminAuditLog.create({
      data: {
        adminUserId,
        action,
        entity: entity ?? null,
        entityId: entityId ?? null,
        ipAddress: ip,
        payload: payload ? (payload as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });
  }

  // quick probe route to confirm AdminController is mounted
  @Get('ping')
  ping() {
    return { ok: true, scope: 'admin', at: new Date().toISOString() };
  }

  @Get('chargers')
  async getChargers(@Req() req: Request) {
    const scope = await this.getAccountScope(req);
    const where = scope.accountIds
      ? { location: { accountId: { in: scope.accountIds } } }
      : {};

    return this.prisma.charger.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get('transactions')
  async getTransactions(@Req() req: Request) {
    const scope = await this.getAccountScope(req);
    const where = scope.accountIds
      ? { charger: { location: { accountId: { in: scope.accountIds } } } }
      : {};

    const transactions = await this.prisma.transaction.findMany({
      where,
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

  // ===== Admin users (super admin only) =====

  @Get('users')
  @Roles('SUPER_ADMIN')
  async listAdminUsers() {
    return this.prisma.adminUser.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, role: true, createdAt: true },
    });
  }

  @Post('users')
  @Roles('SUPER_ADMIN')
  async createAdminUser(@Body() body: CreateAdminUserDto, @Req() req: Request) {
    const idem = await this.checkIdempotency(req, 'admin.users.create', body);
    const cached = this.handleIdempotencyResult(idem);
    if (cached) return cached;

    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    const roleRaw = String(body.role ?? 'ADMIN').toUpperCase();
    const role = roleRaw === 'SUPER_ADMIN' ? AdminRole.SUPER_ADMIN : AdminRole.ADMIN;
    const accountIdNum = body.accountId === undefined ? null : Number(body.accountId);

    if (!email || !password) {
      return { ok: false, error: 'email and password are required' };
    }
    if (role === AdminRole.ADMIN && !Number.isFinite(accountIdNum)) {
      return { ok: false, error: 'accountId is required for ADMIN' };
    }

    let accountId: number | null = null;
    if (typeof accountIdNum === 'number' && Number.isFinite(accountIdNum)) {
      const account = await this.prisma.account.findUnique({
        where: { id: accountIdNum },
        select: { id: true },
      });
      if (!account) return { ok: false, error: 'accountId not found' };
      accountId = accountIdNum;
    }

    const res = await this.auth.createAdminUser(email, password, role, accountId);
    if (res?.ok && res.user?.id) {
      await this.logAction(req, 'admin.create', 'AdminUser', String(res.user.id), {
        email,
        role,
        accountId,
      });
    }

    await this.storeIdempotency(req, 'admin.users.create', body, res);
    return res;
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
    body: UpdatePricingDto,
    @Req() req: Request,
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

    const result = {
      id: updated.id,
      currency: updated.currency,
      baseEnergyGbpKwh: base,
      platformMarkup: markup,
      driverEnergyGbpKwhExVat,
      platformFeeGbpKwhExVat,
      updatedAt: updated.updatedAt,
      createdAt: updated.createdAt,
    };
    await this.logAction(req, 'pricing.update', 'PricingConfig', String(updated.id), result);
    return result;
  }

  /**
   * Dashboard card counts:
   * - Online: lastSeenAt within onlineWindowSeconds (default 120s)
   */
  @Get('overview')
  async getOverview(
    @Query('onlineWindowSeconds') onlineWindowSeconds: string | undefined,
    @Req() req: Request,
  ) {
    const scope = await this.getAccountScope(req);
    const windowSeconds = Number(onlineWindowSeconds ?? 120);
    const cutoff = new Date(Date.now() - windowSeconds * 1000);

    const chargerWhere = scope.accountIds
      ? { location: { accountId: { in: scope.accountIds } } }
      : {};
    const onlineWhere = scope.accountIds
      ? { lastSeenAt: { gte: cutoff }, location: { accountId: { in: scope.accountIds } } }
      : { lastSeenAt: { gte: cutoff } };
    const locationWhere = scope.accountIds
      ? { accountId: { in: scope.accountIds } }
      : {};

    const [totalChargers, onlineChargers, chargeLocations] = await Promise.all([
      this.prisma.charger.count({ where: chargerWhere }),
      this.prisma.charger.count({ where: onlineWhere }),
      this.prisma.location.count({ where: locationWhere }),
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
  async getChargersView(
    @Query('onlineWindowSeconds') onlineWindowSeconds: string | undefined,
    @Req() req: Request,
  ) {
    const scope = await this.getAccountScope(req);
    const windowSeconds = Number(onlineWindowSeconds ?? 120);
    const cutoff = new Date(Date.now() - windowSeconds * 1000);

    const chargers = await this.prisma.charger.findMany({
      where: scope.accountIds
        ? { location: { accountId: { in: scope.accountIds } } }
        : {},
      include: {
        location: true,
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
        location: c.location?.name ?? null,

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
    @Req() req: Request,
    @Query('range') range?: string,
    @Query('meterUnit') meterUnit?: string,
  ) {
    const scope = await this.getAccountScope(req);
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
        ...(scope.accountIds
          ? { charger: { location: { accountId: { in: scope.accountIds } } } }
          : {}),
      },
      select: {
        meterStart: true,
        meterStop: true,
        startedAt: true,
        charger: {
          select: {
            chargerId: true,
            location: { select: { name: true } },
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

      const loc = t.charger?.location?.name ?? 'Unknown';
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
    @Req() req: Request,
    @Query('range') range?: string,
    @Query('meterUnit') meterUnit?: string,
  ) {
    const scope = await this.getAccountScope(req);
    const days = parseRangeDays(range ?? '30d');
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const unit = (meterUnit ?? 'wh').trim().toLowerCase() === 'kwh' ? 'kwh' : 'wh';
    const divisor = unit === 'kwh' ? 1 : 1000;

    const totalInRange = await this.prisma.transaction.count({
      where: {
        startedAt: { gte: since },
        ...(scope.accountIds
          ? { charger: { location: { accountId: { in: scope.accountIds } } } }
          : {}),
      },
    });

    const withMeterStop = await this.prisma.transaction.count({
      where: {
        startedAt: { gte: since },
        meterStop: { not: null },
        ...(scope.accountIds
          ? { charger: { location: { accountId: { in: scope.accountIds } } } }
          : {}),
      },
    });

    const sample = await this.prisma.transaction.findMany({
      where: {
        startedAt: { gte: since },
        ...(scope.accountIds
          ? { charger: { location: { accountId: { in: scope.accountIds } } } }
          : {}),
      },
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
    @Req() req: Request,
    @Query('range') range?: string,
    @Query('meterUnit') meterUnit?: string,
  ) {
    const scope = await this.getAccountScope(req);
    const days = parseRangeDays(range ?? '30d');
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const unit = (meterUnit ?? 'wh').trim().toLowerCase() === 'kwh' ? 'kwh' : 'wh';
    const divisor = unit === 'kwh' ? 1 : 1000;

    const txs = await this.prisma.transaction.findMany({
      where: {
        startedAt: { gte: since },
        meterStop: { not: null },
        ...(scope.accountIds
          ? { charger: { location: { accountId: { in: scope.accountIds } } } }
          : {}),
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
  async getOcppOperations(@Req() req: Request) {
    const scope = await this.getAccountScope(req);
    const rows = await this.prisma.ocppMessageLog.findMany({
      where: scope.accountIds
        ? { charger: { location: { accountId: { in: scope.accountIds } } } }
        : {},
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
    @Req() req: Request,
    @Param('chargerId') chargerId: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
    @Query('operation') operation?: string,
  ) {
    const scope = await this.getAccountScope(req);
    const charger = await this.prisma.charger.findUnique({
      where: { chargerId },
      select: { id: true, chargerId: true, locationId: true, location: { select: { accountId: true } } },
    });

    if (!charger) return { total: 0, items: [] };
    if (scope.accountIds && (!charger.location?.accountId || !scope.accountIds.includes(charger.location.accountId))) {
      return { total: 0, items: [] };
    }

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

  /**
   * Remote command status (for QR start/stop visibility)
   */
  @Get('remote-commands')
  async listRemoteCommands(@Req() req: Request, @Query('chargerId') chargerId?: string) {
    const scope = await this.getAccountScope(req);
    const where = chargerId
      ? {
          charger: {
            chargerId: String(chargerId),
            ...(scope.accountIds ? { location: { accountId: { in: scope.accountIds } } } : {}),
          },
        }
      : scope.accountIds
      ? { charger: { location: { accountId: { in: scope.accountIds } } } }
      : {};

    return this.prisma.remoteCommand.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { charger: { select: { chargerId: true } } },
    });
  }

  // ===== Drivers + RFID fobs (admin) =====

  @Get('drivers')
  async listDrivers(@Req() req: Request) {
    const scope = await this.getAccountScope(req);
    return this.prisma.driver.findMany({
      where: scope.accountIds ? { accountId: { in: scope.accountIds } } : {},
      orderBy: { createdAt: 'desc' },
      include: { fobs: true },
    });
  }

  @Post('drivers')
  async createDriver(@Body() body: CreateDriverDto, @Req() req: Request) {
    const idem = await this.checkIdempotency(req, 'admin.drivers.create', body);
    const cached = this.handleIdempotencyResult(idem);
    if (cached) return cached;

    const scope = await this.getAccountScope(req);
    const name = String(body.name ?? '').trim();
    if (!name) return { ok: false, error: 'name is required' };

    const email = body.email ? String(body.email).trim() : null;
    let accountId: number | null = scope.accountId ?? null;
    if (body.accountId !== undefined) {
      const accountIdNum = Number(body.accountId);
      if (!Number.isFinite(accountIdNum)) return { ok: false, error: 'accountId is invalid' };
      if (scope.accountIds && !scope.accountIds.includes(accountIdNum)) {
        return { ok: false, error: 'accountId not in scope' };
      }
      accountId = accountIdNum;
    }

    const driver = await this.prisma.driver.create({
      data: {
        name,
        email: email || null,
        ...(accountId ? { accountId } : {}),
      },
    });

    await this.logAction(req, 'driver.create', 'Driver', String(driver.id), { name, email });
    const res = { ok: true, driver };
    await this.storeIdempotency(req, 'admin.drivers.create', body, res);
    return res;
  }

  @Get('rfid-fobs')
  async listFobs(@Req() req: Request, @Query('active') active?: string) {
    const scope = await this.getAccountScope(req);
    const activeFilter =
      active === undefined ? undefined : String(active).toLowerCase() === 'true';

    return this.prisma.rfidFob.findMany({
      where: {
        ...(activeFilter === undefined ? {} : { active: activeFilter }),
        ...(scope.accountIds ? { driver: { accountId: { in: scope.accountIds } } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: { driver: true },
    });
  }

  @Post('rfid-fobs')
  async createFob(@Body() body: CreateFobDto, @Req() req: Request) {
    const idem = await this.checkIdempotency(req, 'admin.fobs.create', body);
    const cached = this.handleIdempotencyResult(idem);
    if (cached) return cached;

    const scope = await this.getAccountScope(req);
    const uid = String(body.uid ?? '').trim();
    if (!uid) return { ok: false, error: 'uid is required' };

    const label = body.label ? String(body.label).trim() : null;
    const driverId =
      body.driverId === undefined ? undefined : Number(body.driverId);

    if (!Number.isFinite(driverId)) {
      if (scope.accountIds) {
        return { ok: false, error: 'driverId is required for this account' };
      }
    } else {
      const driver = await this.prisma.driver.findUnique({
        where: { id: driverId },
        select: { id: true, accountId: true },
      });
      if (!driver) return { ok: false, error: 'driverId not found' };
      if (scope.accountIds && (!driver.accountId || !scope.accountIds.includes(driver.accountId))) {
        return { ok: false, error: 'driverId not in account scope' };
      }
    }

    const fob = await this.prisma.rfidFob.create({
      data: {
        uid,
        label,
        ...(driverId ? { driver: { connect: { id: driverId } } } : {}),
      },
      include: { driver: true },
    });

    await this.logAction(req, 'rfid.create', 'RfidFob', String(fob.id), { uid, label, driverId });
    const res = { ok: true, fob };
    await this.storeIdempotency(req, 'admin.fobs.create', body, res);
    return res;
  }

  @Put('rfid-fobs/:id/assign')
  async assignFob(
    @Param('id') id: string,
    @Body() body: AssignFobDto,
    @Req() req: Request,
  ) {
    const scope = await this.getAccountScope(req);
    const fobId = Number(id);
    if (!Number.isFinite(fobId)) return { ok: false, error: 'invalid fob id' };

    const driverIdValue =
      body.driverId === null
        ? null
        : body.driverId === undefined
        ? undefined
        : Number(body.driverId);

    if (scope.accountIds) {
      const fob = await this.prisma.rfidFob.findUnique({
        where: { id: fobId },
        include: { driver: { select: { accountId: true } } },
      });
      const accountId = fob?.driver?.accountId ?? null;
      if (!accountId || !scope.accountIds.includes(accountId)) {
        return { ok: false, error: 'fob not in account scope' };
      }
    }

    if (driverIdValue !== undefined && driverIdValue !== null) {
      const driver = await this.prisma.driver.findUnique({
        where: { id: driverIdValue },
        select: { id: true, accountId: true },
      });
      if (!driver) return { ok: false, error: 'driverId not found' };
      if (scope.accountIds && (!driver.accountId || !scope.accountIds.includes(driver.accountId))) {
        return { ok: false, error: 'driverId not in account scope' };
      }
    }

    const fob = await this.prisma.rfidFob.update({
      where: { id: fobId },
      data: {
        driverId: driverIdValue === null ? null : driverIdValue,
      },
      include: { driver: true },
    });

    await this.logAction(req, 'rfid.assign', 'RfidFob', String(fob.id), { driverId: driverIdValue });
    return { ok: true, fob };
  }

  @Patch('rfid-fobs/:id')
  async updateFob(
    @Param('id') id: string,
    @Body() body: UpdateFobDto,
    @Req() req: Request,
  ) {
    const scope = await this.getAccountScope(req);
    const fobId = Number(id);
    if (!Number.isFinite(fobId)) return { ok: false, error: 'invalid fob id' };

    if (scope.accountIds) {
      const fob = await this.prisma.rfidFob.findUnique({
        where: { id: fobId },
        include: { driver: { select: { accountId: true } } },
      });
      const accountId = fob?.driver?.accountId ?? null;
      if (!accountId || !scope.accountIds.includes(accountId)) {
        return { ok: false, error: 'fob not in account scope' };
      }
    }

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

    await this.logAction(req, 'rfid.update', 'RfidFob', String(fob.id), body);
    return { ok: true, fob };
  }

  // ===== Accounts / Locations / Tariffs / QR =====

  @Get('accounts')
  @Roles('SUPER_ADMIN')
  async listAccounts() {
    return this.prisma.account.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post('accounts')
  @Roles('SUPER_ADMIN')
  async createAccount(
    @Body() body: { name: string; type?: string; email?: string },
    @Req() req: Request,
  ) {
    const idem = await this.checkIdempotency(req, 'admin.accounts.create', body);
    const cached = this.handleIdempotencyResult(idem);
    if (cached) return cached;

    const name = String(body.name ?? '').trim();
    if (!name) return { ok: false, error: 'name is required' };

    const type = String(body.type ?? 'OWNER').toUpperCase();
    const email = body.email ? String(body.email).trim() : null;

    const account = await this.prisma.account.create({
      data: {
        name,
        type: type === 'OPERATOR' ? 'OPERATOR' : 'OWNER',
        email,
      },
    });

    await this.logAction(req, 'account.create', 'Account', String(account.id), { name, type, email });
    const res = { ok: true, account };
    await this.storeIdempotency(req, 'admin.accounts.create', body, res);
    return res;
  }

  @Get('connected-accounts')
  @Roles('SUPER_ADMIN')
  async listConnectedAccounts() {
    return this.prisma.connectedAccount.findMany({
      orderBy: { createdAt: 'desc' },
      include: { operatorAccount: true, ownerAccount: true },
    });
  }

  @Post('connected-accounts')
  @Roles('SUPER_ADMIN')
  async createConnectedAccount(
    @Body() body: { operatorAccountId: number; ownerAccountId: number; serviceFeePercent?: number },
    @Req() req: Request,
  ) {
    const idem = await this.checkIdempotency(req, 'admin.connected-accounts.create', body);
    const cached = this.handleIdempotencyResult(idem);
    if (cached) return cached;

    const operatorAccountId = Number(body.operatorAccountId);
    const ownerAccountId = Number(body.ownerAccountId);
    const serviceFeePercent = Number(body.serviceFeePercent ?? 0);

    if (!Number.isFinite(operatorAccountId) || !Number.isFinite(ownerAccountId)) {
      return { ok: false, error: 'operatorAccountId and ownerAccountId are required' };
    }

    const [operatorAccount, ownerAccount] = await Promise.all([
      this.prisma.account.findUnique({ where: { id: operatorAccountId }, select: { id: true } }),
      this.prisma.account.findUnique({ where: { id: ownerAccountId }, select: { id: true } }),
    ]);
    if (!operatorAccount || !ownerAccount) {
      return { ok: false, error: 'operatorAccountId or ownerAccountId not found' };
    }

    const created = await this.prisma.connectedAccount.create({
      data: {
        operatorAccountId,
        ownerAccountId,
        serviceFeePercent: new Prisma.Decimal(serviceFeePercent),
      },
    });

    await this.logAction(req, 'connected-account.create', 'ConnectedAccount', String(created.id), body);
    const res = { ok: true, connectedAccount: created };
    await this.storeIdempotency(req, 'admin.connected-accounts.create', body, res);
    return res;
  }

  @Get('locations')
  async listLocations(@Req() req: Request) {
    const scope = await this.getAccountScope(req);
    return this.prisma.location.findMany({
      where: scope.accountIds ? { accountId: { in: scope.accountIds } } : {},
      orderBy: { createdAt: 'desc' },
      include: { account: true, tariff: true },
    });
  }

  @Post('locations')
  async createLocation(
    @Body()
    body: {
      accountId: number;
      name: string;
      address: string;
      latitude: number;
      longitude: number;
      access?: string;
      visibility?: string;
      tariffId?: number;
    },
    @Req() req: Request,
  ) {
    const idem = await this.checkIdempotency(req, 'admin.locations.create', body);
    const cached = this.handleIdempotencyResult(idem);
    if (cached) return cached;

    const scope = await this.getAccountScope(req);
    const accountId = Number(body.accountId);
    if (!Number.isFinite(accountId)) return { ok: false, error: 'accountId is required' };
    if (scope.accountIds && !scope.accountIds.includes(accountId)) {
      return { ok: false, error: 'accountId not in scope' };
    }
    const accountExists = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true },
    });
    if (!accountExists) return { ok: false, error: 'accountId not found' };

    const name = String(body.name ?? '').trim();
    const address = String(body.address ?? '').trim();
    if (!name || !address) return { ok: false, error: 'name and address are required' };

    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return { ok: false, error: 'latitude and longitude are required' };
    }

    const access = String(body.access ?? 'PUBLIC').toUpperCase();
    const visibility = String(body.visibility ?? 'LISTED').toUpperCase();

    let tariffId: number | null = null;
    if (body.tariffId !== undefined && body.tariffId !== null) {
      const tariffIdNum = Number(body.tariffId);
      if (Number.isFinite(tariffIdNum) && tariffIdNum > 0) {
        const tariff = await this.prisma.tariff.findUnique({
          where: { id: tariffIdNum },
          select: { id: true },
        });
        if (!tariff) {
          return { ok: false, error: 'tariffId not found' };
        }
        tariffId = tariffIdNum;
      }
    }

    const location = await this.prisma.location.create({
      data: {
        accountId,
        name,
        address,
        latitude: new Prisma.Decimal(latitude),
        longitude: new Prisma.Decimal(longitude),
        access: access === 'PRIVATE' ? 'PRIVATE' : access === 'RESTRICTED' ? 'RESTRICTED' : 'PUBLIC',
        visibility: visibility === 'UNLISTED' ? 'UNLISTED' : 'LISTED',
        tariffId,
      },
    });

    await this.logAction(req, 'location.create', 'Location', String(location.id), body);
    const res = { ok: true, location };
    await this.storeIdempotency(req, 'admin.locations.create', body, res);
    return res;
  }

  @Put('locations/:id')
  async updateLocation(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      address?: string;
      latitude?: number;
      longitude?: number;
      access?: string;
      visibility?: string;
      tariffId?: number | null;
    },
    @Req() req: Request,
  ) {
    const locationId = Number(id);
    if (!Number.isFinite(locationId)) return { ok: false, error: 'invalid location id' };

    const scope = await this.getAccountScope(req);
    if (scope.accountIds) {
      const location = await this.prisma.location.findUnique({
        where: { id: locationId },
        select: { accountId: true },
      });
      if (!location || !scope.accountIds.includes(location.accountId)) {
        return { ok: false, error: 'location not in account scope' };
      }
    }

    const access = body.access ? String(body.access).toUpperCase() : undefined;
    const visibility = body.visibility ? String(body.visibility).toUpperCase() : undefined;

    if (body.tariffId !== undefined && body.tariffId !== null) {
      const tariffId = Number(body.tariffId);
      if (!Number.isFinite(tariffId)) return { ok: false, error: 'invalid tariffId' };
      const tariff = await this.prisma.tariff.findUnique({
        where: { id: tariffId },
        select: { id: true },
      });
      if (!tariff) return { ok: false, error: 'tariffId not found' };
    }

    const location = await this.prisma.location.update({
      where: { id: locationId },
      data: {
        ...(body.name ? { name: String(body.name).trim() } : {}),
        ...(body.address ? { address: String(body.address).trim() } : {}),
        ...(body.latitude !== undefined ? { latitude: new Prisma.Decimal(Number(body.latitude)) } : {}),
        ...(body.longitude !== undefined ? { longitude: new Prisma.Decimal(Number(body.longitude)) } : {}),
        ...(access ? { access: access === 'PRIVATE' ? 'PRIVATE' : access === 'RESTRICTED' ? 'RESTRICTED' : 'PUBLIC' } : {}),
        ...(visibility ? { visibility: visibility === 'UNLISTED' ? 'UNLISTED' : 'LISTED' } : {}),
        ...(body.tariffId !== undefined ? { tariffId: body.tariffId === null ? null : Number(body.tariffId) } : {}),
      },
    });

    await this.logAction(req, 'location.update', 'Location', String(location.id), body);
    return { ok: true, location };
  }

  @Post('chargers/:chargerId/assign-location')
  async assignChargerLocation(
    @Param('chargerId') chargerId: string,
    @Body() body: { locationId: number | null },
    @Req() req: Request,
  ) {
    const scope = await this.getAccountScope(req);
    const locationId = body.locationId === null ? null : Number(body.locationId);
    if (locationId !== null && Number.isFinite(locationId)) {
      const location = await this.prisma.location.findUnique({
        where: { id: locationId },
        select: { id: true },
      });
      if (!location) return { ok: false, error: 'locationId not found' };
    }

    if (scope.accountIds) {
      const charger = await this.prisma.charger.findUnique({
        where: { chargerId },
        select: { id: true, location: { select: { accountId: true } } },
      });
      if (!charger) return { ok: false, error: 'charger not found' };
      const currentAccountId = charger.location?.accountId ?? null;
      if (currentAccountId && !scope.accountIds.includes(currentAccountId)) {
        return { ok: false, error: 'charger not in account scope' };
      }
      if (locationId !== null) {
        const targetLocation = await this.prisma.location.findUnique({
          where: { id: locationId },
          select: { accountId: true },
        });
        if (!targetLocation || !scope.accountIds.includes(targetLocation.accountId)) {
          return { ok: false, error: 'locationId not in account scope' };
        }
      }
    }

    const updated = await this.prisma.charger.update({
      where: { chargerId },
      data: { locationId },
    });
    await this.logAction(req, 'charger.assign-location', 'Charger', String(updated.id), body);
    return { ok: true, charger: updated };
  }

  @Get('tariffs')
  async listTariffs(@Req() req: Request) {
    const scope = await this.getAccountScope(req);
    return this.prisma.tariff.findMany({
      where: scope.accountIds ? { accountId: { in: scope.accountIds } } : {},
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post('tariffs')
  async createTariff(
    @Body()
    body: {
      accountId?: number;
      name: string;
      startFee: number;
      energyFee: number;
      idleFee: number;
      vatRate?: number;
      currency?: string;
    },
    @Req() req: Request,
  ) {
    const idem = await this.checkIdempotency(req, 'admin.tariffs.create', body);
    const cached = this.handleIdempotencyResult(idem);
    if (cached) return cached;

    const scope = await this.getAccountScope(req);
    const name = String(body.name ?? '').trim();
    if (!name) return { ok: false, error: 'name is required' };

    const startFee = Number(body.startFee);
    const energyFee = Number(body.energyFee);
    const idleFee = Number(body.idleFee);
    if (![startFee, energyFee, idleFee].every(Number.isFinite)) {
      return { ok: false, error: 'startFee, energyFee, idleFee are required' };
    }

    if ([startFee, energyFee, idleFee].some((v) => v < 0)) {
      return { ok: false, error: 'startFee, energyFee, idleFee must be >= 0' };
    }

    const vatRate = Number(body.vatRate ?? 0);
    const currency = String(body.currency ?? 'GBP').toUpperCase();

    let accountId: number | null = null;
    if (scope.accountIds) {
      if (body.accountId !== undefined) {
        const accountIdNum = Number(body.accountId);
        if (!Number.isFinite(accountIdNum)) return { ok: false, error: 'accountId is invalid' };
        if (!scope.accountIds.includes(accountIdNum)) {
          return { ok: false, error: 'accountId not in scope' };
        }
        accountId = accountIdNum;
      } else {
        accountId = scope.accountId ?? null;
      }
    } else if (body.accountId !== undefined) {
      const accountIdNum = Number(body.accountId);
      if (!Number.isFinite(accountIdNum)) return { ok: false, error: 'accountId is invalid' };
      accountId = accountIdNum;
    }

    if (!accountId && scope.role !== 'SUPER_ADMIN') {
      return { ok: false, error: 'accountId is required' };
    }
    if (accountId) {
      const account = await this.prisma.account.findUnique({
        where: { id: accountId },
        select: { id: true },
      });
      if (!account) return { ok: false, error: 'accountId not found' };
    }

    const tariff = await this.prisma.tariff.create({
      data: {
        accountId,
        name,
        startFee: new Prisma.Decimal(startFee),
        energyFee: new Prisma.Decimal(energyFee),
        idleFee: new Prisma.Decimal(idleFee),
        vatRate: new Prisma.Decimal(vatRate),
        currency,
      },
    });

    await this.logAction(req, 'tariff.create', 'Tariff', String(tariff.id), body);
    const res = { ok: true, tariff };
    await this.storeIdempotency(req, 'admin.tariffs.create', body, res);
    return res;
  }

  @Get('qr-codes')
  async listQrCodes(@Req() req: Request) {
    const scope = await this.getAccountScope(req);
    return this.prisma.qrCode.findMany({
      where: scope.accountIds
        ? { location: { accountId: { in: scope.accountIds } } }
        : {},
      orderBy: { createdAt: 'desc' },
      include: { location: true, charger: true },
    });
  }

  @Post('qr-codes')
  async createQrCode(
    @Body() body: { code: string; locationId: number; chargerId?: number; connectorId?: number },
    @Req() req: Request,
  ) {
    const idem = await this.checkIdempotency(req, 'admin.qr.create', body);
    const cached = this.handleIdempotencyResult(idem);
    if (cached) return cached;

    const scope = await this.getAccountScope(req);
    const code = String(body.code ?? '').trim();
    const locationId = Number(body.locationId);
    if (!code || !Number.isFinite(locationId)) {
      return { ok: false, error: 'code and locationId are required' };
    }

    const location = await this.prisma.location.findUnique({
      where: { id: locationId },
      select: { id: true, accountId: true },
    });
    if (!location) return { ok: false, error: 'locationId not found' };
    if (scope.accountIds && !scope.accountIds.includes(location.accountId)) {
      return { ok: false, error: 'locationId not in account scope' };
    }

    let chargerId: number | null = null;
    if (body.chargerId !== undefined && body.chargerId !== null) {
      const chargerIdNum = Number(body.chargerId);
      if (Number.isFinite(chargerIdNum) && chargerIdNum > 0) {
        const charger = await this.prisma.charger.findUnique({
          where: { id: chargerIdNum },
          select: { id: true, location: { select: { accountId: true } } },
        });
        if (!charger) return { ok: false, error: 'chargerId not found' };
        if (
          scope.accountIds &&
          charger.location?.accountId &&
          !scope.accountIds.includes(charger.location.accountId)
        ) {
          return { ok: false, error: 'chargerId not in account scope' };
        }
        chargerId = chargerIdNum;
      }
    }

    const qr = await this.prisma.qrCode.create({
      data: {
        code,
        locationId,
        chargerId,
        connectorId: body.connectorId ? Number(body.connectorId) : null,
      },
    });

    await this.logAction(req, 'qr.create', 'QrCode', String(qr.id), body);
    const res = { ok: true, qr };
    await this.storeIdempotency(req, 'admin.qr.create', body, res);
    return res;
  }

  @Get('driver-groups')
  async listDriverGroups(@Req() req: Request) {
    const scope = await this.getAccountScope(req);
    return this.prisma.driverGroup.findMany({
      where: scope.accountIds ? { accountId: { in: scope.accountIds } } : {},
      orderBy: { createdAt: 'desc' },
      include: { members: true },
    });
  }

  @Post('driver-groups')
  async createDriverGroup(@Body() body: { accountId: number; name: string; description?: string }, @Req() req: Request) {
    const idem = await this.checkIdempotency(req, 'admin.driver-groups.create', body);
    const cached = this.handleIdempotencyResult(idem);
    if (cached) return cached;

    const scope = await this.getAccountScope(req);
    const accountId = Number(body.accountId);
    const name = String(body.name ?? '').trim();
    if (!Number.isFinite(accountId) || !name) {
      return { ok: false, error: 'accountId and name are required' };
    }
    if (scope.accountIds && !scope.accountIds.includes(accountId)) {
      return { ok: false, error: 'accountId not in scope' };
    }

    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true },
    });
    if (!account) return { ok: false, error: 'accountId not found' };

    const group = await this.prisma.driverGroup.create({
      data: {
        accountId,
        name,
        description: body.description ? String(body.description).trim() : null,
      },
    });

    await this.logAction(req, 'driver-group.create', 'DriverGroup', String(group.id), body);
    const res = { ok: true, group };
    await this.storeIdempotency(req, 'admin.driver-groups.create', body, res);
    return res;
  }

  @Post('driver-groups/:id/members')
  async addDriverGroupMember(
    @Param('id') id: string,
    @Body() body: { driverId: number },
    @Req() req: Request,
  ) {
    const scope = await this.getAccountScope(req);
    const driverGroupId = Number(id);
    const driverId = Number(body.driverId);
    if (!Number.isFinite(driverGroupId) || !Number.isFinite(driverId)) {
      return { ok: false, error: 'driverGroupId and driverId are required' };
    }

    const [group, driver] = await Promise.all([
      this.prisma.driverGroup.findUnique({ where: { id: driverGroupId }, select: { id: true, accountId: true } }),
      this.prisma.driver.findUnique({ where: { id: driverId }, select: { id: true, accountId: true } }),
    ]);
    if (!group || !driver) {
      return { ok: false, error: 'driverGroupId or driverId not found' };
    }
    if (scope.accountIds) {
      if (!scope.accountIds.includes(group.accountId)) {
        return { ok: false, error: 'driverGroupId not in scope' };
      }
      if (!driver.accountId || !scope.accountIds.includes(driver.accountId)) {
        return { ok: false, error: 'driverId not in scope' };
      }
    }

    const member = await this.prisma.driverGroupMember.create({
      data: { driverGroupId, driverId },
    });

    await this.logAction(req, 'driver-group.member.add', 'DriverGroupMember', String(member.id), {
      driverGroupId,
      driverId,
    });
    return { ok: true, member };
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
