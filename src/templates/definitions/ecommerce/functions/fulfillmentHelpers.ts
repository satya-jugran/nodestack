import { CreateFunctionDto } from '../../../../functions/types';

export const generateTrackingLabelFunction: CreateFunctionDto = {
  name: 'generate-tracking-label',
  description: 'Generates carrier shipping label, tracking number, and dispatch ETA',
  enabled: true,
  authPolicy: 'public',
  methods: ['POST'],
  timeoutMs: 2000,
  memoryLimitMb: 32,
  allowedDomains: [],
  elevated: false,
  env: {},
  code: "export default async function(core, context) {\n  const logger = core.observability.logger;\n  const order = context.request?.body?.record || context.request?.body || {};\n  const randCode = Math.floor(100000 + Math.random() * 900000);\n  const carriers = ['FedEx Priority Express', 'DHL Express Air', 'UPS Worldwide'];\n  const carrier = carriers[Math.floor(Math.random() * carriers.length)];\n  const trackingNumber = `TRK-US-${randCode}`;\n\n  const eta = new Date();\n  eta.setDate(eta.getDate() + 3);\n\n  logger.log(`[generate-tracking-label] Generated label for order #${order.orderNumber}: ${carrier} - ${trackingNumber}`);\n\n  return {\n    status: 200,\n    body: {\n      success: true,\n      carrier,\n      trackingNumber,\n      estimatedDelivery: eta.toISOString().split('T')[0],\n      dispatchedAt: new Date().toISOString()\n    }\n  };\n}",
};

export const grantLoyaltyPointsFunction: CreateFunctionDto = {
  name: 'grant-loyalty-points',
  description: 'Awards customer VIP reward points based on order total',
  enabled: true,
  authPolicy: 'public',
  methods: ['POST'],
  timeoutMs: 2000,
  memoryLimitMb: 32,
  allowedDomains: [],
  elevated: false,
  env: {},
  code: "export default async function(core, context) {\n  const logger = core.observability.logger;\n  const order = context.request?.body?.record || context.request?.body || {};\n  const total = Number(order.total || 0);\n  const pointsPerDollar = 10;\n  const pointsAwarded = Math.round(total * pointsPerDollar);\n\n  let tier = 'Bronze';\n  if (total >= 400) tier = 'Platinum';\n  else if (total >= 200) tier = 'Gold';\n  else if (total >= 100) tier = 'Silver';\n\n  logger.log(`[grant-loyalty-points] Customer ${order.customerEmail} awarded ${pointsAwarded} VIP points (Tier: ${tier})`);\n\n  return {\n    status: 200,\n    body: {\n      success: true,\n      customerEmail: order.customerEmail,\n      pointsAwarded,\n      loyaltyTier: tier,\n      message: `Congratulations! You earned ${pointsAwarded.toLocaleString()} VIP reward points.`\n    }\n  };\n}",
};

export const sendOrderNotificationFunction: CreateFunctionDto = {
  name: 'send-order-notification',
  description: 'Dispatches order confirmation receipt, tracking link, and updates order fulfillment record',
  enabled: true,
  authPolicy: 'admin',
  methods: ['POST'],
  timeoutMs: 3000,
  memoryLimitMb: 32,
  allowedDomains: [],
  elevated: true,
  env: {},
  code: "export default async function(core, context) {\n  const logger = core.observability.logger;\n  const auth = context.request?.auth;\n  if (!auth?.role?.includes('admin') && auth?.role !== 'service-role' && !auth?.isAdmin) {\n    return {\n      status: 403,\n      body: {\n        error: 'Forbidden',\n        message: 'Admin or service-role privileges required to send order notification'\n      }\n    };\n  }\n\n  const body = context.request?.body || {};\n  const order = body.record || body.order || body;\n  const tracking = body.fulfillment?.[1] || body.shippingResult || body.tracking || {};\n  const vip = body.vipRewards || {};\n\n  const trackingNumber = tracking.trackingNumber || `TRK-US-${Math.floor(100000 + Math.random() * 900000)}`;\n  const carrier = tracking.carrier || 'FedEx Priority Express';\n  const loyaltyPoints = Number(vip.pointsAwarded || 0);\n\n  logger.log(`[send-order-notification] Finalizing order #${order.orderNumber}: tracking=${trackingNumber}, points=${loyaltyPoints}`);\n\n  if (order.id) {\n    try {\n      await core.sdk.collection('orders').update(order.id, {\n        status: 'processing',\n        trackingNumber: trackingNumber,\n        carrier: carrier,\n        loyaltyPoints: loyaltyPoints\n      });\n      logger.log(`[send-order-notification] Updated order record ${order.id} with tracking number & loyalty points.`);\n    } catch (err) {\n      logger.log(`[send-order-notification] Note updating order record: ${err.message}`);\n    }\n  }\n\n  return {\n    status: 200,\n    body: {\n      notified: true,\n      orderNumber: order.orderNumber,\n      recipient: order.customerEmail,\n      carrier,\n      trackingNumber,\n      loyaltyPoints,\n      sentAt: new Date().toISOString()\n    }\n  };\n}",
};
