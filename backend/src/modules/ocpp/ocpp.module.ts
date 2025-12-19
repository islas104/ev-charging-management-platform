import { Module } from '@nestjs/common';
import { OcppGateway } from './gateway/ocpp.gateway';

@Module({
  providers: [OcppGateway],
})
export class OcppModule {}
