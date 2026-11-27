import { TemplateCollectionDef, TemplateSeedContext } from '../../../types';
import { getStoreManagerRule } from '../access';

export const managerCatalogInsightsView: TemplateCollectionDef = {
  name: 'manager_catalog_insights',
  dto: {
    name: 'manager_catalog_insights',
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
          WITH rev_agg AS (
            SELECT
              product,
              COUNT(*) AS reviewCount,
              ROUND(AVG(CAST(rating AS REAL)), 1) AS avgRating,
              SUM(COALESCE(helpfulVotes, 0)) AS helpfulVotesTotal
            FROM reviews
            GROUP BY product
          ),
          fav_agg AS (
            SELECT product, COUNT(*) AS favoriteCount
            FROM favorites
            GROUP BY product
          ),
          cart_agg AS (
            SELECT
              product,
              SUM(COALESCE(quantity, 0)) AS inCartUnits,
              COUNT(DISTINCT user) AS cartShoppersCount
            FROM cart_items
            GROUP BY product
          )
          SELECT
            p.id AS id,
            p.name AS name,
            p.slug AS slug,
            p.category AS category,
            COALESCE(c.name, 'General') AS categoryName,
            p.price AS price,
            p.originalPrice AS originalPrice,
            p.stock AS stock,
            p.status AS status,
            ROUND(COALESCE(p.price, 0) * COALESCE(p.stock, 0), 2) AS inventoryValue,
            COALESCE(r.reviewCount, 0) AS reviewCount,
            COALESCE(r.avgRating, 0) AS avgRating,
            COALESCE(r.helpfulVotesTotal, 0) AS helpfulVotesTotal,
            COALESCE(f.favoriteCount, 0) AS favoriteCount,
            COALESCE(ci.inCartUnits, 0) AS inCartUnits,
            COALESCE(ci.cartShoppersCount, 0) AS cartShoppersCount
          FROM products p
          LEFT JOIN categories c ON c.id = p.category
          LEFT JOIN rev_agg r ON r.product = p.id
          LEFT JOIN fav_agg f ON f.product = p.id
          LEFT JOIN cart_agg ci ON ci.product = p.id
        `.trim(),
        postgres: `
          WITH rev_agg AS (
            SELECT
              product,
              COUNT(*) AS "reviewCount",
              ROUND(CAST(AVG(rating) AS NUMERIC), 1) AS "avgRating",
              SUM(COALESCE("helpfulVotes", 0)) AS "helpfulVotesTotal"
            FROM reviews
            GROUP BY product
          ),
          fav_agg AS (
            SELECT product, COUNT(*) AS "favoriteCount"
            FROM favorites
            GROUP BY product
          ),
          cart_agg AS (
            SELECT
              product,
              SUM(COALESCE(quantity, 0)) AS "inCartUnits",
              COUNT(DISTINCT "user") AS "cartShoppersCount"
            FROM cart_items
            GROUP BY product
          )
          SELECT
            p.id AS id,
            p.name AS name,
            p.slug AS slug,
            p.category AS category,
            COALESCE(c.name, 'General') AS "categoryName",
            p.price AS price,
            p."originalPrice" AS "originalPrice",
            p.stock AS stock,
            p.status AS status,
            ROUND(CAST(COALESCE(p.price, 0) * COALESCE(p.stock, 0) AS NUMERIC), 2) AS "inventoryValue",
            COALESCE(r."reviewCount", 0) AS "reviewCount",
            COALESCE(r."avgRating", 0) AS "avgRating",
            COALESCE(r."helpfulVotesTotal", 0) AS "helpfulVotesTotal",
            COALESCE(f."favoriteCount", 0) AS "favoriteCount",
            COALESCE(ci."inCartUnits", 0) AS "inCartUnits",
            COALESCE(ci."cartShoppersCount", 0) AS "cartShoppersCount"
          FROM products p
          LEFT JOIN categories c ON c.id = p.category
          LEFT JOIN rev_agg r ON r.product = p.id
          LEFT JOIN fav_agg f ON f.product = p.id
          LEFT JOIN cart_agg ci ON ci.product = p.id
        `.trim(),
        mssql: `
          WITH rev_agg AS (
            SELECT
              product,
              COUNT(*) AS reviewCount,
              ROUND(AVG(CAST(rating AS FLOAT)), 1) AS avgRating,
              SUM(COALESCE(helpfulVotes, 0)) AS helpfulVotesTotal
            FROM reviews
            GROUP BY product
          ),
          fav_agg AS (
            SELECT product, COUNT(*) AS favoriteCount
            FROM favorites
            GROUP BY product
          ),
          cart_agg AS (
            SELECT
              product,
              SUM(COALESCE(quantity, 0)) AS inCartUnits,
              COUNT(DISTINCT [user]) AS cartShoppersCount
            FROM cart_items
            GROUP BY product
          )
          SELECT
            p.id AS id,
            p.name AS name,
            p.slug AS slug,
            p.category AS category,
            COALESCE(c.name, 'General') AS categoryName,
            p.price AS price,
            p.originalPrice AS originalPrice,
            p.stock AS stock,
            p.status AS status,
            ROUND(COALESCE(p.price, 0) * COALESCE(p.stock, 0), 2) AS inventoryValue,
            COALESCE(r.reviewCount, 0) AS reviewCount,
            COALESCE(r.avgRating, 0) AS avgRating,
            COALESCE(r.helpfulVotesTotal, 0) AS helpfulVotesTotal,
            COALESCE(f.favoriteCount, 0) AS favoriteCount,
            COALESCE(ci.inCartUnits, 0) AS inCartUnits,
            COALESCE(ci.cartShoppersCount, 0) AS cartShoppersCount
          FROM products p
          LEFT JOIN categories c ON c.id = p.category
          LEFT JOIN rev_agg r ON r.product = p.id
          LEFT JOIN fav_agg f ON f.product = p.id
          LEFT JOIN cart_agg ci ON ci.product = p.id
        `.trim(),
      },
    },
  },
  seed: async (_ctx: TemplateSeedContext): Promise<Array<Record<string, any>>> => [],
};
