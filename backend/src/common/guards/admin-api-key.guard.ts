import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AdminApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const configuredKey = this.config.get<string>('ADMIN_API_KEY');
    const env = (this.config.get<string>('NODE_ENV') ?? '').toLowerCase();

    if (!configuredKey && env !== 'production') {
      return true;
    }

    if (!configuredKey) {
      throw new UnauthorizedException('Admin API key not configured');
    }

    const header = String(req.headers['authorization'] ?? '');
    const bearer = header.toLowerCase().startsWith('bearer ')
      ? header.slice(7).trim()
      : '';
    const apiKey = bearer || String(req.headers['x-admin-key'] ?? '');

    if (!apiKey || apiKey !== configuredKey) {
      throw new UnauthorizedException('Invalid admin API key');
    }

    return true;
  }
}
