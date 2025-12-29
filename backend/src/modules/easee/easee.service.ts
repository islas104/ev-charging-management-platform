import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { EaseeAccessTokenResponse, EaseeCharger } from './easee.types';

@Injectable()
export class EaseeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EaseeService.name);
  private pollTimer: NodeJS.Timeout | null = null;
  private accessToken: string | null = null;
  private tokenExpiresAt: number | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    if (!this.isEnabled()) {
      this.logger.log('Easee adapter disabled.');
      return;
    }

    this.logger.log('Easee adapter enabled.');
    this.startPolling();
  }

  onModuleDestroy() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  private isEnabled() {
    const raw = String(this.config.get<string>('EASEE_ENABLED') ?? 'false').toLowerCase();
    return raw === 'true' || raw === '1';
  }

  private getBaseUrl() {
    return String(this.config.get<string>('EASEE_BASE_URL') ?? 'https://api.easee.cloud').replace(/\/$/, '');
  }

  private getUsername() {
    return String(this.config.get<string>('EASEE_USERNAME') ?? '').trim();
  }

  private getPassword() {
    return String(this.config.get<string>('EASEE_PASSWORD') ?? '').trim();
  }

  private getPollSeconds() {
    const raw = Number(this.config.get<string>('EASEE_POLL_SECONDS') ?? 20);
    return Number.isFinite(raw) && raw >= 10 ? raw : 20;
  }

  private getChargersPath() {
    return String(this.config.get<string>('EASEE_CHARGERS_PATH') ?? '/api/chargers');
  }

  private getStartPathTemplate() {
    return String(this.config.get<string>('EASEE_START_PATH_TEMPLATE') ?? '').trim();
  }

  private getStopPathTemplate() {
    return String(this.config.get<string>('EASEE_STOP_PATH_TEMPLATE') ?? '').trim();
  }

  private getDynamicCurrentPathTemplate() {
    return String(this.config.get<string>('EASEE_DYNAMIC_CURRENT_PATH_TEMPLATE') ?? '').trim();
  }

  private async getToken() {
    const staticToken = String(this.config.get<string>('EASEE_ACCESS_TOKEN') ?? '').trim();
    if (staticToken) return staticToken;

    if (this.accessToken && this.tokenExpiresAt && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    const username = this.getUsername();
    const password = this.getPassword();
    if (!username || !password) {
      throw new Error('Easee credentials not configured');
    }

    const url = `${this.getBaseUrl()}/api/accounts/login`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userName: username, password }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Easee login failed: ${res.status} ${text}`);
    }

    const data = (await res.json()) as EaseeAccessTokenResponse;
    if (!data?.accessToken) {
      throw new Error('Easee login missing accessToken');
    }

    this.accessToken = data.accessToken;
    const ttl = Number(data.expiresIn ?? 3000);
    this.tokenExpiresAt = Date.now() + ttl * 1000 - 30_000;
    return data.accessToken;
  }

  private async request<T>(path: string): Promise<T> {
    const token = await this.getToken();
    const url = `${this.getBaseUrl()}${path}`;
    const res = await fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Easee request failed: ${res.status} ${text}`);
    }

    return (await res.json()) as T;
  }

  private buildPath(template: string, chargerId: string) {
    if (!template) {
      throw new Error('Easee command path template not configured');
    }
    return template.replace('{chargerId}', encodeURIComponent(chargerId));
  }

  private async command<T>(path: string, body: Record<string, unknown>) {
    const token = await this.getToken();
    const url = `${this.getBaseUrl()}${path}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body ?? {}),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Easee command failed: ${res.status} ${text}`);
    }

    return (await res.json()) as T;
  }

  private mapStatus(raw: string | undefined, online: boolean | undefined) {
    const val = String(raw ?? '').toLowerCase();
    if (online === false || val.includes('offline') || val.includes('disconnected')) return 'Unavailable';
    if (val.includes('fault')) return 'Faulted';
    if (val.includes('charging') || val.includes('active')) return 'Charging';
    if (val.includes('occupied')) return 'Occupied';
    return 'Available';
  }

  private resolveChargerId(charger: EaseeCharger) {
    return String(
      charger.chargerId ??
      charger.serialNumber ??
      charger.id ??
      '',
    ).trim();
  }

  private async syncChargers() {
    const chargers = await this.request<EaseeCharger[]>(this.getChargersPath());
    if (!Array.isArray(chargers) || chargers.length === 0) return;

    const now = new Date();
    for (const ch of chargers) {
      const chargerId = this.resolveChargerId(ch);
      if (!chargerId) continue;

      const status = this.mapStatus(ch.status, ch.isOnline);
      await this.prisma.charger.upsert({
        where: { chargerId },
        update: {
          protocol: 'easee',
          lastSeenAt: status === 'Unavailable' ? null : now,
        },
        create: {
          chargerId,
          protocol: 'easee',
          registered: true,
          lastSeenAt: status === 'Unavailable' ? null : now,
        },
      });

      const row = await this.prisma.charger.findUnique({
        where: { chargerId },
        select: { id: true },
      });
      if (!row) continue;

      await this.prisma.connectorStatus.upsert({
        where: {
          chargerId_connectorId: {
            chargerId: row.id,
            connectorId: 1,
          },
        },
        update: {
          status,
          errorCode: status === 'Faulted' ? 'OtherError' : 'NoError',
          info: ch.name ? String(ch.name) : null,
        },
        create: {
          chargerId: row.id,
          connectorId: 1,
          status,
          errorCode: status === 'Faulted' ? 'OtherError' : 'NoError',
          info: ch.name ? String(ch.name) : null,
        },
      });
    }
  }

  async startCharging(chargerId: string) {
    const path = this.buildPath(this.getStartPathTemplate(), chargerId);
    return this.command(path, {});
  }

  async stopCharging(chargerId: string) {
    const path = this.buildPath(this.getStopPathTemplate(), chargerId);
    return this.command(path, {});
  }

  async setDynamicCurrent(chargerId: string, amps: number) {
    const path = this.buildPath(this.getDynamicCurrentPathTemplate(), chargerId);
    return this.command(path, { dynamicCurrent: amps });
  }

  private startPolling() {
    const intervalMs = this.getPollSeconds() * 1000;
    const tick = async () => {
      try {
        await this.syncChargers();
      } catch (err) {
        this.logger.error(String((err as Error)?.message ?? err));
      }
    };
    tick().catch(() => {});
    this.pollTimer = setInterval(tick, intervalMs);
  }
}
