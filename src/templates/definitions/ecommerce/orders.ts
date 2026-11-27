import { TemplateCollectionDef, TemplateSeedContext } from '../../types';
import { ORDERS_SEED } from './ordersSeed';

export const ordersCollection: TemplateCollectionDef = {
  name: 'orders',
  dto: {
    name: 'orders',
    type: 'base',
    listRule: '@request.auth.id != "" && user = @request.auth.id',
    viewRule: '@request.auth.id != "" && user = @request.auth.id',
    createRule: '@request.auth.id != "" && user = @request.auth.id',
    updateRule: '@request.auth.id != "" && user = @request.auth.id',
    deleteRule: null,
    schema: [
      { id: 'f_ord_no', name: 'orderNumber', type: 'text', required: true, unique: true },
      { id: 'f_ord_user', name: 'user', type: 'relation', options: { collectionId: 'users' } },
      { id: 'f_ord_cust', name: 'customerName', type: 'text', required: true },
      { id: 'f_ord_email', name: 'customerEmail', type: 'email', required: true },
      {
        id: 'f_ord_status',
        name: 'status',
        type: 'select',
        options: { values: ['pending', 'processing', 'shipped', 'delivered', 'cancelled'] },
      },
      { id: 'f_ord_total', name: 'total', type: 'number', required: true },
      { id: 'f_ord_items', name: 'items', type: 'json' },
      { id: 'f_ord_addr', name: 'shippingAddress', type: 'text' },
      {
        id: 'f_ord_pay',
        name: 'paymentStatus',
        type: 'select',
        options: { values: ['paid', 'pending', 'refunded', 'failed'] },
      },
      { id: 'f_ord_discount', name: 'discount', type: 'number' },
      { id: 'f_ord_coupon', name: 'couponCode', type: 'text' },
      { id: 'f_ord_tracking', name: 'trackingNumber', type: 'text' },
      { id: 'f_ord_carrier', name: 'carrier', type: 'text' },
      { id: 'f_ord_points', name: 'loyaltyPoints', type: 'number' },
    ],
  },
  seed: async (_ctx: TemplateSeedContext): Promise<Array<Record<string, any>>> => {
    return ORDERS_SEED;
  },
};
