const REQUIRED_ENV = [
  'FINANCIAL_SERVICE_PORT',
  'FINANCIAL_DATABASE_URL',
  'FINANCIAL_DB_NAME',
  'LOGGING_SERVICE_URL',
  'LOGGING_SERVICE_API_PATH',
  'LOGGING_SERVICE_TIMEOUT',
  'AUTH_SERVICE_TIMEOUT',
  'PAYMENT_SERVICE_URL',
  'SALARY_SERVICE_URL',
  'COURSE_SERVICE_URL',
];

export function validateEnv(): void {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }

  const authBase = process.env.AUTH_SERVICE_URL || process.env.AUTH_MICROSERVICE_URL;
  if (!authBase) {
    throw new Error('Missing AUTH_SERVICE_URL or AUTH_MICROSERVICE_URL');
  }

  const pairTokens = [
    'FINANCIAL_TO_PAYMENT_SERVICE_TOKEN',
    'FINANCIAL_TO_SALARY_SERVICE_TOKEN',
    'FINANCIAL_TO_COURSE_SERVICE_TOKEN',
  ];
  const missingPairs = pairTokens.filter((key) => !(process.env[key] || '').trim());
  if (missingPairs.length > 0) {
    throw new Error(`Missing outbound Auth RS256 pair tokens: ${missingPairs.join(', ')}`);
  }

  const numericKeys = ['FINANCIAL_SERVICE_PORT', 'LOGGING_SERVICE_TIMEOUT', 'AUTH_SERVICE_TIMEOUT'];
  for (const key of numericKeys) {
    const v = process.env[key];
    if (!v || Number.isNaN(Number(v))) {
      throw new Error(`Invalid or missing numeric env var: ${key}`);
    }
  }
}
