export const REQUIRED_ENV = [
  'PORT',
  'SERVICE_NAME',
  'DATABASE_URL',
  'LOGGING_SERVICE_URL',
  'LOGGING_SERVICE_API_PATH',
  'LOGGING_SERVICE_TIMEOUT',
  'AUTH_SERVICE_URL',
  'AUTH_SERVICE_TIMEOUT',
  'DEFAULT_PAGE_SIZE',
  'MAX_PAGE_SIZE',
  // Auth RS256 pair JWTs (SERVICE_IDENTITY_CONSUMER_STANDARD).
  'EDUCATION_TO_NOTIFICATION_SERVICE_TOKEN',
  'EDUCATION_TO_CONTENT_SERVICE_TOKEN',
  'EDUCATION_TO_USER_SERVICE_TOKEN',
  'AI_SERVICE_URL',
  'DRILL_GENERATION_MODEL_TIER',
];

export function validateEnv(): void {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }

  const numericKeys = [
    'PORT',
    'LOGGING_SERVICE_TIMEOUT',
    'AUTH_SERVICE_TIMEOUT',
    'DEFAULT_PAGE_SIZE',
    'MAX_PAGE_SIZE',
  ];
  const invalid = numericKeys.filter((key) => Number.isNaN(Number(process.env[key])));
  if (invalid.length > 0) {
    throw new Error(`Invalid numeric env vars: ${invalid.join(', ')}`);
  }

  const maxPageSize = Number(process.env.MAX_PAGE_SIZE);
  if (maxPageSize > 30) {
    throw new Error('MAX_PAGE_SIZE must be 30 or less');
  }
}
