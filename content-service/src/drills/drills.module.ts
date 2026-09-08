import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DrillsController } from './drills.controller';
import { DrillsService } from './drills.service';
import { VocabularyController } from '../vocabulary/vocabulary.controller';
import { VocabularyService } from '../vocabulary/vocabulary.service';

// Owns both the drill-bank endpoints and the vocabulary-baseline endpoint.
@Module({
  imports: [AuthModule],
  controllers: [DrillsController, VocabularyController],
  providers: [DrillsService, VocabularyService],
})
export class DrillsModule {}
