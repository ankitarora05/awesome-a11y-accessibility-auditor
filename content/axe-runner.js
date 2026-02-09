(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  if (!window.axe) {
    console.error('[A11Y] axe-core not found on page');
    return;
  }

  // REALISTIC STANDARDS MAPPING - Only includes standards that axe-core actually supports
  // Based on axe-core documentation and actual rule tags
  const STANDARDS_MAP = {
    // WCAG Standards (axe-core actually tests these)
    'wcag2a': 'WCAG 2.0 Level A',
    'wcag2aa': 'WCAG 2.0 Level AA',
    'wcag21a': 'WCAG 2.1 Level A',
    'wcag21aa': 'WCAG 2.1 Level AA',
    'wcag22a': 'WCAG 2.2 Level A',
    'wcag22aa': 'WCAG 2.2 Level AA',
    
    // Section 508 (US Federal)
    'section508': 'Section 508 (1999)',
    'section508.22.a': 'Section 508 (2017)',
    
    // WAI-ARIA and HTML5
    'cat.aria': 'WAI-ARIA Techniques',
    'cat.name-role-value': 'WCAG 4.1.2 Name, Role, Value',
    'cat.semantics': 'Semantic HTML',
    'cat.parsing': 'HTML Parsing',
    
    // Best Practices (axe-core has specific rules for these)
    'best-practice': 'Accessibility Best Practices',
    'experimental': 'Experimental Rules',
    
    // Disability-specific categories (as used by axe-core)
    'cat.keyboard': 'Keyboard Accessibility',
    'cat.color': 'Color and Contrast',
    'cat.forms': 'Form Accessibility',
    'cat.language': 'Language of Page',
    'cat.structure': 'Document Structure',
    'cat.time-and-media': 'Time-based Media',
    'cat.tables': 'Table Accessibility',
    'cat.text-alternatives': 'Text Alternatives',
    
    // ACT Rules (Accessibility Conformance Testing)
    'ACT': 'W3C ACT Rules',
    
    // Other important standards
    'TTv5': 'Trusted Tester v5 (US Federal)',
    'ISO-30071-1': 'ISO 30071-1 (International)'
  };

  // Get all available axe-core rules to know what's actually supported
  function getAllAvailableTags() {
    try {
      const rules = window.axe.getRules();
      const allTags = new Set();
      
      rules.forEach(rule => {
        if (rule.tags) {
          rule.tags.forEach(tag => allTags.add(tag));
        }
      });
      
      return Array.from(allTags);
    } catch (error) {
      console.warn('[A11Y] Could not fetch axe rules, using default tags');
      return Object.keys(STANDARDS_MAP);
    }
  }

  function normalizeResults(raw, context = {}) {
    const timestamp = new Date().toISOString();
    const availableTags = getAllAvailableTags();
    
    // Calculate REALISTIC statistics
    const totalTestsRun = 
      (raw.violations?.length || 0) + 
      (raw.passes?.length || 0) + 
      (raw.incomplete?.length || 0) + 
      (raw.inapplicable?.length || 0);
    
    const testsPassed = raw.passes?.length || 0;
    const issuesFound = raw.violations?.length || 0;
    const manualReviews = raw.incomplete?.length || 0;
    
    // Group violations by severity
    const severityCounts = {
      critical: 0,
      serious: 0,
      moderate: 0,
      minor: 0
    };
    
    if (raw.violations) {
      raw.violations.forEach(violation => {
        const severity = violation.impact?.toLowerCase();
        if (severityCounts.hasOwnProperty(severity)) {
          severityCounts[severity]++;
        } else if (severity) {
          severityCounts[severity] = (severityCounts[severity] || 0) + 1;
        }
      });
    }
    
    // Extract WCAG criteria from tags
    function extractWcagCriteria(tags) {
      if (!tags) return [];
      
      const wcagCriteria = [];
      const wcagPattern = /wcag(\d)(\d)(\d+)/;
      
      tags.forEach(tag => {
        const match = tag.match(wcagPattern);
        if (match) {
          const [, version, level, number] = match;
          wcagCriteria.push(`WCAG ${version}.${level}.${number}`);
        }
      });
      
      return wcagCriteria;
    }
    
    // Map tags to actual standards
    function mapTagsToStandards(tags) {
      if (!tags) return [];
      
      return tags
        .map(tag => STANDARDS_MAP[tag] || tag)
        .filter((value, index, self) => self.indexOf(value) === index); // Remove duplicates
    }
    
    return {
      // Metadata
      url: window.location.href,
      timestamp: timestamp,
      tool: {
        name: 'axe-core',
        version: window.axe.version,
        engine: 'Accessibility Compliance Scanner'
      },
      context: {
        ...context,
        availableTags: availableTags,
        standards: mapTagsToStandards(context.tags || [])
      },
      
      // REALISTIC Statistics
      statistics: {
        totalTestsRun: totalTestsRun,
        testsPassed: testsPassed,
        issuesFound: issuesFound,
        manualReviews: manualReviews,
        severityCounts: severityCounts,
        automatedCoverage: Math.round((testsPassed / totalTestsRun) * 100) || 0,
        standardsCovered: (context.tags || []).length
      },
      
      // Results by Type
      violations: (raw.violations || []).map(v => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        description: v.description,
        helpUrl: v.helpUrl,
        tags: v.tags,
        wcagCriteria: extractWcagCriteria(v.tags),
        standards: mapTagsToStandards(v.tags),
        nodes: (v.nodes || []).map(n => ({
          html: n.html,
          target: n.target,
          failureSummary: n.failureSummary,
          element: n.element || null
        }))
      })),
      
      passes: (raw.passes || []).map(p => ({
        id: p.id,
        impact: p.impact,
        help: p.help,
        description: p.description,
        helpUrl: p.helpUrl,
        tags: p.tags,
        wcagCriteria: extractWcagCriteria(p.tags),
        standards: mapTagsToStandards(p.tags),
        nodes: (p.nodes || []).map(n => ({
          html: n.html,
          target: n.target
        }))
      })),
      
      incomplete: (raw.incomplete || []).map(i => ({
        id: i.id,
        impact: i.impact,
        help: i.help,
        description: i.description,
        helpUrl: i.helpUrl,
        tags: i.tags,
        wcagCriteria: extractWcagCriteria(i.tags),
        standards: mapTagsToStandards(i.tags),
        nodes: (i.nodes || []).map(n => ({
          html: n.html,
          target: n.target,
          failureSummary: n.failureSummary
        }))
      })),
      
      inapplicable: (raw.inapplicable || []).map(ia => ({
        id: ia.id,
        impact: ia.impact,
        help: ia.help,
        description: ia.description,
        helpUrl: ia.helpUrl,
        tags: ia.tags,
        wcagCriteria: extractWcagCriteria(ia.tags),
        standards: mapTagsToStandards(ia.tags)
      })),
      
      // Enhanced metadata
      metadata: {
        scanType: 'comprehensive',
        timestamp: timestamp,
        url: window.location.href,
        userAgent: navigator.userAgent,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight
        },
        axeVersion: window.axe.version,
        standardsMapping: STANDARDS_MAP
      }
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
    // Get ALL available tags from axe-core
    const allTags = getAllAvailableTags();
    
    // Default to ALL available standards that axe-core can test
    const defaultTags = allTags.filter(tag => 
      !tag.includes('experimental') // Optional: exclude experimental
    );
    
    const axeConfig = {
      // Performance settings
      preload: false,
      pingWaitTime: 100,
      timeout: 60000,
      
      // Comprehensive result types
      resultTypes: ['violations', 'passes', 'incomplete', 'inapplicable'],
      
      // Enable all features for comprehensive scanning
      iframes: true,
      elementRef: true,
      restoreScroll: true,
      selectors: true,
      
      // Run ALL available standards
      runOnly: {
        type: 'tag',
        values: config.tags && config.tags.length > 0 ? 
          config.tags.filter(tag => allTags.includes(tag)) : // Filter to only valid tags
          defaultTags
      }
    };

    // Apply custom rules if provided
    if (config.rules && typeof config.rules === 'object') {
      axeConfig.rules = config.rules;
    }

    // Apply custom impacts if provided
    if (Array.isArray(config.impacts) && config.impacts.length > 0) {
      axeConfig.impactLevels = config.impacts;
    }

    return axeConfig;
  }

  async function runAxe(config = {}) {
    const axeConfig = buildAxeConfig(config);
    const validTags = axeConfig.runOnly.values;
    const invalidTags = config.tags ? 
      config.tags.filter(tag => !validTags.includes(tag)) : [];
    
    if (invalidTags.length > 0) {
      console.warn('[A11Y] Skipping invalid tags not supported by axe-core:', invalidTags);
    }
    
    console.log('[A11Y] Running comprehensive axe scan with:', {
      validTagsCount: validTags.length,
      standards: validTags.map(tag => STANDARDS_MAP[tag] || tag),
      resultTypes: axeConfig.resultTypes
    });
    
    return window.axe.run(document, axeConfig);
  }

  function filterByImpact(results, allowedImpacts) {
    if (!Array.isArray(allowedImpacts) || allowedImpacts.length === 0) {
      return results;
    }

    // Filter all result types by impact
    const filtered = {
      ...results,
      violations: results.violations.filter(v =>
        allowedImpacts.includes(v.impact)
      ),
      passes: results.passes.filter(p =>
        allowedImpacts.includes(p.impact)
      ),
      incomplete: results.incomplete.filter(i =>
        allowedImpacts.includes(i.impact)
      )
    };
    
    // Recalculate statistics after filtering
    if (filtered.statistics) {
      filtered.statistics.issuesFound = filtered.violations.length;
      filtered.statistics.testsPassed = filtered.passes.length;
      filtered.statistics.manualReviews = filtered.incomplete.length;
      
      // Recalculate severity counts
      const severityCounts = {
        critical: 0,
        serious: 0,
        moderate: 0,
        minor: 0
      };
      
      filtered.violations.forEach(violation => {
        const severity = violation.impact?.toLowerCase();
        if (severityCounts.hasOwnProperty(severity)) {
          severityCounts[severity]++;
        } else if (severity) {
          severityCounts[severity] = (severityCounts[severity] || 0) + 1;
        }
      });
      
      filtered.statistics.severityCounts = severityCounts;
    }
    
    return filtered;
  }

  // Main scanning function
  async function handleScan(request) {
    const config = request?.config || {};
    
    console.log('[A11Y] Starting comprehensive accessibility scan', {
      requestedStandards: config.tags?.map(tag => STANDARDS_MAP[tag] || tag) || 'ALL'
    });

    // Wait for DOM stability
    await waitForDomStability({
      quietWindowMs: config.domQuietMs || 500,
      maxWaitMs: config.domSettleMs || 3000
    });

    // Run comprehensive axe scan
    const rawResults = await runAxe(config);
    
    console.log('[A11Y] Scan results summary:', {
      violations: rawResults.violations?.length || 0,
      passes: rawResults.passes?.length || 0,
      incomplete: rawResults.incomplete?.length || 0,
      inapplicable: rawResults.inapplicable?.length || 0
    });

    // Normalize results
    const normalized = normalizeResults(rawResults, {
      impacts: config.impacts || [],
      tags: config.tags || [],
      config: config
    });

    // Filter by impact if specified
    const filtered = filterByImpact(normalized, config.impacts);
    
    console.log('[A11Y] Final results:', {
      totalIssues: filtered.statistics?.issuesFound || 0,
      bySeverity: filtered.statistics?.severityCounts || {},
      standardsTested: filtered.statistics?.standardsCovered || 0
    });

    return filtered;
  }

  // Chrome extension message listener
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
          sendResponse({
            success: true,
            results: results
          });
        })
        .catch(err => {
          console.error('[A11Y] Scan failed:', err);
          sendResponse({
            error: true,
            success: false,
            message: err?.message || String(err),
            timestamp: new Date().toISOString()
          });
        });

      return true;
    });
  }

  // Global function for direct invocation
  window.runA11yScan = async function (config = {}) {
    try {
      console.log('[A11Y] Starting direct accessibility scan');
      
      // Wait for DOM stability
      await waitForDomStability({
        quietWindowMs: 500,
        maxWaitMs: 3000
      });

      // Run comprehensive scan
      const raw = await runAxe(config);
      
      // Normalize results
      const normalized = normalizeResults(raw, config);

      // Store results globally
      window.__A11Y_SCAN_RESULT__ = normalized;
      window.__A11Y_SCAN_STATISTICS__ = normalized.statistics;
      
      console.info('[A11Y] Comprehensive scan complete', {
        issuesFound: normalized.statistics?.issuesFound || 0,
        testsPassed: normalized.statistics?.testsPassed || 0,
        coverage: `${normalized.statistics?.automatedCoverage || 0}%`,
        standards: normalized.context?.standards?.length || 0
      });
      
      return normalized;
    } catch (e) {
      const error = {
        message: e?.message || String(e),
        stack: e?.stack || null,
        timestamp: new Date().toISOString()
      };
      window.__A11Y_SCAN_ERROR__ = error;
      console.error('[A11Y] Scan failed', error);
      throw e;
    }
  };

  // Enhanced compliance checks
  window.runComprehensiveGlobalScan = async function () {
    console.log('[A11Y] Running GLOBAL accessibility compliance scan');
    
    const config = {
      tags: getAllAvailableTags(),
      impacts: ['critical', 'serious', 'moderate', 'minor'],
      rules: {
        // Ensure all important rules are enabled
        'color-contrast': { enabled: true },
        'landmark-one-main': { enabled: true },
        'page-has-heading-one': { enabled: true },
        'region': { enabled: true },
        'skip-link': { enabled: true }
      }
    };
    
    return window.runA11yScan(config);
  };

  // WCAG 2.2 AA compliance (current global standard)
  window.checkWCAG22Compliance = async function () {
    console.log('[A11Y] Running WCAG 2.2 AA compliance scan');
    
    const config = {
      tags: ['wcag22aa', 'best-practice', 'cat.aria', 'cat.keyboard'],
      impacts: ['critical', 'serious', 'moderate']
    };
    
    return window.runA11yScan(config);
  };

  // US Federal compliance (Section 508 + WCAG 2.0)
  window.checkUSFederalCompliance = async function () {
    console.log('[A11Y] Running US Federal compliance scan');
    
    const config = {
      tags: ['section508.22.a', 'wcag2aa', 'best-practice'],
      impacts: ['critical', 'serious', 'moderate']
    };
    
    return window.runA11yScan(config);
  };

  // European EN 301 549 compliance
  window.checkEuropeanCompliance = async function () {
    console.log('[A11Y] Running European EN 301 549 compliance scan');
    
    const config = {
      tags: ['wcag21aa', 'best-practice', 'cat.aria'],
      impacts: ['critical', 'serious', 'moderate']
    };
    
    return window.runA11yScan(config);
  };

  // Initialize and log available standards
  console.log('[A11Y] Enhanced accessibility scanner loaded', {
    axeVersion: window.axe?.version,
    availableStandards: Object.keys(STANDARDS_MAP).length,
    features: [
      'comprehensive-scanning',
      'wcag-2.2-compliance',
      'us-federal-compliance',
      'european-compliance',
      'global-standards'
    ]
  });
})();