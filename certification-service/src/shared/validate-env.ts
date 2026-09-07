const REQUIRED_ENV = [
  'PORT',
  'SERVICE_NAME',
  'DATABASE_URL',
  'LOGGING_SERVICE_URL',
  'LOGGING_SERVICE_API_PATH',
  'LOGGING_SERVICE_TIMEOUT',
  'DEFAULT_PAGE_SIZE',
  'MAX_PAGE_SIZE',
  'AUTH_SERVICE_URL',
  'AUTH_SERVICE_TIMEOUT',
  'CERT_VIEW_TOKEN_SECRET',
  'MATERIALS_PUBLIC_BASE_URL',
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
