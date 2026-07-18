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

if (!process.exitCode) {
  console.log(
    `Web quality checks passed: ${refs.size} static i18n refs, ${dictKeys.size} dictionary keys, route/theme/RTL/accessibility wiring OK.`,
  );
} else {
  console.error(`Web quality checks failed under ${relative(root, appDir)}.`);
}
