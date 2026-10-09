import { PART_ATTEMPTS } from '../tokens';

export class HaltAttempts extends Error {
  constructor(readonly reason: unknown) {
    super('halt-attempts');
  }
}

export async function withAttempts<T>(attempts: number, fn: (attempt: number) => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (error instanceof HaltAttempts) {
        throw error.reason instanceof Error ? error.reason : new Error('Сбой части проверки');
      }
      last = error;
    }
  }
  throw last instanceof Error ? last : new Error('Сбой части проверки');
}

export const ATTEMPTS = PART_ATTEMPTS;
