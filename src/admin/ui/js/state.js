// Global State & UI Utilities
    const state = {
      token: localStorage.getItem('nodestack_token') || localStorage.getItem('nb_token') || '',
      admin: JSON.parse(localStorage.getItem('nodestack_admin') || localStorage.getItem('nb_admin') || 'null'),
      collections: [],
      activeCollection: null,
      activeNav: 'collection', // 'collection' | 'logs' | 'settings'
      collectionTab: 'records', // 'records' | 'schema'
      records: [],
      recordsPage: 1,
      recordsPerPage: 25,
      recordsTotal: 0,
      recordsTotalPages: 1,
      recordsSort: '',
      recordsSearchField: '_all',
      recordsSearchTerm: '',
      selectedRecordId: null,
      realtimeEventSource: null,
      logs: [],
      activeRules: {},
      demo: {
        hasSnapshot: false,
        snapshot: null,
        liveStats: null,
      },
    };


    function escapeHtml(str) {
      if (str === null || str === undefined) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    // Toast helper
    function toast(msg, type = 'success') {
      const container = document.getElementById('toast-container');
      const el = document.createElement('div');
      el.className = `toast ${type}`;
      el.innerHTML = `<span>${type === 'success' ? '✓' : '⚠'}</span> <span>${msg}</span>`;
      container.appendChild(el);
      setTimeout(() => el.remove(), 4000);
    }

    // Copy helper
    function copyToClipboard(text, btnEl, successMsg = 'Copied to clipboard!') {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          toast(successMsg, 'success');
          if (btnEl) {
            const orig = btnEl.innerHTML;
            btnEl.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>';
            setTimeout(() => { btnEl.innerHTML = orig; }, 1500);
          }
        }).catch(() => fallbackCopy(text, btnEl, successMsg));
      } else {
        fallbackCopy(text, btnEl, successMsg);
      }
    }

    function fallbackCopy(text, btnEl, successMsg = 'Copied to clipboard!') {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      toast(successMsg, 'success');
      if (btnEl) {
        const orig = btnEl.innerHTML;
        btnEl.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        setTimeout(() => { btnEl.innerHTML = orig; }, 1500);
      }
    }
