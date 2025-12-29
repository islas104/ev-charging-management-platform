import { Module } from '@nestjs/common';
import { EaseeService } from './easee.service';

@Module({
  providers: [EaseeService],
  exports: [EaseeService],
})
export class EaseeModule {}
