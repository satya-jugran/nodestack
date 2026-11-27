import { CreateFlowDto } from '../../../flows/types';

export const ecommerceFlows: CreateFlowDto[] = [
  {
    name: 'OrderFulfillmentFlow',
    description:
      'Automated order processing pipeline with validation, parallel inventory & tracking fulfillment, and VIP rewards',
    enabled: true,
    triggerType: 'event',
    eventTrigger: 'orders:create',
    definition: {
      comment: 'Automated e-commerce order fulfillment state machine pipeline',
      startAt: 'ValidateOrder',
      states: {
        ValidateOrder: {
          type: 'Task',
          function: 'validate-order',
          resultPath: '$.validation',
          next: 'CheckFraudRisk',
        },
        CheckFraudRisk: {
          type: 'Choice',
          choices: [
            {
              variable: '$.validation.passed',
              booleanEquals: false,
              next: 'ValidationFailed',
            },
          ],
          default: 'ProcessFulfillment',
        },
        ProcessFulfillment: {
          type: 'Parallel',
          branches: [
            {
              startAt: 'DeductInventory',
              states: {
                DeductInventory: {
                  type: 'Task',
                  function: 'update-inventory',
                  serviceRole: true,
                  end: true,
                },
              },
            },
            {
              startAt: 'CreateShippingLabel',
              states: {
                CreateShippingLabel: {
                  type: 'Task',
                  function: 'generate-tracking-label',
                  end: true,
                },
              },
            },
          ],
          resultPath: '$.fulfillment',
          next: 'CheckHighValueVIP',
        },
        CheckHighValueVIP: {
          type: 'Choice',
          choices: [
            {
              variable: '$.record.total',
              numericGreaterThanEquals: 200,
              next: 'AwardVipPoints',
            },
          ],
          default: 'NotifyCustomer',
        },
        AwardVipPoints: {
          type: 'Task',
          function: 'grant-loyalty-points',
          resultPath: '$.vipRewards',
          next: 'NotifyCustomer',
        },
        NotifyCustomer: {
          type: 'Task',
          function: 'send-order-notification',
          serviceRole: true,
          resultPath: '$.notification',
          next: 'OrderFulfilled',
        },
        OrderFulfilled: {
          type: 'Succeed',
        },
        ValidationFailed: {
          type: 'Fail',
          error: 'ORDER_VALIDATION_FAILED',
          cause: 'Order validation failed during fulfillment pipeline',
        },
      },
    },
  },
  {
    name: 'CheckoutPromotionFlow',
    description: 'Step-function pipeline evaluating promo codes and unlocking bundle perks',
    enabled: true,
    triggerType: 'http',
    definition: {
      comment: 'Interactive checkout pricing and promotion rules pipeline',
      startAt: 'ApplyCoupon',
      states: {
        ApplyCoupon: {
          type: 'Task',
          function: 'calculate-discount',
          resultPath: '$.discountResult',
          next: 'CheckBundleThreshold',
        },
        CheckBundleThreshold: {
          type: 'Choice',
          choices: [
            {
              variable: '$.cartTotal',
              numericGreaterThanEquals: 150,
              next: 'GrantGiftCredit',
            },
          ],
          default: 'FinalizePricing',
        },
        GrantGiftCredit: {
          type: 'Pass',
          result: {
            unlockedPerk: 'Free Premium Express Packaging + $15 Gift Credit',
            giftCredit: 15,
          },
          resultPath: '$.bundlePerk',
          next: 'FinalizePricing',
        },
        FinalizePricing: {
          type: 'Pass',
          next: 'PricingSuccess',
        },
        PricingSuccess: {
          type: 'Succeed',
        },
      },
    },
  },
];
