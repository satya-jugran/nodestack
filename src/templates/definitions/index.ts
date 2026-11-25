import { TemplateDefinition } from '../types';
import {
  ecommerceTemplate,
  getStoreManagerEmail,
  getStoreManagerRule,
  SEEDED_PRODUCT_VARIANTS,
} from './ecommerce';
import { blogTemplate } from './blog';
import { crmTemplate } from './crm';

export {
  ecommerceTemplate,
  blogTemplate,
  crmTemplate,
  getStoreManagerEmail,
  getStoreManagerRule,
  SEEDED_PRODUCT_VARIANTS,
};

export const STARTER_TEMPLATES: TemplateDefinition[] = [
  ecommerceTemplate,
  blogTemplate,
  crmTemplate,
];
