import { Body, Controller, Get, Param, Post, Req, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OcppConnectionRegistry } from '../ocpp/ocpp.registry';
import { OcppMessageType } from '../ocpp/types/ocpp-message';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { checkIdempotency, storeIdempotency } from '../../common/utils/idempotency';
import type { Request } from 'express';

@Controller('public')
export class PublicController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: OcppConnectionRegistry,
  ) {}

  private getIdempotencyKey(req: Request) {
    const header = req.headers['idempotency-key'];
    if (Array.isArray(header)) return header[0]?.trim() ?? '';
    return String(header ?? '').trim();
  }

  private getIdempotencyOwner(req: Request) {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
      req.socket?.remoteAddress ??
      'unknown';
    return `public:${ip}`;
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

  private handleIdempotencyResult<T>(result: { hit: boolean; statusCode?: number; response?: T }) {
    if (!result.hit) return null;
    if (result.statusCode === 409) {
      throw new ConflictException(
        (result.response as any)?.error ?? 'Idempotency key conflict',
      );
    }
    return result.response ?? null;
  }

  @Get('qr/:code')
  async resolveQr(@Param('code') code: string) {
    const qr = await this.prisma.qrCode.findUnique({
      where: { code },
      include: {
        location: true,
        charger: true,
      },
    });

    if (!qr || !qr.active) return { ok: false, error: 'QR not found' };

    return {
      ok: true,
      qr: {
        code: qr.code,
        location: qr.location,
        charger: qr.charger ? { chargerId: qr.charger.chargerId } : null,
        connectorId: qr.connectorId,
      },
    };
  }

  @Post('qr/:code/start')
  async startFromQr(
    @Param('code') code: string,
    @Body() body: { idTag: string },
    @Req() req: Request,
  ) {
    const idem = await this.checkIdempotency(req, 'public.qr.start', { code, ...body });
    const cached = this.handleIdempotencyResult(idem);
    if (cached) return cached;

    const idTag = String(body.idTag ?? '').trim();
    if (!idTag) return { ok: false, error: 'idTag is required' };

    const qr = await this.prisma.qrCode.findUnique({
      where: { code },
      include: {
        charger: true,
      },
    });

    if (!qr || !qr.active) return { ok: false, error: 'QR not found' };
    if (!qr.charger) return { ok: false, error: 'QR not linked to a charger' };

    const ttlRaw = Number(process.env.REMOTE_COMMAND_TTL_SECONDS ?? 45);
    const ttlSeconds = Number.isFinite(ttlRaw) && ttlRaw > 0 ? ttlRaw : 45;
    const recent = await this.prisma.remoteCommand.findFirst({
      where: {
        chargerId: qr.charger.id,
        command: 'RemoteStartTransaction',
        status: 'Pending',
        createdAt: { gte: new Date(Date.now() - ttlSeconds * 1000) },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (recent) {
      const res = { ok: true, messageId: recent.messageId, pending: true };
      await this.storeIdempotency(req, 'public.qr.start', { code, ...body }, res);
      return res;
    }

    const socket = this.registry.get(qr.charger.chargerId);
    if (!socket) return { ok: false, error: 'Charger offline' };

    const messageId = randomUUID();
    const payload = {
      connectorId: qr.connectorId ?? 1,
      idTag,
    };

    socket.send(JSON.stringify([OcppMessageType.CALL, messageId, 'RemoteStartTransaction', payload]));

    const chargerRow = await this.prisma.charger.findUnique({
      where: { chargerId: qr.charger.chargerId },
      select: { id: true },
    });

    if (chargerRow) {
      await this.prisma.remoteCommand.create({
        data: {
          chargerId: chargerRow.id,
          command: 'RemoteStartTransaction',
          messageId,
          payload: payload as unknown as Prisma.InputJsonValue,
          status: 'Pending',
        },
      });

      await this.prisma.ocppMessageLog.create({
        data: {
          chargerId: chargerRow.id,
          direction: 'OUT',
          operation: 'RemoteStartTransaction',
          messageId,
          raw: payload as unknown as Prisma.InputJsonValue,
        },
      });
    }

    const res = { ok: true, messageId };
    await this.storeIdempotency(req, 'public.qr.start', { code, ...body }, res);
    return res;
  }

  @Post('qr/:code/stop')
  async stopFromQr(
    @Param('code') code: string,
    @Body() body: { transactionId: number },
    @Req() req: Request,
  ) {
    const idem = await this.checkIdempotency(req, 'public.qr.stop', { code, ...body });
    const cached = this.handleIdempotencyResult(idem);
    if (cached) return cached;

    const txId = Number(body.transactionId);
    if (!Number.isFinite(txId)) return { ok: false, error: 'transactionId is required' };

    const qr = await this.prisma.qrCode.findUnique({
      where: { code },
      include: { charger: true },
    });
    if (!qr || !qr.active) return { ok: false, error: 'QR not found' };
    if (!qr.charger) return { ok: false, error: 'QR not linked to a charger' };

    const ttlRaw = Number(process.env.REMOTE_COMMAND_TTL_SECONDS ?? 45);
    const ttlSeconds = Number.isFinite(ttlRaw) && ttlRaw > 0 ? ttlRaw : 45;
    const recent = await this.prisma.remoteCommand.findFirst({
      where: {
        chargerId: qr.charger.id,
        command: 'RemoteStopTransaction',
        status: 'Pending',
        createdAt: { gte: new Date(Date.now() - ttlSeconds * 1000) },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (recent) {
      const res = { ok: true, messageId: recent.messageId, pending: true };
      await this.storeIdempotency(req, 'public.qr.stop', { code, ...body }, res);
      return res;
    }

    const socket = this.registry.get(qr.charger.chargerId);
    if (!socket) return { ok: false, error: 'Charger offline' };

    const messageId = randomUUID();
    const payload = { transactionId: txId };

    socket.send(JSON.stringify([OcppMessageType.CALL, messageId, 'RemoteStopTransaction', payload]));

    const chargerRow = await this.prisma.charger.findUnique({
      where: { chargerId: qr.charger.chargerId },
      select: { id: true },
    });

    if (chargerRow) {
      await this.prisma.remoteCommand.create({
        data: {
          chargerId: chargerRow.id,
          command: 'RemoteStopTransaction',
          messageId,
          payload: payload as unknown as Prisma.InputJsonValue,
          status: 'Pending',
        },
      });

      await this.prisma.ocppMessageLog.create({
        data: {
          chargerId: chargerRow.id,
          direction: 'OUT',
          operation: 'RemoteStopTransaction',
          messageId,
          raw: payload as unknown as Prisma.InputJsonValue,
        },
      });
    }

    const res = { ok: true, messageId };
    await this.storeIdempotency(req, 'public.qr.stop', { code, ...body }, res);
    return res;
  }
}
