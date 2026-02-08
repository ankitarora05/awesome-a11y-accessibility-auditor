/**
 * Human-readable HTML accessibility report for axe-core
 * Designed for auditors, PMs, designers, and developers
 */

import fs from 'fs';
import path from 'path';

function escapeHtml(str = '') {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function impactBadge(impact) {
  const colors = {
    critical: '#b91c1c',
    serious: '#dc2626',
    moderate: '#f59e0b',
    minor: '#2563eb'
  };

  return `<span style="
    background:${colors[impact] || '#6b7280'};
    color:#fff;
    padding:2px 6px;
    border-radius:4px;
    font-size:12px;
    text-transform:uppercase;
  ">${impact}</span>`;
}

function renderViolation(violation) {
  return `
    <section class="violation">
      <h3>${violation.help} ${impactBadge(violation.impact)}</h3>
      <p>${violation.description || ''}</p>
      <p>
        <strong>Rule:</strong> ${violation.id} |
        <strong>WCAG:</strong> ${(violation.tags || []).join(', ')}
      </p>
      <p>
        <a href="${violation.helpUrl}" target="_blank" rel="noopener">
          Fix guidance
        </a>
      </p>

      ${violation.nodes.map(node => `
        <details>
          <summary>Affected element</summary>
          <pre>${escapeHtml(node.html)}</pre>
          <p>${node.failureSummary || ''}</p>
        </details>
      `).join('')}
    </section>
  `;
}

export function writeHtml(results, options = {}) {
  const outputFile =
    options.outputFile || path.resolve(process.cwd(), 'a11y-report.html');

  const html = `
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Accessibility Report</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body {
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      margin: 24px;
      background: #ffffff;
      color: #111827;
    }
    h1 {
      font-size: 24px;
      margin-bottom: 8px;
    }
    .meta {
      color: #6b7280;
      margin-bottom: 24px;
    }
    .violation {
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      padding: 16px;
      margin-bottom: 16px;
    }
    details {
      margin-top: 8px;
    }
    pre {
      background: #f9fafb;
      padding: 12px;
      overflow-x: auto;
      border-radius: 4px;
    }
    a {
      color: #2563eb;
    }
  </style>
</head>
<body>

<h1>Accessibility Report</h1>
<div class="meta">
  <div><strong>URL:</strong> ${results.url || 'Unknown'}</div>
  <div><strong>Scan time:</strong> ${new Date().toISOString()}</div>
  <div><strong>Violations:</strong> ${(results.violations || []).length}</div>
</div>

${(results.violations || []).length === 0
  ? '<p>✅ No accessibility violations detected.</p>'
  : results.violations.map(renderViolation).join('')
}

<hr />
<p style="color:#6b7280;font-size:12px;">
  Automated accessibility testing covers a subset of WCAG criteria and must be
  complemented with manual verification.
</p>

</body>
</html>
`;

  fs.writeFileSync(outputFile, html, 'utf8');
  return outputFile;
}