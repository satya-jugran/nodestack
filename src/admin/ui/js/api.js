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

      const res = await fetch(path, { ...options, headers });
      if (res.status === 401) {
        logout();
        throw new Error('Session expired');
      }
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || `Request failed with status ${res.status}`);
      }
      if (res.status === 204) return null;
      return res.json();
    }


    function initRealtime() {
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

      // 2. Check auth
      if (!state.token) {
        openLoginModal();
        return;
      }

      // 3. Load App
      await loadCollections();
      initRealtime();
      selectNav('home');
    }


    function openLoginModal() {
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
                <input type="email" class="form-input" id="login-email" required autofocus>
              </div>
              <div class="form-group">
                <label class="form-label">Password</label>
                <input type="password" class="form-input" id="login-password" required>
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

        closeModal();
        await loadCollections();
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
        initRealtime();
        toast('Admin account created! Welcome to NodeStack.', 'success');
      } catch (e) {
        toast(e.message, 'error');
      }
    }

    function logout() {
      state.token = '';
      state.admin = null;
      localStorage.removeItem('nodestack_token');
      localStorage.removeItem('nodestack_admin');
      localStorage.removeItem('nb_token');
      localStorage.removeItem('nb_admin');
      if (state.realtimeEventSource) {
        state.realtimeEventSource.close();
      }
      openLoginModal();
    }
