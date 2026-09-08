import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InternalAuthGuard } from '../../auth/internal-token.guard';
import { Roles } from '../../auth/roles.decorator';
import { CONTENT_SERVICE_INTERNAL_ROLE } from '../drills.controller';
import { SetsService, CreateSetInput, ReplacementItem } from './sets.service';
import {
  DrillSetDetailDTO,
  DrillSetDTO,
  DrillSetListResponse,
  DrillSetReviewState,
  ValidationState,
} from '../contracts';

/** Identity of the caller, resolved upstream. Never read from the request body. */
export interface RaterContext {
  raterId: number;
  raterType: 'TEACHER' | 'STUDENT';
}

export interface StudentScope {
  courseKey?: string;
  lessonOrder?: number;
}

// SECURITY: public list/available-for-me/ratings stay unguarded (no answers).
// Internal detail/mutate routes require Auth RS256
// (`internal:content-service:internal`). Gateway-only trust deleted.
@Controller()
export class SetsController {
  private readonly logger = new Logger(SetsController.name);

  constructor(private readonly setsService: SetsService) {}

  @Get('drill-sets')
  async list(@Query() query: any): Promise<DrillSetListResponse> {
    return this.setsService.list({
      languageCode: query.languageCode,
      materialLanguage: query.materialLanguage,
      topicSlugs: toArray(query.topicSlugs),
      courseKey: query.courseKey,
      lessonOrder: toInt(query.lessonOrder),
      q: query.q,
      sort: query.sort,
      createdBy: toInt(query.createdBy),
      reviewState: query.reviewState,
      groupBy: query.groupBy,
      limit: toInt(query.limit),
      offset: toInt(query.offset),
    });
  }

  /**
   * The student-facing library. Two rules, both enforced here rather than
   * trusted to the caller:
   *   - only APPROVED sets are visible;
   *   - nothing beyond the student's current lesson.
   * The response is DrillSetDTO[], which carries no answers.
   */
  @Get('drill-sets/available-for-me')
  async availableForMe(scope: StudentScope): Promise<DrillSetListResponse> {
    const start = Date.now();
    const result = await this.setsService.list({
      reviewState: 'APPROVED',
      courseKey: scope.courseKey,
      maxLessonOrder: scope.lessonOrder,
      sort: 'popularity',
    });
    this.logger.log(
      `Student drill-set library: returned=${result.sets.length} courseKey=${scope.courseKey || 'none'} maxLessonOrder=${scope.lessonOrder ?? 'none'} latencyMs=${Date.now() - start}`,
    );
    return result;
  }

  // Internal-only: carries answers. See the class-level security note.
  @Get('internal/drill-sets/:uuid')
  @UseGuards(InternalAuthGuard)
  @Roles(CONTENT_SERVICE_INTERNAL_ROLE)
  async getSet(@Param('uuid') uuid: string): Promise<DrillSetDetailDTO> {
    return this.setsService.getSet(uuid);
  }

  @Post('internal/drill-sets')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(InternalAuthGuard)
  @Roles(CONTENT_SERVICE_INTERNAL_ROLE)
  async createSet(@Body() body: CreateSetInput): Promise<DrillSetDetailDTO> {
    if (!body?.uuid) {
      throw new BadRequestException('uuid is required');
    }
    if (!body?.title) {
      throw new BadRequestException('title is required');
    }
    if (!Array.isArray(body?.itemIds)) {
      throw new BadRequestException('itemIds is required (may be an empty array)');
    }
    return this.setsService.createSet(body);
  }

  /**
   * Replaces items at given `order` positions. Internal-only for the same reason as the
   * detail route above: the request body carries `blanks`, and `blanks` carries answers.
   *
   * Called by education-service's regeneration loop when a teacher rejects items.
   */
  @Post('internal/drill-sets/:uuid/replace-items')
  @HttpCode(HttpStatus.OK)
  @UseGuards(InternalAuthGuard)
  @Roles(CONTENT_SERVICE_INTERNAL_ROLE)
  async replaceSetItems(
    @Param('uuid') uuid: string,
    @Body()
    body: {
      positions?: number[];
      items?: ReplacementItem[];
      recordRevisionReason?: string;
    },
  ): Promise<DrillSetDetailDTO> {
    if (!Array.isArray(body?.positions) || !Array.isArray(body?.items)) {
      throw new BadRequestException('positions and items are required arrays');
    }
    if (!body.recordRevisionReason) {
      // The revision reason is what makes the history readable later. An unlabelled
      // revision row tells a teacher a sentence changed but not why.
      throw new BadRequestException('recordRevisionReason is required');
    }
    return this.setsService.replaceSetItems(uuid, body.positions, body.items, {
      recordRevisionReason: body.recordRevisionReason,
    });
  }

  /**
   * Teacher edits to one sentence of a set — the review screen's Edit and override
   * controls.
   *
   * Internal-only for the same reason as the routes above: the body carries a template
   * with its answers in it. education-service checks the caller is staff and makes the
   * hop with its own token.
   */
  @Patch('internal/drill-sets/:uuid/items/:itemId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(InternalAuthGuard)
  @Roles(CONTENT_SERVICE_INTERNAL_ROLE)
  async updateSetItem(
    @Param('uuid') uuid: string,
    @Param('itemId') itemId: string,
    @Body() body: { template?: string; hint?: string | null; validationState?: ValidationState },
  ): Promise<DrillSetDetailDTO> {
    const id = Number(itemId);
    if (!Number.isInteger(id)) {
      throw new BadRequestException('numeric itemId is required');
    }
    if (
      body?.template === undefined &&
      body?.hint === undefined &&
      body?.validationState === undefined
    ) {
      // An empty patch would report success having changed nothing, which reads to a
      // teacher as "my edit was saved".
      throw new BadRequestException('nothing to update: send template, hint or validationState');
    }
    return this.setsService.updateSetItem(uuid, id, body);
  }

  @Delete('internal/drill-sets/:uuid/items/:itemId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(InternalAuthGuard)
  @Roles(CONTENT_SERVICE_INTERNAL_ROLE)
  async deleteSetItem(
    @Param('uuid') uuid: string,
    @Param('itemId') itemId: string,
  ): Promise<DrillSetDetailDTO> {
    const id = Number(itemId);
    if (!Number.isInteger(id)) {
      throw new BadRequestException('numeric itemId is required');
    }
    return this.setsService.deleteSetItem(uuid, id);
  }

  /** Appends a teacher-written sentence. Internal-only: the template carries answers. */
  @Post('internal/drill-sets/:uuid/items')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(InternalAuthGuard)
  @Roles(CONTENT_SERVICE_INTERNAL_ROLE)
  async addSetItem(
    @Param('uuid') uuid: string,
    @Body() body: { template?: string; hint?: string | null },
  ): Promise<DrillSetDetailDTO> {
    if (typeof body?.template !== 'string' || body.template.trim() === '') {
      throw new BadRequestException('template is required');
    }
    return this.setsService.addSetItem(uuid, {
      template: body.template,
      hint: body.hint ?? null,
    });
  }

  /**
   * Patches a set's review state. APPROVED is not grantable here — see updateSet.
   */
  @Post('internal/drill-sets/:uuid/update')
  @HttpCode(HttpStatus.OK)
  @UseGuards(InternalAuthGuard)
  @Roles(CONTENT_SERVICE_INTERNAL_ROLE)
  async updateSet(
    @Param('uuid') uuid: string,
    @Body() body: { reviewState?: DrillSetReviewState },
  ): Promise<DrillSetDTO> {
    return this.setsService.updateSet(uuid, { reviewState: body?.reviewState });
  }

  @Post('internal/drill-sets/:uuid/approve')
  @HttpCode(HttpStatus.OK)
  @UseGuards(InternalAuthGuard)
  @Roles(CONTENT_SERVICE_INTERNAL_ROLE)
  async approveSet(
    @Param('uuid') uuid: string,
    @Body() body: { teacherId?: number },
  ): Promise<DrillSetDTO> {
    const teacherId = Number(body?.teacherId);
    if (!Number.isInteger(teacherId) || teacherId <= 0) {
      throw new BadRequestException('numeric teacherId is required');
    }
    return this.setsService.approveSet(uuid, teacherId);
  }

  /**
   * The rater is taken from the resolved caller context, never from the body —
   * otherwise a student could cast a teacher-weighted vote (3x) or vote as
   * someone else. Spec 8.3 states this explicitly.
   */
  @Post('drill-sets/:uuid/ratings')
  @HttpCode(HttpStatus.OK)
  async rateSet(
    @Param('uuid') uuid: string,
    @Body() body: { value: number; comment?: string },
    rater: RaterContext,
  ): Promise<DrillSetDTO> {
    return this.setsService.recordRating(uuid, rater.raterType, rater.raterId, body?.value, body?.comment);
  }
}

function toArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return Array.isArray(value) ? (value as string[]) : String(value).split(',').filter(Boolean);
}

function toInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
