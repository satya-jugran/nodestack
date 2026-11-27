import { CreateFunctionDto } from '../../../../functions/types';

export const upvoteReviewFunction: CreateFunctionDto = {
  name: 'upvote-review',
  description: 'Increments or decrements the helpfulVotes counter on a customer review in SQLite',
  enabled: true,
  authPolicy: 'public',
  methods: ['POST'],
  timeoutMs: 2000,
  memoryLimitMb: 32,
  allowedDomains: [],
  elevated: true,
  env: {},
  code: "export default async function(core, context) {\n  const payload = context.request?.body || {};\n  const reviewId = String(payload.reviewId || '').trim();\n  const delta = Number(payload.delta ?? 1);\n\n  if (!reviewId) {\n    return {\n      status: 400,\n      body: { success: false, error: 'reviewId is required' }\n    };\n  }\n\n  try {\n    const review = await core.sdk.collection('reviews').get(reviewId);\n    if (!review) {\n      return {\n        status: 404,\n        body: { success: false, error: 'Review not found' }\n      };\n    }\n\n    const currentVotes = Number(review.helpfulVotes || 0);\n    const nextVotes = Math.max(0, currentVotes + (delta < 0 ? -1 : 1));\n    await core.sdk.collection('reviews').update(reviewId, {\n      helpfulVotes: nextVotes\n    });\n\n    return {\n      status: 200,\n      body: {\n        success: true,\n        reviewId,\n        helpfulVotes: nextVotes\n      }\n    };\n  } catch (err) {\n    return {\n      status: 404,\n      body: { success: false, error: err?.message || 'Review not found' }\n    };\n  }\n}",
};
