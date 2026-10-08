import { loadEnvironment, applyEnvironment } from './runtime-env.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { atomicJson } from './demo-profile.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function loadRootEnv() { return loadEnvironment(root); }

function requireFrom(moduleDir) {
  return createRequire(join(moduleDir, 'dgop-ui-smoke.js'));
}

function loadPlaywright() {
  const candidates = [
    createRequire(import.meta.url),
    createRequire(join(root, 'apps', 'web', 'package.json')),
  ];
  const moduleDirs = [
    process.env.DGOP_PLAYWRIGHT_NODE_MODULES,
    ...(process.env.NODE_PATH ? process.env.NODE_PATH.split(delimiter) : []),
    join(homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules', '.pnpm', 'node_modules'),
    join(homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules'),
  ].filter(Boolean);
  for (const dir of moduleDirs) {
    if (existsSync(dir)) candidates.push(requireFrom(dir));
  }
  for (const req of candidates) {
    for (const packageName of ['playwright', 'playwright-core']) {
      try {
        return req(packageName);
      } catch {
        // Try the next package or known module root.
      }
    }
  }
  throw new Error(
    'Playwright is required for UI smoke testing. Install it in apps/web or set DGOP_PLAYWRIGHT_NODE_MODULES to a node_modules directory that contains playwright.',
  );
}

function fail(message, detail) {
  const error=new Error(message);if(detail)console.error(detail);throw error;
}

const env = loadRootEnv();
const baseUrl = env.DGOP_UI_BASE_URL ?? 'http://localhost:4206';
const email = env.DGOP_SMOKE_EMAIL ?? 'admin@dgop.local';
const password = env.DGOP_SMOKE_PASSWORD ?? env.SEED_ADMIN_PASSWORD;
if (!password) fail('DGOP UI smoke requires DGOP_SMOKE_PASSWORD or SEED_ADMIN_PASSWORD.');

const routes = (env.DGOP_SMOKE_ROUTES ?? [
  '/dashboard',
  '/governance/workflow',
  '/governance/workflow/designer',
  '/governance/access',
  '/governance/training',
  '/governance/operations',
  '/governance/data-quality',
  '/governance/security',
  '/admin/integrations',
  '/governance-map',
].join(','))
  .split(',')
  .map((route) => route.trim())
  .filter(Boolean);

const { chromium } = loadPlaywright();
const browser = await chromium.launch({
  headless: true,
  ...(env.DGOP_BROWSER_EXE ? { executablePath: env.DGOP_BROWSER_EXE } : {}),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const consoleErrors = [];
const consoleWarnings = [];
const failedResponses = [];
let nextNavigationAt=0;
const paceNavigation=async()=>{const pause=Math.max(0,nextNavigationAt-Date.now());if(pause)await page.waitForTimeout(Math.min(pause,65000));};
const accessibilityWarningPattern = /aria-hidden|focus must not be hidden|blocked aria-hidden|inert/iu;

page.on('console', (message) => {
  const text = message.text();
  if (message.type() === 'error') consoleErrors.push(text);
  if (message.type() === 'warning' && accessibilityWarningPattern.test(text)) consoleWarnings.push(text);
  if (env.DGOP_SMOKE_MATRIX === '1' && message.type() === 'warning' && /^\[PrimeUI\]/u.test(text)) consoleWarnings.push(text);
});
page.on('pageerror',error=>consoleErrors.push(error.message));
page.on('response', async (response) => {
  if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
  const headers=await response.allHeaders();
  const remaining=Number(headers['ratelimit-remaining']),reset=Number(headers['ratelimit-reset']);
  // Leave capacity for each screen's bounded context requests. Test pacing is
  // outside measured navigation latency and never changes the server's limits.
  if(headers['ratelimit-remaining']!==undefined&&remaining<50&&Number.isFinite(reset))nextNavigationAt=Math.max(nextNavigationAt,Date.now()+Math.min(60,reset)*1000+1000);
});

try {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await Promise.all([
    page.waitForURL(/\/dashboard(?:\?|$)/u, { timeout: 20_000 }),
    page.locator('button[type="submit"]').click(),
  ]);
  const authSessionCheck = await page.evaluate(async () => {
    const response = await fetch('/api/auth/me', { credentials: 'include' });
    let email = null;
    try {
      const body = await response.json();
      email = typeof body?.email === 'string' ? body.email : null;
    } catch {
      // Non-JSON responses are handled by the status/email assertion below.
    }
    return { status: response.status, email };
  });
  if (authSessionCheck.status !== 200 || authSessionCheck.email?.toLowerCase() !== email.toLowerCase()) {
    fail('DGOP UI smoke failed authentication session check.', JSON.stringify({ authSessionCheck, email }, null, 2));
  }

  const checks = [];

  async function checkRoute(route, label = route) {
    await paceNavigation();
    const began = performance.now();
    await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle' });
    const title = (await page.locator('h1').first().textContent({ timeout: 10_000 })).trim();
    const navigationMs = performance.now() - began;
    const routeLoaded = new URL(page.url()).pathname === route;
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    const bodyText = await page.locator('body').innerText();
    const licenseValid=env.DGOP_SMOKE_MATRIX!=='1'||await page.locator('#p-license-host').count()===0;
    const rawKey = await page
      .locator('body')
      .evaluate((body) => /\b(?:common|nav|workflow|operations|dq|security|ds|dashboard|aiGovernance|aiRisk|aiReview|privacy|scoring|evidence)\.[A-Za-z0-9_.-]+\b/u.test(body.innerText ?? ''));
    const invalidText = /\b(?:undefined|null)\b/iu.test(bodyText);
    let systemDatabaseStatus = true;
    if (route === '/dashboard') {
      if(await page.locator('.system-panel').count()){
        const systemText = await page.locator('.system-panel').innerText({ timeout: 10_000 });
        systemDatabaseStatus = /\b(?:up|down)\b/iu.test(systemText);
      }else{
        // A role with no operational dashboard sections has a legitimate empty view.
        // Verify the server agrees rather than treating an unavailable dashboard as empty.
        const empty=await page.evaluate(async()=>{const session=await fetch('/api/auth/me');if(!session.ok)return false;const user=await session.json();if(!user.permissions.includes('*')&&!user.permissions.includes('dashboard.view'))return true;const response=await fetch('/api/dashboard/summary');if(!response.ok)return false;const summary=await response.json();return ['governance','ndi','workflow','myWork','training','dataQuality','reference'].every(key=>summary[key]===null);});
        systemDatabaseStatus=empty&&await page.locator('app-dashboard .empty-state').count()>0;
      }
    }
    let featureControls = true;
    let hierarchyExpansion = true;
    let hierarchyCounts = null;
    if (route.startsWith('/governance/workflow/designer')) {
      const splitButton = page.getByRole('button', { name: 'Split', exact: true });
      const mergeButton = page.getByRole('button', { name: 'Merge', exact: true });
      const shapes = page.locator('.bpmn-canvas .djs-shape');
      await shapes.first().waitFor({ state: 'visible', timeout: 10_000 });
      const shapeCountBefore = await shapes.count();
      await splitButton.waitFor({ state: 'visible', timeout: 5_000 });
      let splitEnabled = false;
      for (let index = 0; index < shapeCountBefore; index += 1) {
        const shape = shapes.nth(index);
        const elementId = (await shape.getAttribute('data-element-id')) ?? '';
        if (!elementId || elementId.endsWith('_label')) continue;
        await shape.dispatchEvent('click');
        splitEnabled = await splitButton.isEnabled();
        if (splitEnabled) break;
      }
      if (splitEnabled) await splitButton.click();
      const shapeCountAfter = await shapes.count();
      featureControls = splitEnabled && (await mergeButton.isVisible()) && shapeCountAfter >= shapeCountBefore + 4;
    }
    if (route === '/admin/capabilities' || route === '/admin/org-units') {
      const nodes = page.locator('app-tree-view .tree__node');
      const toggles = page.locator('app-tree-view .tree__toggle');
      await nodes.first().waitFor({ state: 'visible', timeout: 10_000 });
      const expandedCount = await nodes.count();
      const toggleCount = await toggles.count();
      if (toggleCount > 0) {
        await toggles.first().click();
        await page.waitForTimeout(75);
        const branchCollapsedCount = await nodes.count();
        await toggles.first().click();
        await page.waitForTimeout(75);
        const branchExpandedCount = await nodes.count();
        await page.getByRole('button', { name: 'Collapse all', exact: true }).click();
        await page.waitForTimeout(75);
        const allCollapsedCount = await nodes.count();
        await page.getByRole('button', { name: 'Expand all', exact: true }).click();
        await page.waitForTimeout(75);
        const allExpandedCount = await nodes.count();
        hierarchyCounts = { expandedCount, branchCollapsedCount, branchExpandedCount, allCollapsedCount, allExpandedCount };
        hierarchyExpansion =
          branchCollapsedCount < expandedCount &&
          branchExpandedCount === expandedCount &&
          allCollapsedCount < expandedCount &&
          allExpandedCount === expandedCount;
      } else {
        hierarchyExpansion = false;
      }
    }
    checks.push({ route: label, title, navigationMs, routeLoaded, licenseValid, overflow, rawKey, invalidText, systemDatabaseStatus, featureControls, hierarchyExpansion, hierarchyCounts });
  }

  for (const route of routes) {
    await checkRoute(route);
  }
  for(const route of (env.DGOP_SMOKE_DENIED_ROUTES??'').split(',').filter(Boolean)){
    await paceNavigation();
    await page.goto(`${baseUrl}${route}`,{waitUntil:'networkidle'});
    if(new URL(page.url()).pathname!=='/unauthorized')throw new Error('A role without AI screen access did not reach the denied-access page.');
  }

  if (env.DGOP_SMOKE_PRIVILEGE_BUILDER === '1') {
    await page.goto(`${baseUrl}/admin/roles`, { waitUntil: 'networkidle' });
    const configurableRole = page.locator('.role-row').nth(1);
    await configurableRole.waitFor({ state: 'visible', timeout: 10_000 });
    await configurableRole.click();
    await page.getByRole('button', { name: 'Permissions', exact: true }).click();
    const builder = page.locator('.privilege-builder');
    await builder.waitFor({ state: 'visible', timeout: 10_000 });
    const permissionGroups = await builder.locator('.permission-group__head h3').allTextContents();
    const permissionScreens = await builder.locator('.permission-screen > .permission-resource__head strong').allTextContents();
    const specialtyActions = await builder.locator('.action-toggle').allTextContents();
    const builderText = await builder.innerText();
    const expectedGroups = ['Foundation & platform', 'Governance screens', 'Access Management screens', 'Administration screens'];
    const expectedScreens = ['Command Center', 'Data Security & Access', 'Roles & Privileges', 'People Directory'];
    const builderValid =
      expectedGroups.every((label) => permissionGroups.includes(label)) &&
      expectedScreens.every((label) => permissionScreens.includes(label)) &&
      specialtyActions.some((label) => label.trim() === 'Import') &&
      specialtyActions.some((label) => label.trim() === 'Run') &&
      !/\b(?:res|act|roles\.permissions)\.[A-Za-z0-9_.-]+\b/u.test(builderText);
    checks.push({
      route: '/admin/roles privilege builder',
      title: 'Privilege builder',
      overflow: false,
      rawKey: !builderValid,
      invalidText: false,
      systemDatabaseStatus: true,
      featureControls: builderValid,
      hierarchyExpansion: true,
      hierarchyCounts: { groups: permissionGroups.length, screens: permissionScreens.length },
    });
    if (env.DGOP_SMOKE_PRIVILEGE_SCREENSHOT) {
      await page.screenshot({ path: env.DGOP_SMOKE_PRIVILEGE_SCREENSHOT, fullPage: false });
    }
  }

  if (env.DGOP_SMOKE_SCREENSHOT) {
    const screenshotRoute = env.DGOP_SMOKE_SCREENSHOT_ROUTE ?? routes[0] ?? '/dashboard';
    await page.goto(`${baseUrl}${screenshotRoute}`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: env.DGOP_SMOKE_SCREENSHOT, fullPage: true });
  }

  await page.evaluate(() => {
    localStorage.setItem('dgop.theme', 'dark');
    localStorage.setItem('dgop.lang', 'ar');
  });
  await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle' });
  const htmlState = await page.evaluate(() => ({
    dir: document.documentElement.getAttribute('dir'),
    lang: document.documentElement.getAttribute('lang'),
    theme: document.documentElement.getAttribute('data-theme'),
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
  }));
  checks.push({
    route: '/dashboard ar/dark',
    title: `${htmlState.lang}/${htmlState.dir}/${htmlState.theme}`,
    overflow: htmlState.overflow,
    rawKey: false,
    invalidText: false,
    systemDatabaseStatus: true,
  });

  const mobileRoutes = (env.DGOP_SMOKE_MOBILE_ROUTES ?? routes.join(','))
    .split(',')
    .map((route) => route.trim())
    .filter(Boolean);
  await page.setViewportSize({
    width: Number(env.DGOP_SMOKE_MOBILE_WIDTH ?? 390),
    height: Number(env.DGOP_SMOKE_MOBILE_HEIGHT ?? 844),
  });
  await page.evaluate(() => {
    localStorage.setItem('dgop.theme', 'light');
    localStorage.setItem('dgop.lang', 'en');
  });
  for (const route of mobileRoutes) {
    await checkRoute(route, `mobile ${route}`);
  }

  if (env.DGOP_SMOKE_MATRIX === '1') {
    for (const viewport of [{width:1440,height:950},{width:390,height:844}]) {
      await page.setViewportSize(viewport);
      for (const lang of ['en','ar']) for (const theme of ['light','dark']) {
        await page.evaluate(({lang,theme}) => {localStorage.setItem('dgop.lang',lang);localStorage.setItem('dgop.theme',theme);},{lang,theme});
        for (const route of routes) {
          await checkRoute(route,`${viewport.width}px ${lang}/${theme} ${route}`);
          const state=await page.evaluate(()=>({lang:document.documentElement.lang,dir:document.documentElement.dir,theme:document.documentElement.getAttribute('data-theme')}));
          if(state.lang!==lang||state.dir!==(lang==='ar'?'rtl':'ltr')||state.theme!==theme) throw new Error('Language, direction or theme did not match the requested browser scenario.');
        }
      }
    }
  }

  const durations=checks.map(check=>check.navigationMs).filter(Number.isFinite).sort((a,b)=>a-b);
  const navigationP95Ms=durations[Math.max(0,Math.ceil(durations.length*.95)-1)]??null;
  const functionalBadChecks=checks.filter(check=>check.routeLoaded===false||check.overflow||check.rawKey||check.invalidText||check.systemDatabaseStatus===false||check.featureControls===false||check.hierarchyExpansion===false||!check.title);
  const performancePassed=navigationP95Ms!==null&&navigationP95Ms<=3000;
  const licenseWarnings=consoleWarnings.filter(message=>message.startsWith('[PrimeUI]'));
  const otherWarnings=consoleWarnings.filter(message=>!message.startsWith('[PrimeUI]'));
  if(env.DGOP_SMOKE_REPORT)atomicJson(env.DGOP_SMOKE_REPORT,{demoOnly:true,evaluatedAt:new Date().toISOString(),browserVersion:browser.version(),matrix:env.DGOP_SMOKE_MATRIX==='1',checks:checks.length,navigationP95Ms,functionalPassed:!consoleErrors.length&&!failedResponses.length&&!functionalBadChecks.length&&!otherWarnings.length&&performancePassed,licensedAcceptancePassed:!consoleErrors.length&&!failedResponses.length&&!functionalBadChecks.length&&!consoleWarnings.length&&performancePassed&&checks.every(check=>check.licenseValid!==false),consoleErrors,failedResponses,otherWarnings,licenseWarningCount:licenseWarnings.length,licenseHostCount:checks.filter(check=>check.licenseValid===false).length,functionalBadChecks});
  const badChecks = checks.filter(
    (check) => check.licenseValid === false || check.routeLoaded === false || check.overflow || check.rawKey || check.invalidText || check.systemDatabaseStatus === false || check.featureControls === false || check.hierarchyExpansion === false || !check.title,
  );
  if (consoleErrors.length || consoleWarnings.length || failedResponses.length || badChecks.length) {
    fail(
      'DGOP UI smoke failed.',
      JSON.stringify({ consoleErrors, consoleWarnings, failedResponses, badChecks, checks }, null, 2),
    );
  }
  if(env.DGOP_SMOKE_MATRIX==='1'&&(navigationP95Ms===null||navigationP95Ms>3000))fail('Browser navigation exceeded the agreed local p95 budget.',JSON.stringify({navigationP95Ms,budgetMs:3000}));
  console.log(JSON.stringify({ status: 'ok', baseUrl, matrix:env.DGOP_SMOKE_MATRIX==='1', navigationP95Ms, routes: checks }, null, 2));
} catch(error) {
  console.error(JSON.stringify({url:page.url(),consoleErrors,consoleWarnings,failedResponses,body:(await page.locator('body').innerText().catch(()=>'' )).slice(0,8000)},null,2));
  throw error;
} finally {
  await browser.close();
}
