import { TemplateCollectionDef, TemplateSeedContext } from '../../../types';

export const productSocialProofView: TemplateCollectionDef = {
  name: 'product_social_proof',
  dto: {
    name: 'product_social_proof',
    type: 'view',
    listRule: '',
    viewRule: '',
    createRule: null,
    updateRule: null,
    deleteRule: null,
    options: {
      viewQueries: {
        sqlite: `
          WITH rev_agg AS (
            SELECT
              product,
              COUNT(*) AS reviewCount,
              ROUND(AVG(CAST(rating AS REAL)), 1) AS avgRating,
              SUM(CASE WHEN verifiedPurchase = 1 THEN 1 ELSE 0 END) AS verifiedReviewCount,
              SUM(COALESCE(helpfulVotes, 0)) AS helpfulVotesTotal
            FROM reviews
            GROUP BY product
          ),
          fav_agg AS (
            SELECT product, COUNT(*) AS favoriteCount
            FROM favorites
            GROUP BY product
          )
          SELECT
            p.id AS id,
            p.name AS name,
            p.slug AS slug,
            p.category AS category,
            p.price AS price,
            p.originalPrice AS originalPrice,
            p.stock AS stock,
            p.status AS status,
            p.isFeatured AS isFeatured,
            CASE
              WHEN p.originalPrice IS NOT NULL AND p.originalPrice > p.price
                THEN CAST(ROUND(((p.originalPrice - p.price) / p.originalPrice) * 100.0) AS INTEGER)
              ELSE 0
            END AS discountPercent,
            COALESCE(r.reviewCount, 0) AS reviewCount,
            COALESCE(r.avgRating, 0) AS avgRating,
            COALESCE(r.verifiedReviewCount, 0) AS verifiedReviewCount,
            COALESCE(r.helpfulVotesTotal, 0) AS helpfulVotesTotal,
            COALESCE(f.favoriteCount, 0) AS favoriteCount
          FROM products p
          LEFT JOIN rev_agg r ON r.product = p.id
          LEFT JOIN fav_agg f ON f.product = p.id
        `.trim(),
        postgres: `
          WITH rev_agg AS (
            SELECT
              product,
              COUNT(*) AS "reviewCount",
              ROUND(CAST(AVG(rating) AS NUMERIC), 1) AS "avgRating",
              SUM(CASE WHEN "verifiedPurchase" IS TRUE THEN 1 ELSE 0 END) AS "verifiedReviewCount",
              SUM(COALESCE("helpfulVotes", 0)) AS "helpfulVotesTotal"
            FROM reviews
            GROUP BY product
          ),
          fav_agg AS (
            SELECT product, COUNT(*) AS "favoriteCount"
            FROM favorites
            GROUP BY product
          )
          SELECT
            p.id AS id,
            p.name AS name,
            p.slug AS slug,
            p.category AS category,
            p.price AS price,
            p."originalPrice" AS "originalPrice",
            p.stock AS stock,
            p.status AS status,
            p."isFeatured" AS "isFeatured",
            CASE
              WHEN p."originalPrice" IS NOT NULL AND p."originalPrice" > p.price
                THEN CAST(ROUND(CAST(((p."originalPrice" - p.price) / p."originalPrice") * 100.0 AS NUMERIC), 0) AS INTEGER)
              ELSE 0
            END AS "discountPercent",
            COALESCE(r."reviewCount", 0) AS "reviewCount",
            COALESCE(r."avgRating", 0) AS "avgRating",
            COALESCE(r."verifiedReviewCount", 0) AS "verifiedReviewCount",
            COALESCE(r."helpfulVotesTotal", 0) AS "helpfulVotesTotal",
            COALESCE(f."favoriteCount", 0) AS "favoriteCount"
          FROM products p
          LEFT JOIN rev_agg r ON r.product = p.id
          LEFT JOIN fav_agg f ON f.product = p.id
        `.trim(),
        mssql: `
          WITH rev_agg AS (
            SELECT
              product,
              COUNT(*) AS reviewCount,
              ROUND(AVG(CAST(rating AS FLOAT)), 1) AS avgRating,
              SUM(CASE WHEN verifiedPurchase = 1 THEN 1 ELSE 0 END) AS verifiedReviewCount,
              SUM(COALESCE(helpfulVotes, 0)) AS helpfulVotesTotal
            FROM reviews
            GROUP BY product
          ),
          fav_agg AS (
            SELECT product, COUNT(*) AS favoriteCount
            FROM favorites
            GROUP BY product
          )
          SELECT
            p.id AS id,
            p.name AS name,
            p.slug AS slug,
            p.category AS category,
            p.price AS price,
            p.originalPrice AS originalPrice,
            p.stock AS stock,
            p.status AS status,
            p.isFeatured AS isFeatured,
            CASE
              WHEN p.originalPrice IS NOT NULL AND p.originalPrice > p.price
                THEN CAST(ROUND(((p.originalPrice - p.price) / p.originalPrice) * 100.0, 0) AS INT)
              ELSE 0
            END AS discountPercent,
            COALESCE(r.reviewCount, 0) AS reviewCount,
            COALESCE(r.avgRating, 0) AS avgRating,
            COALESCE(r.verifiedReviewCount, 0) AS verifiedReviewCount,
            COALESCE(r.helpfulVotesTotal, 0) AS helpfulVotesTotal,
            COALESCE(f.favoriteCount, 0) AS favoriteCount
          FROM products p
          LEFT JOIN rev_agg r ON r.product = p.id
          LEFT JOIN fav_agg f ON f.product = p.id
        `.trim(),
      },
    },
  },
  seed: async (_ctx: TemplateSeedContext): Promise<Array<Record<string, any>>> => [],
};
