import { NodeStackClient } from 'nodestack-client';

export const NODESTACK_URL =
  import.meta.env.VITE_NODESTACK_URL ||
  (typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'http://localhost:8090');

export const NODESTACK_APP = import.meta.env.VITE_NODESTACK_APP || 'ecommerce-demo';

export const client = new NodeStackClient(NODESTACK_URL, {
  app: NODESTACK_APP,
});

/**
 * Returns the configured backend URL used by the client, falling back to window.location.origin
 */
export function getBackendUrl(): string {
  const url = client.baseUrl || NODESTACK_URL;
  if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
    return url.replace(/\/+$/, '');
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    const origin = window.location.origin.replace(/\/+$/, '');
    const cleanUrl = (url || '').startsWith('/') ? url : `/${url || ''}`;
    return `${origin}${cleanUrl}`.replace(/\/+$/, '');
  }
  return 'http://localhost:8090';
}

/**
 * Helper to build an absolute URL for the NodeStack Admin UI or docs
 */
export function getAdminUrl(path = '/_/'): string {
  const base = getBackendUrl();
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${cleanPath}`;
}

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
