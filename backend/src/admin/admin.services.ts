import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { COSTS_REPO, RULES_REPO } from '../tokens';
import { CostsRepo, RulesRepo } from '../storage/repos';
import { AdminRules, cloneRules, defaultRules, mergeRules, RulesValidationError } from '../rules/rules';

@Injectable()
export class RulesService {
  constructor(@Inject(RULES_REPO) private readonly rules: RulesRepo) {}

  async current(): Promise<AdminRules> {
    const stored = await this.rules.get();
    return cloneRules(stored ?? defaultRules());
  }

  async replace(body: unknown): Promise<AdminRules> {
    const current = await this.current();
    try {
      const next = mergeRules(current, body);
      await this.rules.set(next);
      return cloneRules(next);
    } catch (error) {
      if (error instanceof RulesValidationError) {
        throw new BadRequestException({ error: error.message });
      }
      throw error;
    }
  }
}

@Injectable()
export class CostsService {
  constructor(@Inject(COSTS_REPO) private readonly costs: CostsRepo) {}

  async report(): Promise<{ usage_reported: false } | { usage_reported: true; provider_usage: Record<string, unknown>[] }> {
    const entries = await this.costs.list();
    if (entries.length === 0) return { usage_reported: false };
    return { usage_reported: true, provider_usage: entries.map((entry) => ({ ...entry.provider_usage })) };
  }

  async record(usage: Record<string, unknown> | null | undefined): Promise<void> {
    if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return;
    await this.costs.insert({ provider_usage: { ...usage }, recorded_at: new Date().toISOString() });
  }
}
