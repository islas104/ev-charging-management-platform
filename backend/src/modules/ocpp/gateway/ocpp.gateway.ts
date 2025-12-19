import {
    WebSocketGateway,
    WebSocketServer,
    OnGatewayConnection,
    OnGatewayDisconnect,
  } from '@nestjs/websockets';
  import { Server, WebSocket } from 'ws';
  import { Logger } from 'nestjs-pino';
  import { IncomingMessage } from 'http';
  
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
      this.logger.log(
        {
          ip: request.socket?.remoteAddress,
        },
        'OCPP charger connected',
      );
    }
  
    handleDisconnect(client: WebSocket) {
      this.logger.log('OCPP charger disconnected');
    }
  }
  