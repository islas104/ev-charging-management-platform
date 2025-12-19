import { Controller, Get } from '@nestjs/common';
import { chargers } from '../ocpp/ocpp.state';

@Controller('admin')
export class AdminController {
  @Get('chargers')
  getChargers() {
    return Array.from(chargers.values());
  }
}
