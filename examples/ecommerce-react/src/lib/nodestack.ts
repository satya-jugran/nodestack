import { NodeStackClient } from 'nodestack-client';

const NODESTACK_URL = import.meta.env.VITE_NODESTACK_URL || 'http://localhost:8090';
const NODESTACK_APP = import.meta.env.VITE_NODESTACK_APP;

export const client = new NodeStackClient(NODESTACK_URL, {
  app: NODESTACK_APP || undefined,
});

/**
 * Helper to build an absolute URL for a file stored in NodeStack
 */
export function getProductImageUrl(product: { id: string; image?: string; collection?: string }): string {
  if (!product.image) {
    return 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><rect width="400" height="400" fill="%23f1f5f9"/><text x="50%" y="50%" text-anchor="middle" fill="%2394a3b8" font-size="20" font-family="sans-serif">No Image</text></svg>';
  }
  return client.files.getUrl(product, product.image, { collection: 'products' });
}

export function getCategoryImageUrl(category: { id: string; image?: string; collection?: string }): string {
  if (!category.image) {
    return '';
  }
  return client.files.getUrl(category, category.image, { collection: 'categories' });
}
