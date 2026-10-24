// API Client, Realtime SSE & Authentication
    async function api(path, options = {}) {
      const headers = {
        ...(options.headers || {}),
      };

      // Only set Content-Type: application/json if body is a string (e.g. JSON.stringify)
      // Do NOT set it for GET, DELETE (prevents Fastify empty body error), or FormData
      if (options.body && typeof options.body === 'string') {
        headers['Content-Type'] = 'application/json';
      }

      if (state.token) {
        headers['Authorization'] = `Bearer ${state.token}`;
      }

      // Exclude global management and bootstrap endpoints from app-scoped header
      const isGlobalEndpoint =
        path.startsWith('/api/apps') ||
        path.startsWith('/api/admins/') ||
        path === '/api/health' ||
        path === '/api/settings';

      if (!isGlobalEndpoint && !options.skipAppHeader && !headers['x-nodestack-app'] && state.activeApp && state.activeApp.slug) {
        headers['x-nodestack-app'] = state.activeApp.slug;
      }

      const res = await fetch(path, { ...options, headers });
      const isAuthEndpoint = path.includes('auth-with-password') || path.includes('create-initial');

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const errorMsg = errData.message || `Request failed with status ${res.status}`;

        // Specifically detect NodeStack core admin authentication session expiration
        const isCoreAuthSessionExpired =
          !options.skipAuthRedirect &&
          !isAuthEndpoint &&
          Boolean(state.token) &&
          (
            (res.status === 403 && (errorMsg === 'Only admins are authorized to access this resource' || errorMsg.includes('Only admins are authorized'))) ||
            (res.status === 401 && (errorMsg === 'Authentication required to access this resource' || errorMsg === 'Invalid token' || errorMsg === 'Token expired' || errorMsg === 'jwt expired'))
          );

        if (isCoreAuthSessionExpired) {
          const sessionMsg = 'Your admin session has expired or is invalid. Please sign in again.';
          logout();
          toast(sessionMsg, 'warning');
          const error = new Error(sessionMsg);
          error.status = res.status;
          error.data = errData;
          throw error;
        }

        // Detect if active application was deleted or not found on server (404)
        const isAppNotFoundError =
          res.status === 404 &&
          typeof errorMsg === 'string' &&
          (errorMsg.includes('Application ') || errorMsg.includes('application ')) &&
          errorMsg.includes('not found');

        if (isAppNotFoundError && state.activeApp && state.activeApp.slug !== 'default') {
          console.warn(`[NodeStack] Active app '${state.activeApp.slug}' not found on server. Resetting to default app.`);
          state.activeApp = { id: 'app_default', slug: 'default', name: 'Default App', isDefault: true };
          try {
            localStorage.setItem('nodestack_active_app', JSON.stringify(state.activeApp));
          } catch {}
          if (typeof updateAppSwitcherUI === 'function') {
            updateAppSwitcherUI();
          }
          if (typeof fetchApps === 'function') {
            fetchApps().catch(() => {});
          }
        }

        const error = new Error(errorMsg);
        error.status = res.status;
        error.data = errData;
        throw error;
      }
      if (res.status === 204) return null;
      return res.json();
    }


    function initRealtime() {
      if (typeof EventSource === 'undefined') {
        return;
      }
      if (state.realtimeEventSource) {
        state.realtimeEventSource.close();
      }

      const url = state.token ? `/api/realtime?token=${state.token}` : '/api/realtime';
      const es = new EventSource(url);
      state.realtimeEventSource = es;

      const handleConnect = async (e) => {
        const data = JSON.parse(e.data);
        // Subscribe to all topics
        await fetch('/api/realtime', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId: data.clientId,
            subscriptions: ['*'],
          }),
        }).catch(() => {});
      };

      es.addEventListener('NS_CONNECT', handleConnect);
      es.addEventListener('NB_CONNECT', handleConnect);

      es.addEventListener('SNAPSHOT_RESTORE', () => {
        if (typeof fetchDemoStatus === 'function') fetchDemoStatus();
      });
      es.addEventListener('SNAPSHOT_CREATE', () => {
        if (typeof fetchDemoStatus === 'function') fetchDemoStatus();
      });
      es.addEventListener('SNAPSHOT_DELETE', () => {
        if (typeof fetchDemoStatus === 'function') fetchDemoStatus();
      });

      // Listen for system demo state reset
      es.addEventListener('DEMO_RESET', () => {
        toast('✨ Clean demo baseline restored!', 'success');
        if (typeof fetchDemoStatus === 'function') {
          fetchDemoStatus();
        }
        if (typeof loadWebhookStats === 'function') {
          loadWebhookStats();
        }
        loadCollections().then(() => {
          if (state.activeCollection) {
            if (state.collectionTab === 'records') loadRecords();
            else renderSchemaView();
          } else if (state.activeNav === 'home') {
            renderHomeView();
          }
        });
      });

      // Listen for updates on any collection
      for (const col of state.collections) {
        es.addEventListener(col.name, (e) => {
          const payload = JSON.parse(e.data);
          toast(`[Realtime] Record ${payload.action}d in ${col.name}`, 'success');
          if (state.activeCollection && state.activeCollection.name === col.name && state.collectionTab === 'records') {
            loadRecords();
          }
        });
      }
    }

    // Load Collections

    async function init() {
      // 1. Check if admins exist
      try {
        const res = await fetch('/api/admins/has-admins');
        const data = await res.json();
        if (!data.hasAdmins) {
          openOnboardingModal();
          return;
        }
      } catch (e) {
        console.error('Failed to check admins:', e);
      }

      // 2. Check auth & verify token with backend
      if (!state.token) {
        openLoginModal();
        return;
      }

      try {
        const meRes = await fetch('/api/admins/me', {
          headers: { Authorization: `Bearer ${state.token}` },
        });
        if (!meRes.ok) {
          logout();
          return;
        }
        const me = await meRes.json();
        if (me && me.email) {
          state.admin = me;
          localStorage.setItem('nodestack_admin', JSON.stringify(me));
          localStorage.setItem('nodestack_last_email', me.email);
        }
      } catch (e) {
        logout();
        return;
      }

      // 3. Load App & Active MVP Context
      if (typeof fetchApps === 'function') {
        await fetchApps();
      }
      await loadCollections();
      if (typeof fetchDemoStatus === 'function') {
        fetchDemoStatus();
      }
      if (typeof renderPluginNavItems === 'function') {
        renderPluginNavItems();
      }
      if (typeof loadWebhookStats === 'function') {
        loadWebhookStats();
      }
      fetch('/api/plugins').then(r => r.ok ? r.json() : null).then(data => {
        if (data) {
          if (data.navItems) {
            state.pluginNavItems = data.navItems;
            if (typeof renderPluginNavItems === 'function') renderPluginNavItems();
          }
          if (data.catalog) {
            state.pluginCatalog = data.catalog;
          }
        }
      }).catch(() => {});
      initRealtime();
      selectNav('home');
    }


    function openLoginModal(emailPrefill) {
      const email = emailPrefill || (state.admin && state.admin.email) || localStorage.getItem('nodestack_last_email') || '';
      const modal = document.getElementById('modal-root');
      modal.innerHTML = `
        <div class="modal-backdrop">
          <div class="modal" style="max-width:400px;">
            <div style="display:flex; justify-content:center; margin-top:0.5rem; margin-bottom:0.75rem;">
              <div style="width:50px; height:50px; border-radius:12px; background:#0c0e14; border:1px solid rgba(59,130,246,0.4); display:flex; align-items:center; justify-content:center; box-shadow:0 6px 16px -2px rgba(59,130,246,0.35);">
                <img src="/_/icon.svg" width="34" height="34" alt="NodeStack" style="display:block;" />
              </div>
            </div>
            <div class="modal-header" style="justify-content:center; text-align:center;">
              <h2 class="modal-title">NodeStack Admin Login</h2>
            </div>
            <div class="modal-body">
              <div class="form-group">
                <label class="form-label">Admin Email</label>
                <input type="email" class="form-input" id="login-email" value="${escapeHtml(email)}" required ${email ? '' : 'autofocus'}>
              </div>
              <div class="form-group">
                <label class="form-label">Password</label>
                <input type="password" class="form-input" id="login-password" required ${email ? 'autofocus' : ''}>
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn btn-primary" style="width:100%;" onclick="submitLogin()">Sign In</button>
            </div>
          </div>
        </div>
      `;
    }

    async function submitLogin() {
      const email = document.getElementById('login-email').value;
      const password = document.getElementById('login-password').value;

      try {
        const res = await api('/api/admins/auth-with-password', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });

        state.token = res.token;
        state.admin = res.admin;
        localStorage.setItem('nodestack_token', res.token);
        localStorage.setItem('nodestack_admin', JSON.stringify(res.admin));
        if (res.admin?.email) {
          localStorage.setItem('nodestack_last_email', res.admin.email);
        }

        closeModal();
        await loadCollections();
        if (typeof renderPluginNavItems === 'function') renderPluginNavItems();
        if (typeof loadWebhookStats === 'function') loadWebhookStats();
        initRealtime();
        selectNav('home');
        toast('Logged in successfully', 'success');
      } catch (e) {
        toast(e.message, 'error');
      }
    }

    function openOnboardingModal() {
      const modal = document.getElementById('modal-root');
      modal.innerHTML = `
        <div class="modal-backdrop">
          <div class="modal" style="max-width:440px;">
            <div style="display:flex; align-items:center; gap:0.85rem; margin-bottom:0.75rem;">
              <div style="width:46px; height:46px; border-radius:12px; background:#0c0e14; border:1px solid rgba(59,130,246,0.4); display:flex; align-items:center; justify-content:center; box-shadow:0 6px 16px -2px rgba(59,130,246,0.35); flex-shrink:0;">
                <img src="/_/icon.svg" width="30" height="30" alt="NodeStack" style="display:block;" />
              </div>
              <div>
                <h2 class="modal-title">Welcome to NodeStack 👋</h2>
                <span style="color:var(--text-muted); font-size:12px;">Create your first Superuser</span>
              </div>
            </div>
            <div class="modal-body">
              <p style="color:var(--text-muted); font-size:13px; line-height:1.4;">
                Create your first Superuser / Administrator account to take control of your backend:
              </p>
              <div class="form-group">
                <label class="form-label">Admin Email *</label>
                <input type="email" class="form-input" id="onboard-email" placeholder="admin@example.com" required>
              </div>
              <div class="form-group">
                <label class="form-label">Password * (min 8 characters)</label>
                <input type="password" class="form-input" id="onboard-password" required>
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn btn-primary" style="width:100%;" onclick="submitOnboarding()">Create Admin Account & Launch</button>
            </div>
          </div>
        </div>
      `;
    }

    async function submitOnboarding() {
      const email = document.getElementById('onboard-email').value;
      const password = document.getElementById('onboard-password').value;

      try {
        const res = await api('/api/admins/create-initial', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });

        state.token = res.token;
        state.admin = res.admin;
        localStorage.setItem('nodestack_token', res.token);
        localStorage.setItem('nodestack_admin', JSON.stringify(res.admin));

        closeModal();
        await loadCollections();
        if (typeof renderPluginNavItems === 'function') renderPluginNavItems();
        if (typeof loadWebhookStats === 'function') loadWebhookStats();
        initRealtime();
        toast('Admin account created! Welcome to NodeStack.', 'success');
      } catch (e) {
        toast(e.message, 'error');
      }
    }

    function logout() {
      const lastEmail = state.admin?.email || localStorage.getItem('nodestack_last_email') || '';
      if (lastEmail) {
        localStorage.setItem('nodestack_last_email', lastEmail);
      }
      state.token = '';
      state.admin = null;
      localStorage.removeItem('nodestack_token');
      localStorage.removeItem('nodestack_admin');
      localStorage.removeItem('nb_token');
      localStorage.removeItem('nb_admin');
      if (state.realtimeEventSource) {
        state.realtimeEventSource.close();
      }
      openLoginModal(lastEmail);
    }
