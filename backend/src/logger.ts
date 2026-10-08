import { LoggerService } from '@nestjs/common';
import { AppConfig, secretList } from './config';
import { redactSecrets } from './redact';

export function nestLogger(config: AppConfig): LoggerService {
  const secrets = secretList(config);
  const write = (message: unknown, level: 'log' | 'warn' | 'error') => {
    const text = redactSecrets(typeof message === 'string' ? message : JSON.stringify(message), secrets);
    if (level === 'error') console.error(text);
    else if (level === 'warn') console.warn(text);
    else console.log(text);
  };
  return {
    log: (message) => write(message, 'log'),
    warn: (message) => write(message, 'warn'),
    error: (message) => write(message, 'error'),
    debug: () => undefined,
    verbose: () => undefined,
  };
}
