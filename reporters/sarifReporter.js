/**
 * SARIF 2.1.0 reporter for axe-core results
 * Compatible with GitHub Advanced Security, Azure DevOps, SonarQube
 */

import fs from 'fs';
import path from 'path';

const TOOL_NAME = 'Awesome Accessibility Auditor';
const TOOL_VERSION = '1.0.0';
const SARIF_VERSION = '2.1.0';

const impactToLevel = {
  critical: 'error',
  serious: 'error',
  moderate: 'warning',
  minor: 'note'
};

function normalizeUri(uri) {
  if (!uri) return 'file:///unknown';
  if (uri.startsWith('http')) return uri;
  return `file://${uri}`;
}

function buildRule(rule) {
  return {
    id: rule.id,
    name: rule.id,
    shortDescription: {
      text: rule.help
    },
    fullDescription: {
      text: rule.description || rule.help
    },
    help: {
      text: rule.help,
      markdown: `[Learn more](${rule.helpUrl})`
    },
    properties: {
      tags: rule.tags || [],
      category: 'Accessibility'
    }
  };
}

function buildResult(violation, node, pageUrl) {
  return {
    ruleId: violation.id,
    level: impactToLevel[violation.impact] || 'warning',
    message: {
      text: violation.help
    },
    locations: [
      {
        physicalLocation: {
          artifactLocation: {
            uri: normalizeUri(pageUrl)
          },
          region: {
            snippet: {
              text: node.html
            }
          }
        }
      }
    ],
    properties: {
      impact: violation.impact,
      wcagTags: violation.tags || [],
      failureSummary: node.failureSummary || '',
      target: node.target || []
    }
  };
}

export function writeSarif(results, options = {}) {
  const outputFile =
    options.outputFile || path.resolve(process.cwd(), 'a11y-report.sarif');

  const rules = {};
  const sarifResults = [];

  (results.violations || []).forEach(violation => {
    rules[violation.id] = buildRule(violation);

    violation.nodes.forEach(node => {
      sarifResults.push(
        buildResult(violation, node, results.url)
      );
    });
  });

  const sarif = {
    version: SARIF_VERSION,
    $schema:
      'https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0.json',
    runs: [
      {
        tool: {
          driver: {
            name: TOOL_NAME,
            version: TOOL_VERSION,
            rules: Object.values(rules)
          }
        },
        results: sarifResults
      }
    ]
  };

  fs.writeFileSync(outputFile, JSON.stringify(sarif, null, 2), 'utf8');
  return outputFile;
}