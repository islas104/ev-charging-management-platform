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
    logger.warn('Invalid OCPP message (not JSON)');
    return;
  }

  const [messageType, messageId, action, payload] = message;

  if (messageType !== OcppMessageType.CALL) return;

  /* ---------- Heartbeat ---------- */
  if (action === 'Heartbeat') {
    const { chargerId } = (socket as any).ocpp;

    try {
      await prisma.charger.update({
        where: { chargerId },
        data: {
          lastSeenAt: new Date(),
        },
      });
    } catch (err) {
      logger.error(err, 'Heartbeat persistence failed');
      // do NOT throw
    }

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
    const { chargerId, protocol } = (socket as any).ocpp;

    try {
      await prisma.charger.upsert({
        where: { chargerId },
        update: {
          protocol,
          registered: true,
          lastSeenAt: new Date(),
        },
        create: {
          chargerId,
          protocol,
          registered: true,
          lastSeenAt: new Date(),
          // IMPORTANT: no siteId here
        },
      });
    } catch (err) {
      logger.error(err, 'BootNotification persistence failed');
      // do NOT throw
    }

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
    const transactionId = ++transactionCounter;

    const response: StartTransactionResponse = {
      transactionId,
      idTagInfo: { status: 'Accepted' },
    };

    socket.send(
      JSON.stringify([OcppMessageType.CALL_RESULT, messageId, response]),
    );

    logger.log(
      {
        transactionId,
        idTag: payload?.idTag,
      },
      'Transaction started',
    );
    return;
  }

  /* ---------- StopTransaction ---------- */
  if (action === 'StopTransaction') {
    const response: StopTransactionResponse = {
      idTagInfo: { status: 'Accepted' },
    };

    socket.send(
      JSON.stringify([OcppMessageType.CALL_RESULT, messageId, response]),
    );

    logger.log(
      {
        transactionId: payload?.transactionId,
        reason: payload?.reason,
      },
      'Transaction stopped',
    );
    return;
  }
}
