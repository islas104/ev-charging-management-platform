import { WebSocket } from 'ws';
import { Logger } from 'nestjs-pino';
import { PrismaService } from '../../../prisma/prisma.service';

import { OcppMessageType } from '../types/ocpp-message';
import { HeartbeatResponse } from '../types/heartbeat';
import { BootNotificationResponse } from '../types/boot-notification';
import {
  StartTransactionResponse,
  StopTransactionResponse,
} from '../types/transaction';

let transactionCounter = 1000;

export async function routeOcppMessage(
  socket: WebSocket,
  rawMessage: string,
  logger: Logger,
  prisma: PrismaService,
) {
  let message: any;

  try {
    message = JSON.parse(rawMessage);
  } catch {
    logger.warn('Invalid OCPP message');
    return;
  }

  const [messageType, messageId, action, payload] = message;

  if (messageType !== OcppMessageType.CALL) return;

  const { chargerId } = (socket as any).ocpp;

  /* ---------- Heartbeat ---------- */
  if (action === 'Heartbeat') {
    await prisma.charger.update({
      where: { chargerId },
      data: { lastSeenAt: new Date() },
    });

    const response: HeartbeatResponse = {
      currentTime: new Date().toISOString(),
    };

    socket.send(
      JSON.stringify([OcppMessageType.CALL_RESULT, messageId, response]),
    );

    logger.log({ chargerId }, 'Heartbeat received');
    return;
  }

  /* ---------- BootNotification ---------- */
  if (action === 'BootNotification') {
    await prisma.charger.upsert({
      where: { chargerId },
      update: {
        protocol: payload?.chargePointModel,
        registered: true,
        lastSeenAt: new Date(),
      },
      create: {
        chargerId,
        protocol: payload?.chargePointModel ?? 'ocpp1.6',
        registered: true,
        lastSeenAt: new Date(),
      },
    });

    const response: BootNotificationResponse = {
      status: 'Accepted',
      currentTime: new Date().toISOString(),
      interval: 300,
    };

    socket.send(
      JSON.stringify([OcppMessageType.CALL_RESULT, messageId, response]),
    );

    logger.log({ chargerId }, 'BootNotification accepted');
    return;
  }

  /* ---------- StartTransaction ---------- */
  if (action === 'StartTransaction') {
    const ocppTransactionId = ++transactionCounter;

    const charger = await prisma.charger.findUnique({
      where: { chargerId },
    });

    if (!charger) return;

    // Prevent multiple active transactions
    const existing = await prisma.transaction.findFirst({
      where: {
        chargerId: charger.id,
        stoppedAt: null,
      },
    });

    if (existing) {
      logger.warn({ chargerId }, 'Active transaction already exists');
      return;
    }

    await prisma.transaction.create({
      data: {
        ocppTransactionId,
        chargerId: charger.id,
        idTag: payload.idTag,
        meterStart: payload.meterStart,
      },
    });

    const response: StartTransactionResponse = {
      transactionId: ocppTransactionId,
      idTagInfo: { status: 'Accepted' },
    };

    socket.send(
      JSON.stringify([OcppMessageType.CALL_RESULT, messageId, response]),
    );

    logger.log(
      { chargerId, ocppTransactionId },
      'Transaction started',
    );
    return;
  }

  /* ---------- StopTransaction ---------- */
  if (action === 'StopTransaction') {
    await prisma.transaction.updateMany({
      where: {
        ocppTransactionId: payload.transactionId,
        stoppedAt: null,
      },
      data: {
        meterStop: payload.meterStop,
        stoppedAt: new Date(),
        stopReason: payload.reason,
      },
    });

    const response: StopTransactionResponse = {
      idTagInfo: { status: 'Accepted' },
    };

    socket.send(
      JSON.stringify([OcppMessageType.CALL_RESULT, messageId, response]),
    );

    logger.log(
      { chargerId, transactionId: payload.transactionId },
      'Transaction stopped',
    );
  }
}
