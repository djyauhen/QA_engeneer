import { PART_ATTEMPTS } from '../tokens';

export async function withAttempts<T>(attempts: number, fn: (attempt: number) => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      last = error;
    }
  }
  throw last instanceof Error ? last : new Error('Сбой части проверки');
}

export const ATTEMPTS = PART_ATTEMPTS;
