import { Module } from '@nestjs/common';

/**
 * AIO access lives in HttpAioClient. The process wires that client
 * (or a test double) through RuntimeModule as the AioClient token.
 * Every live call puts AIO_TOKEN only in the query parameter `token`.
 */
@Module({})
export class AioModule {}
