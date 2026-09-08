import {
  BadRequestException,
  Controller,
  Get,
  Logger,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { InternalAuthGuard } from '../auth/internal-token.guard';
import { Roles } from '../auth/roles.decorator';
import { CONTENT_SERVICE_INTERNAL_ROLE } from '../drills/drills.controller';
import { VocabularyService } from './vocabulary.service';
import { VocabularyBaseline } from '../drills/contracts';

@Controller()
export class VocabularyController {
  private readonly logger = new Logger(VocabularyController.name);

  constructor(private readonly vocabularyService: VocabularyService) {}

  // Internal-only: course vocabulary baseline for generation. Auth RS256 required.
  @Get('internal/course-vocabulary')
  @UseGuards(InternalAuthGuard)
  @Roles(CONTENT_SERVICE_INTERNAL_ROLE)
  async getBaseline(
    @Query('courseKey') courseKey?: string,
    @Query('languageCode') languageCode?: string,
    @Query('maxLessonOrder') maxLessonOrder?: string,
    @Req() req?: Request,
  ): Promise<VocabularyBaseline> {
    const start = Date.now();
    if (!courseKey) {
      throw new BadRequestException('courseKey is required');
    }
    if (!languageCode) {
      throw new BadRequestException('languageCode is required');
    }
    const maxLessonOrderNumber = Number(maxLessonOrder);
    if (!maxLessonOrder || Number.isNaN(maxLessonOrderNumber)) {
      throw new BadRequestException('maxLessonOrder is required and must be a number');
    }

    this.logger.log(
      `Course vocabulary request received: courseKey=${courseKey} languageCode=${languageCode} maxLessonOrder=${maxLessonOrderNumber}`,
    );
    this.logger.debug(
      `Request details: ${JSON.stringify({ method: req?.method, path: req?.path, query: req?.query, ip: req?.ip })}`,
    );

    const result = await this.vocabularyService.getBaseline(courseKey, languageCode, maxLessonOrderNumber);
    this.logger.log(
      `Course vocabulary response: words=${result.words.length} hasBaseline=${result.hasBaseline} latencyMs=${Date.now() - start}`,
    );
    return result;
  }
}
