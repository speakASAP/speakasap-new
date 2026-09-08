import { validateEnv } from './validate-env';

const REQUIRED_BASE_ENV: Record<string, string> = {
  PORT: '4212',
  SERVICE_NAME: 'education-service',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  LOGGING_SERVICE_URL: 'http://logging-microservice:3000',
  LOGGING_SERVICE_API_PATH: '/api/v1/logs',
  LOGGING_SERVICE_TIMEOUT: '5000',
  AUTH_SERVICE_URL: 'http://auth-microservice:3370',
  AUTH_SERVICE_TIMEOUT: '5000',
  DEFAULT_PAGE_SIZE: '10',
  MAX_PAGE_SIZE: '30',
  EDUCATION_TO_USER_SERVICE_TOKEN: 'rs256-edu-to-user',
  EDUCATION_TO_NOTIFICATION_SERVICE_TOKEN: 'rs256-edu-to-notification',
  EDUCATION_TO_CONTENT_SERVICE_TOKEN: 'rs256-edu-to-content',
  EDUCATION_TO_AI_SERVICE_TOKEN: 'rs256-edu-to-ai',
  EDUCATION_TO_PORTAL_SERVICE_TOKEN: 'rs256-edu-to-portal',
  AI_SERVICE_URL: 'http://ai-microservice:3380',
  DRILL_GENERATION_MODEL_TIER: 'smart',
};

describe('validateEnv (drilling assignments env vars)', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('does not throw when all required env vars, including the drilling ones, are set', () => {
    process.env = { ...process.env, ...REQUIRED_BASE_ENV };
    expect(() => validateEnv()).not.toThrow();
  });

  it('throws naming AI_SERVICE_URL when it is missing', () => {
    const { AI_SERVICE_URL, ...rest } = REQUIRED_BASE_ENV;
    process.env = { ...process.env, ...rest };
    delete process.env.AI_SERVICE_URL;
    expect(() => validateEnv()).toThrow(/AI_SERVICE_URL/);
  });

  it('throws naming DRILL_GENERATION_MODEL_TIER when it is missing', () => {
    const { DRILL_GENERATION_MODEL_TIER, ...rest } = REQUIRED_BASE_ENV;
    process.env = { ...process.env, ...rest };
    delete process.env.DRILL_GENERATION_MODEL_TIER;
    expect(() => validateEnv()).toThrow(/DRILL_GENERATION_MODEL_TIER/);
  });
});
