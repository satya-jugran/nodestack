// Plugin Tester Drawer & Live Integration Tests

function openPluginTesterDrawer(pluginId) {
  const cleanId = String(pluginId || '').replace(/^nav-/, '').toLowerCase();
  const catalog = (state.pluginCatalog && state.pluginCatalog.length > 0)
    ? state.pluginCatalog
    : (window.__NODESTACK_PLUGIN_CATALOG__ && window.__NODESTACK_PLUGIN_CATALOG__.length > 0)
      ? window.__NODESTACK_PLUGIN_CATALOG__
      : DEFAULT_OFFICIAL_CATALOG;

  const meta = catalog.find(c => c.id === cleanId || c.name === cleanId) || {
    title: cleanId.charAt(0).toUpperCase() + cleanId.slice(1),
    icon: '🧩',
    collections: []
  };

  const title = meta.title || cleanId;
  const icon = meta.icon || '🧩';
  const relatedCol = meta.collections && meta.collections.length > 0 ? meta.collections[0] : null;

  let formHtml = '';
  if (cleanId === 'stripe') {
    const stripeNavItem = (state.pluginNavItems || []).find(p => p.id === 'stripe');
    const isStripeLive = stripeNavItem && (stripeNavItem.badge === 'LIVE' || stripeNavItem.badgeVariant === 'danger');
    const isStripeConfigured = stripeNavItem && stripeNavItem.badge !== 'UNCONFIGURED' && !stripeNavItem.view?.description?.includes('Unconfigured');

    formHtml = `
      ${!isStripeConfigured ? `
        <div style="background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.35); border-radius: 6px; padding: 0.65rem 0.85rem; margin-bottom: 0.85rem; color: #fcd34d; font-size: 11.5px;">
          <div style="font-weight: 700; color: #fbbf24; display: flex; align-items: center; gap: 6px; margin-bottom: 2px;">
            <span>⚠️</span> <span>Stripe Unconfigured</span>
          </div>
          <div style="color: #cbd5e1; font-size: 11px;">
            Stripe Secret Key is not configured yet. Checkout session creation and test calls will fail until you provide a Stripe API key (<code>sk_test_...</code> or <code>sk_live_...</code>) in extension settings.
          </div>
        </div>
      ` : isStripeLive ? `
        <div style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 6px; padding: 0.65rem 0.85rem; margin-bottom: 0.85rem; color: #fca5a5; font-size: 11.5px;">
          <div style="font-weight: 800; color: #ef4444; display: flex; align-items: center; gap: 6px; margin-bottom: 2px;">
            <span>🚨</span> <span>LIVE PRODUCTION MODE ACTIVE</span>
          </div>
          <div>Live Stripe Secret Key (<code>sk_live_...</code>) is configured. Creating checkout sessions will initiate REAL credit card transactions and monetary deductions!</div>
        </div>
      ` : `
        <div style="background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.25); border-radius: 6px; padding: 0.5rem 0.75rem; margin-bottom: 0.85rem; color: var(--accent-primary); font-size: 11px;">
          🛡️ <strong>Test Mode Active:</strong> Using Stripe test credentials (<code>sk_test_...</code>). Simulated charges will not debit real payment cards.
        </div>
      `}
      <div class="drawer-section-title">1. Create Checkout Session</div>
      <div class="drawer-card">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
          <div>
            <label style="font-size: 11.5px; color: var(--text-muted); font-weight: 600;">Customer Email</label>
            <input type="email" id="test-stripe-email" class="form-control" value="customer@example.com" style="margin-top: 3px; font-size: 12px; padding: 6px 8px;" />
          </div>
          <div>
            <label style="font-size: 11.5px; color: var(--text-muted); font-weight: 600;">Amount (Cents)</label>
            <input type="number" id="test-stripe-amount" class="form-control" value="4900" style="margin-top: 3px; font-size: 12px; padding: 6px 8px;" />
          </div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="runStripeCheckoutTest()" style="margin-top: 4px;">
          Create Checkout Session ($49.00)
        </button>
      </div>

      <div class="drawer-section-title" style="margin-top: 0.85rem;">2. Simulate Incoming Webhook</div>
      <div class="drawer-card">
        <div>
          <label style="font-size: 11.5px; color: var(--text-muted); font-weight: 600;">Event Type</label>
          <select id="test-stripe-event-type" class="form-control" style="margin-top: 3px; font-size: 12px; padding: 6px 8px;">
            <option value="payment_intent.succeeded">payment_intent.succeeded</option>
            <option value="checkout.session.completed">checkout.session.completed</option>
            <option value="customer.subscription.created">customer.subscription.created</option>
          </select>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="runStripeWebhookSimulation()" style="margin-top: 4px;">
          Dispatch Mock Webhook
        </button>
      </div>
    `;
  } else if (cleanId === 's3' || cleanId === 's3-storage') {
    const s3NavItem = (state.pluginNavItems || []).find(p => p.id === 's3-storage' || p.id === 's3');
    const isS3Configured = s3NavItem && s3NavItem.badge !== 'UNCONFIGURED' && !s3NavItem.view?.description?.includes('Unconfigured');
    formHtml = `
      ${!isS3Configured ? `
        <div style="background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.35); border-radius: 6px; padding: 0.65rem 0.85rem; margin-bottom: 0.85rem; color: #fcd34d; font-size: 11.5px;">
          <div style="font-weight: 700; color: #fbbf24; display: flex; align-items: center; gap: 6px; margin-bottom: 2px;">
            <span>⚠️</span> <span>S3 Cloud Storage Unconfigured</span>
          </div>
          <div style="color: #cbd5e1; font-size: 11px;">
            No S3 bucket has been configured yet. URL presigning and bucket connectivity tests will fail until you specify a bucket name in extension settings or environment variables.
          </div>
        </div>
      ` : ''}
      <div class="drawer-section-title">1. Generate SigV4 Presigned Upload URL</div>
      <div class="drawer-card">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
          <div>
            <label style="font-size: 11.5px; color: var(--text-muted); font-weight: 600;">File Key</label>
            <input type="text" id="test-s3-key" class="form-control" value="uploads/avatar-demo.png" style="margin-top: 3px; font-size: 12px; padding: 6px 8px;" />
          </div>
          <div>
            <label style="font-size: 11.5px; color: var(--text-muted); font-weight: 600;">MIME Type</label>
            <input type="text" id="test-s3-mimetype" class="form-control" value="image/png" style="margin-top: 3px; font-size: 12px; padding: 6px 8px;" />
          </div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="runS3PresignedUrlTest()" style="margin-top: 4px;">
          Generate Presigned Upload URL
        </button>
      </div>

      <div class="drawer-section-title" style="margin-top: 0.85rem;">2. Bucket Connectivity & Health</div>
      <div class="drawer-card">
        <div style="font-size: 12px; color: var(--text-muted);">
          Verifies S3 bucket configuration, region, and endpoint resolution.
        </div>
        <button class="btn btn-secondary btn-sm" onclick="runS3StatusTest()" style="margin-top: 4px;">
          Verify Bucket Status
        </button>
      </div>
    `;
  } else if (cleanId === 'resend' || cleanId === 'resend-email') {
    formHtml = `
      <div class="drawer-section-title">1. Send Transactional Email</div>
      <div class="drawer-card">
        <div>
          <label style="font-size: 11.5px; color: var(--text-muted); font-weight: 600;">Recipient Email (To)</label>
          <input type="email" id="test-resend-to" class="form-control" value="developer@example.com" style="margin-top: 3px; font-size: 12px; padding: 6px 8px;" />
        </div>
        <div style="margin-top: 4px;">
          <label style="font-size: 11.5px; color: var(--text-muted); font-weight: 600;">Subject Line</label>
          <input type="text" id="test-resend-subject" class="form-control" value="NodeStack Test Notification" style="margin-top: 3px; font-size: 12px; padding: 6px 8px;" />
        </div>
        <div style="margin-top: 4px;">
          <label style="font-size: 11.5px; color: var(--text-muted); font-weight: 600;">Email Body</label>
          <textarea id="test-resend-body" class="form-control" rows="2" style="margin-top: 3px; font-size: 12px; padding: 6px 8px; font-family: sans-serif;">Hello from NodeStack! This is an interactive transactional test email.</textarea>
        </div>
        <button class="btn btn-primary btn-sm" onclick="runResendSendTest()" style="margin-top: 4px;">
          Send Test Email
        </button>
      </div>
    `;
  } else if (cleanId === 'chat-notifications' || cleanId === 'webhooks') {
    formHtml = `
      <div class="drawer-section-title">1. Dispatch Test Chat Notification</div>
      <div class="drawer-card">
        <div>
          <label style="font-size: 11.5px; color: var(--text-muted); font-weight: 600;">Target Platform</label>
          <select id="test-webhook-platform" class="form-control" style="margin-top: 3px; font-size: 12px; padding: 6px 8px;">
            <option value="discord">Discord</option>
            <option value="slack">Slack</option>
          </select>
        </div>
        <div style="margin-top: 4px;">
          <label style="font-size: 11.5px; color: var(--text-muted); font-weight: 600;">Notification Message</label>
          <input type="text" id="test-webhook-message" class="form-control" value="NodeStack database mutation event" style="margin-top: 3px; font-size: 12px; padding: 6px 8px;" />
        </div>
        <button class="btn btn-primary btn-sm" onclick="runChatNotificationTest()" style="margin-top: 4px;">
          Dispatch Chat Notification
        </button>
      </div>
    `;
  } else if (cleanId === 'algolia') {
    const algoliaNavItem = (state.pluginNavItems || []).find(p => p.id === 'algolia');
    const isAlgoliaConfigured = algoliaNavItem && algoliaNavItem.badge !== 'UNCONFIGURED' && !algoliaNavItem.view?.description?.includes('Unconfigured');
    const userCols = (state.collections || []).filter(c => typeof c === 'object' && !c.name.startsWith('_'));
    const optionsHtml = userCols.length > 0
      ? userCols.map(c => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join('')
      : '<option value="users">users</option>';
    formHtml = `
      ${!isAlgoliaConfigured ? `
        <div style="background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.35); border-radius: 6px; padding: 0.65rem 0.85rem; margin-bottom: 0.85rem; color: #fcd34d; font-size: 11.5px;">
          <div style="font-weight: 700; color: #fbbf24; display: flex; align-items: center; gap: 6px; margin-bottom: 2px;">
            <span>⚠️</span> <span>Algolia Search Unconfigured</span>
          </div>
          <div style="color: #cbd5e1; font-size: 11px;">
            No Algolia Application ID or Admin API Key configured. Index synchronization and queue processing will fail until credentials are configured in extension settings or environment variables.
          </div>
        </div>
      ` : ''}
      <div class="drawer-section-title">1. Trigger Collection Reindex</div>
      <div class="drawer-card">
        <div>
          <label style="font-size: 11.5px; color: var(--text-muted); font-weight: 600;">Collection to Index</label>
          <select id="test-algolia-col" class="form-control" style="margin-top: 3px; font-size: 12px; padding: 6px 8px;">
            ${optionsHtml}
          </select>
        </div>
        <button class="btn btn-primary btn-sm" onclick="runAlgoliaReindexTest()" style="margin-top: 4px;">
          Trigger Full Re-index
        </button>
      </div>

      <div class="drawer-section-title" style="margin-top: 0.85rem;">2. Process Sync Queue</div>
      <div class="drawer-card">
        <div style="font-size: 12px; color: var(--text-muted);">
          Manually triggers background worker queue to flush and synchronize pending mutations.
        </div>
        <button class="btn btn-secondary btn-sm" onclick="runAlgoliaProcessQueueTest()" style="margin-top: 4px;">
          Process Queue Now
        </button>
      </div>
    `;
  } else {
    formHtml = `
      <div class="drawer-section-title">Plugin Workbench</div>
      <div class="drawer-card">
        <div style="font-size: 12.5px; color: var(--text-muted);">
          Custom registered plugin: <code style="color: var(--accent-primary);">${escapeHtml(cleanId)}</code>
        </div>
        <button class="btn btn-primary btn-sm" onclick="checkPluginTesterStatus('${escapeHtml(cleanId)}')" style="margin-top: 4px;">
          Check Extension Status
        </button>
      </div>
    `;
  }

  let root = document.getElementById('drawer-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'drawer-root';
    document.body.appendChild(root);
  }

  const activePluginNavItem = (state.pluginNavItems || []).find(
    p => p.id === cleanId || (cleanId === 's3' && p.id === 's3-storage') || (cleanId === 'resend' && p.id === 'resend-email') || (cleanId === 'webhooks' && p.id === 'chat-notifications') || (cleanId === 'chat-notifications' && p.id === 'webhooks')
  );
  const isUnconfigured = activePluginNavItem && (activePluginNavItem.badge === 'UNCONFIGURED' || activePluginNavItem.badgeVariant === 'warning');
  const statusBadgeHtml = isUnconfigured
    ? `<span class="badge badge-warning" style="font-size: 10px;">● UNCONFIGURED</span>`
    : `<span class="badge badge-success" style="font-size: 10px;">● ACTIVE</span>`;

  root.innerHTML = `
    <div id="plugin-drawer-backdrop" class="drawer-backdrop" onclick="closePluginTesterDrawer()" aria-hidden="true"></div>
    <aside id="plugin-drawer-panel" class="record-drawer plugin-drawer" role="dialog" aria-modal="true" aria-labelledby="plugin-drawer-title" tabindex="-1">
      <div class="drawer-header">
        <div class="drawer-title-area">
          <span style="font-size: 1.2rem; display: inline-flex; align-items: center;">${icon}</span>
          <div>
            <h2 id="plugin-drawer-title" class="drawer-title" style="margin:0; font-size:1.05rem;">
              Test ${escapeHtml(title)}
            </h2>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 1px;">
              Interactive In-Context Developer Tester
            </div>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          ${statusBadgeHtml}
          <button class="btn btn-secondary btn-sm" id="plugin-drawer-close-btn" onclick="closePluginTesterDrawer()" title="Close drawer (Esc)" aria-label="Close drawer">✕</button>
        </div>
      </div>

      <div class="drawer-quick-actions">
        ${relatedCol ? `
          <button class="btn btn-secondary btn-sm" onclick="selectCollection('${escapeHtml(relatedCol)}'); closePluginTesterDrawer();" style="font-size: 11.5px;">
            View <code>${escapeHtml(relatedCol)}</code> Table ↗
          </button>
        ` : ''}
        <button class="btn btn-secondary btn-sm" onclick="checkPluginTesterStatus('${escapeHtml(cleanId)}')" style="font-size: 11.5px;">
          Check Status
        </button>
        <button class="btn btn-secondary btn-sm" onclick="clearPluginTesterOutput()" style="font-size: 11.5px; margin-left: auto;">
          Clear Output
        </button>
      </div>

      <div class="drawer-body">
        <div class="plugin-disclaimer-banner" style="background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: 6px; padding: 0.65rem 0.85rem; margin-bottom: 0.85rem; font-size: 11.5px; line-height: 1.45; color: #fcd34d;">
          <div style="font-weight: 700; display: flex; align-items: center; gap: 5px; margin-bottom: 2px; color: #fbbf24;">
            <span>⚠️</span> <span>External Service Disclaimer</span>
          </div>
          <div style="color: #cbd5e1; font-size: 11px;">
            Actions executed here communicate directly with your configured external service provider. Live operations, resource usage, or data changes may occur. You are solely responsible for all actions triggered and any external fees or modifications incurred.
          </div>
        </div>

        ${formHtml}

        <div class="drawer-section-title" style="margin-top: 1rem; display: flex; align-items: center; justify-content: space-between;">
          <span>Live Response Payload</span>
          <span id="plugin-tester-latency" style="font-family: var(--font-mono); font-size: 10px; color: var(--text-muted);">--</span>
        </div>
        <div class="drawer-json-container">
          <div class="drawer-json-bar">
            <span id="plugin-tester-status-badge" style="font-weight: 700; color: var(--text-muted);">Status: Ready</span>
            <button class="btn btn-secondary btn-sm" style="padding: 2px 7px; font-size: 10.5px;" onclick="copyPluginTesterOutput()">Copy</button>
          </div>
          <pre class="drawer-json-pre"><code id="plugin-tester-output">// Run an action above to inspect live responses...</code></pre>
        </div>
      </div>
    </aside>
  `;

  const triggerDrawerOpen = () => {
    const backdrop = document.getElementById('plugin-drawer-backdrop');
    const panel = document.getElementById('plugin-drawer-panel');
    if (backdrop) backdrop.classList.add('open');
    if (panel) {
      panel.classList.add('open');
      if (typeof panel.focus === 'function') panel.focus();
    }
  };

  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(triggerDrawerOpen);
  } else {
    setTimeout(triggerDrawerOpen, 16);
  }
}

function closePluginTesterDrawer() {
  const backdrop = document.getElementById('plugin-drawer-backdrop');
  const panel = document.getElementById('plugin-drawer-panel');
  if (backdrop) backdrop.classList.remove('open');
  if (panel) panel.classList.remove('open');
  setTimeout(() => {
    const root = document.getElementById('drawer-root');
    if (root && root.querySelector('#plugin-drawer-panel')) {
      root.innerHTML = '';
    }
  }, 250);
}

async function executePluginTest(actionFn) {
  const badge = document.getElementById('plugin-tester-status-badge');
  const latency = document.getElementById('plugin-tester-latency');
  const output = document.getElementById('plugin-tester-output');
  if (badge) {
    badge.textContent = 'Status: Executing...';
    badge.style.color = 'var(--accent-primary)';
  }
  if (output) output.textContent = '// Sending request...';
  const start = performance.now();
  try {
    const data = await actionFn();
    const duration = Math.round(performance.now() - start);
    if (latency) latency.textContent = `${duration}ms`;
    if (badge) {
      badge.textContent = 'Status: 200 OK';
      badge.style.color = 'var(--accent-success)';
    }
    if (output) output.textContent = JSON.stringify(data, null, 2);
    toast('Action completed successfully!', 'success');
  } catch (err) {
    const duration = Math.round(performance.now() - start);
    if (latency) latency.textContent = `${duration}ms`;
    if (badge) {
      badge.textContent = `Status: ${err.status ? err.status + ' Error' : 'Error'}`;
      badge.style.color = 'var(--accent-danger)';
    }
    const errPayload = err.data || { error: err.message };
    if (output) output.textContent = JSON.stringify(errPayload, null, 2);
    toast(err.message || 'Action failed', 'danger');
  }
}

function checkPluginTesterStatus(pluginId) {
  const cleanId = String(pluginId || '').replace(/^nav-/, '').toLowerCase();
  const endpoints = {
    stripe: '/api/stripe/status',
    s3: '/api/s3/status',
    's3-storage': '/api/s3/status',
    resend: '/api/resend/status',
    webhooks: '/api/webhooks/status',
    algolia: '/api/algolia/status',
  };
  const ep = endpoints[cleanId] || `/api/plugins/${encodeURIComponent(cleanId)}/config`;
  return executePluginTest(async () => {
    const res = await api(ep, { skipAuthRedirect: true });
    if ((cleanId === 's3' || cleanId === 's3-storage') && (!res || !res.connected || !res.bucket)) {
      const err = new Error(
        res?.message || 'S3 Cloud Storage is not configured. Please configure your bucket name in extension settings.'
      );
      err.status = res?.statusCode || 400;
      err.data = res;
      throw err;
    }
    if (cleanId === 'algolia' && (!res || res.configured === false || !res.appId)) {
      const err = new Error(
        res?.message || 'Algolia Search is not configured. Please configure your Application ID and Admin API Key in extension settings.'
      );
      err.status = res?.statusCode || 400;
      err.data = res;
      throw err;
    }
    if (cleanId === 'stripe' && (!res || res.configured === false)) {
      const err = new Error(
        res?.message || 'Stripe is not configured. Please configure your Stripe Secret Key in extension settings.'
      );
      err.status = res?.statusCode || 400;
      err.data = res;
      throw err;
    }
    if ((cleanId === 'resend' || cleanId === 'resend-email') && (!res || res.configured === false)) {
      const err = new Error(
        res?.message || 'Resend Email is not configured. Please configure your Resend API Key in extension settings.'
      );
      err.status = res?.statusCode || 400;
      err.data = res;
      throw err;
    }
    return res;
  });
}

function runStripeCheckoutTest() {
  const email = document.getElementById('test-stripe-email')?.value || 'customer@example.com';
  const amount = Number(document.getElementById('test-stripe-amount')?.value || 4900);
  const stripeNavItem = (state.pluginNavItems || []).find(p => p.id === 'stripe');
  const isStripeLive = stripeNavItem && (stripeNavItem.badge === 'LIVE' || stripeNavItem.badgeVariant === 'danger');

  if (isStripeLive && typeof window.confirm === 'function') {
    const confirmed = window.confirm(
      `⚠️ WARNING: LIVE STRIPE CREDENTIALS DETECTED!\n\nYou are in LIVE Production Mode. This test will create a real Stripe checkout session for $${(amount / 100).toFixed(2)} USD.\n\nAre you sure you want to proceed?`
    );
    if (!confirmed) {
      toast('Checkout session creation canceled', 'info');
      return Promise.resolve();
    }
  }

  return executePluginTest(() => api('/api/stripe/checkout-session', {
    method: 'POST',
    body: JSON.stringify({ email, amount }),
    skipAuthRedirect: true,
  }));
}

function runStripeWebhookSimulation() {
  const type = document.getElementById('test-stripe-event-type')?.value || 'payment_intent.succeeded';
  return executePluginTest(() => api('/api/stripe/webhook', {
    method: 'POST',
    body: JSON.stringify({
      type,
      data: {
        object: {
          id: 'pi_mock_' + Math.random().toString(36).substring(2, 9),
          amount: 4900,
          currency: 'usd',
          status: 'succeeded'
        }
      }
    }),
    skipAuthRedirect: true,
  }));
}

function runS3PresignedUrlTest() {
  const filename = document.getElementById('test-s3-key')?.value || 'uploads/avatar-demo.png';
  const mimeType = document.getElementById('test-s3-mimetype')?.value || 'image/png';
  return executePluginTest(() => api('/api/s3/sign-upload-url', {
    method: 'POST',
    body: JSON.stringify({ filename, mimeType }),
    skipAuthRedirect: true,
  }));
}

function runS3StatusTest() {
  return executePluginTest(async () => {
    const res = await api('/api/s3/status', { skipAuthRedirect: true });
    if (!res || !res.connected || !res.bucket) {
      const err = new Error(
        res?.message || 'S3 Cloud Storage is not configured. Please configure your bucket name in extension settings.'
      );
      err.status = res?.statusCode || 400;
      err.data = res;
      throw err;
    }
    return res;
  });
}

function runResendSendTest() {
  const to = document.getElementById('test-resend-to')?.value || 'developer@example.com';
  const subject = document.getElementById('test-resend-subject')?.value || 'NodeStack Notification';
  const body = document.getElementById('test-resend-body')?.value || 'Test message';
  return executePluginTest(() => api('/api/resend/send', {
    method: 'POST',
    body: JSON.stringify({
      to,
      subject,
      html: `<p>${escapeHtml(body)}</p>`,
      text: body
    }),
    skipAuthRedirect: true,
  }));
}

function runChatNotificationTest() {
  const platform = document.getElementById('test-webhook-platform')?.value || 'discord';
  const message = document.getElementById('test-webhook-message')?.value || 'Test chat notification from NodeStack';
  const endpoint = '/api/chat-notifications/test';
  return executePluginTest(() => api(endpoint, {
    method: 'POST',
    body: JSON.stringify({
      platform,
      payload: { message }
    }),
    skipAuthRedirect: true,
  }));
}
const runWebhookDispatchTest = runChatNotificationTest;

function runAlgoliaReindexTest() {
  const collection = document.getElementById('test-algolia-col')?.value;
  if (!collection) {
    toast('Please select a collection to reindex', 'warning');
    return Promise.resolve();
  }
  return executePluginTest(() => api('/api/algolia/reindex', {
    method: 'POST',
    body: JSON.stringify({ collection }),
    skipAuthRedirect: true,
  }));
}

function runAlgoliaProcessQueueTest() {
  return executePluginTest(() => api('/api/algolia/process-queue', {
    method: 'POST',
    skipAuthRedirect: true,
  }));
}

function copyPluginTesterOutput() {
  const output = document.getElementById('plugin-tester-output');
  if (output && navigator.clipboard) {
    navigator.clipboard.writeText(output.textContent || '');
    toast('Payload copied to clipboard!', 'info');
  }
}

function clearPluginTesterOutput() {
  const output = document.getElementById('plugin-tester-output');
  const badge = document.getElementById('plugin-tester-status-badge');
  const latency = document.getElementById('plugin-tester-latency');
  if (output) output.textContent = '// Ready';
  if (badge) {
    badge.textContent = 'Status: Ready';
    badge.style.color = 'var(--text-muted)';
  }
  if (latency) latency.textContent = '--';
}

// Expose on window for browser event handlers & tests
if (typeof window !== 'undefined') {
  window.openPluginTesterDrawer = openPluginTesterDrawer;
  window.closePluginTesterDrawer = closePluginTesterDrawer;
  window.executePluginTest = executePluginTest;
  window.checkPluginTesterStatus = checkPluginTesterStatus;
  window.runStripeCheckoutTest = runStripeCheckoutTest;
  window.runStripeWebhookSimulation = runStripeWebhookSimulation;
  window.runS3PresignedUrlTest = runS3PresignedUrlTest;
  window.runS3StatusTest = runS3StatusTest;
  window.runResendSendTest = runResendSendTest;
  window.runWebhookDispatchTest = runWebhookDispatchTest;
  window.runChatNotificationTest = runChatNotificationTest;
  window.runAlgoliaReindexTest = runAlgoliaReindexTest;
  window.runAlgoliaProcessQueueTest = runAlgoliaProcessQueueTest;
  window.copyPluginTesterOutput = copyPluginTesterOutput;
  window.clearPluginTesterOutput = clearPluginTesterOutput;
}
