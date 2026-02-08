let policy = null;
let lastResults = null;
let currentTabId = null;

/* ---------------- Policy ---------------- */
async function loadPolicy() {
  if (policy) return policy;
  const res = await fetch(chrome.runtime.getURL('policy.json'));
  policy = await res.json();
  return policy;
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

document.getElementById('scan').addEventListener('click', runScan);
document.getElementById('export-html').addEventListener('click', () => exportReport('html'));
document.getElementById('export-sarif').addEventListener('click', () => exportReport('sarif'));

/* ---------------- Page helpers ---------------- */
function highlightNode(selector) {
  const el = document.querySelector(selector);
  if (!el) return;

  let overlay = document.getElementById('__a11y_overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = '__a11y_overlay';
    overlay.style.position = 'fixed';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '2147483647';
    overlay.style.border = '2px solid #ef4444';
    overlay.style.background = 'rgba(239,68,68,0.15)';
    document.body.appendChild(overlay);
  }

  const r = el.getBoundingClientRect();
  overlay.style.top = `${r.top}px`;
  overlay.style.left = `${r.left}px`;
  overlay.style.width = `${r.width}px`;
  overlay.style.height = `${r.height}px`;
}

function clearHighlight() {
  document.getElementById('__a11y_overlay')?.remove();
}

function inspectNode(selector) {
  const el = document.querySelector(selector);
  if (el) inspect(el);
}

/* ---------------- Scan ---------------- */
async function runScan() {
  try {
    resetUI();
    statusEl.textContent = 'Scanning…';

    const policy = await loadPolicy();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTabId = tab.id;

    const impacts = ['critical', 'serious'];
    if (document.getElementById('includeModerate').checked) impacts.push('moderate');
    if (document.getElementById('includeMinor').checked) impacts.push('minor');

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['vendor/axe.min.js', 'content/axe-runner.js']
    });

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: config => window.runA11yScan(config),
      args: [{ tags: policy.automation.tags, impacts }]
    });

    lastResults = result;
    renderResults(result);
  } catch (e) {
    statusEl.textContent = 'Scan failed';
    resultsEl.textContent = e.message;
  }
}

/* ---------------- Render ---------------- */
function renderResults(results) {
  const violations = results.violations || [];
  statusEl.textContent =
    violations.length ? `${violations.length} issues found` : 'No violations 🎉';

  violations.forEach(v => {
    increment(v.impact);

    const card = document.createElement('div');
    card.className = `violation ${v.impact}`;

    card.innerHTML = `
      <div class="violation-header">
        <div class="violation-title">${v.help}</div>
        <span class="badge">${v.impact}</span>
      </div>
      <div class="help">${v.id} · ${v.tags?.join(', ')}</div>
      <details>
        <summary>Affected elements (${v.nodes.length})</summary>
        <div class="nodes"></div>
      </details>
    `;

    const nodesEl = card.querySelector('.nodes');

    v.nodes.forEach(node => {
      node.target.forEach(selector => {
        const el = document.createElement('div');
        el.className = 'node';

        el.innerHTML = `
          <pre>${escapeHtml(node.html)}</pre>
          <div class="reason">${node.failureSummary}</div>
          <div class="actions">
            <button class="highlight">Highlight</button>
            <button class="inspect">Inspect</button>
            <button class="copy">Copy fix</button>
          </div>
        `;

        el.querySelector('.highlight').onmouseenter = () =>
          chrome.scripting.executeScript({
            target: { tabId: currentTabId },
            func: highlightNode,
            args: [selector]
          });

        el.querySelector('.highlight').onmouseleave = () =>
          chrome.scripting.executeScript({
            target: { tabId: currentTabId },
            func: clearHighlight
          });

        el.querySelector('.inspect').onclick = () =>
          chrome.scripting.executeScript({
            target: { tabId: currentTabId },
            func: inspectNode,
            args: [selector]
          });

        el.querySelector('.copy').onclick = () =>
          navigator.clipboard.writeText(getFixSnippet(v.id));

        nodesEl.appendChild(el);
      });
    });

    resultsEl.appendChild(card);
  });

  document.getElementById('export-html').disabled = false;
  document.getElementById('export-sarif').disabled = false;
}

/* ---------------- Utilities ---------------- */
function getFixSnippet(id) {
  switch (id) {
    case 'button-name':
      return `<button aria-label="Describe action"></button>`;
    case 'label':
      return `<label for="field">Label</label><input id="field" />`;
    case 'color-contrast':
      return `/* Ensure contrast ≥ 4.5:1 */`;
    default:
      return `/* Refer to WCAG guidance */`;
  }
}

function increment(level) {
  const el = counts[level];
  el.textContent = `${parseInt(el.textContent) + 1} ${capitalize(level)}`;
}

function resetUI() {
  resultsEl.innerHTML = '';
  statusEl.textContent = 'Idle';
  ['critical','serious','moderate','minor'].forEach(k =>
    counts[k].textContent = `0 ${capitalize(k)}`
  );
}

function capitalize(s) {
  return s[0].toUpperCase() + s.slice(1);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, m =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])
  );
}

function exportReport(type) {
  const blob = new Blob([JSON.stringify(lastResults, null, 2)], {
    type: 'application/json'
  });

  chrome.downloads.download({
    url: URL.createObjectURL(blob),
    filename: `a11y-report.${type === 'sarif' ? 'sarif' : 'json'}`,
    saveAs: true
  });
}