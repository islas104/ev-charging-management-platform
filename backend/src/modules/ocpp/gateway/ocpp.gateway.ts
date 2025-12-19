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
  import { OcppProtocolVersion } from '../types/protocol-version';
  
  @WebSocketGateway({
    path: '/ocpp/:chargerId',
  })
  export class OcppGateway
    implements OnGatewayConnection, OnGatewayDisconnect
  {
    @WebSocketServer()
    server: Server;
  
    constructor(private readonly logger: Logger) {}
  
    handleConnection(client: WebSocket, request: IncomingMessage) {
      const url = request.url ?? '';
      const segments = url.split('/');
      const chargerId = segments[segments.length - 1];
  
      const protocol = resolveOcppProtocol(
        request.headers['sec-websocket-protocol']
          ?.toString()
          .split(',')
          .map((p) => p.trim()),
      );
  
      this.logger.log(
        {
          chargerId,
          protocol,
          ip: request.socket?.remoteAddress,
        },
        'OCPP charger connected',
      );
  
      // Attach resolved protocol to socket for later routing
      (client as any).ocpp = {
        chargerId,
        protocol,
      };
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
  