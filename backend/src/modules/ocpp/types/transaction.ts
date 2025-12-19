export interface StartTransactionRequest {
    connectorId: number;
    idTag: string;
    meterStart: number;
    timestamp: string;
  }
  
  export interface StartTransactionResponse {
    transactionId: number;
    idTagInfo: {
      status: 'Accepted' | 'Rejected';
    };
  }
  
  export interface StopTransactionRequest {
    transactionId: number;
    meterStop: number;
    timestamp: string;
    reason: string;
  }
  
  export interface StopTransactionResponse {
    idTagInfo: {
      status: 'Accepted';
    };
  }
  