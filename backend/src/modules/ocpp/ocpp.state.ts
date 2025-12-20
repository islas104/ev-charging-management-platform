export interface ChargerState {
    chargerId: string;
    connectedAt: string;
    registered: boolean;
    activeTransactionId?: number;
    lastHeartbeatAt?: string;
  }
  
  export const chargers = new Map<string, ChargerState>();
  