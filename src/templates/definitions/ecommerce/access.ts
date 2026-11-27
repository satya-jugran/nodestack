export function getStoreManagerEmail(): string {
  return (process.env.STORE_MANAGER_EMAIL || 'manager@nodestack.dev').trim().toLowerCase();
}

export function getStoreManagerRule(): string {
  return `@request.auth.email = "${getStoreManagerEmail()}"`;
}
