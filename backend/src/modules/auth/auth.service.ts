import { Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import bcrypt from 'bcryptjs';
import { AdminRole, AdminUser, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    const email = String(this.config.get<string>('SUPER_ADMIN_EMAIL') ?? '').trim();
    const password = String(this.config.get<string>('SUPER_ADMIN_PASSWORD') ?? '').trim();
    if (!email || !password) return;

    const existing = await this.prisma.adminUser.findUnique({ where: { email } });
    if (existing) return;

    const passwordHash = await bcrypt.hash(password, 12);
    await this.prisma.adminUser.create({
      data: {
        email,
        passwordHash,
        role: AdminRole.SUPER_ADMIN,
      },
    });
  }

  async validateUser(email: string, password: string) {
    const user = await this.prisma.adminUser.findUnique({ where: { email } });
    if (!user) {
      await this.logAuth('auth.login.failed', null, { email, reason: 'user_not_found' });
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.logAuth('auth.login.locked', user.id, { email });
      throw new UnauthorizedException('Account locked. Try again later.');
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      const maxAttempts = Number(this.config.get<string>('AUTH_MAX_LOGIN_ATTEMPTS') ?? 5);
      const lockMinutes = Number(this.config.get<string>('AUTH_LOCK_MINUTES') ?? 15);

      const failedCount = (user.failedLoginCount ?? 0) + 1;
      const lockedUntil =
        failedCount >= maxAttempts
          ? new Date(Date.now() + lockMinutes * 60 * 1000)
          : null;

      await this.prisma.adminUser.update({
        where: { id: user.id },
        data: {
          failedLoginCount: lockedUntil ? 0 : failedCount,
          lockedUntil,
        },
      });

      await this.logAuth('auth.login.failed', user.id, {
        email,
        reason: lockedUntil ? 'locked' : 'invalid_password',
      });

      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.failedLoginCount || user.lockedUntil) {
      await this.prisma.adminUser.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
    }

    await this.logAuth('auth.login.success', user.id, { email });
    return user;
  }

  async login(email: string, password: string) {
    const user = await this.validateUser(email, password);
    const payload = { sub: user.id, email: user.email, role: user.role };
    const accessToken = await this.jwt.signAsync(payload);

    return {
      accessToken,
      user: this.sanitizeUser(user),
    };
  }

  async getUserById(id: number) {
    const user = await this.prisma.adminUser.findUnique({ where: { id } });
    if (!user) throw new UnauthorizedException('User not found');
    return this.sanitizeUser(user);
  }

  async createAdminUser(email: string, password: string, role: AdminRole) {
    const existing = await this.prisma.adminUser.findUnique({ where: { email } });
    if (existing) {
      return { ok: false, error: 'email already exists' };
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await this.prisma.adminUser.create({
      data: { email, passwordHash, role },
    });
    return { ok: true, user: this.sanitizeUser(user) };
  }

  async requestPasswordReset(email: string) {
    const user = await this.prisma.adminUser.findUnique({ where: { email } });
    if (!user) {
      await this.logAuth('auth.reset.requested', null, { email });
      return { ok: true };
    }

    const ttlMinutes = Number(this.config.get<string>('AUTH_RESET_TOKEN_TTL_MIN') ?? 30);
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

    await this.prisma.adminUser.update({
      where: { id: user.id },
      data: { resetToken: token, resetTokenExpiresAt: expiresAt },
    });

    await this.logAuth('auth.reset.requested', user.id, { email });

    const env = (this.config.get<string>('NODE_ENV') ?? '').toLowerCase();
    return { ok: true, token: env === 'production' ? undefined : token };
  }

  async resetPassword(token: string, newPassword: string) {
    const user = await this.prisma.adminUser.findFirst({
      where: {
        resetToken: token,
        resetTokenExpiresAt: { gt: new Date() },
      },
    });
    if (!user) throw new UnauthorizedException('Invalid or expired token');

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.adminUser.update({
      where: { id: user.id },
      data: {
        passwordHash,
        resetToken: null,
        resetTokenExpiresAt: null,
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });

    await this.logAuth('auth.reset.completed', user.id, { email: user.email });
    return { ok: true };
  }

  private sanitizeUser(user: AdminUser) {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
    };
  }

  private async logAuth(action: string, adminUserId: number | null, payload?: unknown) {
    await this.prisma.adminAuditLog.create({
      data: {
        adminUserId,
        action,
        entity: 'Auth',
        entityId: adminUserId ? String(adminUserId) : null,
        payload: payload ? (payload as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    }).catch(() => {});
  }
}
