import { Module } from '@nestjs/common';
import { OcppGateway } from './gateway/ocpp.gateway';
import { OcppConnectionRegistry } from './ocpp.registry';

@Module({
  providers: [OcppGateway, OcppConnectionRegistry],
  exports: [OcppConnectionRegistry],
})
export class OcppModule {}
