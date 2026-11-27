import { TemplateCollectionDef, TemplateSeedContext } from '../../../types';
import { getStoreManagerRule } from '../access';

export const managerOrderInsightsView: TemplateCollectionDef = {
  name: 'manager_order_insights',
  dto: {
    name: 'manager_order_insights',
    type: 'view',
    get listRule() {
      return getStoreManagerRule();
    },
    get viewRule() {
      return getStoreManagerRule();
    },
    createRule: null,
    updateRule: null,
    deleteRule: null,
    options: {
      viewQueries: {
        sqlite: `
          SELECT
            COALESCE(status, 'unknown') || ':' || COALESCE(paymentStatus, 'unknown') || ':' || COALESCE(NULLIF(TRIM(couponCode), ''), 'none') AS id,
            COALESCE(status, 'unknown') AS status,
            COALESCE(paymentStatus, 'unknown') AS paymentStatus,
            COALESCE(NULLIF(TRIM(couponCode), ''), 'none') AS couponCode,
            COUNT(*) AS orderCount,
            ROUND(SUM(COALESCE(total, 0)), 2) AS grossRevenue,
            ROUND(SUM(COALESCE(discount, 0)), 2) AS totalDiscount,
            ROUND(AVG(COALESCE(total, 0)), 2) AS avgOrderValue,
            SUM(COALESCE(loyaltyPoints, 0)) AS loyaltyPointsIssued
          FROM orders
          GROUP BY
            COALESCE(status, 'unknown'),
            COALESCE(paymentStatus, 'unknown'),
            COALESCE(NULLIF(TRIM(couponCode), ''), 'none')
        `.trim(),
        postgres: `
          SELECT
            COALESCE(status, 'unknown') || ':' || COALESCE("paymentStatus", 'unknown') || ':' || COALESCE(NULLIF(TRIM("couponCode"), ''), 'none') AS id,
            COALESCE(status, 'unknown') AS status,
            COALESCE("paymentStatus", 'unknown') AS "paymentStatus",
            COALESCE(NULLIF(TRIM("couponCode"), ''), 'none') AS "couponCode",
            COUNT(*) AS "orderCount",
            ROUND(CAST(SUM(COALESCE(total, 0)) AS NUMERIC), 2) AS "grossRevenue",
            ROUND(CAST(SUM(COALESCE(discount, 0)) AS NUMERIC), 2) AS "totalDiscount",
            ROUND(CAST(AVG(COALESCE(total, 0)) AS NUMERIC), 2) AS "avgOrderValue",
            SUM(COALESCE("loyaltyPoints", 0)) AS "loyaltyPointsIssued"
          FROM orders
          GROUP BY
            COALESCE(status, 'unknown'),
            COALESCE("paymentStatus", 'unknown'),
            COALESCE(NULLIF(TRIM("couponCode"), ''), 'none')
        `.trim(),
        mssql: `
          SELECT
            CONCAT(COALESCE(status, 'unknown'), ':', COALESCE(paymentStatus, 'unknown'), ':', COALESCE(NULLIF(LTRIM(RTRIM(couponCode)), ''), 'none')) AS id,
            COALESCE(status, 'unknown') AS status,
            COALESCE(paymentStatus, 'unknown') AS paymentStatus,
            COALESCE(NULLIF(LTRIM(RTRIM(couponCode)), ''), 'none') AS couponCode,
            COUNT(*) AS orderCount,
            ROUND(SUM(COALESCE(total, 0)), 2) AS grossRevenue,
            ROUND(SUM(COALESCE(discount, 0)), 2) AS totalDiscount,
            ROUND(AVG(COALESCE(total, 0)), 2) AS avgOrderValue,
            SUM(COALESCE(loyaltyPoints, 0)) AS loyaltyPointsIssued
          FROM orders
          GROUP BY
            COALESCE(status, 'unknown'),
            COALESCE(paymentStatus, 'unknown'),
            COALESCE(NULLIF(LTRIM(RTRIM(couponCode)), ''), 'none')
        `.trim(),
      },
    },
  },
  seed: async (_ctx: TemplateSeedContext): Promise<Array<Record<string, any>>> => [],
};
