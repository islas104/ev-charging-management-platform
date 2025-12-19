export interface BootNotificationRequest {
    chargePointVendor: string;
    chargePointModel: string;
  }
  
  export interface BootNotificationResponse {
    status: 'Accepted' | 'Rejected' | 'Pending';
    currentTime: string;
    interval: number;
  }
  