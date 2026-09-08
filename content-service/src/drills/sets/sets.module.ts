import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { SetsController } from './sets.controller';
import { SetsService } from './sets.service';

@Module({
  imports: [AuthModule],
  controllers: [SetsController],
  providers: [SetsService],
  exports: [SetsService],
})
export class SetsModule {}
