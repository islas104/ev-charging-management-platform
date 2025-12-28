import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export type AdminRole = 'ADMIN' | 'SITE_MANAGER' | 'SUPER_ADMIN';

export const Roles = (...roles: AdminRole[]) => SetMetadata(ROLES_KEY, roles);
