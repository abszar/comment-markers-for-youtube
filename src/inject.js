/**
 * Runs in the page's MAIN world so it can read YouTube's `ytcfg` object.
 * The isolated content script asks for it with a CustomEvent and gets the
 * InnerTube API key + client context back, which is what we need to call
 * YouTube's own comment endpoint.
 */
(() => {
  'use strict';

  function grab() {
    const out = { apiKey: null, context: null };
    try {
      const get = (k) => {
        if (window.ytcfg && typeof window.ytcfg.get === 'function') {
          const v = window.ytcfg.get(k);
          if (v) return v;
        }
        if (window.ytcfg && window.ytcfg.data_) return window.ytcfg.data_[k];
        return null;
      };
      out.apiKey = get('INNERTUBE_API_KEY') || null;
      const ctx = get('INNERTUBE_CONTEXT');
      if (ctx) {
        // Keep it small: only the client block is required.
        out.context = { client: JSON.parse(JSON.stringify(ctx.client || {})) };
      }
      const ver = get('INNERTUBE_CLIENT_VERSION');
      if (out.context && ver && !out.context.client.clientVersion) {
        out.context.client.clientVersion = ver;
      }
    } catch (e) {
      /* ignore - the content script has a fallback */
    }
    return out;
  }

  window.addEventListener('ytct:request-config', () => {
    let payload = '{}';
    try {
      payload = JSON.stringify(grab());
    } catch (e) {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent('ytct:config', { detail: payload }));
  });
})();
