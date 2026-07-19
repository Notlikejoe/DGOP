import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const appDir = join(root, 'apps', 'web', 'src', 'app');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    const stat = statSync(file);
    if (stat.isDirectory()) walk(file, out);
    else if (/\.(ts|html)$/u.test(name)) out.push(file);
  }
  return out;
}

function read(path) {
  return readFileSync(path, 'utf8');
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

const files = walk(appDir);
const refs = new Set();
for (const file of files) {
  const text = read(file);
  for (const match of text.matchAll(/\bt\(\s*['"]([^'"]+)['"]\s*\)/gu)) refs.add(match[1]);
  for (const match of text.matchAll(/\btranslate\(\s*['"]([^'"]+)['"]\s*\)/gu)) refs.add(match[1]);
}

const i18nPath = join(appDir, 'core', 'i18n.service.ts');
const i18n = read(i18nPath);
const sourceIndex = read(join(root, 'apps', 'web', 'src', 'index.html'));
if (/https:\/\/fonts\.(?:googleapis|gstatic)\.com/iu.test(sourceIndex)) {
  fail('Web index must not load externally hosted fonts; use bundled assets or the system font stack.');
}
if (/\son[a-z]+\s*=/iu.test(sourceIndex)) {
  fail('Web index must not contain inline event handlers because strict CSP blocks script attributes.');
}
const mojibakeArabicPattern = /[ØÙ][^\s'"}),.;:!?<>]*/u;
const mojibakeFiles = files
  .filter((file) => /\.(ts|html)$/u.test(file))
  .flatMap((file) => {
    const text = read(file);
    const match = text.match(mojibakeArabicPattern);
    if (!match) return [];
    const line = text.slice(0, match.index).split(/\r?\n/u).length;
    return [`${relative(root, file)}:${line} (${match[0]})`];
  });
if (mojibakeFiles.length) {
  fail(
    `Arabic UI copy appears to contain mojibake/corrupted encoding:\n${mojibakeFiles.map((item) => `- ${item}`).join('\n')}`,
  );
}

const dictKeys = new Set();
for (const match of i18n.matchAll(/['"]([A-Za-z0-9_.-]+)['"]\s*:/gu)) dictKeys.add(match[1]);
const missing = [...refs].filter((key) => !dictKeys.has(key)).sort();
if (missing.length) {
  fail(`Missing i18n keys:\n${missing.map((key) => `- ${key}`).join('\n')}`);
}

const routes = read(join(appDir, 'app.routes.ts'));
if (!routes.includes("path: 'governance-map'")) fail('Governance Map route is missing.');
if (!routes.includes("path: 'design-system'") || !routes.includes("redirectTo: 'governance-map'")) {
  fail('Legacy design-system route must redirect to governance-map.');
}

const shellHtml = read(join(appDir, 'layout', 'shell.html'));
const shellTs = read(join(appDir, 'layout', 'shell.ts'));
if (!shellHtml.includes('[attr.inert]') || !shellHtml.includes('[attr.aria-hidden]')) {
  fail('Mobile sidebar must use inert and aria-hidden together when hidden.');
}
if (!shellTs.includes('moveFocusOutOfSidebar')) {
  fail('Mobile sidebar must move focus before becoming inert.');
}

if (!i18n.includes("document.documentElement.setAttribute('dir', dir)")) {
  fail('Language switching must update the document dir attribute.');
}
const themePath = join(appDir, 'core', 'theme.service.ts');
if (!existsSync(themePath) || !read(themePath).includes("document.documentElement.setAttribute('data-theme', theme)")) {
  fail('Theme switching must update the document data-theme attribute.');
}

const apiServiceText = read(join(appDir, 'core', 'api.service.ts'));
const authInterceptorText = read(join(appDir, 'core', 'auth.interceptor.ts'));
const dashboardTs = read(join(appDir, 'pages', 'dashboard', 'dashboard.ts'));
const dashboardHtml = read(join(appDir, 'pages', 'dashboard', 'dashboard.html'));
if (
  !authInterceptorText.includes('withCredentials: true') ||
  !authInterceptorText.includes("'x-request-id': requestId") ||
  !authInterceptorText.includes("'x-correlation-id': requestId") ||
  !authInterceptorText.includes("'x-dgop-csrf': 'same-origin'")
) {
  fail('Auth interceptor must send cookie credentials, request correlation IDs, and the same-origin CSRF marker on API calls.');
}
if (
  !authInterceptorText.includes('isAlreadyOnLogin') ||
  !authInterceptorText.includes("router.navigate(['/login'], { queryParams: { returnUrl: currentUrl } })")
) {
  fail('Auth interceptor must preserve returnUrl on 401 redirects without redirect loops on the login page.');
}
if (!apiServiceText.includes('environment?:') || !apiServiceText.includes('uptimeSeconds?:') || !apiServiceText.includes('name?:')) {
  fail('HealthResponse must model production-redacted health fields as optional.');
}
if (
  !dashboardTs.includes('platformSignalKind') ||
  !dashboardTs.includes("h?.status === 'ok' && h.database?.status === 'up'")
) {
  fail('Dashboard platform signal must treat degraded API or database health as a danger state.');
}
if (!dashboardHtml.includes('databaseStatusLabel()') || !dashboardHtml.includes('environmentLabel()')) {
  fail('Dashboard system readiness must use explicit health labels instead of rendering blank redacted fields.');
}

const genericHttpErrors = files
  .filter((file) => file.endsWith('.ts'))
  .flatMap((file) => {
    const text = read(file);
    const matches = [
      ...text.matchAll(/error:\s*\([^)]*\)\s*=>[\s\S]{0,250}?this\.toast\.error\(/gu),
    ];
    return matches.map((match) => {
      const line = text.slice(0, match.index).split(/\r?\n/u).length;
      return `${relative(root, file)}:${line}`;
    });
  });
if (genericHttpErrors.length) {
  fail(
    `HTTP subscribe errors must use toast.errorFrom(error, fallback) so request IDs and safe API messages are preserved:\n${genericHttpErrors.map((item) => `- ${item}`).join('\n')}`,
  );
}

const unsafeTemplatePatterns = files.flatMap((file) => {
  const text = read(file);
  const findings = [];
  const rel = relative(root, file);
  for (const pattern of [
    { name: 'raw innerHTML binding', regex: /\[(?:innerHTML|innerHtml)\]|innerHTML\s*=/gu },
    { name: 'Angular sanitizer bypass', regex: /bypassSecurityTrust\w+/gu },
    { name: 'javascript: link', regex: /href\s*=\s*['"]javascript:/giu },
  ]) {
    for (const match of text.matchAll(pattern.regex)) {
      const line = text.slice(0, match.index).split(/\r?\n/u).length;
      findings.push(`${rel}:${line} ${pattern.name}`);
    }
  }
  if (/target\s*=\s*['"]_blank['"]/iu.test(text) && !/rel\s*=\s*['"][^'"]*noopener[^'"]*noreferrer[^'"]*['"]/iu.test(text)) {
    const match = text.match(/target\s*=\s*['"]_blank['"]/iu);
    const line = match?.index == null ? 1 : text.slice(0, match.index).split(/\r?\n/u).length;
    findings.push(`${rel}:${line} target="_blank" must include rel="noopener noreferrer"`);
  }
  return findings;
});
if (unsafeTemplatePatterns.length) {
  fail(
    `Frontend templates must avoid unsafe HTML/link patterns:\n${unsafeTemplatePatterns.map((item) => `- ${item}`).join('\n')}`,
  );
}

const uiSmokePath = join(root, 'scripts', 'ui-smoke.mjs');
const uiSmokeText = existsSync(uiSmokePath) ? read(uiSmokePath) : '';
if (
  !uiSmokeText.includes('consoleWarnings') ||
  !uiSmokeText.includes('accessibilityWarningPattern') ||
  !uiSmokeText.includes('authSessionCheck') ||
  !uiSmokeText.includes('/api/auth/me') ||
  !uiSmokeText.includes('DGOP_SMOKE_MOBILE_ROUTES') ||
  !uiSmokeText.includes('setViewportSize')
) {
  fail('UI smoke must cover authenticated session health, mobile viewports, and warning-level accessibility regressions.');
}

if (!process.exitCode) {
  console.log(
    `Web quality checks passed: ${refs.size} static i18n refs, ${dictKeys.size} dictionary keys, route/theme/RTL/accessibility/error wiring OK.`,
  );
} else {
  console.error(`Web quality checks failed under ${relative(root, appDir)}.`);
}
