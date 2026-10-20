import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const API = '**/api/v1/parties**';
const CLAIMS_SEARCH = '**/api/v1/claims/search**';
const POLICY_LOOKUP = '**/api/v1/policies**';

function party(overrides = {}) {
  return {
    id: '0192f3a4-8f1c-7c3a-9b2e-6a1d4f8e2b90',
    tenantId: TENANT,
    partyNumber: 'PTY-000000001',
    partyType: 'ORGANIZATION',
    displayName: 'Acme Manufacturing',
    legalName: 'Acme Manufacturing Holdings, Inc.',
    status: 'ACTIVE',
    sanctionsStatus: 'CLEAR',
    confidentiality: 'INTERNAL',
    version: 2,
    createdAt: '2026-10-19T12:00:00Z',
    updatedAt: '2026-10-20T09:30:00Z',
    ...overrides
  };
}

async function json(route, status, body) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body)
  });
}

/** Keeps party selection independent from the direct-claims domain in every spec. */
async function mockClaimsSearch(page, items = []) {
  await page.route(CLAIMS_SEARCH, async (route) => {
    const url = new URL(route.request().url());
    await json(route, 200, { query: url.searchParams.get('q') || '', limit: 5, items });
  });
}

/** Keeps party selection independent from the policy domain in every spec. */
async function mockPolicyLookup(page, items = []) {
  await page.route(POLICY_LOOKUP, async (route) => {
    await json(route, 200, { items, page: 0, size: 5, total: items.length });
  });
}

test('renders the shared Party operational record layout and read-only sections', async ({ page }) => {
  const existing = party();
  const requests = [];
  let detailRequests = 0;

  await mockClaimsSearch(page);
  await mockPolicyLookup(page);
  await page.route(API, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push(request.headers());

    if (request.method() === 'GET' && url.pathname === '/api/v1/parties') {
      await json(route, 200, [existing]);
      return;
    }
    if (request.method() === 'GET' && url.pathname === `/api/v1/parties/${existing.id}`) {
      detailRequests += 1;
      await json(route, 200, existing);
      return;
    }
    await route.fulfill({ status: 404, body: `unexpected route ${request.method()} ${url.pathname}` });
  });

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Party', exact: true })).toBeVisible();
  await expect(page.getByText('Party · Shared master data')).toBeVisible();
  await expect(page.getByText('Shared party master data for the direct and assumed books')).toBeVisible();
  await expect(page.getByText('SHARED', { exact: true })).toBeVisible();
  await expect(page.locator('.eia-page-head .eia-actions')).toBeVisible();
  await expect(page.locator('.eia-record-layout')).toBeVisible();
  await expect(page.locator('.eia-record-list')).toBeVisible();
  await expect(page.locator('.eia-record-panel')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open record PTY-000000001' })).toBeVisible();
  await expect(page.getByTestId('party-number')).toHaveText('PTY-000000001');
  await expect(page.getByTestId('party-name')).toHaveText('Acme Manufacturing');
  await expect(page.getByTestId('party-type')).toHaveText('ORGANIZATION');
  await expect(page.getByTestId('party-status')).toHaveText('ACTIVE');

  const summaryValues = page.locator('.eia-summary-grid .value');
  await expect(summaryValues).toHaveCount(4);
  await expect(summaryValues.nth(0)).toHaveText('ORGANIZATION');
  await expect(summaryValues.nth(1)).toHaveText('ACTIVE');
  await expect(summaryValues.nth(2)).toHaveText('CLEAR');
  await expect(summaryValues.nth(3)).toHaveText('INTERNAL');

  await expect(page.getByRole('tab')).toHaveCount(4);
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('overview-party-number')).toHaveText('PTY-000000001');
  await expect(page.getByText('Acme Manufacturing Holdings, Inc.')).toBeVisible();

  const requestsBeforeRefresh = detailRequests;
  await page.getByRole('button', { name: 'Refresh record' }).click();
  await expect.poll(() => detailRequests).toBeGreaterThan(requestsBeforeRefresh);

  await page.getByRole('tab', { name: 'Identifiers' }).click();
  await expect(page.locator('#panel-identifiers .eia-table-wrap')).toBeVisible();
  await expect(page.getByText('No identifier endpoint is available in this release.')).toBeVisible();
  await expect(page.locator('#panel-identifiers .eia-badge.warn')).toHaveText('Not available');

  await page.getByRole('tab', { name: 'Names & Addresses' }).click();
  await expect(page.locator('#panel-names .eia-table-wrap')).toHaveCount(2);
  await expect(page.getByRole('cell', { name: 'Acme Manufacturing Holdings, Inc.' })).toBeVisible();
  await expect(page.getByText('No address endpoint is available in this release.')).toBeVisible();

  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(page.getByText('No activity endpoint is available in this release.')).toBeVisible();

  expect(requests.length).toBeGreaterThan(1);
  expect(requests.every((headers) => headers['x-eia-tenant'] === TENANT)).toBeTruthy();
});

test('registers a party from the modal and preserves the tenant header', async ({ page }) => {
  const existing = party();
  let parties = [existing];
  let createHeaders = null;
  let createBody = null;

  await mockClaimsSearch(page);
  await mockPolicyLookup(page);
  await page.route(API, async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === 'GET' && url.pathname === '/api/v1/parties') {
      await json(route, 200, parties);
      return;
    }
    if (request.method() === 'GET' && url.pathname === `/api/v1/parties/${existing.id}`) {
      await json(route, 200, existing);
      return;
    }
    if (request.method() === 'POST' && url.pathname === '/api/v1/parties') {
      createHeaders = request.headers();
      createBody = request.postDataJSON();
      const created = party({
        id: '0192f3a4-8f1c-7c3a-9b2e-6a1d4f8e2b91',
        partyNumber: 'PTY-000000002',
        partyType: createBody.partyType,
        displayName: createBody.displayName,
        legalName: createBody.legalName,
        status: 'PROSPECT',
        sanctionsStatus: 'NOT_SCREENED',
        confidentiality: 'INTERNAL',
        version: 0,
        createdAt: '2026-10-20T10:00:00Z',
        updatedAt: '2026-10-20T10:00:00Z'
      });
      parties = [created, ...parties];
      await json(route, 201, created);
      return;
    }
    await route.fulfill({ status: 404, body: `unexpected route ${request.method()} ${url.pathname}` });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Register party' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.eia-form-grid')).toBeVisible();
  await expect(dialog.locator('.eia-field')).toHaveCount(3);
  await expect(dialog.getByText('new parties start', { exact: false })).toBeVisible();

  await dialog.getByLabel('Party type').selectOption('PERSON');
  await dialog.getByLabel('Display name').fill('Jordan Blake');
  await dialog.getByLabel('Legal name').fill('Jordan A. Blake');
  await dialog.getByRole('button', { name: 'Register party' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status')).toContainText('PTY-000000002');
  await expect(page.getByRole('button', { name: 'Open record PTY-000000002' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'PTY-000000002' })).toBeVisible();
  await expect(page.getByTestId('party-name')).toHaveText('Jordan Blake');
  await expect(page.getByTestId('party-type')).toHaveText('PERSON');
  await expect(page.getByTestId('party-status')).toHaveText('PROSPECT');

  const summaryValues = page.locator('.eia-summary-grid .value');
  await expect(summaryValues.nth(1)).toHaveText('PROSPECT');
  await expect(summaryValues.nth(2)).toHaveText('NOT_SCREENED');
  await expect(summaryValues.nth(3)).toHaveText('INTERNAL');

  expect(createBody).toEqual({
    partyType: 'PERSON',
    displayName: 'Jordan Blake',
    legalName: 'Jordan A. Blake'
  });
  expect(createHeaders['x-eia-tenant']).toBe(TENANT);
  expect(createHeaders['content-type']).toContain('application/json');
});

test('shows problem details and keeps the registration modal open on failure', async ({ page }) => {
  const existing = party();

  await mockClaimsSearch(page);
  await mockPolicyLookup(page);
  await page.route(API, async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === 'GET' && url.pathname === '/api/v1/parties') {
      await json(route, 200, [existing]);
      return;
    }
    if (request.method() === 'GET' && url.pathname === `/api/v1/parties/${existing.id}`) {
      await json(route, 200, existing);
      return;
    }
    if (request.method() === 'POST' && url.pathname === '/api/v1/parties') {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'VALIDATION',
          message: 'Request validation failed',
          details: { displayName: 'must not be blank' }
        })
      });
      return;
    }
    await route.fulfill({ status: 404, body: `unexpected route ${request.method()} ${url.pathname}` });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Register party' }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Display name').fill('   ');
  await dialog.getByLabel('Legal name').fill('Acme Manufacturing');
  await dialog.getByRole('button', { name: 'Register party' }).click();

  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toContainText('Request validation failed');
  await expect(dialog.getByRole('alert')).toContainText('displayName: must not be blank');
});
