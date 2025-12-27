import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export type AdminRole = 'ADMIN' | 'SUPER_ADMIN';

export const Roles = (...roles: AdminRole[]) => SetMetadata(ROLES_KEY, roles);
