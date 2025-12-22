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
        protocol: payload?.chargePointModel ?? 'ocpp1.6',
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
    const charger = await prisma.charger.findUnique({
      where: { chargerId },
    });

    if (!charger) {
      logger.warn({ chargerId }, 'StartTransaction for unknown charger');
      return;
    }

    const lastTx = await prisma.transaction.findFirst({
      orderBy: { ocppTransactionId: 'desc' },
      select: { ocppTransactionId: true },
    });

    const ocppTransactionId = (lastTx?.ocppTransactionId ?? 1000) + 1;

    await prisma.transaction.create({
      data: {
        ocppTransactionId,
        chargerId: charger.id,
        idTag: payload.idTag,
        meterStart: payload.meterStart,
        startedAt: new Date(payload.timestamp),
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
      'Transaction started and persisted',
    );

    return;
  }

  /* ---------- StopTransaction ---------- */
  if (action === 'StopTransaction') {
    await prisma.transaction.update({
      where: {
        ocppTransactionId: payload.transactionId,
      },
      data: {
        meterStop: payload.meterStop,
        stoppedAt: new Date(payload.timestamp),
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
      { chargerId, ocppTransactionId: payload.transactionId },
      'Transaction stopped',
    );

    return;
  }
}
