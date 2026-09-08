import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { InternalAuthGuard } from '../auth/internal-token.guard';
import { Roles } from '../auth/roles.decorator';
import { DrillsService } from './drills.service';
import {
  DrillItemSearchRequest,
  DrillItemSearchResponse,
  DrillLanguageDTO,
  DrillTopicDTO,
} from './contracts';

export const CONTENT_SERVICE_INTERNAL_ROLE = 'internal:content-service:internal';

/**
 * Public drill-topics/languages stay unguarded. Internal bank search requires
 * Auth RS256 (`internal:content-service:internal`). Gateway-only trust deleted.
 */
@Controller()
export class DrillsController {
  private readonly logger = new Logger(DrillsController.name);

  constructor(private readonly drillsService: DrillsService) {}

  /**
   * Carries no answers — an id, a code and a display name — so it sits under the public
   * prefix beside `drill-topics` rather than under `internal/`.
   */
  @Get('drill-languages')
  async listLanguages(): Promise<DrillLanguageDTO[]> {
    const start = Date.now();
    const result = await this.drillsService.listLanguages();
    this.logger.log(
      `Drill languages response: count=${result.length} latencyMs=${Date.now() - start}`,
    );
    return result;
  }

  @Get('drill-topics')
  async listTopics(
    @Query('languageCode') languageCode?: string,
    @Query('materialLanguage') materialLanguage?: string,
    @Req() req?: Request,
  ): Promise<DrillTopicDTO[]> {
    const start = Date.now();
    this.logger.log(
      `Drill topics request received: languageCode=${languageCode || 'all'} materialLanguage=${materialLanguage || 'all'}`,
    );
    this.logger.debug(
      `Request details: ${JSON.stringify({ method: req?.method, path: req?.path, query: req?.query, ip: req?.ip })}`,
    );

    const result = await this.drillsService.listTopics(languageCode, materialLanguage);
    this.logger.log(`Drill topics response: count=${result.length} latencyMs=${Date.now() - start}`);
    return result;
  }

  // Internal-only: blanks carry answers. Auth RS256 required on this service.
  @Post('internal/drill-items/search')
  @HttpCode(HttpStatus.OK)
  @UseGuards(InternalAuthGuard)
  @Roles(CONTENT_SERVICE_INTERNAL_ROLE)
  async searchItems(
    @Body() body: DrillItemSearchRequest,
    @Req() req?: Request,
  ): Promise<DrillItemSearchResponse> {
    const start = Date.now();
    if (!body?.languageCode) {
      throw new BadRequestException('languageCode is required');
    }
    if (!body?.materialLanguage) {
      throw new BadRequestException('materialLanguage is required');
    }
    if (!Array.isArray(body?.topicSlugs)) {
      throw new BadRequestException('topicSlugs is required (may be an empty array)');
    }
    if (typeof body?.limit !== 'number' || body.limit <= 0) {
      throw new BadRequestException('limit is required and must be a positive number');
    }

    this.logger.log(
      `Drill items search request received: languageCode=${body.languageCode} topicSlugs=${body.topicSlugs.length} courseKey=${body.courseKey || 'none'}`,
    );
    this.logger.debug(
      `Request details: ${JSON.stringify({ method: req?.method, path: req?.path, ip: req?.ip })}`,
    );

    const result = await this.drillsService.searchItems(body);
    this.logger.log(
      `Drill items search response: returned=${result.items.length} totalAvailable=${result.totalAvailable} latencyMs=${Date.now() - start}`,
    );
    return result;
  }
}
