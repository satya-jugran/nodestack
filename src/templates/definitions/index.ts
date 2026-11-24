import { TemplateDefinition } from '../types';
import { ecommerceTemplate, getStoreManagerEmail, getStoreManagerRule } from './ecommerce';
import { blogTemplate } from './blog';
import { crmTemplate } from './crm';

export { ecommerceTemplate, blogTemplate, crmTemplate, getStoreManagerEmail, getStoreManagerRule };

export const STARTER_TEMPLATES: TemplateDefinition[] = [
  ecommerceTemplate,
  blogTemplate,
  crmTemplate,
];
