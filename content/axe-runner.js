(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  if (!window.axe) {
    console.error('[A11Y] axe-core not found on page');
    return;
  }

  function normalizeResults(raw, context = {}) {
    return {
      url: window.location.href,
      timestamp: new Date().toISOString(),
      tool: {
        name: 'axe-core',
        version: window.axe.version
      },
      context,
      violations: (raw.violations || []).map(v => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        description: v.description,
        helpUrl: v.helpUrl,
        tags: v.tags,
        nodes: (v.nodes || []).map(n => ({
          html: n.html,
          target: n.target,
          failureSummary: n.failureSummary
        }))
      }))
    };
  }

  function waitForDomStability({
    quietWindowMs = 500,
    maxWaitMs = 3000
  } = {}) {
    return new Promise(resolve => {
      let lastMutation = Date.now();

      const observer = new MutationObserver(() => {
        lastMutation = Date.now();
      });

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true
      });

      const interval = setInterval(() => {
        const now = Date.now();
        if (now - lastMutation >= quietWindowMs) {
          cleanup();
        }
      }, 100);

      const timeout = setTimeout(() => {
        cleanup();
      }, maxWaitMs);

      function cleanup() {
        clearInterval(interval);
        clearTimeout(timeout);
        observer.disconnect();
        resolve();
      }
    });
  }

  function buildAxeConfig(config = {}) {
    const axeConfig = {
      preload: false, // 🔑 prevents CSP preload failures
      resultTypes: ['violations']
    };

    if (Array.isArray(config.tags) && config.tags.length > 0) {
      axeConfig.runOnly = {
        type: 'tag',
        values: config.tags
      };
    }

    if (config.rules && typeof config.rules === 'object') {
      axeConfig.rules = config.rules;
    }

    return axeConfig;
  }

  async function runAxe(config = {}) {
    const axeConfig = buildAxeConfig(config);
    return window.axe.run(document, axeConfig);
  }

  function filterByImpact(results, allowedImpacts) {
    if (!Array.isArray(allowedImpacts) || allowedImpacts.length === 0) {
      return results;
    }

    return {
      ...results,
      violations: results.violations.filter(v =>
        allowedImpacts.includes(v.impact)
      )
    };
  }

  async function handleScan(request) {
    const config = request?.config || {};

    await waitForDomStability({
      quietWindowMs: config.domQuietMs || 500,
      maxWaitMs: config.domSettleMs || 3000
    });

    const rawResults = await runAxe(config);

    const normalized = normalizeResults(rawResults, {
      impacts: config.impacts || [],
      tags: config.tags || []
    });

    return filterByImpact(normalized, config.impacts);
  }

  if (
    typeof chrome !== 'undefined' &&
    chrome.runtime &&
    chrome.runtime.onMessage
  ) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (!request || request.type !== 'RUN_A11Y_SCAN') {
        return;
      }

      handleScan(request)
        .then(results => {
          sendResponse(results);
        })
        .catch(err => {
          sendResponse({
            error: true,
            message: err?.message || String(err),
            stack: err?.stack || null
          });
        });

      return true;
    });
  }

  window.runA11yScan = async function (config = {}) {
    try {
      await waitForDomStability({
        quietWindowMs: 500,
        maxWaitMs: 3000
      });

      const raw = await runAxe(config);
      const normalized = normalizeResults(raw, config);

      window.__A11Y_SCAN_RESULT__ = normalized;
      console.info('[A11Y] Scan complete', normalized);
      return normalized;
    } catch (e) {
      const error = {
        message: e?.message || String(e),
        stack: e?.stack || null
      };
      window.__A11Y_SCAN_ERROR__ = error;
      console.error('[A11Y] Scan failed', error);
      throw e;
    }
  };
})();