const REQUIRED_ENV = [
  'PORT',
  'SERVICE_NAME',
  'LOGGING_SERVICE_URL',
  'LOGGING_SERVICE_API_PATH',
  'LOGGING_SERVICE_TIMEOUT',
  'AUTH_SERVICE_TIMEOUT',
  'CONTENT_SERVICE_URL',
  'CERTIFICATION_SERVICE_URL',
  'ASSESSMENT_SERVICE_URL',
  'USER_SERVICE_URL',
  'COURSE_SERVICE_URL',
  'EDUCATION_SERVICE_URL',
  'PAYMENT_SERVICE_URL',
  'NOTIFICATION_SERVICE_URL',
  'SALARY_SERVICE_URL',
  'FINANCIAL_SERVICE_URL',
  'GATEWAY_TO_USER_SERVICE_TOKEN',
  'GATEWAY_TO_EDUCATION_SERVICE_TOKEN',
  'GATEWAY_TO_CONTENT_SERVICE_TOKEN',
  'GATEWAY_TO_FINANCIAL_SERVICE_TOKEN',
  'GATEWAY_TO_PAYMENT_SERVICE_TOKEN',
  'GATEWAY_TO_SALARY_SERVICE_TOKEN',
  'GATEWAY_TO_COURSE_SERVICE_TOKEN',
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

  const numericKeys = ['PORT', 'LOGGING_SERVICE_TIMEOUT', 'AUTH_SERVICE_TIMEOUT'];
  for (const key of numericKeys) {
    const v = process.env[key];
    if (!v || Number.isNaN(Number(v))) {
      throw new Error(`Invalid or missing numeric env var: ${key}`);
    }
  }
}
