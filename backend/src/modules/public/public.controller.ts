import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OcppConnectionRegistry } from '../ocpp/ocpp.registry';
import { OcppMessageType } from '../ocpp/types/ocpp-message';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';

@Controller('public')
export class PublicController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: OcppConnectionRegistry,
  ) {}

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
  ) {
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

    return { ok: true, messageId };
  }

  @Post('qr/:code/stop')
  async stopFromQr(
    @Param('code') code: string,
    @Body() body: { transactionId: number },
  ) {
    const txId = Number(body.transactionId);
    if (!Number.isFinite(txId)) return { ok: false, error: 'transactionId is required' };

    const qr = await this.prisma.qrCode.findUnique({
      where: { code },
      include: { charger: true },
    });
    if (!qr || !qr.active) return { ok: false, error: 'QR not found' };
    if (!qr.charger) return { ok: false, error: 'QR not linked to a charger' };

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

    return { ok: true, messageId };
  }
}
