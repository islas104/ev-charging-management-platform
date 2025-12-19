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
    const chargerId = url.searchParams.get('chargerId');

    const protocol = resolveOcppProtocol(
      request.headers['sec-websocket-protocol']
        ?.toString()
        .split(',')
        .map((p) => p.trim()),
    );

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

    this.logger.log(
      {
        chargerId: meta?.chargerId,
        protocol: meta?.protocol,
      },
      'OCPP charger disconnected',
    );
  }
}
