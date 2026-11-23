import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { AppConfig } from '../config';
import { AiProfileRef } from '../reports/report.types';
import { APP_CONFIG } from '../tokens';
import { chooseAiProfile, GrokProbe, GROK_PROBE, listAiProfiles } from './ai-profile';

@Injectable()
export class AiProfilesService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(GROK_PROBE) private readonly probe: GrokProbe,
  ) {}

  list(): AiProfileRef[] {
    return listAiProfiles(this.config, {
      command: this.probe.command() != null,
      session: this.probe.session(),
    });
  }

  /** Refuses an id that is not currently available. Download has not started. */
  choose(requested: string | undefined): AiProfileRef {
    const chosen = chooseAiProfile(requested, this.list());
    if (!chosen) {
      throw new BadRequestException({ error: 'Некорректный запрос', message: 'Скачивание не начато.' });
    }
    return { id: chosen.id, label: chosen.label };
  }
}
