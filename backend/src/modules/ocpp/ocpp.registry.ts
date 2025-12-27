import { Injectable } from '@nestjs/common';
import { WebSocket } from 'ws';

@Injectable()
export class OcppConnectionRegistry {
  private readonly sockets = new Map<string, WebSocket>();

  register(chargerId: string, socket: WebSocket) {
    this.sockets.set(chargerId, socket);
  }

  unregister(chargerId: string) {
    this.sockets.delete(chargerId);
  }

  get(chargerId: string) {
    return this.sockets.get(chargerId);
  }
}
