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

  const token =
    process.env.PAYMENT_SERVICE_INTERNAL_TOKEN ||
    process.env.SALARY_SERVICE_INTERNAL_TOKEN ||
    process.env.COURSE_SERVICE_INTERNAL_TOKEN ||
    process.env.INTERNAL_API_TOKEN;
  if (!token) {
    throw new Error(
      'Missing outbound internal token: set PAYMENT_SERVICE_INTERNAL_TOKEN (or salary/course/INTERNAL_API_TOKEN)',
    );
  }

  const numericKeys = ['FINANCIAL_SERVICE_PORT', 'LOGGING_SERVICE_TIMEOUT', 'AUTH_SERVICE_TIMEOUT'];
  for (const key of numericKeys) {
    const v = process.env[key];
    if (!v || Number.isNaN(Number(v))) {
      throw new Error(`Invalid or missing numeric env var: ${key}`);
    }
  }
}
