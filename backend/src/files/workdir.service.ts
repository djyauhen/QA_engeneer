import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { Inject, Injectable } from '@nestjs/common';
import { AppConfig } from '../config';
import { APP_CONFIG } from '../tokens';

@Injectable()
export class WorkdirService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  prepare(login: string): { dir: string; replaced: boolean } {
    const dir = path.join(this.config.workDir, 'users', createHash('sha256').update(login).digest('hex'), 'current');
    let replaced = false;
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      replaced = true;
    }
    fs.mkdirSync(dir, { recursive: true });
    return { dir, replaced };
  }
}
