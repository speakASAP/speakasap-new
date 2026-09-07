const REQUIRED_ENV = [
  'NOTIFICATION_SERVICE_PORT',
  'NOTIFICATION_DATABASE_URL',
  'NOTIFICATION_SERVICE_URL',
  'LOGGING_SERVICE_URL',
  'LOGGING_SERVICE_API_PATH',
  'LOGGING_SERVICE_TIMEOUT',
  'AUTH_SERVICE_TIMEOUT',
  'NOTIFICATION_TO_USER_SERVICE_TOKEN',
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

  const numericKeys = ['NOTIFICATION_SERVICE_PORT', 'LOGGING_SERVICE_TIMEOUT', 'AUTH_SERVICE_TIMEOUT'];
  for (const key of numericKeys) {
    const v = process.env[key];
    if (!v || Number.isNaN(Number(v))) {
      throw new Error(`Invalid or missing numeric env var: ${key}`);
    }
  }
}
