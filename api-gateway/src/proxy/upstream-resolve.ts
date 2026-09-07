/**
 * First-match-wins over a hand-ordered array: the first entry whose prefix
 * matches owns the request. Ordering is NOT computed by prefix length —
 * entries must be listed most-specific-first, or a broader prefix placed
 * above a narrower one will silently shadow it.
 * Aligned with docs/refactoring/GATEWAY_ROUTE_OWNERSHIP_MATRIX.md
 */
export const ROUTES: { prefix: string; envKey: string }[] = [
  { prefix: '/api/v1/internal/financial/products-metadata', envKey: 'COURSE_SERVICE_URL' },
  { prefix: '/api/v1/internal/financial/orders-paid-slice', envKey: 'PAYMENT_SERVICE_URL' },
  { prefix: '/api/v1/internal/financial/transactions-slice', envKey: 'PAYMENT_SERVICE_URL' },
  { prefix: '/api/v1/internal/financial/period-salary-totals', envKey: 'SALARY_SERVICE_URL' },
  { prefix: '/api/v1/internal/financial/refresh-window', envKey: 'FINANCIAL_SERVICE_URL' },
  { prefix: '/api/v1/internal/financial', envKey: 'FINANCIAL_SERVICE_URL' },
  { prefix: '/api/v1/internal/salary', envKey: 'SALARY_SERVICE_URL' },
  // Must stay above '/api/v1/internal' below — otherwise it never matches
  // and internal drilling calls silently resolve to user-service and 404.
  { prefix: '/api/v1/internal/drill-assignments', envKey: 'EDUCATION_SERVICE_URL' },
  // Same reason as drill-assignments immediately above, plus a security reason:
  // these two responses carry DrillBlank.answer/.alternatives (drill-items/search)
  // and a course's known-vocabulary baseline (course-vocabulary) — Task A.8's
  // review found the gateway's auth guard checks for a valid token but not a
  // role, so any authenticated student could otherwise read drill answers.
  // Moving them under /api/v1/internal makes the gateway require Auth RS256 with
  // internal:speakasap-api-gateway:*. Must stay above '/api/v1/internal' below, or they
  // silently resolve to user-service and 404.
  { prefix: '/api/v1/internal/drill-items', envKey: 'CONTENT_SERVICE_URL' },
  { prefix: '/api/v1/internal/course-vocabulary', envKey: 'CONTENT_SERVICE_URL' },
  { prefix: '/api/v1/internal/drill-sets', envKey: 'CONTENT_SERVICE_URL' },
  { prefix: '/api/v1/internal', envKey: 'USER_SERVICE_URL' },

  { prefix: '/api/v1/manager/user-questionnaires', envKey: 'CERTIFICATION_SERVICE_URL' },
  { prefix: '/api/v1/user-questionnaires', envKey: 'CERTIFICATION_SERVICE_URL' },
  { prefix: '/api/v1/questionnaires', envKey: 'CERTIFICATION_SERVICE_URL' },
  { prefix: '/api/v1/quests', envKey: 'CERTIFICATION_SERVICE_URL' },
  { prefix: '/api/v1/education-certificates', envKey: 'CERTIFICATION_SERVICE_URL' },
  { prefix: '/api/v1/course-certificates', envKey: 'CERTIFICATION_SERVICE_URL' },

  { prefix: '/api/v1/admin/language-user-tests', envKey: 'ASSESSMENT_SERVICE_URL' },
  { prefix: '/api/v1/admin/language-tests', envKey: 'ASSESSMENT_SERVICE_URL' },
  { prefix: '/api/v1/language-user-tests', envKey: 'ASSESSMENT_SERVICE_URL' },
  { prefix: '/api/v1/asset-user-tests', envKey: 'ASSESSMENT_SERVICE_URL' },

  { prefix: '/api/v1/employee-profiles', envKey: 'USER_SERVICE_URL' },
  { prefix: '/api/v1/managers', envKey: 'USER_SERVICE_URL' },
  { prefix: '/api/v1/teachers', envKey: 'USER_SERVICE_URL' },
  { prefix: '/api/v1/students', envKey: 'USER_SERVICE_URL' },

  { prefix: '/api/v1/part-payment-collections', envKey: 'COURSE_SERVICE_URL' },
  { prefix: '/api/v1/offers', envKey: 'COURSE_SERVICE_URL' },
  { prefix: '/api/v1/products', envKey: 'COURSE_SERVICE_URL' },
  { prefix: '/api/v1/categories', envKey: 'COURSE_SERVICE_URL' },

  { prefix: '/api/v1/student-courses', envKey: 'EDUCATION_SERVICE_URL' },
  { prefix: '/api/v1/homeworks', envKey: 'EDUCATION_SERVICE_URL' },
  { prefix: '/api/v1/lessons', envKey: 'EDUCATION_SERVICE_URL' },
  { prefix: '/api/v1/groups', envKey: 'EDUCATION_SERVICE_URL' },
  { prefix: '/api/v1/drill-assignments', envKey: 'EDUCATION_SERVICE_URL' },

  { prefix: '/api/v1/seven', envKey: 'CONTENT_SERVICE_URL' },
  { prefix: '/api/v1/dictionary', envKey: 'CONTENT_SERVICE_URL' },
  { prefix: '/api/v1/songs', envKey: 'CONTENT_SERVICE_URL' },
  { prefix: '/api/v1/phonetics', envKey: 'CONTENT_SERVICE_URL' },
  { prefix: '/api/v1/grammar', envKey: 'CONTENT_SERVICE_URL' },
  { prefix: '/api/v1/languages', envKey: 'CONTENT_SERVICE_URL' },
  { prefix: '/api/v1/drill-sets', envKey: 'CONTENT_SERVICE_URL' },
  // drill-items/search and course-vocabulary are internal-only as of the Task A.8
  // security fix (see the /api/v1/internal/drill-items and
  // /api/v1/internal/course-vocabulary entries above) — there is deliberately no
  // public-prefix entry for them here. drill-topics carries no answers and stays
  // public for Track F's teacher UI.
  { prefix: '/api/v1/drill-topics', envKey: 'CONTENT_SERVICE_URL' },
  // Language id/code/name only, no answers. Distinct from /api/v1/languages, which is
  // the site's own language controller — prefix matching gives them separate entries.
  { prefix: '/api/v1/drill-languages', envKey: 'CONTENT_SERVICE_URL' },

  { prefix: '/api/v1/webhooks/payments', envKey: 'PAYMENT_SERVICE_URL' },
  { prefix: '/api/v1/discounts', envKey: 'PAYMENT_SERVICE_URL' },
  { prefix: '/api/v1/invoices', envKey: 'PAYMENT_SERVICE_URL' },
  { prefix: '/api/v1/subscriptions', envKey: 'PAYMENT_SERVICE_URL' },
  { prefix: '/api/v1/orders', envKey: 'PAYMENT_SERVICE_URL' },

  { prefix: '/api/v1/notification-groups', envKey: 'NOTIFICATION_SERVICE_URL' },
  { prefix: '/api/v1/preferences/me', envKey: 'NOTIFICATION_SERVICE_URL' },
  { prefix: '/api/v1/dispatch', envKey: 'NOTIFICATION_SERVICE_URL' },
  { prefix: '/api/v1/in-app', envKey: 'NOTIFICATION_SERVICE_URL' },
  { prefix: '/api/v1/letters', envKey: 'NOTIFICATION_SERVICE_URL' },
  { prefix: '/api/v1/templates', envKey: 'NOTIFICATION_SERVICE_URL' },

  { prefix: '/api/v1/admin/summary', envKey: 'SALARY_SERVICE_URL' },
  { prefix: '/api/v1/salary-profiles', envKey: 'SALARY_SERVICE_URL' },
  { prefix: '/api/v1/salary-expenses', envKey: 'SALARY_SERVICE_URL' },
  { prefix: '/api/v1/calculation-runs', envKey: 'SALARY_SERVICE_URL' },
  { prefix: '/api/v1/payout-runs', envKey: 'SALARY_SERVICE_URL' },
  { prefix: '/api/v1/contracts', envKey: 'SALARY_SERVICE_URL' },

  { prefix: '/api/v1/dashboard/overview', envKey: 'FINANCIAL_SERVICE_URL' },
  { prefix: '/api/v1/revenue', envKey: 'FINANCIAL_SERVICE_URL' },
  { prefix: '/api/v1/expenses', envKey: 'FINANCIAL_SERVICE_URL' },
];

function normalizeBase(url: string): string {
  return url.replace(/\/$/, '');
}

export function resolveUpstreamBaseUrl(pathname: string): string | null {
  for (const { prefix, envKey } of ROUTES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      const raw = process.env[envKey];
      if (!raw) {
        return null;
      }
      return normalizeBase(raw);
    }
  }
  return null;
}
