/**
 * Outbound credential to payment/salary/course internal slice routes.
 * Those receivers still compare X-Internal-Token until their own Auth RS256 migration.
 * Inbound financial InternalAuthGuard no longer uses FINANCIAL_INTERNAL_API_TOKEN.
 */
export function getOutboundInternalToken(): string {
  const token = (
    process.env.PAYMENT_SERVICE_INTERNAL_TOKEN ||
    process.env.SALARY_SERVICE_INTERNAL_TOKEN ||
    process.env.COURSE_SERVICE_INTERNAL_TOKEN ||
    process.env.INTERNAL_API_TOKEN ||
    ''
  ).trim();
  if (!token) {
    throw new Error(
      'Outbound internal token unset: set PAYMENT_SERVICE_INTERNAL_TOKEN (or salary/course/INTERNAL_API_TOKEN)',
    );
  }
  return token;
}
