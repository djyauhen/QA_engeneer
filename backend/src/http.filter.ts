import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { Response } from 'express';
import { AppConfig, secretList } from './config';
import { redactSecrets } from './redact';

@Catch()
export class RedactingFilter implements ExceptionFilter {
  constructor(private readonly config: AppConfig) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      response.status(exception.getStatus()).json(typeof body === 'string' ? { error: body } : body);
      return;
    }
    const raw = exception instanceof Error ? exception.message : 'error';
    console.error(redactSecrets(raw, secretList(this.config)));
    response.status(500).json({ error: 'internal_error' });
  }
}
