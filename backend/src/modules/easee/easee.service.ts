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

  private getAccountId() {
    const raw = Number(this.config.get<string>('EASEE_ACCOUNT_ID') ?? '');
    return Number.isFinite(raw) ? raw : null;
  }

  private getChargersPath() {
    return String(this.config.get<string>('EASEE_CHARGERS_PATH') ?? '/api/chargers');
  }

  private getSitesPath() {
    return String(this.config.get<string>('EASEE_SITES_PATH') ?? '').trim();
  }

  private getSiteChargersPathTemplate() {
    return String(this.config.get<string>('EASEE_SITE_CHARGERS_PATH_TEMPLATE') ?? '').trim();
  }

  private getSiteDetailPathTemplate() {
    return String(this.config.get<string>('EASEE_SITE_DETAIL_PATH_TEMPLATE') ?? '').trim();
  }

  private getDefaultAddress() {
    return String(this.config.get<string>('EASEE_DEFAULT_LOCATION_ADDRESS') ?? '').trim();
  }

  private getDefaultLatitude() {
    const raw = Number(this.config.get<string>('EASEE_DEFAULT_LOCATION_LATITUDE') ?? '');
    return Number.isFinite(raw) ? raw : null;
  }

  private getDefaultLongitude() {
    const raw = Number(this.config.get<string>('EASEE_DEFAULT_LOCATION_LONGITUDE') ?? '');
    return Number.isFinite(raw) ? raw : null;
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

  private buildSitePath(template: string, siteId: string) {
    if (!template) return '';
    return template.replace('{siteId}', encodeURIComponent(siteId));
  }

  private async fetchChargersBySite(siteId: string) {
    const template = this.getSiteChargersPathTemplate();
    if (!template) return null;
    const path = this.buildSitePath(template, siteId);
    if (!path) return null;
    const chargers = await this.request<EaseeCharger[]>(path);
    if (!Array.isArray(chargers)) return null;
    return chargers.map((c) => ({ ...c, siteId }));
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

  private resolveSiteId(charger: EaseeCharger) {
    return String(
      charger.siteId ??
      (charger as any)?.siteKey ??
      (charger as any)?.siteId ??
      '',
    ).trim();
  }

  private resolveSiteName(site: Record<string, any>) {
    return String(site?.name ?? site?.siteName ?? site?.title ?? '').trim();
  }

  private resolveSiteAddress(site: Record<string, any>) {
    const raw = site?.address;
    if (raw && typeof raw === 'object') {
      const parts = [
        raw?.buildingNumber,
        raw?.street,
        raw?.area,
        raw?.zip,
        raw?.country?.name,
      ].filter(Boolean);
      return String(parts.join(', ')).trim();
    }

    return String(
      raw ??
      site?.street ??
      site?.streetAddress ??
      site?.addressLine ??
      '',
    ).trim();
  }

  private resolveSiteLatitude(site: Record<string, any>) {
    const raw = Number(
      site?.latitude ??
      site?.lat ??
      site?.latitudeDecimal ??
      site?.address?.latitude ??
      '',
    );
    return Number.isFinite(raw) ? raw : null;
  }

  private resolveSiteLongitude(site: Record<string, any>) {
    const raw = Number(
      site?.longitude ??
      site?.lng ??
      site?.longitudeDecimal ??
      site?.address?.longitude ??
      '',
    );
    return Number.isFinite(raw) ? raw : null;
  }

  private async fetchSites() {
    const sitesPath = this.getSitesPath();
    if (!sitesPath) return new Map<string, Record<string, any>>();
    const sites = await this.request<Record<string, any>[]>(sitesPath);
    const siteMap = new Map<string, Record<string, any>>();
    if (!Array.isArray(sites)) return siteMap;
    for (const site of sites) {
      const id = String(site?.id ?? site?.siteId ?? site?.siteKey ?? '').trim();
      if (!id) continue;
      siteMap.set(id, site);
    }
    return siteMap;
  }

  private async fetchSiteDetail(siteId: string) {
    const template = this.getSiteDetailPathTemplate();
    if (!template) return null;
    const path = this.buildSitePath(template, siteId);
    if (!path) return null;
    return this.request<Record<string, any>>(path);
  }

  private async ensureLocation(accountId: number, siteId: string, siteData: Record<string, any>) {
    const name = this.resolveSiteName(siteData) || `Easee Site ${siteId}`;
    let address = this.resolveSiteAddress(siteData);
    let latitude = this.resolveSiteLatitude(siteData);
    let longitude = this.resolveSiteLongitude(siteData);

    if (!address) address = this.getDefaultAddress();
    if (!Number.isFinite(latitude ?? NaN)) latitude = this.getDefaultLatitude();
    if (!Number.isFinite(longitude ?? NaN)) longitude = this.getDefaultLongitude();

    if (!address || latitude === null || longitude === null) {
      this.logger.warn(`Skipping site ${siteId}: missing address/lat/lng`);
      return null;
    }

    const location = await this.prisma.location.upsert({
      where: {
        accountId_externalId: {
          accountId,
          externalId: siteId,
        },
      },
      update: {
        name,
        address,
        latitude,
        longitude,
      },
      create: {
        accountId,
        externalId: siteId,
        name,
        address,
        latitude,
        longitude,
        access: 'PUBLIC',
        visibility: 'LISTED',
      },
    });

    return location;
  }

  private async syncChargers() {
    const accountId = this.getAccountId();
    const siteMap = await this.fetchSites();
    let chargers: EaseeCharger[] = [];
    if (siteMap.size > 0 && this.getSiteChargersPathTemplate()) {
      for (const [siteId] of siteMap.entries()) {
        const siteChargers = await this.fetchChargersBySite(siteId);
        if (siteChargers && siteChargers.length) {
          chargers = chargers.concat(siteChargers);
        }
      }
    } else {
      chargers = await this.request<EaseeCharger[]>(this.getChargersPath());
    }
    if (!Array.isArray(chargers) || chargers.length === 0) return;

    const now = new Date();
    for (const ch of chargers) {
      const chargerId = this.resolveChargerId(ch);
      if (!chargerId) continue;

      const status = this.mapStatus(ch.status, ch.isOnline);
      let locationId: number | null = null;

      if (accountId && Number.isFinite(accountId)) {
        const siteId = this.resolveSiteId(ch);
        if (siteId) {
          let siteData = siteMap.get(siteId) ?? null;
          if (!siteData) {
            siteData = await this.fetchSiteDetail(siteId);
            if (siteData) siteMap.set(siteId, siteData);
          }
          if (siteData) {
            const location = await this.ensureLocation(accountId, siteId, siteData);
            locationId = location?.id ?? null;
          }
        }
      }

      await this.prisma.charger.upsert({
        where: { chargerId },
        update: {
          protocol: 'easee',
          lastSeenAt: status === 'Unavailable' ? null : now,
          ...(locationId ? { locationId } : {}),
        },
        create: {
          chargerId,
          protocol: 'easee',
          registered: true,
          lastSeenAt: status === 'Unavailable' ? null : now,
          ...(locationId ? { locationId } : {}),
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
