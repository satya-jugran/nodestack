# NodeStack Release Checklist & Operations Guide

This document defines the standardized release process for **NodeStack** (`@nodestackapp/server`, `nodestack-client`, official plugins, and standalone single-executable binaries).

---

## 1. Pre-Release Checklist

Complete and verify each item before tagging and publishing any release.

### 1.1 Code Quality & Test Validation
- [ ] **Run Core Test Suite**: Ensure all unit and integration tests pass cleanly without memory leaks or unhandled rejections.
  ```bash
  npm test
  ```
- [ ] **Run Client SDK Tests**: Validate the isomorphic client test harness.
  ```bash
  npx vitest run packages/client/tests/unit.test.ts
  ```
- [ ] **Run Plugin Tests**: Validate all official plugins (`stripe`, `s3`, `resend`, `chat-notifications`, `algolia`, `webhooks`).
  ```bash
  npx vitest run tests/plugins.test.ts tests/plugin-config.test.ts
  ```
- [ ] **Clean Test Artifacts**: Confirm no ephemeral test directories (`.test_*`, `tmp_*`) or temporary databases are lingering on disk.

---

### 1.2 Package Builds & Compilation
- [ ] **Build Server & Bundled Admin UI**:
  ```bash
  npm run build:server
  ```
  *Verify that TypeScript compiles (`tsc`) and `dist/admin/ui/index.html` is bundled with inline styles and assets via `AdminUIBundler`.*
- [ ] **Build First-Party Client SDK**:
  ```bash
  npm run build:client
  ```
  *Verify that both ESM (`dist/index.mjs`) and CJS (`dist/index.cjs`) bundles and TypeScript declaration files (`dist/index.d.ts`) are generated.*
- [ ] **Build Official Plugins**:
  ```bash
  npm run build:plugins
  ```
  *Verify that all packages in `packages/plugins/*` emit clean `dist/` artifacts.*
- [ ] **Validate Full Monorepo Build**:
  ```bash
  npm run build
  ```

---

### 1.3 Version Number Synchronization
Confirm that the new SemVer version (`X.Y.Z`) is updated across all required manifest and source references:

- [ ] **Root Package**: `package.json` (`"version": "X.Y.Z"`) & `package-lock.json`
- [ ] **Client SDK**: `packages/client/package.json` (`"version": "X.Y.Z"`) & `package-lock.json`
- [ ] **CLI Version**: `src/cli/cli.ts` (`.version('X.Y.Z')`)
- [ ] **Health & Settings Controller**: `src/http/controllers/HealthController.ts` (`version: 'X.Y.Z'`)
- [ ] **OpenAPI Specification Generator**: `src/schema/OpenApiGenerator.ts` (`options.version || 'X.Y.Z'`)
- [ ] **Sandboxed QuickJS Runtime Bridge**: `src/functions/runtime/QuickJsWasmRuntime.ts` (`globalThis.core.version = 'X.Y.Z'`)
- [ ] **Webhook User-Agent**: `src/webhooks/WebhookService.ts` (`'User-Agent': 'NodeStack-Webhooks/X.Y.Z'`)
- [ ] **Admin UI Header & Dashboard**: `src/admin/ui/index.html` (`vX.Y.Z`) and `src/admin/ui/js/views.js` (`vX.Y.Z`)
- [ ] **Project README**: `README.md` version badge (`https://img.shields.io/badge/version-X.Y.Z-blue.svg`)
- [ ] **OpenWiki Quickstart**: `openwiki/quickstart.md` (`nodestack vX.Y.Z`)
- [ ] **Functions Test Assertion**: `tests/functions.test.ts` (`expect(data.version).toBe('X.Y.Z')`)

---

### 1.4 Documentation & Changelog
- [ ] **Update `CHANGELOG.md`**:
  * Add a dedicated section: `## [X.Y.Z] - YYYY-MM-DD`.
  * Group highlights into **Added**, **Changed**, **Fixed**, and **Removed**.
  * Keep the narrative aligned with Keep a Changelog standards.
- [ ] **Update `/docs` Guides & Sidebar**:
  * Document any newly introduced features, configuration options, or endpoints.
  * Verify `docs/sidebars.ts` reflects new documentation categories or guides.
  * Update `docs/docusaurus.config.ts` version badge.
- [ ] **Validate Documentation Production Build**:
  ```bash
  npm run docs:build
  ```
  *Ensure the Docusaurus site compiles with zero broken links (`[SUCCESS] Generated static files in "build"`).*

---

### 1.5 OpenWiki Knowledge Base & Claim Verification
- [ ] **Reconcile Grounded Claims**:
  * Execute OpenWiki update to verify all changed source paths against registered claims.
  * Confirm that `claimIssueCount: 0` before proceeding.
  ```bash
  # Check git status for openwiki/.claims/ and openwiki/.page-manifest.json
  git status openwiki/
  ```

---

## 2. Release Execution Instructions

Follow these steps in order to commit, tag, and publish the release.

### Step 2.1: Commit and Tag

1. **Review Changed Files**:
   ```bash
   git status
   git diff --stat
   ```
2. **Stage and Commit**:
   ```bash
   git add .
   git commit -m "release: bump version to X.Y.Z"
   ```
3. **Create Annotated Git Tag**:
   ```bash
   git tag -a vX.Y.Z -m "Release vX.Y.Z"
   ```
4. **Push Branch and Tag to GitHub**:
   ```bash
   git push origin master
   git push origin vX.Y.Z
   ```

---

### Step 2.2: Publish GitHub Release (Automated CI/CD)

1. Navigate to the GitHub repository: `https://github.com/satya-jugran/nodestack/releases/new`.
2. Select tag: **`vX.Y.Z`**.
3. Release Title: `NodeStack vX.Y.Z - <Release Summary / Headline>`
4. Release Notes: Copy the exact markdown notes from `CHANGELOG.md` under `## [X.Y.Z]`.
5. Click **Publish release**.

> [!NOTE]
> Publishing a GitHub release automatically triggers two GitHub Actions workflows:
> 1. **`.github/workflows/publish.yml`**: Compiles and publishes `@nodestackapp/server`, `nodestack-client`, and all plugins to npm using the repository `NPM_TOKEN`.
> 2. **`.github/workflows/build-binaries.yml`**: Compiles standalone single-executable binaries (Node.js SEA) for Linux (x64), macOS (ARM64 & x64), and Windows (x64), attaching them directly as release assets.
> 3. **`.github/workflows/deploy-docs.yml`**: Automatically deploys the updated documentation site to GitHub Pages upon pushing to `master`.

---

### Step 2.3: Manual / Fallback npm Publishing

If the automated GitHub Actions pipeline is unavailable, or if manual publishing is required:

#### 1. Authenticate with npm
```bash
npm whoami
# If not logged in:
npm login
```

#### 2. Publish Server Package (`@nodestackapp/server`)
```bash
npm publish --access public
# If npm account enforces 2FA:
npm publish --access public --otp=<6-digit-code>
```

#### 3. Publish Client SDK (`nodestack-client`)
```bash
npm --workspace=packages/client publish --access public
# If npm account enforces 2FA:
npm --workspace=packages/client publish --access public --otp=<6-digit-code>
```

#### 4. Publish Official Plugins (`@nodestackapp/plugin-*`)
Run the interactive plugin publisher script, which handles dependency ordering and 2FA OTP prompt:
```bash
node scripts/publish-plugins.js
# Or supply OTP directly:
node scripts/publish-plugins.js --otp=<6-digit-code>
```

---

## 3. Post-Release Verification

Verify that all release artifacts are live, accessible, and functioning:

- [ ] **Verify Server on npm Registry**:
  ```bash
  npm view @nodestackapp/server version
  npm view @nodestackapp/server dist-tags
  ```
- [ ] **Verify Client SDK on npm Registry**:
  ```bash
  npm view nodestack-client version
  ```
- [ ] **Verify Official Plugins on npm Registry**:
  ```bash
  npm view @nodestackapp/plugin-stripe version
  npm view @nodestackapp/plugin-s3 version
  npm view @nodestackapp/plugin-resend version
  npm view @nodestackapp/plugin-chat-notifications version
  npm view @nodestackapp/plugin-algolia version
  ```
- [ ] **Verify GitHub Release Assets**:
  Check that the following binary assets are attached to the release:
  * `nodestack-windows-x64.exe`
  * `nodestack-linux-x64`
  * `nodestack-macos-arm64`
  * `nodestack-macos-x64`
- [ ] **Verify Documentation Site**:
  Visit `https://satya-jugran.github.io/nodestack/` and confirm that the navbar badge displays `vX.Y.Z` and new documentation sections render properly.
- [ ] **Run Fresh Install Smoke Test**:
  Test running NodeStack in a clean temporary directory:
  ```bash
  npx @nodestackapp/server@latest --help
  ```
