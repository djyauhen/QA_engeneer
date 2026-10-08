import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SessionUser } from '../config';
import { CatalogService } from '../catalog/catalog.service';
import { toChoiceRow } from '../catalog/map-row';
import { FORBIDDEN_BODY } from '../tokens';
import { CheckRecord } from './check.record';
import { CheckStore } from './check.store';
import { CheckOrchestrator } from './orchestrator';

@Injectable()
export class ChecksService {
  constructor(
    private readonly catalog: CatalogService,
    private readonly store: CheckStore,
    private readonly orchestrator: CheckOrchestrator,
  ) {}

  async start(user: SessionUser, body: unknown): Promise<{ check_id: string }> {
    const input = parseStart(body);
    const resolved = await this.catalog.resolve(input.human_id, input.uuid);
    if (resolved.kind === 'collision') {
      throw new ConflictException({
        error: 'collision',
        message: 'Несколько строк с одним human_id. Скачивание не начато.',
        rows: resolved.rows.map(toChoiceRow),
      });
    }
    if (resolved.kind === 'not_found') {
      throw new NotFoundException({
        error: 'not_found',
        message: 'Ленд не найден среди последних 300. Скачивание не начато.',
      });
    }
    if (resolved.kind === 'pair_not_found') {
      throw new NotFoundException({
        error: 'pair_not_found',
        message: 'Пара human_id и uuid не найдена в кэше. Скачивание не начато.',
      });
    }
    const check = new CheckRecord(user.login, user.role, resolved.card);
    check.step('catalog', 'done');
    this.store.add(check);
    check.finished = this.orchestrator.run(check);
    return { check_id: check.id };
  }

  view(user: SessionUser, id: string) {
    return toView(this.owned(user, id));
  }

  async decide(user: SessionUser, id: string, body: unknown): Promise<{ decision: 'allow' | 'deny' }> {
    const check = this.owned(user, id);
    if (check.state('ai_gate') !== 'waiting_user') {
      throw new ConflictException({
        error: 'ai_decision_not_accepted',
        message: 'Решение по ИИ принимается только когда статика уже есть, в ней есть failed, а ИИ ещё не стартовал',
      });
    }
    const decision = parseDecision(body);
    check.submit(decision);
    return { decision };
  }

  allowStand(user: SessionUser, id: string, body: unknown): { actions_allowed: true } {
    const check = this.owned(user, id);
    if (!body || typeof body !== 'object' || (body as { decision?: unknown }).decision !== 'allow') {
      throw new BadRequestException({ error: 'Некорректный запрос' });
    }
    if (!check.standReady) {
      throw new ConflictException({ error: 'stand_not_ready', message: 'Стенд ещё не готов' });
    }
    check.actionsAllowed = true;
    return { actions_allowed: true };
  }

  private owned(user: SessionUser, id: string): CheckRecord {
    const check = this.store.get(id);
    if (!check) throw new NotFoundException({ error: 'not_found' });
    if (check.ownerLogin !== user.login) throw new ForbiddenException(FORBIDDEN_BODY);
    return check;
  }
}

function toView(check: CheckRecord) {
  const body: Record<string, unknown> = {
    check_id: check.id,
    human_id: check.card.human_id,
    name: check.card.name,
    owner_login: check.ownerLogin,
    replaced_previous_stand: check.replaced_previous_stand,
    steps: check.steps.map((step) => ({
      name: step.name,
      state: step.state,
      ...(step.message ? { message: step.message } : {}),
    })),
    static: check.staticBlock,
    ai: check.aiBlock,
    lighthouse: check.lighthouseBlock,
  };
  const downloaded = check.state('download_file');
  if (downloaded === 'pending' || downloaded === 'running' || downloaded === 'retrying') {
    body.preview_image = check.card.preview_image;
  }
  if (check.standReady && check.standUrl) body.stand_url = check.standUrl;
  return body;
}

function parseStart(body: unknown): { human_id: string; uuid?: string } {
  if (!body || typeof body !== 'object') throw new BadRequestException({ error: 'Некорректный запрос' });
  const record = body as Record<string, unknown>;
  if (typeof record.human_id !== 'string' || !record.human_id) {
    throw new BadRequestException({ error: 'Некорректный запрос' });
  }
  if (record.uuid != null && (typeof record.uuid !== 'string' || !record.uuid)) {
    throw new BadRequestException({ error: 'Некорректный запрос' });
  }
  return { human_id: record.human_id, uuid: typeof record.uuid === 'string' ? record.uuid : undefined };
}

function parseDecision(body: unknown): 'allow' | 'deny' {
  if (!body || typeof body !== 'object') throw new BadRequestException({ error: 'Некорректный запрос' });
  const decision = (body as { decision?: unknown }).decision;
  if (decision !== 'allow' && decision !== 'deny') {
    throw new BadRequestException({ error: 'Некорректный запрос' });
  }
  return decision;
}
