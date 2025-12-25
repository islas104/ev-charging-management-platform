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

const MAX_MESSAGE_BYTES = Number(process.env.OCPP_MAX_MESSAGE_BYTES ?? 1000000);

function sendCallError(
  socket: WebSocket,
  messageId: string,
  errorCode: string,
  errorDescription: string,
) {
  const payload = [OcppMessageType.CALL_ERROR, messageId, errorCode, errorDescription, {}];
  socket.send(JSON.stringify(payload));
}

export async function routeOcppMessage(
  socket: WebSocket,
  rawMessage: string,
  logger: Logger,
  prisma: PrismaService,
) {
  let message: any;

  if (Buffer.byteLength(rawMessage, 'utf8') > MAX_MESSAGE_BYTES) {
    logger.warn('OCPP message rejected: payload too large');
    return;
  }

  try {
    message = JSON.parse(rawMessage);
  } catch {
    logger.warn('Invalid OCPP message');
    return;
  }

  if (!Array.isArray(message) || message.length < 3) {
    logger.warn('Invalid OCPP frame');
    return;
  }

  const [messageType, messageId, action, payload] = message;
  if (messageType !== OcppMessageType.CALL) {
    if (messageType === OcppMessageType.CALL_RESULT || messageType === OcppMessageType.CALL_ERROR) {
      const msgId = String(messageId ?? '');
      await prisma.ocppMessageLog.create({
        data: {
          chargerId: (await prisma.charger.findUnique({ where: { chargerId: (socket as any).ocpp?.chargerId } }))?.id ?? 0,
          direction: 'IN',
          operation: messageType === OcppMessageType.CALL_RESULT ? 'CALL_RESULT' : 'CALL_ERROR',
          messageId: msgId,
          raw: (payload ?? {}) as Prisma.InputJsonValue,
          status: messageType === OcppMessageType.CALL_ERROR ? 'Error' : 'Ok',
        },
      }).catch(() => {});
    }
    return;
  }

  const { chargerId } = (socket as any).ocpp;
  const msgId = String(messageId ?? '');
  const actionName = String(action ?? '');

  if (!msgId || !actionName) {
    sendCallError(socket, msgId || '0', 'FormationViolation', 'Missing messageId/action');
    return;
  }

  const allowedActions = new Set([
    'Heartbeat',
    'BootNotification',
    'StartTransaction',
    'StopTransaction',
    'StatusNotification',
    'Authorize',
    'MeterValues',
  ]);

  if (!allowedActions.has(actionName)) {
    sendCallError(socket, msgId, 'NotSupported', `Unsupported action: ${actionName}`);
    return;
  }

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

  const existing = await prisma.ocppMessageLog.findFirst({
    where: {
      chargerId: chargerRow.id,
      messageId: msgId,
      direction: 'IN',
    },
  });
  if (existing) {
    logger.warn({ chargerId, msgId }, 'Duplicate OCPP message ignored');
    return;
  }

  // Log incoming OCPP request
  await prisma.ocppMessageLog.create({
    data: {
      chargerId: chargerRow.id,
      direction: 'IN',
      operation: actionName,
      messageId: msgId,
      raw: (payload ?? {}) as Prisma.InputJsonValue,
    },
  });

  /* ---------- Heartbeat ---------- */
  if (actionName === 'Heartbeat') {
    await prisma.charger.update({
      where: { chargerId },
      data: { lastSeenAt: new Date() },
    });

    const response: HeartbeatResponse = {
      currentTime: new Date().toISOString(),
    };

    socket.send(JSON.stringify([OcppMessageType.CALL_RESULT, msgId, response]));

    // Log outgoing response
    await prisma.ocppMessageLog.create({
      data: {
        chargerId: chargerRow.id,
        direction: 'OUT',
        operation: 'Heartbeat',
      messageId: msgId,
      raw: response as unknown as Prisma.InputJsonValue,
    },
  });

    logger.log({ chargerId }, 'Heartbeat received');
    return;
  }

  /* ---------- BootNotification ---------- */
  if (actionName === 'BootNotification') {
    if (!payload || typeof payload !== 'object') {
      sendCallError(socket, msgId, 'FormationViolation', 'Invalid BootNotification payload');
      return;
    }

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

    socket.send(JSON.stringify([OcppMessageType.CALL_RESULT, msgId, response]));

    // Log outgoing response
    await prisma.ocppMessageLog.create({
      data: {
        chargerId: chargerRow.id,
        direction: 'OUT',
        operation: 'BootNotification',
      messageId: msgId,
      raw: response as unknown as Prisma.InputJsonValue,
      status: response.status,
    },
  });

    logger.log({ chargerId }, 'BootNotification accepted');
    return;
  }

  /* ---------- StartTransaction ---------- */
  if (actionName === 'StartTransaction') {
    if (!payload || typeof payload !== 'object') {
      sendCallError(socket, msgId, 'FormationViolation', 'Invalid StartTransaction payload');
      return;
    }

    const idTag = String(payload.idTag ?? '').trim();
    const meterStart = Number(payload.meterStart);
    const ts = new Date(payload.timestamp ?? '');
    if (!idTag || !Number.isFinite(meterStart) || Number.isNaN(ts.getTime())) {
      sendCallError(socket, msgId, 'PropertyConstraintViolation', 'Invalid StartTransaction fields');
      return;
    }

    const charger = await prisma.charger.findUnique({
      where: { chargerId },
      include: {
        location: {
          include: {
            tariff: true,
          },
        },
      },
    });

    if (!charger) {
      logger.warn({ chargerId }, 'StartTransaction for unknown charger');
      sendCallError(socket, msgId, 'NotFound', 'Charger not found');
      return;
    }

    const lastTx = await prisma.transaction.findFirst({
      orderBy: { ocppTransactionId: 'desc' },
      select: { ocppTransactionId: true },
    });

    const ocppTransactionId = (lastTx?.ocppTransactionId ?? 1000) + 1;

    const fob = await prisma.rfidFob.findUnique({
      where: { uid: idTag },
      include: {
        driver: {
          include: {
            groups: {
              include: {
                driverGroup: {
                  include: {
                    tariffs: {
                      include: {
                        tariff: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    const locationTariff = charger?.location?.tariff ?? null;
    const groupTariff =
      fob?.driver?.groups?.[0]?.driverGroup?.tariffs?.[0]?.tariff ?? null;
    const effectiveTariff = groupTariff || locationTariff;

    await prisma.transaction.create({
      data: {
        ocppTransactionId,
        chargerId: charger.id,
        idTag,
        meterStart,
        startedAt: ts,
        locationId: charger.locationId ?? null,
        driverId: fob?.driver?.id ?? null,
        driverGroupId: fob?.driver?.groups?.[0]?.driverGroupId ?? null,
        startFee: effectiveTariff?.startFee ?? null,
        energyFee: effectiveTariff?.energyFee ?? null,
        idleFee: effectiveTariff?.idleFee ?? null,
        vatRate: effectiveTariff?.vatRate ?? null,
        currency: effectiveTariff?.currency ?? null,
      },
    });

    const response: StartTransactionResponse = {
      transactionId: ocppTransactionId,
      idTagInfo: { status: 'Accepted' },
    };

    socket.send(JSON.stringify([OcppMessageType.CALL_RESULT, msgId, response]));

    // Log outgoing response
    await prisma.ocppMessageLog.create({
      data: {
        chargerId: chargerRow.id,
        direction: 'OUT',
        operation: 'StartTransaction',
      messageId: msgId,
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
  if (actionName === 'StopTransaction') {
    if (!payload || typeof payload !== 'object') {
      sendCallError(socket, msgId, 'FormationViolation', 'Invalid StopTransaction payload');
      return;
    }

    const txId = Number(payload.transactionId);
    const meterStop = Number(payload.meterStop);
    const ts = new Date(payload.timestamp ?? '');
    if (!Number.isFinite(txId) || !Number.isFinite(meterStop) || Number.isNaN(ts.getTime())) {
      sendCallError(socket, msgId, 'PropertyConstraintViolation', 'Invalid StopTransaction fields');
      return;
    }

    const existingTx = await prisma.transaction.findUnique({
      where: { ocppTransactionId: txId },
    });

    if (!existingTx) {
      sendCallError(socket, msgId, 'NotFound', 'Transaction not found');
      return;
    }

    if (existingTx.meterStop !== null) {
      logger.warn({ chargerId, txId }, 'StopTransaction ignored: already stopped');
    } else if (meterStop < existingTx.meterStart) {
      logger.warn({ chargerId, txId }, 'StopTransaction ignored: meterStop < meterStart');
    } else {
      await prisma.transaction.update({
        where: {
          ocppTransactionId: txId,
        },
        data: {
          meterStop,
          stoppedAt: ts,
          stopReason: payload.reason ? String(payload.reason) : null,
        },
      });
    }

    const response: StopTransactionResponse = {
      idTagInfo: { status: 'Accepted' },
    };

    socket.send(JSON.stringify([OcppMessageType.CALL_RESULT, msgId, response]));

    // Log outgoing response
    await prisma.ocppMessageLog.create({
      data: {
        chargerId: chargerRow.id,
        direction: 'OUT',
        operation: 'StopTransaction',
      messageId: msgId,
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
  if (actionName === 'StatusNotification') {
    const req = payload as StatusNotificationRequest;
    if (!req || typeof req !== 'object') {
      sendCallError(socket, msgId, 'FormationViolation', 'Invalid StatusNotification payload');
      return;
    }
    const connectorId = Number(req.connectorId);
    if (!Number.isFinite(connectorId) || !req.status || !req.errorCode) {
      sendCallError(socket, msgId, 'PropertyConstraintViolation', 'Invalid StatusNotification fields');
      return;
    }

    // Persist connector status (for the colored dots in the chargers table)
    await prisma.connectorStatus.upsert({
      where: {
        chargerId_connectorId: {
          chargerId: chargerRow.id,
          connectorId,
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

    socket.send(JSON.stringify([OcppMessageType.CALL_RESULT, msgId, response]));

    // Log outgoing response
    await prisma.ocppMessageLog.create({
      data: {
        chargerId: chargerRow.id,
        direction: 'OUT',
        operation: 'StatusNotification',
      messageId: msgId,
      raw: response as unknown as Prisma.InputJsonValue,
    },
  });

    logger.log(
      { chargerId, connectorId: req.connectorId, status: req.status },
      'StatusNotification persisted',
    );

    return;
  }

  /* ---------- Authorize ---------- */
  if (actionName === 'Authorize') {
    if (!payload || typeof payload !== 'object') {
      sendCallError(socket, msgId, 'FormationViolation', 'Invalid Authorize payload');
      return;
    }

    const idTag = String(payload.idTag ?? '').trim();
    if (!idTag) {
      sendCallError(socket, msgId, 'PropertyConstraintViolation', 'Missing idTag');
      return;
    }

    const fob = await prisma.rfidFob.findUnique({
      where: { uid: idTag },
    });

    const response = {
      idTagInfo: {
        status: fob?.active ? 'Accepted' : 'Rejected',
      },
    };

    socket.send(JSON.stringify([OcppMessageType.CALL_RESULT, msgId, response]));

    await prisma.ocppMessageLog.create({
      data: {
        chargerId: chargerRow.id,
        direction: 'OUT',
        operation: 'Authorize',
        messageId: msgId,
        raw: response as unknown as Prisma.InputJsonValue,
        status: response.idTagInfo?.status ?? null,
      },
    });

    return;
  }

  /* ---------- MeterValues ---------- */
  if (actionName === 'MeterValues') {
    const response = {};
    socket.send(JSON.stringify([OcppMessageType.CALL_RESULT, msgId, response]));

    await prisma.ocppMessageLog.create({
      data: {
        chargerId: chargerRow.id,
        direction: 'OUT',
        operation: 'MeterValues',
        messageId: msgId,
        raw: response as unknown as Prisma.InputJsonValue,
      },
    });
    return;
  }
}
