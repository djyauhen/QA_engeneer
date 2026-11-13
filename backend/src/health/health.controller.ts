import { Controller, Get, HttpCode, Inject, ServiceUnavailableException } from '@nestjs/common';
import { DB_PING } from '../tokens';

@Controller()
export class HealthController {
  constructor(@Inject(DB_PING) private readonly ping: () => Promise<void>) {}

  @Get('health')
  @HttpCode(200)
  async health(): Promise<{ ok: true }> {
    try {
      await this.ping();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unavailable';
      console.error(`health check failed: ${message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]')}`);
      throw new ServiceUnavailableException({ error: 'unavailable' });
    }
    return { ok: true };
  }
}
