# Awesome A11y Accessibility Auditor

> **Enterprise-grade accessibility auditing using axe-core — directly in the browser.**

**Awesome A11y Accessibility Auditor** is a Chrome extension and open-source toolkit for running **automated WCAG 2.x accessibility audits**, inspecting affected DOM elements, and exporting results for engineering, QA, and compliance workflows.

It is designed to be **developer-friendly**, **privacy-first**, and **production-ready**.

---

## ✨ Highlights

- 🔍 Automated accessibility audits powered by **axe-core**
- 📊 Severity breakdown (**Critical · Serious · Moderate · Minor**)
- 🧭 DOM inspection & visual highlighting
- 🛠 Fix guidance with copyable snippets
- 📤 Exportable reports (**JSON & SARIF**)
- ⚙️ Policy-driven configuration
- 🔐 Runs 100% locally — no tracking, no servers

---

## 🚀 Why This Project?

Accessibility is a **legal, ethical, and product requirement**, but tooling is often:

- too heavyweight
- locked behind paywalls
- disconnected from developer workflows

This project aims to:

- **lower the barrier** to high-quality accessibility audits
- provide **enterprise-grade signals** without enterprise friction
- integrate naturally with **modern dev + CI workflows**

---

## 🧠 What This Tool Does (and Does Not Do)

### ✅ What It Does
- Identifies **potential accessibility issues** using automated rules
- Helps catch regressions early during development
- Produces machine-readable output for CI and governance tools

### ❌ What It Does NOT Do
- Guarantee WCAG / ADA / Section 508 compliance
- Replace manual testing
- Replace assistive technology or user testing

> Automated tools typically detect **~30–40%** of accessibility issues.  
> This auditor is designed to **augment**, not replace, human review.

---

## 🧩 Features

### 🔍 Automated Audits
- Uses **axe-core**
- WCAG 2.x rule coverage
- Configurable tags and impact levels

### 📊 Results That Make Sense
- Clear severity counts
- Human-readable explanations
- Grouped affected elements per rule

### 🧭 DOM Inspection
- Highlight affected elements on hover
- Open elements directly in Chrome DevTools
- Inspect real rendered markup

### 🛠 Fix Assistance
- Failure summaries per element
- Copy-ready fix snippets for common violations
- Designed to reduce context switching

### 📤 Export & Integration
- **JSON** export for debugging and storage
- **SARIF** export for:
  - GitHub Code Scanning
  - Azure DevOps
  - Security dashboards
  - Governance tooling

---

## 🧪 Screenshots

> _(Add screenshots here)_

Recommended screenshots:
1. Scan summary with severity counts  
2. Violation detail view  
3. DOM highlight & inspection  
4. Export options  

---

## ⚡ Quick Start

### 1️⃣ Clone the Repository

```bash
git clone https://github.com/your-org/awesome-a11y-accessibility-auditor.git
cd awesome-a11y-accessibility-auditor
```

---

### 2️⃣ Load the Extension in Chrome

1. Open Chrome and navigate to:

```
chrome://extensions
```

2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the project directory

---

### 3️⃣ Run an Audit

1. Open any webpage (local, staging, or production)
2. Click the extension icon
3. Click **Run Scan**
4. Review:
   - Severity counts
   - Violations
   - Affected DOM nodes

---

## 🧠 Architecture Overview

```text
popup/
 ├── popup.html        UI layout
 ├── popup.css         Responsive, accessible styles
 └── popup.js          UI logic, state, rendering

content/
 └── axe-runner.js     Page-injected axe execution logic

vendor/
 └── axe.min.js        axe-core runtime

policy.json            Centralized rule configuration
manifest.json          Chrome extension manifest
```

### Design Principles
- Policy-driven configuration
- Stateless, repeatable scans
- Defensive error handling
- No persistent page pollution
- Enterprise-ready exports

---

## ⚙️ Configuration (`policy.json`)

Accessibility rules are controlled via a policy file:

```json
{
  "automation": {
    "tags": ["wcag2a", "wcag2aa"]
  }
}
```

### Why Policy-Driven?
- Consistent audits across teams
- Easier CI enforcement
- Separation of rules from UI logic

---

## 📦 Export Formats

### JSON
- Full axe-core result object
- Useful for debugging and archival

### SARIF
Compatible with:
- GitHub Code Scanning
- Azure DevOps
- Security & compliance platforms

---

## 🔒 Permissions Explained

The extension uses **minimum required permissions**:

| Permission     | Purpose                                 |
|----------------|------------------------------------------|
| `activeTab`    | Audit the current page                   |
| `scripting`    | Inject axe-core safely                   |
| `downloads`    | Export reports                           |

No background tracking.  
No browsing history access.

---

## 🔐 Privacy Policy

This project is **privacy-first** by design.

- ❌ No analytics
- ❌ No tracking
- ❌ No remote network requests
- ❌ No data collection

All audits run **locally in your browser**.

---

## 🧪 Testing Strategy

Recommended validation scenarios:
- Missing labels
- Button name failures
- Color contrast issues
- Keyboard navigation issues
- Navigation route changes
- Re-running scans multiple times
- Pages with strict CSP headers
