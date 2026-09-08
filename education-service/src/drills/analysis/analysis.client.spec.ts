import { AnalysisClient } from './analysis.client';
import * as http from '../orchestration/http';

const request = {
  languageCode: 'en',
  materialLanguage: 'ru',
  level: 'A2',
  allowedTopicSlugs: ['en.other'],
  failures: [
    {
      answer: 'through',
      sentence: 'Walk {{0}} the park.',
      prompt: 'через',
      wrongAttempts: ['across'],
      revealed: false,
      mistakeCount: 1,
    },
  ],
  correlationId: 'cid-1',
};

describe('AnalysisClient', () => {
  const originalUrl = process.env.AI_SERVICE_URL;
  const originalToken = process.env.EDUCATION_TO_AI_SERVICE_TOKEN;

  beforeEach(() => {
    process.env.AI_SERVICE_URL = 'http://ai-microservice:3400';
    process.env.EDUCATION_TO_AI_SERVICE_TOKEN = 'edu-to-ai-rs256';
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env.AI_SERVICE_URL = originalUrl;
    process.env.EDUCATION_TO_AI_SERVICE_TOKEN = originalToken;
  });

  it('posts to the analyze route', async () => {
    const spy = jest.spyOn(http, 'requestUpstream').mockResolvedValue({
      clusters: [],
      meta: { model: 'claude-3', tier: 'smart', promptTokens: 100, completionTokens: 50 },
    } as any);

    await new AnalysisClient().analyze(request);

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'http://ai-microservice:3400/api/teacher-assistant/analyze-drill-errors',
        method: 'POST',
        body: request,
      }),
    );
  });

  it('sends the Auth pair JWT, never a caller token', async () => {
    const spy = jest.spyOn(http, 'requestUpstream').mockResolvedValue({
      clusters: [],
      meta: { model: 'claude-3', tier: 'smart', promptTokens: 100, completionTokens: 50 },
    } as any);

    await new AnalysisClient().analyze(request);

    expect(spy.mock.calls[0][0].token).toBe('edu-to-ai-rs256');
  });

  it('propagates an upstream failure rather than returning empty clusters', async () => {
    jest.spyOn(http, 'requestUpstream').mockRejectedValue(new Error('502 Bad Gateway'));

    await expect(new AnalysisClient().analyze(request)).rejects.toThrow('502 Bad Gateway');
  });

  it('raises when AI_SERVICE_URL is unset', async () => {
    delete process.env.AI_SERVICE_URL;

    await expect(new AnalysisClient().analyze(request)).rejects.toThrow(/AI_SERVICE_URL/);
  });

  it('raises when EDUCATION_TO_AI_SERVICE_TOKEN is unset', async () => {
    delete process.env.EDUCATION_TO_AI_SERVICE_TOKEN;

    await expect(new AnalysisClient().analyze(request)).rejects.toThrow(
      /EDUCATION_TO_AI_SERVICE_TOKEN/,
    );
  });
});
