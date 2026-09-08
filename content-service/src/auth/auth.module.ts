import { Module } from '@nestjs/common';
import { InternalAuthGuard } from './internal-token.guard';

@Module({
  providers: [InternalAuthGuard],
  exports: [InternalAuthGuard],
})
export class AuthModule {}
