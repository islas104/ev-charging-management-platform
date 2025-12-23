import { WebSocket } from 'ws';
import { Logger } from 'nestjs-pino';
import { PrismaService } from '../../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

import { OcppMessageType } from '../types/ocpp-message';
import { HeartbeatResponse } from '../types/heartbeat';
import { BootNotificationResponse } from '../types/boot-notification';
import {
  StartTransactionResponse,
  StopTransactionResponse,
} from '../types/transaction';

type StatusNotificationRequest = {
  connectorId: number;
  errorCode: string;
  status: string;
  timestamp?: string;
  info?: string;
  vendorId?: string;
  vendorErrorCode?: string;
};

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

  // Ensure charger exists so we can persist logs + statuses
  const chargerRow = await prisma.charger.upsert({
    where: { chargerId },
    update: { lastSeenAt: new Date() },
    create: {
      chargerId,
      protocol: 'ocpp1.6',
      registered: false,
      lastSeenAt: new Date(),
    },
    select: { id: true, chargerId: true },
  });

  // Log incoming OCPP request
  await prisma.ocppMessageLog.create({
    data: {
      chargerId: chargerRow.id,
      direction: 'IN',
      operation: String(action),
      messageId: String(messageId),
      raw: (payload ?? {}) as Prisma.InputJsonValue,
    },
  });

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

    // Log outgoing response
    await prisma.ocppMessageLog.create({
      data: {
        chargerId: chargerRow.id,
        direction: 'OUT',
        operation: 'Heartbeat',
        messageId: String(messageId),
        raw: response as unknown as Prisma.InputJsonValue,
      },
    });

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

    // Log outgoing response
    await prisma.ocppMessageLog.create({
      data: {
        chargerId: chargerRow.id,
        direction: 'OUT',
        operation: 'BootNotification',
        messageId: String(messageId),
        raw: response as unknown as Prisma.InputJsonValue,
        status: response.status,
      },
    });

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

    // Log outgoing response
    await prisma.ocppMessageLog.create({
      data: {
        chargerId: chargerRow.id,
        direction: 'OUT',
        operation: 'StartTransaction',
        messageId: String(messageId),
        raw: response as unknown as Prisma.InputJsonValue,
        status: response.idTagInfo?.status ?? null,
      },
    });

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

    // Log outgoing response
    await prisma.ocppMessageLog.create({
      data: {
        chargerId: chargerRow.id,
        direction: 'OUT',
        operation: 'StopTransaction',
        messageId: String(messageId),
        raw: response as unknown as Prisma.InputJsonValue,
        status: response.idTagInfo?.status ?? null,
      },
    });

    logger.log(
      { chargerId, ocppTransactionId: payload.transactionId },
      'Transaction stopped',
    );

    return;
  }

  /* ---------- StatusNotification ---------- */
  if (action === 'StatusNotification') {
    const req = payload as StatusNotificationRequest;

    // Persist connector status (for the colored dots in the chargers table)
    await prisma.connectorStatus.upsert({
      where: {
        chargerId_connectorId: {
          chargerId: chargerRow.id,
          connectorId: Number(req.connectorId),
        },
      },
      update: {
        status: String(req.status),
        errorCode: req.errorCode ? String(req.errorCode) : null,
        vendorError: req.vendorErrorCode ? String(req.vendorErrorCode) : null,
        info: req.info ? String(req.info) : null,
      },
      create: {
        chargerId: chargerRow.id,
        connectorId: Number(req.connectorId),
        status: String(req.status),
        errorCode: req.errorCode ? String(req.errorCode) : null,
        vendorError: req.vendorErrorCode ? String(req.vendorErrorCode) : null,
        info: req.info ? String(req.info) : null,
      },
    });

    const response = {};

    socket.send(
      JSON.stringify([OcppMessageType.CALL_RESULT, messageId, response]),
    );

    // Log outgoing response
    await prisma.ocppMessageLog.create({
      data: {
        chargerId: chargerRow.id,
        direction: 'OUT',
        operation: 'StatusNotification',
        messageId: String(messageId),
        raw: response as unknown as Prisma.InputJsonValue,
      },
    });

    logger.log(
      { chargerId, connectorId: req.connectorId, status: req.status },
      'StatusNotification persisted',
    );

    return;
  }
}