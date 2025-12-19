import { WebSocket } from 'ws';
import { Logger } from 'nestjs-pino';
import { OcppMessageType } from '../types/ocpp-message';
import { HeartbeatResponse } from '../types/heartbeat';

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

  const [messageType, messageId, action] = message;

  if (messageType !== OcppMessageType.CALL) {
    return;
  }

  if (action === 'Heartbeat') {
    const response: HeartbeatResponse = {
      currentTime: new Date().toISOString(),
    };

    socket.send(
      JSON.stringify([
        OcppMessageType.CALL_RESULT,
        messageId,
        response,
      ]),
    );

    logger.log('Heartbeat handled');
  }
}
