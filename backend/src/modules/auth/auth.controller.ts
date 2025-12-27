import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto, RequestPasswordResetDto, ResetPasswordDto } from './dto/auth.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60 } })
  async login(@Body() body: LoginDto) {
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    return this.auth.login(email, password);
  }

  @Post('request-reset')
  @Throttle({ default: { limit: 3, ttl: 300 } })
  async requestReset(@Body() body: RequestPasswordResetDto) {
    const email = String(body.email ?? '').trim().toLowerCase();
    return this.auth.requestPasswordReset(email);
  }

  @Post('reset')
  @Throttle({ default: { limit: 3, ttl: 300 } })
  async resetPassword(@Body() body: ResetPasswordDto) {
    const token = String(body.token ?? '').trim();
    const newPassword = String(body.newPassword ?? '');
    return this.auth.resetPassword(token, newPassword);
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
