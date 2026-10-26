---
sidebar_position: 2
id: oauth2
title: OAuth2 & Social Logins (PKCE)
description: Native OAuth2 flows for Google, GitHub, Apple, Discord, and Microsoft using PKCE code exchange
---

# OAuth2 & Social Logins (PKCE)

NodeStack supports native OAuth2 authentication with PKCE (Proof Key for Code Exchange, RFC 7636) for public web SPAs, mobile apps, and server environments.

---

## Supported Providers

* **Google** (`google`): OpenID Connect, verified email matching, name & avatar syncing.
* **GitHub** (`github`): Public/private email resolution, username & avatar syncing.
* **Apple** (`apple`): Sign in with Apple, secure ID token parsing, relay email support.
* **Discord** (`discord`): User identify & email scopes, CDN avatar syncing.
* **Microsoft** (`microsoft`): Azure AD / Microsoft Identity, profile & email resolution.

---

## Configuring Providers

Set provider credentials in your `.env` or system environment variables:

```bash
# Google
OAUTH_GOOGLE_CLIENT_ID="your_google_client_id.apps.googleusercontent.com"
OAUTH_GOOGLE_CLIENT_SECRET="your_google_client_secret"

# GitHub
OAUTH_GITHUB_CLIENT_ID="your_github_client_id"
OAUTH_GITHUB_CLIENT_SECRET="your_github_client_secret"

# Discord
OAUTH_DISCORD_CLIENT_ID="your_discord_client_id"
OAUTH_DISCORD_CLIENT_SECRET="your_discord_client_secret"

# Microsoft
OAUTH_MICROSOFT_CLIENT_ID="your_microsoft_app_id"
OAUTH_MICROSOFT_CLIENT_SECRET="your_microsoft_client_secret"

# Apple
OAUTH_APPLE_CLIENT_ID="your_apple_service_id"
OAUTH_APPLE_CLIENT_SECRET="your_apple_client_secret"
```

---

## How to Use with `nodestack-client`

The TypeScript SDK provides zero-dependency PKCE code challenge generation and authentication methods.

### 1. Discover Auth Providers & Generate PKCE
Fetch configured providers along with precomputed cryptographic state and code challenges:

```typescript
import { NodeStackClient } from 'nodestack-client';

const client = new NodeStackClient('http://localhost:8090');

// List active providers for the 'users' collection
const { authProviders } = await client.collection('users').listAuthMethods('http://localhost:3000/callback');

console.log('Available providers:', authProviders.map(p => p.name));
// e.g. ['google', 'github', 'discord']

const google = authProviders.find(p => p.name === 'google');
```

Each provider object contains:
* `name`: Provider identifier (`google`, `github`, etc.)
* `displayName`: Human-readable name
* `authUrl`: Full authorization URL containing `client_id`, `state`, `code_challenge`, and `code_challenge_method=S256`
* `codeVerifier`: The random secret verifier needed for token exchange

### 2. Redirect User to Provider
Redirect the user or open a popup with `google.authUrl`. Once the user grants consent, the provider redirects back to your redirect URI with `?code=...&state=...`.

### 3. Complete Token Exchange

#### Option A: Direct Redirect Flow
Exchange the authorization code and PKCE code verifier on your callback page:

```typescript
// On your OAuth callback page (/callback):
const urlParams = new URLSearchParams(window.location.search);
const code = urlParams.get('code');

const authData = await client.collection('users').authWithOAuth2({
  provider: 'google',
  code: code!,
  codeVerifier: google.codeVerifier, // Retrieved from step 1
  redirectUrl: 'http://localhost:3000/callback',
});

console.log('Logged in user:', authData.record);
console.log('Is new registration:', authData.meta.isNew);
console.log('Session valid:', client.authStore.isValid);
```

#### Option B: Popup Flow (Recommended for Single-Page Apps)
You can let `nodestack-client` handle the exchange seamlessly in a popup window:

```typescript
// In your SPA component:
const authData = await client.collection('users').authWithOAuth2({
  provider: 'google',
  urlCallback: (url) => window.open(url, '_blank', 'width=500,height=650'),
  redirectUrl: 'http://localhost:3000/callback',
});
```

And on your callback page (`/callback`), notify the opener:
```html
<script>
  const params = new URLSearchParams(window.location.search);
  if (window.opener) {
    window.opener.postMessage({
      type: 'nodestack_oauth_callback',
      code: params.get('code'),
      state: params.get('state'),
      error: params.get('error') || params.get('error_description'),
    }, window.location.origin);
  }
</script>
```

> [!TIP] Security Guardrails in Popup Flow
> `nodestack-client` strictly validates incoming `postMessage` events against the expected origin, the specific popup window source, and the session's cryptographic `state` before exchanging tokens, failing closed against spoofed frames or hijacked messages.

On success, `nodestack-client` automatically persists the token and user record in `authStore`.

---

## User Provisioning & Account Linking

* **New Users**: NodeStack automatically provisions a record in the auth collection with a verified status, randomized unusable password hash, and downloaded avatar in local file storage.
* **Existing Accounts**: If an account with the same email already exists, NodeStack automatically links the external identity **only if the provider asserts `email_verified: true`** (preventing account takeover attacks).
* **Listing Linked Identities**:
  ```typescript
  const linked = await client.collection('users').listExternalAuths(client.authStore.record.id);
  ```
* **Unlinking an Identity**:
  ```typescript
  await client.collection('users').unlinkExternalAuth(client.authStore.record.id, 'github');
  ```

---

## REST API Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/collections/:collection/auth-methods` | List active OAuth2 providers with PKCE challenge and authorization URLs. |
| `POST` | `/api/collections/:collection/auth-with-oauth2` | Exchange authorization code and PKCE codeVerifier for session JWT. |
| `GET` | `/api/collections/:collection/records/:id/external-auths` | List linked social identities for an authenticated user. |
| `DELETE` | `/api/collections/:collection/records/:id/external-auths/:provider` | Unlink an external social identity. |
