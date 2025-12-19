import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, WebSocket } from 'ws';
import { Logger } from 'nestjs-pino';
import { IncomingMessage } from 'http';

import { resolveOcppProtocol } from './ocpp-protocol.resolver';
import { routeOcppMessage } from './ocpp-message.router';
import { chargers } from '../ocpp.state';

@WebSocketGateway({
  path: '/ocpp',
})
export class OcppGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  constructor(private readonly logger: Logger) {}

  handleConnection(client: WebSocket, request: IncomingMessage) {
    const url = new URL(request.url ?? '', 'http://localhost');
    const chargerId = url.searchParams.get('chargerId') ?? 'UNKNOWN';

    const protocol = resolveOcppProtocol(
      request.headers['sec-websocket-protocol']
        ?.toString()
        .split(',')
        .map((p) => p.trim()),
    );

    // 🔹 Track charger state for admin dashboard
    chargers.set(chargerId, {
      chargerId,
      connectedAt: new Date().toISOString(),
      registered: false,
    });

    (client as any).ocpp = { chargerId, protocol };

    this.logger.log(
      { chargerId, protocol },
      'OCPP charger connected',
    );

    client.on('message', (data) => {
      routeOcppMessage(
        client,
        data.toString(),
        this.logger,
      );
    });
  }

  handleDisconnect(client: WebSocket) {
    const meta = (client as any).ocpp;
    const chargerId = meta?.chargerId;

    if (chargerId) {
      chargers.delete(chargerId);
    }

    this.logger.log(
      { chargerId },
      'OCPP charger disconnected',
    );
  }
}
