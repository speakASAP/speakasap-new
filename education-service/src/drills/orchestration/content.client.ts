import { Injectable } from '@nestjs/common';
import {
  DrillBlank,
  DrillItemSearchRequest,
  DrillItemSearchResponse,
  DrillSetDetailDTO,
  DrillSetDTO,
  DrillLanguageDTO,
  DrillSetOrigin,
  DrillSetReviewState,
  DrillTemplate,
  DrillTopicDTO,
  ValidationState,
  VocabularyBaseline,
} from '../contracts';
import { numericEnv, requestUpstream, requiredEnv } from './http';

const UPSTREAM = 'content-service';

/** Mirrors content-service's `CreateSetInput` (src/drills/sets/sets.service.ts). */
export interface CreateSetInput {
  uuid: string;
  title: string;
  languageId: number;
  materialLanguage: string;
  level?: string | null;
  topicSlugs?: string[];
  courseKey?: string | null;
  lessonOrder?: number | null;
  origin: DrillSetOrigin;
  reviewState?: DrillSetReviewState;
  createdByTeacherId?: number | null;
  instructions?: string | null;
  visibility?: 'SHARED' | 'PRIVATE';
  knownWordRatio?: number | null;
  /** Existing bank rows to attach, in order. */
  itemIds: number[];
  /**
   * Items with no bank row yet — AI output. content-service creates the rows
   * inside the same transaction as the set.
   *
   * Required because `itemIds` can only reference rows that already exist,
   * which is true of bank items and never of generated ones. Omitting these
   * produced sets with zero items while the pipeline reported success.
   */
  newItems?: ReplacementItem[];
}

/** A replacement drill item, not yet persisted — content-service assigns the id. */
export interface ReplacementItem {
  template: DrillTemplate;
  blanks: DrillBlank[];
  hint: string | null;
  topicSlug: string;
}

/**
 * Calls into content-service (Tracks A and A2) for the bank, the vocabulary
 * baseline and drill sets.
 *
 * Auth RS256 pair JWT (EDUCATION_TO_CONTENT_SERVICE_TOKEN) as Authorization Bearer.
 * Static x-internal-token / INTERNAL_API_TOKEN deleted.
 */
@Injectable()
export class ContentClient {
  /** code -> content-service Language.id. Populated on first resolve. */
  private readonly languageIds = new Map<string, number>();

  timeoutMs(): number {
    return numericEnv('DRILL_CLIENT_TIMEOUT_MS', 30000);
  }

  async searchItems(
    req: DrillItemSearchRequest,
    token: string,
  ): Promise<DrillItemSearchResponse> {
    return requestUpstream<DrillItemSearchResponse>({
      url: `${this.baseUrl()}/api/v1/internal/drill-items/search`,
      method: 'POST',
      token: this.serviceToken(),
      body: req,
      timeoutMs: this.timeoutMs(),
      upstream: UPSTREAM,
    });
  }

  async getBaseline(
    courseKey: string,
    languageCode: string,
    maxLessonOrder: number,
    token: string,
  ): Promise<VocabularyBaseline> {
    const query = new URLSearchParams({
      courseKey,
      languageCode,
      maxLessonOrder: String(maxLessonOrder),
    });
    return requestUpstream<VocabularyBaseline>({
      url: `${this.baseUrl()}/api/v1/internal/course-vocabulary?${query}`,
      method: 'GET',
      token: this.serviceToken(),
      timeoutMs: this.timeoutMs(),
      upstream: UPSTREAM,
    });
  }

  async getTopics(
    languageCode: string,
    materialLanguage: string,
    token: string,
  ): Promise<DrillTopicDTO[]> {
    const query = new URLSearchParams({ languageCode, materialLanguage });
    return requestUpstream<DrillTopicDTO[]>({
      url: `${this.baseUrl()}/api/v1/drill-topics?${query}`,
      method: 'GET',
      token: this.serviceToken(),
      timeoutMs: this.timeoutMs(),
      upstream: UPSTREAM,
    });
  }

  async createSet(input: CreateSetInput, token: string): Promise<DrillSetDetailDTO> {
    return requestUpstream<DrillSetDetailDTO>({
      url: `${this.baseUrl()}/api/v1/internal/drill-sets`,
      method: 'POST',
      token: this.serviceToken(),
      body: input,
      timeoutMs: this.timeoutMs(),
      upstream: UPSTREAM,
    });
  }

  async getSet(setUuid: string, token: string): Promise<DrillSetDetailDTO> {
    return requestUpstream<DrillSetDetailDTO>({
      url: `${this.baseUrl()}/api/v1/internal/drill-sets/${encodeURIComponent(setUuid)}`,
      method: 'GET',
      token: this.serviceToken(),
      timeoutMs: this.timeoutMs(),
      upstream: UPSTREAM,
    });
  }

  /**
   * Replaces the items at `positions` (DrillSetItem.order values) with `items`, writing
   * the outgoing rows to DrillItemRevision first. Internal-only: the request body
   * carries `blanks`, and `blanks` carries answers.
   */
  async replaceSetItems(
    setUuid: string,
    positions: number[],
    items: ReplacementItem[],
    options: { recordRevisionReason: string },
    token: string,
  ): Promise<DrillSetDetailDTO> {
    return requestUpstream<DrillSetDetailDTO>({
      url: `${this.baseUrl()}/api/v1/internal/drill-sets/${encodeURIComponent(setUuid)}/replace-items`,
      method: 'POST',
      token: this.serviceToken(),
      body: { positions, items, recordRevisionReason: options.recordRevisionReason },
      timeoutMs: this.timeoutMs(),
      upstream: UPSTREAM,
    });
  }

  /**
   * Teacher edits to one sentence of a set. Internal-only for the same reason as
   * `replaceSetItems`: the body carries a template, and a template carries its answers.
   *
   * content-service validates the template itself and rejects the write with the failing
   * issues — this is a pass-through, not a second opinion.
   */
  async updateSetItem(
    setUuid: string,
    itemId: number,
    patch: { template?: string; hint?: string | null; validationState?: ValidationState },
    token: string,
  ): Promise<DrillSetDetailDTO> {
    return requestUpstream<DrillSetDetailDTO>({
      url: `${this.baseUrl()}/api/v1/internal/drill-sets/${encodeURIComponent(setUuid)}/items/${itemId}`,
      method: 'PATCH',
      token: this.serviceToken(),
      body: patch,
      timeoutMs: this.timeoutMs(),
      upstream: UPSTREAM,
    });
  }

  async deleteSetItem(
    setUuid: string,
    itemId: number,
    token: string,
  ): Promise<DrillSetDetailDTO> {
    return requestUpstream<DrillSetDetailDTO>({
      url: `${this.baseUrl()}/api/v1/internal/drill-sets/${encodeURIComponent(setUuid)}/items/${itemId}`,
      method: 'DELETE',
      token: this.serviceToken(),
      timeoutMs: this.timeoutMs(),
      upstream: UPSTREAM,
    });
  }

  async addSetItem(
    setUuid: string,
    item: { template: string; hint: string | null },
    token: string,
  ): Promise<DrillSetDetailDTO> {
    return requestUpstream<DrillSetDetailDTO>({
      url: `${this.baseUrl()}/api/v1/internal/drill-sets/${encodeURIComponent(setUuid)}/items`,
      method: 'POST',
      token: this.serviceToken(),
      body: item,
      timeoutMs: this.timeoutMs(),
      upstream: UPSTREAM,
    });
  }

  /**
   * Patches a set's review state. content-service refuses to grant APPROVED through
   * this route — that decision belongs to the approve route, which is where the "no
   * item is still FAIL" check lives.
   */
  /**
   * Approve a set for assignment. `teacherId` is supplied by the caller of this method,
   * never taken from a browser request body — the route it wraps trusts it outright.
   */
  async approveSet(setUuid: string, teacherId: number, token: string): Promise<unknown> {
    return requestUpstream<unknown>({
      url: `${this.baseUrl()}/api/v1/internal/drill-sets/${encodeURIComponent(setUuid)}/approve`,
      method: 'POST',
      body: { teacherId },
      token: this.serviceToken(),
      timeoutMs: this.timeoutMs(),
      upstream: UPSTREAM,
    });
  }

  async updateSet(
    setUuid: string,
    patch: { reviewState?: DrillSetReviewState },
    token: string,
  ): Promise<DrillSetDTO> {
    return requestUpstream<DrillSetDTO>({
      url: `${this.baseUrl()}/api/v1/internal/drill-sets/${encodeURIComponent(setUuid)}/update`,
      method: 'POST',
      token: this.serviceToken(),
      body: patch,
      timeoutMs: this.timeoutMs(),
      upstream: UPSTREAM,
    });
  }

  async listLanguages(token: string): Promise<DrillLanguageDTO[]> {
    return requestUpstream<DrillLanguageDTO[]>({
      url: `${this.baseUrl()}/api/v1/drill-languages`,
      method: 'GET',
      token: this.serviceToken(),
      timeoutMs: this.timeoutMs(),
      upstream: UPSTREAM,
    });
  }

  /**
   * Maps an ISO code to content-service's numeric `Language.id`, which `CreateSetInput`
   * requires and this service has no table for.
   *
   * Cached for the process lifetime: the language list changes when a new language is
   * added to the site, which is a deploy-scale event, and fetching it on every
   * generation would put a network hop in front of every teacher request to answer a
   * question whose answer never moves. A failed lookup is not cached, so a transient
   * outage does not poison the map until the next restart.
   *
   * Throws rather than defaulting. Guessing an id here files a set under the wrong
   * language, where it would surface in another language's library — silently wrong is
   * worse than a failed request the teacher can retry.
   */
  async resolveLanguageId(languageCode: string, token: string): Promise<number> {
    const cached = this.languageIds.get(languageCode);
    if (cached !== undefined) {
      return cached;
    }

    const languages = await this.listLanguages(token);
    for (const language of languages) {
      this.languageIds.set(language.code, language.id);
    }

    const resolved = this.languageIds.get(languageCode);
    if (resolved === undefined) {
      throw new Error(
        `content-service knows no language with code "${languageCode}"`,
      );
    }
    return resolved;
  }

  private baseUrl(): string {
    return requiredEnv('CONTENT_SERVICE_URL', UPSTREAM);
  }

  private serviceToken(): string {
    return requiredEnv('EDUCATION_TO_CONTENT_SERVICE_TOKEN', UPSTREAM);
  }
}
