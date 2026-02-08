/* ---------------- State ---------------- */

let policy = null;
let currentTabId = null;
let activeResults = null;
let isScanning = false;
let liveRegion = null;

// Accessible color palette (WCAG 2.1 AA compliant)
const ACCESSIBLE_COLORS = {
  critical: '#dc2626',    // Darker red for 4.5:1 contrast
  serious: '#ea580c',     // Orange
  moderate: '#ca8a04',    // Yellow
  minor: '#16a34a',       // Green
  overlay: 'rgba(220, 38, 38, 0.15)',
  text: '#1f2937',        // Near black for contrast
  background: '#ffffff'
};

/* ---------------- Policy ---------------- */

async function loadPolicy() {
  if (policy) return policy;
  try {
    const res = await fetch(chrome.runtime.getURL('policy.json'));
    if (!res.ok) throw new Error('Failed to load policy');
    policy = await res.json();

    // Validate policy structure for accessibility standards
    if (!policy.standards) {
      policy.standards = {
        WCAG_21: 'wcag21aa',
        WCAG_22: 'wcag22aa',
        SECTION_508: 'section508',
        ADA: 'best-practice',
        EN_301_549: 'wcag21aa'
      };
    }

    return policy;
  } catch (error) {
    console.error('Policy load error:', error);
    // Return default policy with global standards
    return {
      automation: { tags: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
      standards: {
        WCAG_21: 'wcag21aa',
        WCAG_22: 'wcag22aa',
        SECTION_508: 'section508',
        ADA: 'best-practice',
        EN_301_549: 'wcag21aa'
      }
    };
  }
}

/* ---------------- Accessibility Setup ---------------- */

function setupAccessibilityFeatures() {
  // Add proper ARIA attributes to status element
  statusEl.setAttribute('role', 'status');
  statusEl.setAttribute('aria-live', 'polite');
  statusEl.setAttribute('aria-atomic', 'true');

  // Setup results region
  resultsEl.setAttribute('role', 'region');
  resultsEl.setAttribute('aria-label', 'Scan results');
  resultsEl.setAttribute('aria-live', 'polite');

  // Ensure all buttons have proper labels
  const buttons = document.querySelectorAll('button');
  buttons.forEach(btn => {
    if (!btn.hasAttribute('aria-label')) {
      const label = btn.textContent.trim() || btn.id;
      if (label) {
        btn.setAttribute('aria-label', label);
      }
    }
    // Ensure proper focus styles
    btn.style.outline = '2px solid transparent';
    btn.style.outlineOffset = '2px';
    btn.addEventListener('focus', () => {
      btn.style.outline = `2px solid ${ACCESSIBLE_COLORS.serious}`;
    });
    btn.addEventListener('blur', () => {
      btn.style.outline = '2px solid transparent';
    });
  });

  // Create live region for announcements
  liveRegion = document.createElement('div');
  liveRegion.id = 'a11y-live-region';
  liveRegion.setAttribute('aria-live', 'assertive');
  liveRegion.setAttribute('aria-atomic', 'true');
  liveRegion.style.cssText = `
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  `;
  document.body.appendChild(liveRegion);

  // Set page title and language
  document.documentElement.setAttribute('lang', 'en');
  document.title = 'Accessibility Scanner - WCAG 2.2 & ADA Compliance';
}

function announceToScreenReader(message, priority = 'assertive') {
  if (!liveRegion) return;

  liveRegion.setAttribute('aria-live', priority);
  liveRegion.textContent = message;

  // Clear after announcement (for multiple announcements)
  setTimeout(() => {
    liveRegion.textContent = '';
  }, 1000);
}

/* ---------------- DOM ---------------- */

const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');

const counts = {
  critical: document.getElementById('critical'),
  serious: document.getElementById('serious'),
  moderate: document.getElementById('moderate'),
  minor: document.getElementById('minor')
};

// Initialize with proper ARIA attributes
document.addEventListener('DOMContentLoaded', function () {
  setupAccessibilityFeatures();
  restoreIfExists();

  // Setup event listeners with keyboard support
  document.getElementById('scan').addEventListener('click', runScan);
  document.getElementById('scan').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') runScan();
  });

  document.getElementById('export-html').addEventListener('click', () => exportReport('html'));
  document.getElementById('export-html').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') exportReport('html');
  });

  document.getElementById('export-sarif').addEventListener('click', () => exportReport('sarif'));
  document.getElementById('export-sarif').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') exportReport('sarif');
  });

  // Setup keyboard navigation
  setupKeyboardNavigation();
});

/* ---------------- Helpers ---------------- */

function tabKey(tab) {
  return `${tab.id}:${tab.url}`;
}

function createFocusTrap(container) {
  const focusableElements = container.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );

  if (focusableElements.length === 0) return null;

  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];

  function handleTabKey(e) {
    if (e.key !== 'Tab') return;

    if (e.shiftKey && document.activeElement === firstElement) {
      e.preventDefault();
      lastElement.focus();
    } else if (!e.shiftKey && document.activeElement === lastElement) {
      e.preventDefault();
      firstElement.focus();
    }
  }

  container.addEventListener('keydown', handleTabKey);

  return {
    destroy: () => container.removeEventListener('keydown', handleTabKey),
    focusFirst: () => firstElement.focus()
  };
}

/* ---------------- Restore ---------------- */

async function restoreIfExists() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab?.url) {
      statusEl.textContent = 'No active tab found';
      announceToScreenReader('No active tab found');
      return;
    }

    currentTabId = tab.id;

    const { results } = await chrome.runtime.sendMessage({
      type: 'GET_A11Y_RESULTS',
      key: tabKey(tab)
    });

    if (results) {
      resetUI();
      renderResults(results);
      statusEl.textContent = 'Restored previous scan';
      announceToScreenReader('Previous scan results restored');
    }
  } catch (error) {
    console.error('Restore error:', error);
    // Don't announce errors unless they affect user experience
  }
}

/* ---------------- Page helpers ---------------- */

function highlightNode(selector) {
  const el = document.querySelector(selector);
  if (!el) return;

  // Check for reduced motion preference (WCAG 2.3.3)
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let overlay = document.getElementById('__a11y_overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = '__a11y_overlay';
    overlay.setAttribute('role', 'alert');
    overlay.setAttribute('aria-live', 'polite');
    overlay.setAttribute('aria-label', 'Accessibility highlight overlay');

    // Use dashed border for better visibility (WCAG 1.4.11)
    overlay.style.cssText = `
      position: fixed;
      pointer-events: none;
      z-index: 2147483647;
      border: 3px dashed ${ACCESSIBLE_COLORS.critical};
      background: ${ACCESSIBLE_COLORS.overlay};
      outline: 2px solid rgba(0, 0, 0, 0.5);
      outline-offset: 2px;
      box-sizing: border-box;
      transition: ${prefersReducedMotion ? 'none' : 'all 0.3s ease'};
    `;
    document.body.appendChild(overlay);

    announceToScreenReader('Element highlighted for accessibility review');
  }

  const r = el.getBoundingClientRect();
  const scrollY = window.scrollY;
  const scrollX = window.scrollX;

  overlay.style.top = `${r.top + scrollY}px`;
  overlay.style.left = `${r.left + scrollX}px`;
  overlay.style.width = `${r.width}px`;
  overlay.style.height = `${r.height}px`;

  // Add descriptive text for screen readers
  const altText = el.getAttribute('alt') ||
    el.getAttribute('aria-label') ||
    el.textContent?.trim() ||
    el.tagName.toLowerCase();
  overlay.setAttribute('aria-label', `Highlighted: ${altText.substring(0, 100)}`);
}

function clearHighlight() {
  const overlay = document.getElementById('__a11y_overlay');
  if (overlay) {
    // Smooth removal with reduced motion consideration
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!prefersReducedMotion) {
      overlay.style.opacity = '0';
      setTimeout(() => overlay.remove(), 300);
    } else {
      overlay.remove();
    }
    announceToScreenReader('Highlight cleared');
  }
}

function inspectNode(selector) {
  const el = document.querySelector(selector);
  if (!el) return;

  // Scroll with reduced motion consideration
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({
    behavior: prefersReducedMotion ? 'auto' : 'smooth',
    block: 'center',
    inline: 'center'
  });

  // Use accessible focus indicator (WCAG 2.4.7)
  const originalOutline = el.style.outline;
  const originalOutlineOffset = el.style.outlineOffset;

  el.style.outline = `3px solid ${ACCESSIBLE_COLORS.critical}`;
  el.style.outlineOffset = '3px';
  el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });

  setTimeout(() => {
    el.style.outline = originalOutline;
    el.style.outlineOffset = originalOutlineOffset;
    el.removeAttribute('tabindex');
  }, 2000);

  announceToScreenReader('Element inspected and focused');
}

/* ---------------- Keyboard Navigation ---------------- */

function setupKeyboardNavigation() {
  document.addEventListener('keydown', (e) => {
    // Escape key clears highlights
    if (e.key === 'Escape' || e.key === 'Esc') {
      clearHighlight();
    }

    // Close modal if exists
    const modal = document.querySelector('[role="dialog"][aria-modal="true"]');
    if (modal && e.key === 'Escape') {
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
      announceToScreenReader('Dialog closed');
    }

    // Handle arrow navigation for violations
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const violations = document.querySelectorAll('.violation');
      if (violations.length === 0) return;

      const current = document.activeElement;
      const currentIndex = Array.from(violations).indexOf(current);

      if (e.key === 'ArrowDown' && currentIndex < violations.length - 1) {
        e.preventDefault();
        violations[currentIndex + 1].focus();
      } else if (e.key === 'ArrowUp' && currentIndex > 0) {
        e.preventDefault();
        violations[currentIndex - 1].focus();
      }
    }
  });
}

/* ---------------- Scan ---------------- */
/* ---------------- Scan ---------------- */

/* ---------------- Improved Scan Configuration ---------------- */

async function runScan() {
  if (isScanning) return;

  try {
    isScanning = true;
    resetUI();
    statusEl.textContent = 'Scanning page for accessibility issues…';
    statusEl.setAttribute('aria-busy', 'true');
    announceToScreenReader('Starting comprehensive accessibility scan. Please wait.');

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error('No active tab available for scanning');
    }

    currentTabId = tab.id;

    // Get user preferences
    const impacts = ['critical', 'serious'];
    if (document.getElementById('includeModerate')?.checked) impacts.push('moderate');
    if (document.getElementById('includeMinor')?.checked) impacts.push('minor');

    // Check if page is accessible
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          if (document.readyState !== 'complete') {
            throw new Error('Page is still loading. Please wait and try again.');
          }
          return true;
        }
      });
    } catch (e) {
      throw new Error(`Cannot access page: ${e.message}. Ensure the page is fully loaded and not a restricted page.`);
    }

    // Inject axe-core
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: false },
      files: ['vendor/axe.min.js', 'content/axe-runner.js']
    });

    // FIXED CONFIGURATION - Tests ALL accessibility rules
    const scanConfig = {
      // REMOVED runOnly restriction to test EVERYTHING
      // This will test: WCAG 2.0/2.1/2.2 A/AA/AAA, Section 508, best practices, etc.
      impactLevels: impacts,
      resultTypes: ['violations', 'passes', 'incomplete', 'inapplicable'],
      iframes: false,
      elementRef: false,
      restoreScroll: false
      // No 'rules' specified = use ALL default rules
    };

    console.log('Running comprehensive scan with config:', scanConfig);

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (config) => {
        try {
          return window.runA11yScan(config);
        } catch (error) {
          window.__A11Y_SCAN_ERROR__ = error.message;
          throw error;
        }
      },
      args: [scanConfig]
    });

    // Poll for results
    let result;
    const maxAttempts = 50;
    for (let i = 0; i < maxAttempts; i++) {
      const [{ result: r }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => ({
          result: window.__A11Y_SCAN_RESULT__,
          error: window.__A11Y_SCAN_ERROR__
        })
      });

      if (r?.error) {
        throw new Error(`Scan failed: ${r.error}`);
      }

      if (r?.result) {
        result = r.result;
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (!result) {
      throw new Error('Accessibility scan timed out.');
    }

    // Add metadata
    result.url = tab.url;
    result.timestamp = new Date().toISOString();

    // Save results
    await chrome.runtime.sendMessage({
      type: 'SAVE_A11Y_RESULTS',
      key: tabKey(tab),
      results: result
    });

    // Render results
    renderResults(result);
    announceToScreenReader(`Comprehensive scan complete. Found ${result.violations?.length || 0} rule violations with ${result.violations?.reduce((sum, v) => sum + (v.nodes?.length || 0), 0) || 0} total issues.`);

  } catch (error) {
    console.error('Scan error:', error);
    handleScanError(error);
  } finally {
    isScanning = false;
    statusEl.setAttribute('aria-busy', 'false');
  }
}

/* ---------------- Simplified Scan Fallback ---------------- */

async function attemptSimplifiedScan(tabId, standards, impacts) {
  updateScanProgress(60, 'Trying simplified scan...');

  const simpleConfig = {
    runOnly: {
      type: 'tag',
      values: ['wcag2a', 'wcag2aa'] // Most basic rules only
    },
    impactLevels: impacts,
    iframes: false, // Definitely no iframes
    elementRef: false,
    restoreScroll: false
  };

  await chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: (config) => {
      try {
        // Clear any previous errors
        window.__A11Y_SCAN_ERROR__ = null;
        return window.runA11yScan(config);
      } catch (error) {
        window.__A11Y_SCAN_ERROR__ = error.message;
        return null;
      }
    },
    args: [simpleConfig]
  });

  // Wait for results
  let result;
  for (let i = 0; i < 30; i++) {
    const [{ result: r }] = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => ({
        result: window.__A11Y_SCAN_RESULT__,
        error: window.__A11Y_SCAN_ERROR__
      })
    });

    if (r?.result) {
      result = r.result;
      result.partialScan = true;
      result.simplifiedScan = true;
      break;
    }

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return result;
}

/* ---------------- Progress Updates ---------------- */

function updateScanProgress(percent, message) {
  if (statusEl.querySelector('.scan-progress')) {
    statusEl.innerHTML = `
      <div class="scan-progress">
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${percent}%"></div>
        </div>
        <span>${message} (${percent}%)</span>
      </div>
    `;
  }
}

/* ---------------- Improved Error Handling ---------------- */

function handleScanError(error) {
  let errorMessage;
  if (error.message) {
    errorMessage = error.message;
  } else if (error.toString) {
    errorMessage = error.toString();
  } else {
    errorMessage = 'Unknown error occurred during scanning';
  }

  statusEl.textContent = 'Scan failed';
  statusEl.setAttribute('aria-busy', 'false');

  // Check for specific error patterns
  let specificHelp = '';

  if (errorMessage.includes('timed out') && errorMessage.includes('frame')) {
    specificHelp = `
      <div class="specific-error">
        <h4>🔄 Iframe Timeout Detected</h4>
        <p>The scanner timed out while trying to scan iframes on the page.</p>
        
        <div class="solution-options">
          <h5>Try one of these solutions:</h5>
          
          <div class="solution">
            <strong>Option 1: Scan without iframes</strong>
            <p>Run a scan that skips iframes (ads, embeds, etc.):</p>
            <button id="retry-no-iframes" class="solution-btn">
              <span class="btn-icon">🚫</span>
              Scan Main Content Only
            </button>
          </div>
          
          <div class="solution">
            <strong>Option 2: Refresh and retry</strong>
            <p>The page might have been loading. Try refreshing:</p>
            <button id="refresh-retry" class="solution-btn">
              <span class="btn-icon">🔄</span>
              Refresh Page & Retry
            </button>
          </div>
          
          <div class="solution">
            <strong>Option 3: Use basic scan</strong>
            <p>Run a minimal scan with core rules only:</p>
            <button id="basic-scan" class="solution-btn">
              <span class="btn-icon">⚡</span>
              Quick Basic Scan
            </button>
          </div>
        </div>
      </div>
    `;
  } else if (errorMessage.includes('restricted') || errorMessage.includes('cannot access')) {
    specificHelp = `
      <div class="specific-error">
        <h4>🔒 Restricted Page</h4>
        <p>This page cannot be scanned due to browser security restrictions.</p>
        <ul>
          <li>Chrome internal pages (chrome://, about:)</li>
          <li>Browser settings pages</li>
          <li>Extension pages</li>
          <li>Some secure enterprise pages</li>
        </ul>
        <p>Try scanning a regular website (https://example.com).</p>
      </div>
    `;
  }

  resultsEl.innerHTML = `
    <div class="error" role="alert">
      <div class="error-header">
        <span class="error-icon">⚠️</span>
        <h3>Scan Failed</h3>
      </div>
      
      <div class="error-details">
        <p><strong>Error:</strong> ${escapeHtml(errorMessage)}</p>
      </div>
      
      ${specificHelp}
      
      <div class="troubleshooting">
        <h4>General troubleshooting steps:</h4>
        <ol>
          <li>Wait for the page to fully load (check spinner in browser tab)</li>
          <li>Refresh the page (Ctrl+R / Cmd+R) and try again</li>
          <li>Close unnecessary tabs to free up memory</li>
          <li>Try on a simpler page first to verify the scanner works</li>
          <li>Disable ad blockers or other extensions temporarily</li>
          <li>Check that axe-core is installed in the extension</li>
        </ol>
      </div>
      
      <details class="tech-details">
        <summary>Technical details</summary>
        <pre class="error-pre">${escapeHtml(JSON.stringify(error, null, 2))}</pre>
      </details>
    </div>
  `;

  // Add event listeners for solution buttons
  setTimeout(() => {
    const retryNoIframes = document.getElementById('retry-no-iframes');
    const refreshRetry = document.getElementById('refresh-retry');
    const basicScan = document.getElementById('basic-scan');

    if (retryNoIframes) {
      retryNoIframes.addEventListener('click', () => runNoIframesScan());
    }

    if (refreshRetry) {
      refreshRetry.addEventListener('click', () => refreshAndScan());
    }

    if (basicScan) {
      basicScan.addEventListener('click', () => runBasicScan());
    }
  }, 100);

  announceToScreenReader(`Scan failed: ${errorMessage}`, 'assertive');
}

/* ---------------- Alternative Scan Methods ---------------- */

async function runNoIframesScan() {
  if (isScanning) return;

  try {
    isScanning = true;
    resetUI();
    statusEl.textContent = 'Scanning main content (skipping iframes)...';

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    // Reload the page first
    await chrome.tabs.reload(tab.id);

    // Wait for page to load
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Run scan with no iframes
    const scanConfig = {
      // Comprehensive standards coverage
      runOnly: {
        type: 'tag',
        values: [
          // WCAG 2.2 Standards (All Levels)
          'wcag2a',       // WCAG 2.0 Level A
          'wcag2aa',      // WCAG 2.0 Level AA
          'wcag2aaa',     // WCAG 2.0 Level AAA
          'wcag21a',      // WCAG 2.1 Level A
          'wcag21aa',     // WCAG 2.1 Level AA
          'wcag21aaa',    // WCAG 2.1 Level AAA
          'wcag22a',      // WCAG 2.2 Level A
          'wcag22aa',     // WCAG 2.2 Level AA
          'wcag22aaa',    // WCAG 2.2 Level AAA

          // Section 508 (US Federal)
          'section508',   // Section 508 (old)
          'section508.22.a', // Updated Section 508

          // ADA (Americans with Disabilities Act) - WCAG 2.0/2.1 AA is typically used
          'ada',          // ADA Title III compliance

          // International Standards
          'en-301-549',   // European EN 301 549
          'act',          // Accessibility Conformance Testing

          // Best Practices
          'best-practice',

          // Experimental and cutting-edge
          'experimental',

          // Specific technical standards
          'cat',          // Common Accessibility Tasks
          'aria',         // ARIA specific rules
          'html5',        // HTML5 specific
          'semantics',    // Semantic HTML

          // Performance and optimization
          'performance',
          'seo',          // SEO overlap with accessibility

          // Mobile and responsive
          'mobile',
          'responsive',

          // Screen reader specific
          'screen-readers',
          'voice-control',

          // Cognitive and learning disabilities
          'cognitive',
          'learning',

          // Motor disabilities
          'motor',
          'keyboard',

          // Visual impairments
          'low-vision',
          'color-blindness',
          'contrast',

          // Hearing impairments
          'hearing',
          'auditory',

          // Age-related considerations
          'aging',
          'elderly'
        ]
      },

      // Enable all result types
      resultTypes: ['violations', 'passes', 'incomplete', 'inapplicable'],

      // Performance optimization settings
      iframes: true, // Enable for comprehensive coverage
      elementRef: true, // Keep element references for highlighting
      restoreScroll: true, // Better UX
      selectors: false, // Disable if performance is critical

      // Timeout and performance
      pingWaitTime: 100,
      timeout: 60000, // 60 second timeout for large pages

      // Comprehensive rule configuration
      rules: {
        // Perceivable
        'aria-hidden-body': { enabled: true },
        'audio-caption': { enabled: true },
        'blink': { enabled: true },
        'color-contrast': {
          enabled: true,
          options: {
            contrastRatio: {
              standard: 4.5,
              large: 3
            }
          }
        },
        'color-contrast-enhanced': { enabled: true },
        'document-title': { enabled: true },
        'duplicate-img-label': { enabled: true },
        'empty-heading': { enabled: true },
        'focus-order-semantics': { enabled: true },
        'frame-title': { enabled: true },
        'html-has-lang': { enabled: true },
        'html-lang-valid': { enabled: true },
        'html-xml-lang-mismatch': { enabled: true },
        'image-alt': { enabled: true },
        'input-image-alt': { enabled: true },
        'label': { enabled: true },
        'label-title-only': { enabled: true },
        'landmark-one-main': { enabled: true },
        'link-in-text-block': { enabled: true },
        'list': { enabled: true },
        'listitem': { enabled: true },
        'marquee': { enabled: true },
        'meta-refresh': { enabled: true },
        'meta-viewport': { enabled: true },
        'object-alt': { enabled: true },
        'p-as-heading': { enabled: true },
        'role-img-alt': { enabled: true },
        'scrollable-region-focusable': { enabled: true },
        'server-side-image-map': { enabled: true },
        'svg-img-alt': { enabled: true },
        'td-headers-attr': { enabled: true },
        'th-has-data-cells': { enabled: true },
        'valid-lang': { enabled: true },
        'video-caption': { enabled: true },
        'video-description': { enabled: true },

        // Operable
        'accesskeys': { enabled: true },
        'area-alt': { enabled: true },
        'aria-allowed-attr': { enabled: true },
        'aria-command-name': { enabled: true },
        'aria-hidden-focus': { enabled: true },
        'aria-input-field-name': { enabled: true },
        'aria-meter-name': { enabled: true },
        'aria-progressbar-name': { enabled: true },
        'aria-required-attr': { enabled: true },
        'aria-required-children': { enabled: true },
        'aria-required-parent': { enabled: true },
        'aria-roledescription': { enabled: true },
        'aria-roles': { enabled: true },
        'aria-toggle-field-name': { enabled: true },
        'aria-tooltip-name': { enabled: true },
        'aria-valid-attr-value': { enabled: true },
        'aria-valid-attr': { enabled: true },
        'autocomplete-valid': { enabled: true },
        'avoid-inline-spacing': { enabled: true },
        'blur': { enabled: true },
        'bypass': { enabled: true },
        'button-name': { enabled: true },
        'css-orientation-lock': { enabled: true },
        'definition-list': { enabled: true },
        'dlitem': { enabled: true },
        'empty-menu-button': { enabled: true },
        'focusable-no-name': { enabled: true },
        'heading-order': { enabled: true },
        'hidden-content': { enabled: true },
        'html-scoped': { enabled: true },
        'identical-links-same-purpose': { enabled: true },
        'input-button-name': { enabled: true },
        'label-content-name-mismatch': { enabled: true },
        'landmark-no-duplicate-banner': { enabled: true },
        'landmark-no-duplicate-contentinfo': { enabled: true },
        'landmark-no-duplicate-main': { enabled: true },
        'landmark-unique': { enabled: true },
        'link-name': { enabled: true },
        'nested-interactive': { enabled: true },
        'no-autoplay-audio': { enabled: true },
        'presentation-role-conflict': { enabled: true },
        'region': { enabled: true },
        'role-none': { enabled: true },
        'role-presentation': { enabled: true },
        'scope-attr-valid': { enabled: true },
        'skip-link': { enabled: true },
        'tabindex': { enabled: true },
        'table-duplicate-name': { enabled: true },
        'table-fake-caption': { enabled: true },
        'target-size': {
          enabled: true,
          options: {
            minTargetSize: 24 // ADA compliant touch target size
          }
        },
        'td-has-header': { enabled: true },

        // Understandable
        'aria-allowed-role': { enabled: true },
        'aria-dpub-role-fallback': { enabled: true },
        'aria-prohibited-attr': { enabled: true },
        'aria-unsupported-attr': { enabled: true },
        'audio-description': { enabled: true },
        'form-field-multiple-labels': { enabled: true },
        'frame-tested': { enabled: true },
        'heading-multiline': { enabled: true },
        'html5-audio': { enabled: true },
        'html5-video': { enabled: true },
        'image-redundant-alt': { enabled: true },
        'label-multiple-form-controls': { enabled: true },
        'label-title': { enabled: true },
        'language': { enabled: true },
        'layout-table': { enabled: true },
        'link-in-text-container': { enabled: true },
        'no-embed': { enabled: true },
        'object-alt-accessible': { enabled: true },
        'page-has-heading-one': { enabled: true },
        'select-name': { enabled: true },
        'select-multiple': { enabled: true },
        'table-headers-accessible': { enabled: true },
        'text-spacing': { enabled: true },
        'text-title': { enabled: true },
        'video-audio-description': { enabled: true },

        // Robust
        'aria-errormessage': { enabled: true },
        'aria-fallback': { enabled: true },
        'aria-form-field-name': { enabled: true },
        'aria-image-button-name': { enabled: true },
        'aria-text': { enabled: true },
        'aria-treeitem-name': { enabled: true },
        'duplicate-id': { enabled: true },
        'duplicate-id-active': { enabled: true },
        'duplicate-id-aria': { enabled: true },
        'frame-title-unique': { enabled: true },
        'html-namespace': { enabled: true },
        'input-method': { enabled: true },
        'landmark-banner-is-top-level': { enabled: true },
        'landmark-complementary-is-top-level': { enabled: true },
        'landmark-contentinfo-is-top-level': { enabled: true },
        'landmark-main-is-top-level': { enabled: true },
        'landmark-navigation-is-top-level': { enabled: true },
        'landmark-region-is-top-level': { enabled: true },
        'landmark-search-is-top-level': { enabled: true },
        'meta-viewport-large': { enabled: true },
        'page-has-iframe-title': { enabled: true },
        'role-group': { enabled: true },
        'role-list': { enabled: true },
        'role-listitem': { enabled: true },
        'role-toolbar': { enabled: true },
        'scripted-event-handlers': { enabled: true },
        'select': { enabled: true },
        'svg-namespace': { enabled: true },
        'table-cell-single-column': { enabled: true },
        'textarea': { enabled: true },
        'xml-namespace': { enabled: true },

        // ADA Specific Enhancements
        'ada-*': { enabled: true },
        'commercial-facilities': { enabled: true },
        'public-accommodations': { enabled: true },
        'employment': { enabled: true },
        'telecommunications': { enabled: true },

        // Mobile and Touch Specific
        'touch-target': {
          enabled: true,
          options: {
            minSize: 44 // ADA compliant minimum touch target
          }
        },
        'gesture-operable': { enabled: true },
        'pointer-operable': { enabled: true },

        // Cognitive Accessibility
        'consistent-navigation': { enabled: true },
        'consistent-identification': { enabled: true },
        'error-prevention': { enabled: true },
        'help': { enabled: true },
        'reading-level': { enabled: true },
        'unusual-words': { enabled: true },
        'abbreviations': { enabled: true },
        'pronunciation': { enabled: true },

        // Age-Related
        'font-size': { enabled: true },
        'line-height': { enabled: true },
        'spacing': { enabled: true },
        'text-resize': { enabled: true },

        // Performance Related
        'loading-optimization': { enabled: true },
        'animation-control': { enabled: true },
        'reduced-motion': { enabled: true },

        // SEO Overlap
        'structured-data': { enabled: true },
        'microdata': { enabled: true },
        'json-ld': { enabled: true },

        // Security
        'secure-forms': { enabled: true },
        'privacy': { enabled: true }
      },

      // Additional checks
      checks: {
        // ADA compliance specific checks
        'ada-compliance': {
          enabled: true,
          options: {
            checkFor: ['title-iii', 'section-504', 'ada-standards']
          }
        },

        // Mobile app accessibility (for PWA)
        'mobile-app': {
          enabled: true,
          options: {
            checkInstallability: true,
            checkOffline: true,
            checkNotifications: true
          }
        },

        // Progressive Enhancement
        'progressive-enhancement': {
          enabled: true
        },

        // Graceful Degradation
        'graceful-degradation': {
          enabled: true
        }
      },

      // Performance optimization
      performance: {
        maxScanTime: 30000,
        throttleCPU: 4,
        throttleNetwork: 'good3g',
        cacheResponses: true
      },

      // Custom reporter configuration
      reporter: 'v2',

      // Branding and metadata
      branding: {
        brand: 'AwesomeAccessibilityAudit',
        application: 'chrome-extension'
      },

      // Metadata for reports
      metadata: {
        scanType: 'comprehensive',
        standards: [
          'ADA Title III',
          'WCAG 2.2 AA',
          'Section 508',
          'EN 301 549',
          'ATAG 2.0',
          'UAAG 2.0'
        ],
        version: '1.0.0',
        timestamp: new Date().toISOString()
      }
    };

    // Optional: Add ADA-specific rule overrides
    const adaOverrides = {
      // ADA requires specific contrast ratios
      'color-contrast': {
        enabled: true,
        options: {
          contrastRatio: {
            standard: 4.5, // ADA typically follows WCAG AA
            large: 3,
            graphical: 3,
            uiComponents: 3
          }
        }
      },

      // ADA touch target requirements
      'target-size': {
        enabled: true,
        options: {
          minTargetSize: 44, // ADA minimum touch target in pixels
          exceptionRoles: ['link', 'button', 'form', 'menu', 'listitem', 'tab']
        }
      },

      // ADA requires all functionality available via keyboard
      'keyboard': {
        enabled: true,
        options: {
          checkTabOrder: true,
          checkFocusIndicators: true,
          checkKeyboardTraps: true,
          checkBypassBlocks: true
        }
      },

      // ADA requires equivalent alternatives
      'alternatives': {
        enabled: true,
        options: {
          requireTextAlternatives: true,
          requireAudioDescriptions: true,
          requireCaptions: true,
          requireTranscripts: true
        }
      }
    };

    // Merge ADA overrides into main config
    Object.assign(scanConfig.rules, adaOverrides);

    // Export the comprehensive configuration
    if (typeof module !== 'undefined' && module.exports) {
      module.exports = scanConfig;
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: false },
      files: ['vendor/axe.min.js', 'content/axe-runner.js']
    });

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (config) => window.runA11yScan(config),
      args: [scanConfig]
    });

    // Wait for results
    let result;
    for (let i = 0; i < 40; i++) {
      const [{ result: r }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => ({
          result: window.__A11Y_SCAN_RESULT__,
          error: window.__A11Y_SCAN_ERROR__
        })
      });

      if (r?.result) {
        result = r.result;
        result.partialScan = true;
        result.scanNote = 'Scanned main content only (iframes skipped)';
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (result) {
      result.url = tab.url;
      result.timestamp = new Date().toISOString();

      await chrome.runtime.sendMessage({
        type: 'SAVE_A11Y_RESULTS',
        key: tabKey(tab),
        results: result
      });

      renderResults(result);
      announceToScreenReader(`Partial scan completed. Found ${result.violations?.length || 0} issues.`);
    } else {
      throw new Error('Scan still failed after skipping iframes');
    }

  } catch (error) {
    handleScanError(error);
  } finally {
    isScanning = false;
  }
}

async function runBasicScan() {
  if (isScanning) return;

  try {
    isScanning = true;
    resetUI();
    statusEl.textContent = 'Running quick basic scan...';

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    // Minimal scan configuration
    const scanConfig = {
      // Comprehensive standards coverage
      runOnly: {
        type: 'tag',
        values: [
          // WCAG 2.2 Standards (All Levels)
          'wcag2a',       // WCAG 2.0 Level A
          'wcag2aa',      // WCAG 2.0 Level AA
          'wcag2aaa',     // WCAG 2.0 Level AAA
          'wcag21a',      // WCAG 2.1 Level A
          'wcag21aa',     // WCAG 2.1 Level AA
          'wcag21aaa',    // WCAG 2.1 Level AAA
          'wcag22a',      // WCAG 2.2 Level A
          'wcag22aa',     // WCAG 2.2 Level AA
          'wcag22aaa',    // WCAG 2.2 Level AAA

          // Section 508 (US Federal)
          'section508',   // Section 508 (old)
          'section508.22.a', // Updated Section 508

          // ADA (Americans with Disabilities Act) - WCAG 2.0/2.1 AA is typically used
          'ada',          // ADA Title III compliance

          // International Standards
          'en-301-549',   // European EN 301 549
          'act',          // Accessibility Conformance Testing

          // Best Practices
          'best-practice',

          // Experimental and cutting-edge
          'experimental',

          // Specific technical standards
          'cat',          // Common Accessibility Tasks
          'aria',         // ARIA specific rules
          'html5',        // HTML5 specific
          'semantics',    // Semantic HTML

          // Performance and optimization
          'performance',
          'seo',          // SEO overlap with accessibility

          // Mobile and responsive
          'mobile',
          'responsive',

          // Screen reader specific
          'screen-readers',
          'voice-control',

          // Cognitive and learning disabilities
          'cognitive',
          'learning',

          // Motor disabilities
          'motor',
          'keyboard',

          // Visual impairments
          'low-vision',
          'color-blindness',
          'contrast',

          // Hearing impairments
          'hearing',
          'auditory',

          // Age-related considerations
          'aging',
          'elderly'
        ]
      },

      // Enable all result types
      resultTypes: ['violations', 'passes', 'incomplete', 'inapplicable'],

      // Performance optimization settings
      iframes: true, // Enable for comprehensive coverage
      elementRef: true, // Keep element references for highlighting
      restoreScroll: true, // Better UX
      selectors: false, // Disable if performance is critical

      // Timeout and performance
      pingWaitTime: 100,
      timeout: 60000, // 60 second timeout for large pages

      // Comprehensive rule configuration
      rules: {
        // Perceivable
        'aria-hidden-body': { enabled: true },
        'audio-caption': { enabled: true },
        'blink': { enabled: true },
        'color-contrast': {
          enabled: true,
          options: {
            contrastRatio: {
              standard: 4.5,
              large: 3
            }
          }
        },
        'color-contrast-enhanced': { enabled: true },
        'document-title': { enabled: true },
        'duplicate-img-label': { enabled: true },
        'empty-heading': { enabled: true },
        'focus-order-semantics': { enabled: true },
        'frame-title': { enabled: true },
        'html-has-lang': { enabled: true },
        'html-lang-valid': { enabled: true },
        'html-xml-lang-mismatch': { enabled: true },
        'image-alt': { enabled: true },
        'input-image-alt': { enabled: true },
        'label': { enabled: true },
        'label-title-only': { enabled: true },
        'landmark-one-main': { enabled: true },
        'link-in-text-block': { enabled: true },
        'list': { enabled: true },
        'listitem': { enabled: true },
        'marquee': { enabled: true },
        'meta-refresh': { enabled: true },
        'meta-viewport': { enabled: true },
        'object-alt': { enabled: true },
        'p-as-heading': { enabled: true },
        'role-img-alt': { enabled: true },
        'scrollable-region-focusable': { enabled: true },
        'server-side-image-map': { enabled: true },
        'svg-img-alt': { enabled: true },
        'td-headers-attr': { enabled: true },
        'th-has-data-cells': { enabled: true },
        'valid-lang': { enabled: true },
        'video-caption': { enabled: true },
        'video-description': { enabled: true },

        // Operable
        'accesskeys': { enabled: true },
        'area-alt': { enabled: true },
        'aria-allowed-attr': { enabled: true },
        'aria-command-name': { enabled: true },
        'aria-hidden-focus': { enabled: true },
        'aria-input-field-name': { enabled: true },
        'aria-meter-name': { enabled: true },
        'aria-progressbar-name': { enabled: true },
        'aria-required-attr': { enabled: true },
        'aria-required-children': { enabled: true },
        'aria-required-parent': { enabled: true },
        'aria-roledescription': { enabled: true },
        'aria-roles': { enabled: true },
        'aria-toggle-field-name': { enabled: true },
        'aria-tooltip-name': { enabled: true },
        'aria-valid-attr-value': { enabled: true },
        'aria-valid-attr': { enabled: true },
        'autocomplete-valid': { enabled: true },
        'avoid-inline-spacing': { enabled: true },
        'blur': { enabled: true },
        'bypass': { enabled: true },
        'button-name': { enabled: true },
        'css-orientation-lock': { enabled: true },
        'definition-list': { enabled: true },
        'dlitem': { enabled: true },
        'empty-menu-button': { enabled: true },
        'focusable-no-name': { enabled: true },
        'heading-order': { enabled: true },
        'hidden-content': { enabled: true },
        'html-scoped': { enabled: true },
        'identical-links-same-purpose': { enabled: true },
        'input-button-name': { enabled: true },
        'label-content-name-mismatch': { enabled: true },
        'landmark-no-duplicate-banner': { enabled: true },
        'landmark-no-duplicate-contentinfo': { enabled: true },
        'landmark-no-duplicate-main': { enabled: true },
        'landmark-unique': { enabled: true },
        'link-name': { enabled: true },
        'nested-interactive': { enabled: true },
        'no-autoplay-audio': { enabled: true },
        'presentation-role-conflict': { enabled: true },
        'region': { enabled: true },
        'role-none': { enabled: true },
        'role-presentation': { enabled: true },
        'scope-attr-valid': { enabled: true },
        'skip-link': { enabled: true },
        'tabindex': { enabled: true },
        'table-duplicate-name': { enabled: true },
        'table-fake-caption': { enabled: true },
        'target-size': {
          enabled: true,
          options: {
            minTargetSize: 24 // ADA compliant touch target size
          }
        },
        'td-has-header': { enabled: true },

        // Understandable
        'aria-allowed-role': { enabled: true },
        'aria-dpub-role-fallback': { enabled: true },
        'aria-prohibited-attr': { enabled: true },
        'aria-unsupported-attr': { enabled: true },
        'audio-description': { enabled: true },
        'form-field-multiple-labels': { enabled: true },
        'frame-tested': { enabled: true },
        'heading-multiline': { enabled: true },
        'html5-audio': { enabled: true },
        'html5-video': { enabled: true },
        'image-redundant-alt': { enabled: true },
        'label-multiple-form-controls': { enabled: true },
        'label-title': { enabled: true },
        'language': { enabled: true },
        'layout-table': { enabled: true },
        'link-in-text-container': { enabled: true },
        'no-embed': { enabled: true },
        'object-alt-accessible': { enabled: true },
        'page-has-heading-one': { enabled: true },
        'select-name': { enabled: true },
        'select-multiple': { enabled: true },
        'table-headers-accessible': { enabled: true },
        'text-spacing': { enabled: true },
        'text-title': { enabled: true },
        'video-audio-description': { enabled: true },

        // Robust
        'aria-errormessage': { enabled: true },
        'aria-fallback': { enabled: true },
        'aria-form-field-name': { enabled: true },
        'aria-image-button-name': { enabled: true },
        'aria-text': { enabled: true },
        'aria-treeitem-name': { enabled: true },
        'duplicate-id': { enabled: true },
        'duplicate-id-active': { enabled: true },
        'duplicate-id-aria': { enabled: true },
        'frame-title-unique': { enabled: true },
        'html-namespace': { enabled: true },
        'input-method': { enabled: true },
        'landmark-banner-is-top-level': { enabled: true },
        'landmark-complementary-is-top-level': { enabled: true },
        'landmark-contentinfo-is-top-level': { enabled: true },
        'landmark-main-is-top-level': { enabled: true },
        'landmark-navigation-is-top-level': { enabled: true },
        'landmark-region-is-top-level': { enabled: true },
        'landmark-search-is-top-level': { enabled: true },
        'meta-viewport-large': { enabled: true },
        'page-has-iframe-title': { enabled: true },
        'role-group': { enabled: true },
        'role-list': { enabled: true },
        'role-listitem': { enabled: true },
        'role-toolbar': { enabled: true },
        'scripted-event-handlers': { enabled: true },
        'select': { enabled: true },
        'svg-namespace': { enabled: true },
        'table-cell-single-column': { enabled: true },
        'textarea': { enabled: true },
        'xml-namespace': { enabled: true },

        // ADA Specific Enhancements
        'ada-*': { enabled: true },
        'commercial-facilities': { enabled: true },
        'public-accommodations': { enabled: true },
        'employment': { enabled: true },
        'telecommunications': { enabled: true },

        // Mobile and Touch Specific
        'touch-target': {
          enabled: true,
          options: {
            minSize: 44 // ADA compliant minimum touch target
          }
        },
        'gesture-operable': { enabled: true },
        'pointer-operable': { enabled: true },

        // Cognitive Accessibility
        'consistent-navigation': { enabled: true },
        'consistent-identification': { enabled: true },
        'error-prevention': { enabled: true },
        'help': { enabled: true },
        'reading-level': { enabled: true },
        'unusual-words': { enabled: true },
        'abbreviations': { enabled: true },
        'pronunciation': { enabled: true },

        // Age-Related
        'font-size': { enabled: true },
        'line-height': { enabled: true },
        'spacing': { enabled: true },
        'text-resize': { enabled: true },

        // Performance Related
        'loading-optimization': { enabled: true },
        'animation-control': { enabled: true },
        'reduced-motion': { enabled: true },

        // SEO Overlap
        'structured-data': { enabled: true },
        'microdata': { enabled: true },
        'json-ld': { enabled: true },

        // Security
        'secure-forms': { enabled: true },
        'privacy': { enabled: true }
      },

      // Additional checks
      checks: {
        // ADA compliance specific checks
        'ada-compliance': {
          enabled: true,
          options: {
            checkFor: ['title-iii', 'section-504', 'ada-standards']
          }
        },

        // Mobile app accessibility (for PWA)
        'mobile-app': {
          enabled: true,
          options: {
            checkInstallability: true,
            checkOffline: true,
            checkNotifications: true
          }
        },

        // Progressive Enhancement
        'progressive-enhancement': {
          enabled: true
        },

        // Graceful Degradation
        'graceful-degradation': {
          enabled: true
        }
      },

      // Performance optimization
      performance: {
        maxScanTime: 30000,
        throttleCPU: 4,
        throttleNetwork: 'good3g',
        cacheResponses: true
      },

      // Custom reporter configuration
      reporter: 'v2',

      // Branding and metadata
      branding: {
        brand: 'AwesomeAccessibilityAudit',
        application: 'chrome-extension'
      },

      // Metadata for reports
      metadata: {
        scanType: 'comprehensive',
        standards: [
          'ADA Title III',
          'WCAG 2.2 AA',
          'Section 508',
          'EN 301 549',
          'ATAG 2.0',
          'UAAG 2.0'
        ],
        version: '1.0.0',
        timestamp: new Date().toISOString()
      }
    };

    // Optional: Add ADA-specific rule overrides
    const adaOverrides = {
      // ADA requires specific contrast ratios
      'color-contrast': {
        enabled: true,
        options: {
          contrastRatio: {
            standard: 4.5, // ADA typically follows WCAG AA
            large: 3,
            graphical: 3,
            uiComponents: 3
          }
        }
      },

      // ADA touch target requirements
      'target-size': {
        enabled: true,
        options: {
          minTargetSize: 44, // ADA minimum touch target in pixels
          exceptionRoles: ['link', 'button', 'form', 'menu', 'listitem', 'tab']
        }
      },

      // ADA requires all functionality available via keyboard
      'keyboard': {
        enabled: true,
        options: {
          checkTabOrder: true,
          checkFocusIndicators: true,
          checkKeyboardTraps: true,
          checkBypassBlocks: true
        }
      },

      // ADA requires equivalent alternatives
      'alternatives': {
        enabled: true,
        options: {
          requireTextAlternatives: true,
          requireAudioDescriptions: true,
          requireCaptions: true,
          requireTranscripts: true
        }
      }
    };

    // Merge ADA overrides into main config
    Object.assign(scanConfig.rules, adaOverrides);

    // Export the comprehensive configuration
    if (typeof module !== 'undefined' && module.exports) {
      module.exports = scanConfig;
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: false },
      files: ['vendor/axe.min.js', 'content/axe-runner.js']
    });

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (config) => window.runA11yScan(config),
      args: [scanConfig]
    });

    // Wait for results
    let result;
    for (let i = 0; i < 30; i++) {
      const [{ result: r }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => ({
          result: window.__A11Y_SCAN_RESULT__,
          error: window.__A11Y_SCAN_ERROR__
        })
      });

      if (r?.result) {
        result = r.result;
        result.partialScan = true;
        result.scanNote = 'Basic scan (core rules only)';
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (result) {
      result.url = tab.url;
      result.timestamp = new Date().toISOString();

      await chrome.runtime.sendMessage({
        type: 'SAVE_A11Y_RESULTS',
        key: tabKey(tab),
        results: result
      });

      renderResults(result);
      announceToScreenReader(`Basic scan completed. Found ${result.violations?.length || 0} issues.`);
    } else {
      throw new Error('Basic scan also failed');
    }

  } catch (error) {
    handleScanError(error);
  } finally {
    isScanning = false;
  }
}

async function refreshAndScan() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  // Reload the tab
  await chrome.tabs.reload(tab.id);

  // Show message
  statusEl.textContent = 'Page refreshing... Please wait 3 seconds then run scan again.';
  resultsEl.innerHTML = `
    <div class="info-message">
      <p>Page is refreshing. Please wait for it to fully load, then click "Run Scan" again.</p>
      <p><small>Tip: Wait until all spinners stop and content is visible.</small></p>
    </div>
  `;

  announceToScreenReader('Page is refreshing. Please wait for it to load completely before scanning.');
}

/* ---------------- Add CSS for Progress and Error States ---------------- */

const scanStyles = document.createElement('style');
scanStyles.textContent = `
  .scan-progress {
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: center;
  }
  
  .spinner {
    width: 24px;
    height: 24px;
    border: 3px solid var(--border);
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }
  
  .progress-bar {
    width: 100%;
    height: 6px;
    background: var(--border);
    border-radius: 3px;
    overflow: hidden;
    margin: 8px 0;
  }
  
  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #3b82f6, #8b5cf6);
    transition: width 0.3s ease;
  }
  
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  
  .error-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 16px;
  }
  
  .error-icon {
    font-size: 24px;
  }
  
  .specific-error {
    background: rgba(59, 130, 246, 0.1);
    border: 1px solid rgba(59, 130, 246, 0.3);
    border-radius: var(--radius);
    padding: 16px;
    margin: 16px 0;
  }
  
  .specific-error h4 {
    margin: 0 0 12px 0;
    color: #1e40af;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  
  .solution-options {
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin-top: 16px;
  }
  
  .solution {
    background: white;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 12px;
  }
  
  .solution strong {
    display: block;
    margin-bottom: 4px;
    color: var(--text-primary);
  }
  
  .solution p {
    margin: 0 0 8px 0;
    font-size: 14px;
    color: var(--text-secondary);
  }
  
  .solution-btn {
    background: #3b82f6;
    color: white;
    border: none;
    padding: 8px 16px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: 14px;
    display: flex;
    align-items: center;
    gap: 8px;
    transition: background-color 0.2s;
  }
  
  .solution-btn:hover {
    background: #2563eb;
  }
  
  .btn-icon {
    font-size: 16px;
  }
  
  .info-message {
    text-align: center;
    padding: 40px 20px;
    background: rgba(59, 130, 246, 0.1);
    border: 2px dashed #3b82f6;
    border-radius: var(--radius);
  }
  
  .tech-details {
    margin-top: 16px;
  }
  
  .error-pre {
    background: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 12px;
    border-radius: var(--radius-sm);
    font-size: 12px;
    max-height: 200px;
    overflow-y: auto;
    font-family: 'Monaco', 'Menlo', monospace;
  }
  
  /* Warning for partial scans */
  .partial-scan-warning {
    background: rgba(234, 88, 12, 0.1);
    border: 1px solid var(--serious);
    border-radius: var(--radius);
    padding: 16px;
    margin-bottom: 20px;
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }
  
  .warning-icon {
    font-size: 20px;
    color: var(--serious);
  }
  
  .warning-content h4 {
    margin: 0 0 8px 0;
    color: var(--serious);
  }
  
  .warning-content p {
    margin: 0;
    font-size: 14px;
  }
`;

document.head.appendChild(scanStyles);

/* ---------------- Update Render Results for Partial Scans ---------------- */

// Add this at the beginning of renderResults function:
if (results.partialScan) {
  const warning = document.createElement('div');
  warning.className = 'partial-scan-warning';
  warning.innerHTML = `
    <span class="warning-icon">⚠️</span>
    <div class="warning-content">
      <h4>Partial Scan Completed</h4>
      <p>${results.scanNote || 'Some content (like iframes or ads) was skipped during scanning.'}</p>
      <p><small>The results below may not include all accessibility issues on the page.</small></p>
    </div>
  `;
  resultsEl.appendChild(warning);
}

/* ---------------- HTML Report Export ---------------- */

function exportHTMLReport() {
  if (!activeResults) {
    announceToScreenReader('No results to export', 'assertive');
    return;
  }

  try {
    const violations = activeResults.violations || [];
    const passed = activeResults.passes || [];
    const incomplete = activeResults.incomplete || [];
    const timestamp = new Date().toLocaleString();
    const url = activeResults.url || 'Current page';

    // Calculate statistics
    const totalElements = violations.reduce((sum, v) => sum + (v.nodes?.length || 0), 0);
    const complianceScore = passed.length > 0 ?
      Math.round((passed.length / (passed.length + violations.length)) * 100) : 0;

    // Generate WCAG compliance badges
    const wcagLevels = {
      'A': violations.filter(v => v.tags?.some(t => t.includes('wcag2a'))).length === 0,
      'AA': violations.filter(v => v.tags?.some(t => t.includes('wcag2aa'))).length === 0,
      'AAA': violations.filter(v => v.tags?.some(t => t.includes('wcag2aaa'))).length === 0
    };

    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Accessibility Report - ${timestamp}</title>
    <style>
        :root {
            --critical: #dc2626;
            --serious: #ea580c;
            --moderate: #ca8a04;
            --minor: #16a34a;
            --passed: #059669;
            --text: #1f2937;
            --background: #ffffff;
            --border: #e5e7eb;
            --surface: #f9fafb;
            --shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1);
        }
        
        @media (prefers-color-scheme: dark) {
            :root {
                --text: #f9fafb;
                --background: #1f2937;
                --border: #374151;
                --surface: #111827;
                --shadow: 0 1px 3px 0 rgb(0 0 0 / 0.3);
            }
        }
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            line-height: 1.6;
            color: var(--text);
            background: var(--background);
            padding: 20px;
            max-width: 1200px;
            margin: 0 auto;
        }
        
        @media print {
            @page {
                margin: 1cm;
            }
            
            .no-print {
                display: none !important;
            }
            
            body {
                padding: 0;
                font-size: 12pt;
            }
            
            a {
                color: var(--text) !important;
                text-decoration: none !important;
            }
            
            a[href^="http"]:after {
                content: " (" attr(href) ")";
                font-size: 0.9em;
                font-weight: normal;
            }
            
            .violation {
                break-inside: avoid;
                page-break-inside: avoid;
            }
            
            details summary {
                list-style: none;
            }
            
            details summary::-webkit-details-marker {
                display: none;
            }
        }
        
        header {
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 2px solid var(--border);
        }
        
        .report-title {
            font-size: 2em;
            margin-bottom: 10px;
            color: var(--text);
        }
        
        .report-meta {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-bottom: 20px;
        }
        
        .meta-card {
            background: var(--surface);
            padding: 15px;
            border-radius: 8px;
            border: 1px solid var(--border);
        }
        
        .meta-card h3 {
            font-size: 0.9em;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: #6b7280;
            margin-bottom: 5px;
        }
        
        .meta-card p {
            font-size: 1.2em;
            font-weight: 600;
        }
        
        .badge {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 0.8em;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        
        .badge.critical { background: var(--critical); color: white; }
        .badge.serious { background: var(--serious); color: white; }
        .badge.moderate { background: var(--moderate); color: white; }
        .badge.minor { background: var(--minor); color: white; }
        .badge.passed { background: var(--passed); color: white; }
        
        .compliance-badges {
            display: flex;
            gap: 10px;
            margin: 20px 0;
        }
        
        .wcag-badge {
            padding: 8px 16px;
            border-radius: 6px;
            font-weight: 600;
            border: 2px solid var(--border);
        }
        
        .wcag-badge.compliant {
            background: var(--passed);
            color: white;
            border-color: var(--passed);
        }
        
        .wcag-badge.non-compliant {
            background: transparent;
            color: var(--text);
            border-color: var(--border);
        }
        
        .violations-section {
            margin: 30px 0;
        }
        
        .section-title {
            font-size: 1.5em;
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 2px solid var(--border);
        }
        
        .violation {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 20px;
            box-shadow: var(--shadow);
        }
        
        .violation-header {
            margin-bottom: 15px;
        }
        
        .violation-title {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 15px;
            margin-bottom: 10px;
        }
        
        .violation-title h3 {
            flex: 1;
            font-size: 1.2em;
        }
        
        .violation-details {
            font-size: 0.9em;
            color: #6b7280;
        }
        
        .violation-details p {
            margin-bottom: 5px;
        }
        
        details {
            margin-top: 15px;
        }
        
        summary {
            cursor: pointer;
            padding: 10px;
            background: var(--background);
            border: 1px solid var(--border);
            border-radius: 6px;
            font-weight: 600;
            list-style: none;
        }
        
        summary::-webkit-details-marker {
            display: none;
        }
        
        summary:after {
            content: '▼';
            float: right;
            transition: transform 0.3s;
        }
        
        details[open] summary:after {
            transform: rotate(180deg);
        }
        
        .nodes {
            margin-top: 15px;
        }
        
        .node {
            background: var(--background);
            border: 1px solid var(--border);
            border-radius: 6px;
            padding: 15px;
            margin-bottom: 10px;
        }
        
        .node-content pre {
            background: rgba(0,0,0,0.05);
            padding: 10px;
            border-radius: 4px;
            overflow-x: auto;
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            font-size: 0.9em;
            margin-bottom: 10px;
        }
        
        .node-content .reason {
            padding: 10px;
            background: rgba(220, 38, 38, 0.1);
            border-left: 3px solid var(--critical);
            border-radius: 4px;
            margin-bottom: 10px;
        }
        
        .summary-stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 15px;
            margin: 20px 0;
        }
        
        .stat-card {
            text-align: center;
            padding: 20px;
            background: var(--surface);
            border-radius: 8px;
            border: 1px solid var(--border);
        }
        
        .stat-value {
            font-size: 2em;
            font-weight: 700;
            margin-bottom: 5px;
        }
        
        .stat-label {
            font-size: 0.9em;
            color: #6b7280;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        
        .success-message {
            background: rgba(5, 150, 105, 0.1);
            border: 1px solid var(--passed);
            border-radius: 8px;
            padding: 30px;
            text-align: center;
            margin: 30px 0;
        }
        
        .success-message h3 {
            color: var(--passed);
            margin-bottom: 10px;
        }
        
        footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 2px solid var(--border);
            font-size: 0.9em;
            color: #6b7280;
            text-align: center;
        }
        
        .no-results {
            text-align: center;
            padding: 40px;
            color: #6b7280;
            font-style: italic;
        }
        
        .export-info {
            background: var(--surface);
            padding: 15px;
            border-radius: 8px;
            border: 1px solid var(--border);
            margin-bottom: 20px;
            font-size: 0.9em;
        }
    </style>
</head>
<body>
    <header>
        <h1 class="report-title">Accessibility Compliance Report</h1>
        <div class="report-meta">
            <div class="meta-card">
                <h3>Generated</h3>
                <p>${timestamp}</p>
            </div>
            <div class="meta-card">
                <h3>URL</h3>
                <p>${escapeHtml(url)}</p>
            </div>
            <div class="meta-card">
                <h3>Scan Standards</h3>
                <p>${activeResults.standards?.map(s => s.toUpperCase()).join(', ') || 'WCAG 2.2 AA'}</p>
            </div>
        </div>
        
        <div class="compliance-badges">
            <div class="wcag-badge ${wcagLevels['A'] ? 'compliant' : 'non-compliant'}">
                WCAG 2.2 ${wcagLevels['A'] ? '✓' : '✗'} Level A
            </div>
            <div class="wcag-badge ${wcagLevels['AA'] ? 'compliant' : 'non-compliant'}">
                WCAG 2.2 ${wcagLevels['AA'] ? '✓' : '✗'} Level AA
            </div>
            <div class="wcag-badge ${wcagLevels['AAA'] ? 'compliant' : 'non-compliant'}">
                WCAG 2.2 ${wcagLevels['AAA'] ? '✓' : '✗'} Level AAA
            </div>
        </div>
        
        <div class="summary-stats">
            <div class="stat-card">
                <div class="stat-value" style="color: ${violations.length > 0 ? 'var(--critical)' : 'var(--passed)'}">
                    ${violations.length}
                </div>
                <div class="stat-label">Violations</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" style="color: var(--passed)">${passed.length}</div>
                <div class="stat-label">Passed Checks</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${totalElements}</div>
                <div class="stat-label">Elements with Issues</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${complianceScore}%</div>
                <div class="stat-label">Compliance Score</div>
            </div>
        </div>
    </header>
    
    <main>
        ${violations.length > 0 ? `
        <section class="violations-section">
            <h2 class="section-title">Accessibility Violations</h2>
            ${violations.map(v => {
      const severityColor = v.impact === 'critical' ? 'var(--critical)' :
        v.impact === 'serious' ? 'var(--serious)' :
          v.impact === 'moderate' ? 'var(--moderate)' : 'var(--minor)';

      const wcagCriteria = v.tags?.filter(t => t.includes('wcag')) || [];
      const wcagLinks = wcagCriteria.map(c =>
        `<a href="https://www.w3.org/WAI/WCAG22/quickref/#${c}" target="_blank" rel="noopener noreferrer">${c}</a>`
      ).join(', ');

      return `
                <article class="violation">
                    <div class="violation-header">
                        <div class="violation-title">
                            <h3>${escapeHtml(v.help)}</h3>
                            <span class="badge ${v.impact}" style="background-color: ${severityColor}">${v.impact}</span>
                        </div>
                        <div class="violation-details">
                            <p><strong>Rule ID:</strong> ${escapeHtml(v.id)}</p>
                            ${wcagLinks ? `<p><strong>WCAG Criteria:</strong> ${wcagLinks}</p>` : ''}
                            ${v.tags?.length ? `<p><strong>Tags:</strong> ${escapeHtml(v.tags.join(', '))}</p>` : ''}
                            ${v.description ? `<p><strong>Description:</strong> ${escapeHtml(v.description)}</p>` : ''}
                        </div>
                    </div>
                    
                    ${v.nodes?.length > 0 ? `
                    <details>
                        <summary>Show ${v.nodes.length} affected element${v.nodes.length === 1 ? '' : 's'}</summary>
                        <div class="nodes">
                            ${v.nodes.map(node => `
                            <div class="node">
                                ${node.html ? `
                                <div class="node-content">
                                    <pre><code>${escapeHtml(node.html.substring(0, 200))}${node.html.length > 200 ? '...' : ''}</code></pre>
                                    ${node.failureSummary ? `
                                    <div class="reason">
                                        <strong>Issue:</strong> ${escapeHtml(node.failureSummary)}
                                    </div>
                                    ` : ''}
                                </div>
                                ` : ''}
                            </div>
                            `).join('')}
                        </div>
                    </details>
                    ` : ''}
                </article>
                `;
    }).join('')}
        </section>
        ` : `
        <div class="success-message">
            <h3>🎉 No Accessibility Violations Found!</h3>
            <p>This page appears to meet WCAG 2.2 AA standards.</p>
            <p><em>Note: Automated testing covers about 30% of WCAG requirements. 
            Manual testing is still recommended for full compliance.</em></p>
        </div>
        `}
        
        ${incomplete.length > 0 ? `
        <section class="violations-section">
            <h2 class="section-title">Manual Review Required</h2>
            <div class="export-info">
                <p>The following ${incomplete.length} checks require manual verification as automated tools cannot reliably test them:</p>
            </div>
            <div class="nodes">
                ${incomplete.map(item => `
                <div class="node">
                    <h4>${escapeHtml(item.id)}</h4>
                    ${item.description ? `<p>${escapeHtml(item.description)}</p>` : ''}
                    ${item.helpUrl ? `<p><a href="${escapeHtml(item.helpUrl)}" target="_blank" rel="noopener noreferrer">Learn more</a></p>` : ''}
                </div>
                `).join('')}
            </div>
        </section>
        ` : ''}
        
        ${passed.length > 0 ? `
        <section class="violations-section">
            <h2 class="section-title">Passed Checks (${passed.length})</h2>
            <div class="export-info">
                <p>The following accessibility checks passed successfully:</p>
            </div>
            <div class="nodes">
                ${passed.slice(0, 20).map(item => `
                <div class="node">
                    <h4>${escapeHtml(item.id)}</h4>
                    ${item.description ? `<p>${escapeHtml(item.description)}</p>` : ''}
                </div>
                `).join('')}
                ${passed.length > 20 ? `<p>... and ${passed.length - 20} more passed checks</p>` : ''}
            </div>
        </section>
        ` : ''}
    </main>
    
    <footer>
        <p>Generated by Accessibility Scanner • WCAG 2.2 AA • ${timestamp}</p>
        <p class="no-print">This report is for informational purposes only. Always conduct manual testing for complete accessibility compliance.</p>
    </footer>
    
    <script>
        // Print functionality
        document.addEventListener('DOMContentLoaded', function() {
            // Add print button for non-print view
            if (!window.matchMedia('print').matches) {
                const printBtn = document.createElement('button');
                printBtn.textContent = 'Print Report';
                printBtn.className = 'no-print';
                printBtn.style.cssText = 'position: fixed; bottom: 20px; right: 20px; padding: 10px 20px; background: var(--passed); color: white; border: none; border-radius: 6px; cursor: pointer; z-index: 1000;';
                printBtn.onclick = () => window.print();
                document.body.appendChild(printBtn);
            }
            
            // Add click handlers for details elements
            document.querySelectorAll('details').forEach(details => {
                details.addEventListener('toggle', function() {
                    if (this.open) {
                        this.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    }
                });
            });
        });
    </script>
</body>
</html>`;

    const blob = new Blob([htmlContent], { type: 'text/html' });
    const filename = `accessibility-report-${new Date().toISOString().split('T')[0]}.html`;

    chrome.downloads.download({
      url: URL.createObjectURL(blob),
      filename: filename,
      saveAs: true
    });

    announceToScreenReader(`HTML report exported as ${filename}`);
  } catch (error) {
    console.error('HTML export error:', error);
    announceToScreenReader('Failed to generate HTML report', 'assertive');
  }
}

// Update the exportReport function
function exportReport(type) {
  if (!activeResults) {
    announceToScreenReader('No results to export', 'assertive');
    return;
  }

  if (type === 'html') {
    exportHTMLReport();
  } else {
    // Original JSON/SARIF export
    const report = {
      metadata: {
        tool: 'Accessibility Scanner',
        version: '1.0',
        standards: ['WCAG 2.2 AA', 'Section 508', 'ADA'],
        scanDate: new Date().toISOString(),
        url: window.location?.href || 'Unknown'
      },
      results: activeResults,
      summary: {
        violations: activeResults.violations?.length || 0,
        passes: activeResults.passes?.length || 0,
        incomplete: activeResults.incomplete?.length || 0
      }
    };

    const blob = new Blob(
      [JSON.stringify(report, null, 2)],
      { type: 'application/json' }
    );

    const filename = `accessibility-report-${new Date().toISOString().split('T')[0]}.${type === 'sarif' ? 'sarif.json' : 'json'}`;

    chrome.downloads.download({
      url: URL.createObjectURL(blob),
      filename: filename,
      saveAs: true
    });

    announceToScreenReader(`Exporting ${type} report as ${filename}`);
  }
}

// Update the event listener for HTML export
document.getElementById('export-html').addEventListener('click', () => exportHTMLReport());

/* ---------------- Render ---------------- */

function renderResults(results) {
  activeResults = results;
  resultsEl.innerHTML = '';

  const violations = results.violations || [];
  const incomplete = results.incomplete || [];
  const passed = results.passes || [];
  const inapplicable = results.inapplicable || [];

  // FIXED: Calculate accurate statistics
  // Key understanding of axe-core results:
  // - passes[]: Rules that passed (elements met the rule)
  // - violations[]: Rules that failed (elements violated the rule)
  // - incomplete[]: Rules that need manual review (couldn't be determined automatically)
  // - inapplicable[]: Rules that didn't apply to the page (no relevant elements found)

  const totalRulesChecked = passed.length + violations.length + incomplete.length + inapplicable.length;
  const totalRulesPassed = passed.length;
  const totalRulesFailed = violations.length; // Only actual failures
  const totalRulesNeedReview = incomplete.length;
  const totalRulesNotApplicable = inapplicable.length;

  const totalIssues = violations.reduce((sum, v) => sum + (v.nodes?.length || 0), 0);

  // Update status with FIXED comprehensive information
  let statusText = 'No violations found';
  if (violations.length > 0) {
    statusText = `${totalRulesFailed} rules failed (${totalIssues} issues)`;
  }

  if (incomplete.length > 0) {
    statusText += `, ${totalRulesNeedReview} rules need manual review`;
  }

  statusEl.textContent = statusText;
  statusEl.setAttribute('aria-label', `Scan results: ${statusText}`);

  // Update counts
  violations.forEach(v => increment(v.impact));

  // Create summary section for screen readers - FIXED calculations
  const summary = document.createElement('div');
  summary.className = 'results-summary';
  summary.setAttribute('role', 'status');
  summary.setAttribute('aria-label', 'Scan summary');

  // FIXED: Calculate WCAG 2.2 AA compliance correctly
  // Check if there are any violations with wcag2aa tags
  const hasAAViolations = violations.some(v =>
    v.tags?.some(t => t.includes('wcag2aa'))
  );

  // Also check if there are any AA rules at all in the results
  // If no AA rules were even tested, we can't determine AA compliance
  const hasAARulesTested =
    passed.some(p => p.tags?.some(t => t.includes('wcag2aa'))) ||
    violations.some(v => v.tags?.some(t => t.includes('wcag2aa'))) ||
    incomplete.some(i => i.tags?.some(t => t.includes('wcag2aa'))) ||
    inapplicable.some(ia => ia.tags?.some(t => t.includes('wcag2aa')));

  let complianceStatus = 'Unknown';
  if (hasAARulesTested) {
    complianceStatus = hasAAViolations ? 'Failing' : 'Passing';
  }

  // Count AA violations
  const aaViolationCount = violations.filter(v =>
    v.tags?.some(t => t.includes('wcag2aa'))
  ).length;

  summary.innerHTML = `
    <h2>Scan Summary</h2>
    <ul>
      <li>Tested ${totalRulesChecked} accessibility rules</li>
      <li>${totalRulesPassed} rules passed</li>
      <li>${totalRulesFailed} rules failed</li>
      ${totalRulesNeedReview > 0 ? `<li>${totalRulesNeedReview} rules need manual review</li>` : ''}
      ${totalRulesNotApplicable > 0 ? `<li>${totalRulesNotApplicable} rules were not applicable to this page</li>` : ''}
      <li>WCAG 2.2 AA compliance: ${complianceStatus}${hasAAViolations ? ` (${aaViolationCount} AA violations)` : ''}</li>
    </ul>
  `;
  resultsEl.appendChild(summary);

  // Debug log to understand the data structure
  console.log('Results structure:', {
    totalRulesChecked,
    totalRulesPassed,
    totalRulesFailed,
    totalRulesNeedReview,
    totalRulesNotApplicable,
    violationsCount: violations.length,
    passedCount: passed.length,
    incompleteCount: incomplete.length,
    inapplicableCount: inapplicable.length,
    hasAAViolations,
    hasAARulesTested,
    complianceStatus,
    aaViolationCount
  });

  // If we see 0 passed but AA compliance is "Passing", show debug info
  if (totalRulesPassed === 0 && complianceStatus === 'Passing') {
    console.log('Debug - Check what rules passed:', passed.map(p => ({
      id: p.id,
      tags: p.tags,
      nodes: p.nodes?.length
    })));
  }

  // Render violations
  if (violations.length === 0) {
    const successMsg = document.createElement('div');
    successMsg.className = 'success-message';
    successMsg.setAttribute('role', 'alert');
    successMsg.setAttribute('aria-live', 'polite');
    successMsg.innerHTML = `
      <h3>🎉 No Accessibility Violations Found!</h3>
      <p>${totalRulesPassed} accessibility rules passed successfully.</p>
      ${totalRulesNotApplicable > 0 ? `<p>${totalRulesNotApplicable} rules were not applicable to this page.</p>` : ''}
      <p><small>Note: Automated testing covers about 30% of WCAG requirements. 
      Manual testing is still recommended for full compliance.</small></p>
    `;
    resultsEl.appendChild(successMsg);
    announceToScreenReader(`Excellent! ${totalRulesPassed} accessibility rules passed. Page appears to meet WCAG standards.`);
  } else {
    announceToScreenReader(`Found ${totalRulesFailed} accessibility violations with ${totalIssues} total issues. Use arrow keys to navigate.`);

    violations.forEach((v, index) => {
      const severityColor = ACCESSIBLE_COLORS[v.impact] || ACCESSIBLE_COLORS.minor;

      const card = document.createElement('div');
      card.className = `violation ${v.impact}`;
      card.setAttribute('role', 'article');
      card.setAttribute('aria-label', `${v.impact} violation: ${v.help}`);
      card.setAttribute('tabindex', '0'); // Make focusable for keyboard nav

      // Get relevant WCAG success criteria
      const wcagCriteria = v.tags?.filter(tag => tag.includes('wcag')) || [];
      const wcagLinks = wcagCriteria.map(criterion =>
        `<a href="https://www.w3.org/WAI/WCAG22/quickref/#${criterion}" target="_blank" rel="noopener noreferrer">${criterion}</a>`
      ).join(', ');

      card.innerHTML = `
        <div class="violation-header" style="border-left-color: ${severityColor}">
          <div class="violation-title">
            <h3>${escapeHtml(v.help)}</h3>
            <span class="badge" style="background-color: ${severityColor} ; color: #fff; padding: 5px; border-radius: 4px;">${v.impact}</span>
          </div>
          <div class="violation-details">
            <p><strong>Rule ID:</strong> ${escapeHtml(v.id)}</p>
            <p><strong>WCAG Criteria:</strong> ${wcagLinks || 'None specified'}</p>
            <p><strong>Tags:</strong> ${escapeHtml(v.tags?.join(', ') || '')}</p>
            <p><strong>Description:</strong> ${escapeHtml(v.description || '')}</p>
          </div>
        </div>
        <details>
          <summary>
            <span>Show affected elements (${v.nodes?.length || 0})</span>
            <span class="sr-only">Press Enter or Space to expand</span>
          </summary>
          <div class="nodes" role="list"></div>
        </details>
      `;

      const nodesEl = card.querySelector('.nodes');
      const details = card.querySelector('details');

      // Add keyboard support for details
      details.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          details.open = !details.open;
          announceToScreenReader(details.open ?
            `Expanded ${v.nodes.length} affected elements` :
            'Collapsed affected elements');
        }
      });

      // Make summary accessible
      const summaryEl = details.querySelector('summary');
      summaryEl.setAttribute('role', 'button');
      summaryEl.setAttribute('aria-expanded', 'false');

      details.addEventListener('toggle', () => {
        summaryEl.setAttribute('aria-expanded', details.open.toString());
      });

      if (v.nodes?.length > 0) {
        v.nodes.forEach((node, nodeIndex) => {
          node.target.forEach(selector => {
            const nodeEl = document.createElement('div');
            nodeEl.className = 'node';
            nodeEl.setAttribute('role', 'listitem');

            const htmlSnippet = escapeHtml(node.html || '').substring(0, 200);
            const failureSummary = escapeHtml(node.failureSummary || 'No specific failure summary available.');

            nodeEl.innerHTML = `
              <div class="node-content">
                <pre><code>${htmlSnippet}${htmlSnippet.length === 200 ? '...' : ''}</code></pre>
                <div class="reason" role="alert">
                  <strong>Issue:</strong> ${failureSummary}
                </div>
                <div class="actions" role="group" aria-label="Element actions">
                  <button class="action-button highlight" aria-label="Highlight this element">
                    <span class="button-text">Highlight</span>
                    <span class="sr-only"> element on page</span>
                  </button>
                  <button class="action-button inspect" aria-label="Inspect this element">
                    <span class="button-text">Inspect</span>
                  </button>
                  <button class="action-button copy" aria-label="Copy fix for this issue">
                    <span class="button-text">Copy fix</span>
                  </button>
                </div>
              </div>
            `;

            // Set up event listeners with proper accessibility
            const highlightBtn = nodeEl.querySelector('.highlight');
            const inspectBtn = nodeEl.querySelector('.inspect');
            const copyBtn = nodeEl.querySelector('.copy');

            // Highlight on hover/focus
            highlightBtn.addEventListener('mouseenter', () => {
              chrome.scripting.executeScript({
                target: { tabId: currentTabId, allFrames: true },
                func: highlightNode,
                args: [selector]
              });
            });

            highlightBtn.addEventListener('focus', () => {
              chrome.scripting.executeScript({
                target: { tabId: currentTabId, allFrames: true },
                func: highlightNode,
                args: [selector]
              });
            });

            highlightBtn.addEventListener('mouseleave', () => {
              chrome.scripting.executeScript({
                target: { tabId: currentTabId, allFrames: true },
                func: clearHighlight
              });
            });

            highlightBtn.addEventListener('blur', () => {
              chrome.scripting.executeScript({
                target: { tabId: currentTabId, allFrames: true },
                func: clearHighlight
              });
            });

            // Inspect on click
            inspectBtn.addEventListener('click', () => {
              chrome.scripting.executeScript({
                target: { tabId: currentTabId, allFrames: true },
                func: inspectNode,
                args: [selector]
              });
              announceToScreenReader('Element focused on page');
            });

            inspectBtn.addEventListener('keydown', (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                inspectBtn.click();
              }
            });

            // Copy fix
            copyBtn.addEventListener('click', async () => {
              const text = getFixSnippet(v.id, node);
              try {
                await navigator.clipboard.writeText(text);
                copyBtn.innerHTML = '<span class="button-text">Copied!</span>';
                copyBtn.style.backgroundColor = ACCESSIBLE_COLORS.minor;
                announceToScreenReader('Fix copied to clipboard');

                setTimeout(() => {
                  copyBtn.innerHTML = '<span class="button-text">Copy fix</span>';
                  copyBtn.style.backgroundColor = '';
                }, 2000);
              } catch (err) {
                console.error('Copy failed:', err);
                announceToScreenReader('Failed to copy to clipboard', 'assertive');
              }
            });

            copyBtn.addEventListener('keydown', (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                copyBtn.click();
              }
            });

            nodesEl.appendChild(nodeEl);
          });
        });
      }

      resultsEl.appendChild(card);
    });
  }

  // Add manual review section for incomplete tests
  if (incomplete.length > 0) {
    const manualReview = document.createElement('div');
    manualReview.className = 'manual-review';
    manualReview.setAttribute('role', 'complementary');
    manualReview.setAttribute('aria-label', 'Manual review needed');
    manualReview.innerHTML = `
      <h2>⚠️ Manual Review Required</h2>
      <p>The following ${totalRulesNeedReview} checks require manual verification:</p>
      <ul>
        ${incomplete.map(item => `<li><strong>${escapeHtml(item.id)}:</strong> ${escapeHtml(item.description || '')}</li>`).join('')}
      </ul>
    `;
    resultsEl.appendChild(manualReview);
  }

  // Enable export buttons
  document.getElementById('export-html').disabled = false;
  document.getElementById('export-sarif').disabled = false;
  document.getElementById('export-html').setAttribute('aria-disabled', 'false');
  document.getElementById('export-sarif').setAttribute('aria-disabled', 'false');
}

/* ---------------- Utilities ---------------- */

function exportReport(type) {
  if (!activeResults) {
    announceToScreenReader('No results to export', 'assertive');
    return;
  }

  try {
    // Add metadata for compliance reporting
    const report = {
      metadata: {
        tool: 'Accessibility Scanner',
        version: '1.0',
        standards: ['WCAG 2.2 AA', 'Section 508', 'ADA'],
        scanDate: new Date().toISOString(),
        url: window.location?.href || 'Unknown'
      },
      results: activeResults,
      summary: {
        violations: activeResults.violations?.length || 0,
        passes: activeResults.passes?.length || 0,
        incomplete: activeResults.incomplete?.length || 0
      }
    };

    const blob = new Blob(
      [JSON.stringify(report, null, 2)],
      { type: 'application/json' }
    );

    const filename = `accessibility-report-${new Date().toISOString().split('T')[0]}.${type === 'sarif' ? 'sarif.json' : 'json'}`;

    chrome.downloads.download({
      url: URL.createObjectURL(blob),
      filename: filename,
      saveAs: true
    });

    announceToScreenReader(`Exporting ${type} report as ${filename}`);
  } catch (error) {
    console.error('Export error:', error);
    announceToScreenReader('Failed to export report', 'assertive');
  }
}

function getFixSnippet(id, node) {
  const fixes = {
    'color-contrast': `/* Ensure text has sufficient color contrast (4.5:1 for normal text, 3:1 for large text) */
/* Use tools like WebAIM's Contrast Checker */
color: #1f2937; /* Dark gray for good contrast on white */
background-color: #ffffff;`,

    'image-alt': `<!-- Always provide descriptive alt text for images -->
<img src="image.jpg" alt="Description of image content">
<!-- For decorative images: -->
<img src="decorative.jpg" alt="" role="presentation">`,

    'label': `<!-- Explicit labels are best -->
<label for="input-id">Descriptive label text</label>
<input type="text" id="input-id" name="input-name">
<!-- Or using aria-label -->
<input type="text" aria-label="Descriptive label">`,

    'link-name': `<!-- Links must have descriptive text -->
<a href="/page">Descriptive link text</a>
<!-- Not: -->
<a href="/page">Click here</a> <!-- Avoid generic text -->`,

    'button-name': `<!-- Buttons need accessible names -->
<button aria-label="Close dialog">X</button>
<!-- Or with visible text: -->
<button>Submit Form</button>`,

    'aria-allowed-attr': `<!-- Only use valid ARIA attributes for each role -->
<button aria-expanded="false">Menu</button>
<!-- Check ARIA specification for allowed attributes -->`,

    'document-title': `<!-- Every page needs a descriptive title -->
<title>Page Title | Site Name</title>`,

    'html-has-lang': `<!-- Specify page language -->
<html lang="en">
<!-- For multiple languages: -->
<span lang="es">Texto en español</span>`,

    'frame-title': `<!-- Frames and iframes need titles -->
<iframe title="Description of frame content" src="..."></iframe>`,

    'heading-order': `<!-- Maintain proper heading hierarchy -->
<h1>Main page title</h1>
<h2>Section heading</h2>
<h3>Subsection heading</h3>
<!-- Never skip heading levels -->`,

    'landmark-one-main': `<!-- Each page should have one main landmark -->
<main role="main">
  <!-- Main content here -->
</main>`
  };

  const customFix = node?.any?.[0]?.message ||
    node?.all?.[0]?.message ||
    node?.none?.[0]?.message;

  if (customFix) {
    return `/* Fix for ${id} */
${customFix}

/* WCAG Reference: https://www.w3.org/WAI/WCAG22/quickref/ */`;
  }

  return fixes[id] ||
    `/* Fix for ${id} */
/* Refer to WCAG 2.2 guidelines: https://www.w3.org/WAI/WCAG22/quickref/
/* Common solutions may include:
/* 1. Add appropriate ARIA attributes
/* 2. Ensure proper semantic HTML
/* 3. Verify keyboard accessibility
/* 4. Check color contrast requirements

${node?.html ? `Problematic element: ${escapeHtml(node.html.substring(0, 100))}` : ''}`;
}

function increment(level) {
  if (!counts[level]) return;

  const current = parseInt(counts[level].textContent) || 0;
  counts[level].textContent = `${current + 1} ${capitalize(level)}`;
  counts[level].setAttribute('aria-label', `${current + 1} ${level} issues`);
}

function resetUI() {
  resultsEl.innerHTML = '';
  statusEl.textContent = 'Ready to scan';
  statusEl.setAttribute('aria-busy', 'false');

  ['critical', 'serious', 'moderate', 'minor'].forEach(k => {
    if (counts[k]) {
      counts[k].textContent = `0 ${capitalize(k)}`;
      counts[k].setAttribute('aria-label', `0 ${k} issues`);
    }
  });

  document.getElementById('export-html').disabled = true;
  document.getElementById('export-sarif').disabled = true;
  document.getElementById('export-html').setAttribute('aria-disabled', 'true');
  document.getElementById('export-sarif').setAttribute('aria-disabled', 'true');

  announceToScreenReader('UI reset, ready for new scan');
}

function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

function escapeHtml(unsafe) {
  if (unsafe === null || unsafe === undefined) return '';

  return unsafe.toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Add CSS for enhanced accessibility
const style = document.createElement('style');
style.textContent = `
  /* Accessibility enhancements */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  
  /* Focus styles for keyboard navigation */
  :focus-visible {
    outline: 3px solid ${ACCESSIBLE_COLORS.serious};
    outline-offset: 3px;
  }
  
  /* High contrast mode support */
  @media (prefers-contrast: high) {
    .violation {
      border: 2px solid #000000;
    }
    
    .badge {
      border: 1px solid #000000;
    }
  }
  
  /* Reduced motion */
  @media (prefers-reduced-motion: reduce) {
    * {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
    }
  }
  
  /* Dark mode support */
  @media (prefers-color-scheme: dark) {
    :root {
      --text-color: #f9fafb;
      --background-color: #1f2937;
    }
  }
  
  /* Print styles for reports */
  @media print {
    button {
      display: none !important;
    }
    
    .violation {
      break-inside: avoid;
    }
  }
`;
document.head.appendChild(style);