/**
 * Outbound Auth RS256 pair JWTs for financial → payment/salary/course.
 * Static shared INTERNAL_API_TOKEN / X-Internal-Token are deleted.
 * See auth-microservice/docs/SERVICE_IDENTITY_CONSUMER_STANDARD.md.
 */
export function getOutboundPaymentServiceToken(): string {
  const token = (process.env.FINANCIAL_TO_PAYMENT_SERVICE_TOKEN || '').trim();
  if (!token) {
    throw new Error('FINANCIAL_TO_PAYMENT_SERVICE_TOKEN is unset');
  }
  return token;
}

export function getOutboundSalaryServiceToken(): string {
  const token = (process.env.FINANCIAL_TO_SALARY_SERVICE_TOKEN || '').trim();
  if (!token) {
    throw new Error('FINANCIAL_TO_SALARY_SERVICE_TOKEN is unset');
  }
  return token;
}

export function getOutboundCourseServiceToken(): string {
  const token = (process.env.FINANCIAL_TO_COURSE_SERVICE_TOKEN || '').trim();
  if (!token) {
    throw new Error('FINANCIAL_TO_COURSE_SERVICE_TOKEN is unset');
  }
  return token;
}
