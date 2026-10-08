import { Injectable } from '@nestjs/common';
import { CheckRecord } from './check.record';

@Injectable()
export class CheckStore {
  private readonly byId = new Map<string, CheckRecord>();

  add(check: CheckRecord): void {
    for (const existing of this.byId.values()) {
      if (existing.ownerLogin === check.ownerLogin && !existing.reportSaved) {
        existing.markAborted();
      }
    }
    this.byId.set(check.id, check);
  }

  get(id: string): CheckRecord | null {
    return this.byId.get(id) ?? null;
  }
}
