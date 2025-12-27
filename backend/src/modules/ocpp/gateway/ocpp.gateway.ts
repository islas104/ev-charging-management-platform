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
import { PrismaService } from '../../../prisma/prisma.service';
import { OcppConnectionRegistry } from '../ocpp.registry';
import { OcppProtocolVersion } from '../types/protocol-version';

@WebSocketGateway({
  path: '/ocpp',
})
export class OcppGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly logger: Logger,
    private readonly prisma: PrismaService,
    private readonly registry: OcppConnectionRegistry,
  ) {}

  handleConnection(client: WebSocket, request: IncomingMessage) {
    const url = new URL(request.url ?? '', 'http://localhost');
    const chargerId = url.searchParams.get('chargerId') ?? 'UNKNOWN';
    const token = url.searchParams.get('token') ?? '';

    const chargerIdOk = /^[A-Za-z0-9._ -]{1,64}$/.test(chargerId);
    if (!chargerIdOk) {
      this.logger.warn({ chargerId }, 'OCPP rejected: invalid chargerId');
      client.close(1008, 'Invalid chargerId');
      return;
    }

    const sharedSecret = process.env.OCPP_SHARED_SECRET ?? '';
    if (sharedSecret && token !== sharedSecret) {
      this.logger.warn({ chargerId }, 'OCPP rejected: invalid token');
      client.close(1008, 'Unauthorized');
      return;
    }

    const protocol = resolveOcppProtocol(
      request.headers['sec-websocket-protocol']
        ?.toString()
        .split(',')
        .map((p) => p.trim()),
    );

    if (protocol !== OcppProtocolVersion.OCPP_1_6) {
      this.logger.warn({ chargerId, protocol }, 'OCPP rejected: unsupported protocol');
      client.close(1008, 'Unsupported protocol');
      return;
    }

    (client as any).ocpp = { chargerId, protocol };
    this.registry.register(chargerId, client);

    this.logger.log(
      { chargerId, protocol },
      'OCPP charger connected',
    );

    client.on('message', (data) => {
      routeOcppMessage(
        client,
        data.toString(),
        this.logger,
        this.prisma,
      );
    });

    client.on('error', (err) => {
      this.logger.warn({ chargerId, err }, 'OCPP socket error');
    });
  }

  async handleDisconnect(client: WebSocket) {
    const meta = (client as any).ocpp;

    this.logger.log(
      { chargerId: meta?.chargerId },
      'OCPP charger disconnected',
    );

    if (meta?.chargerId) {
      this.registry.unregister(meta.chargerId);
      await this.prisma.charger.update({
        where: { chargerId: meta.chargerId },
        data: { lastSeenAt: null },
      }).catch(() => {});
    }
  }
}
