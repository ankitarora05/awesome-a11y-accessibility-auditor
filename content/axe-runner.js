(function () {
  if (!window.axe) {
    console.error('[A11Y] axe-core not found on page');
    return;
  }

  /**
   * Normalize axe results to a stable, portable structure
   */
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
        nodes: v.nodes.map(n => ({
          html: n.html,
          target: n.target,
          failureSummary: n.failureSummary
        }))
      }))
    };
  }

  /**
   * Run axe-core scan
   */
  async function runAxe(config = {}) {
    const axeConfig = {
      runOnly: {
        type: 'tag',
        values: config.tags || []
      },
      resultTypes: ['violations'],
      rules: config.rules || {}
    };

    return await window.axe.run(document, axeConfig);
  }

  /**
   * Filter violations by impact
   */
  function filterByImpact(results, allowedImpacts) {
    if (!allowedImpacts || allowedImpacts.length === 0) {
      return results;
    }

    return {
      ...results,
      violations: results.violations.filter(v =>
        allowedImpacts.includes(v.impact)
      )
    };
  }

  /**
   * Wait for DOM stability (important for React / hydration)
   */
  function waitForDomStability(timeoutMs = 3000) {
    return new Promise(resolve => {
      let settled = false;

      const observer = new MutationObserver(() => {
        settled = false;
      });

      observer.observe(document, {
        childList: true,
        subtree: true,
        attributes: true
      });

      setTimeout(() => {
        observer.disconnect();
        resolve();
      }, timeoutMs);
    });
  }

  /**
   * Main scan handler
   */
  async function handleScan(request) {
    const config = request.config || {};

    // Give SPA frameworks time to settle
    await waitForDomStability(config.domSettleMs || 1500);

    const rawResults = await runAxe(config);
    const normalized = normalizeResults(rawResults, {
      impacts: config.impacts,
      tags: config.tags
    });

    return filterByImpact(normalized, config.impacts);
  }

  /**
   * Message listener (single entry point)
   */
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type !== 'RUN_A11Y_SCAN') return;

    handleScan(request)
      .then(results => sendResponse(results))
      .catch(error =>
        sendResponse({
          error: true,
          message: error.message || String(error)
        })
      );

    // Required for async response
    return true;
  });

  /**
   * Optional: expose for DevTools / manual debugging
   */
  window.runA11yScan = async function (config) {
    const rawResults = await runAxe(config || {});
    return normalizeResults(rawResults);
  };
})();