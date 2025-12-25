import { Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import bcrypt from 'bcryptjs';
import { AdminRole, AdminUser } from '@prisma/client';

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
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

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

  private sanitizeUser(user: AdminUser) {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
    };
  }
}
