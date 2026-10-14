import fs from 'fs';
import path from 'path';
import { Inject, Injectable } from '@nestjs/common';
import { AppConfig } from '../config';
import { APP_CONFIG } from '../tokens';

@Injectable()
export class WorkdirService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  directory(checkId: string): string {
    const dir = path.join(this.config.workDir, 'checks', checkId);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  remove(checkId: string): void {
    fs.rmSync(path.join(this.config.workDir, 'checks', checkId), { recursive: true, force: true });
  }
}
