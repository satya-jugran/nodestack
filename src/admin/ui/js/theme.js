// ==========================================
// NodeStack Admin UI - Theme Manager
// Handles System, Light, and Dark appearance themes
// with localStorage persistence and OS change detection.
// ==========================================

const ThemeManager = {
  STORAGE_KEY: 'nodestack_theme',

  getTheme() {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        return stored;
      }
    } catch (e) {}
    return 'system';
  },

  getSystemPreference() {
    try {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
      }
    } catch (e) {}
    return 'light';
  },

  getEffectiveTheme() {
    const pref = this.getTheme();
    return pref === 'system' ? this.getSystemPreference() : pref;
  },

  applyTheme(theme) {
    const validTheme = ['system', 'dark', 'light'].includes(theme) ? theme : 'system';
    try {
      localStorage.setItem(this.STORAGE_KEY, validTheme);
    } catch (e) {}

    const effective = validTheme === 'system' ? this.getSystemPreference() : validTheme;
    const root = document.documentElement;

    root.classList.remove('dark', 'light');
    root.classList.add(effective);
    root.setAttribute('data-theme', validTheme);
    root.setAttribute('data-color-scheme', effective);

    this.updateUI(validTheme);

    // If Analytics view is active, redraw charts with theme-aware colors
    if (typeof renderCurrentAnalyticsView === 'function' && typeof state !== 'undefined' && state && state.activeNav === 'analytics') {
      try {
        renderCurrentAnalyticsView();
      } catch (e) {}
    }

    if (typeof window !== 'undefined' && window.dispatchEvent) {
      window.dispatchEvent(new CustomEvent('nodestack-theme-changed', {
        detail: { theme: validTheme, effective }
      }));
    }
  },

  updateUI(theme) {
    const currentTheme = theme || this.getTheme();
    const buttons = document.querySelectorAll('.theme-picker-btn');
    buttons.forEach((btn) => {
      const btnTheme = btn.getAttribute('data-theme-value');
      if (btnTheme === currentTheme) {
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
      } else {
        btn.classList.remove('active');
        btn.setAttribute('aria-pressed', 'false');
      }
    });
  },

  init() {
    const currentTheme = this.getTheme();
    this.applyTheme(currentTheme);

    // Listen for OS system theme changes
    if (typeof window !== 'undefined' && window.matchMedia) {
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      const handleMediaChange = () => {
        if (this.getTheme() === 'system') {
          this.applyTheme('system');
        }
      };

      if (typeof mql.addEventListener === 'function') {
        mql.addEventListener('change', handleMediaChange);
      } else if (typeof mql.addListener === 'function') {
        mql.addListener(handleMediaChange);
      }
    }

    this.updateUI(currentTheme);
  }
};

// Global shorthand for inline onclick handlers
function setTheme(theme) {
  ThemeManager.applyTheme(theme);
}

if (typeof window !== 'undefined') {
  window.ThemeManager = ThemeManager;
  window.setTheme = setTheme;
}

// Auto-initialize when DOM is ready
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ThemeManager.init());
  } else {
    ThemeManager.init();
  }
}
