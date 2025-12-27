import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

type IdempotencyLookup = {
  key: string;
  scope: string;
  ownerKey: string;
  requestBody: unknown;
  ttlHours: number;
};

type IdempotencyHit<T> = {
  hit: true;
  statusCode: number;
  response: T;
};

type IdempotencyMiss = {
  hit: false;
  requestHash: string;
};

type IdempotencyConflict = {
  hit: true;
  statusCode: number;
  response: { ok: false; error: string };
};

type IdempotencyResult<T> = IdempotencyHit<T> | IdempotencyMiss | IdempotencyConflict;

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
    return `{${parts.join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashRequest(value: unknown): string {
  const json = stableStringify(value);
  return createHash('sha256').update(json).digest('hex');
}

export async function checkIdempotency<T>(
  prisma: PrismaService,
  opts: IdempotencyLookup,
): Promise<IdempotencyResult<T>> {
  const requestHash = hashRequest(opts.requestBody);

  const existing = await prisma.idempotencyKey.findUnique({
    where: {
      key_scope_ownerKey: {
        key: opts.key,
        scope: opts.scope,
        ownerKey: opts.ownerKey,
      },
    },
  });

  if (!existing) return { hit: false, requestHash };

  const ttlMs = Math.max(opts.ttlHours, 1) * 60 * 60 * 1000;
  if (existing.createdAt.getTime() < Date.now() - ttlMs) {
    await prisma.idempotencyKey.delete({
      where: {
        key_scope_ownerKey: {
          key: opts.key,
          scope: opts.scope,
          ownerKey: opts.ownerKey,
        },
      },
    });
    return { hit: false, requestHash };
  }

  if (existing.requestHash !== requestHash) {
    return {
      hit: true,
      statusCode: 409,
      response: { ok: false, error: 'Idempotency key reused with different payload' },
    };
  }

  return {
    hit: true,
    statusCode: existing.statusCode,
    response: existing.response as T,
  };
}

export async function storeIdempotency(
  prisma: PrismaService,
  opts: IdempotencyLookup,
  statusCode: number,
  response: unknown,
) {
  const requestHash = hashRequest(opts.requestBody);

  await prisma.idempotencyKey.create({
    data: {
      key: opts.key,
      scope: opts.scope,
      ownerKey: opts.ownerKey,
      requestHash,
      statusCode,
      response: response as any,
    },
  });
}
