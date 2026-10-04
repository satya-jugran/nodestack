import { TemplateDefinition } from '../types';
import { ecommerceTemplate } from './ecommerce';
import { blogTemplate } from './blog';
import { crmTemplate } from './crm';

export { ecommerceTemplate, blogTemplate, crmTemplate };

export const STARTER_TEMPLATES: TemplateDefinition[] = [
  ecommerceTemplate,
  blogTemplate,
  crmTemplate,
];
