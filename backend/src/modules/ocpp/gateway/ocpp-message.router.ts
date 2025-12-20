import { WebSocket } from 'ws';
import { Logger } from 'nestjs-pino';
import { OcppMessageType } from '../types/ocpp-message';
import { HeartbeatResponse } from '../types/heartbeat';
import { BootNotificationResponse } from '../types/boot-notification';
import {
  StartTransactionResponse,
  StopTransactionResponse,
} from '../types/transaction';

let transactionCounter = 1000;

export function routeOcppMessage(
  socket: WebSocket,
  rawMessage: string,
  logger: Logger,
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
    const response: HeartbeatResponse = {
      currentTime: new Date().toISOString(),
    };

    socket.send(
      JSON.stringify([OcppMessageType.CALL_RESULT, messageId, response]),
    );

    logger.log('Heartbeat handled');
    return;
  }

  /* ---------- BootNotification ---------- */
  if (action === 'BootNotification') {
    const response: BootNotificationResponse = {
      status: 'Accepted',
      currentTime: new Date().toISOString(),
      interval: 300,
    };

    socket.send(
      JSON.stringify([OcppMessageType.CALL_RESULT, messageId, response]),
    );

    logger.log(
      {
        vendor: payload?.chargePointVendor,
        model: payload?.chargePointModel,
      },
      'BootNotification accepted',
    );
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
  }
}
