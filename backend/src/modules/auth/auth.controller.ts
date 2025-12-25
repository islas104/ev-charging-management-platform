import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/auth.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { Request } from 'express';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  async login(@Body() body: LoginDto) {
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    return this.auth.login(email, password);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@Req() req: Request) {
    return { user: (req as any).user };
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout() {
    return { ok: true };
  }
}
