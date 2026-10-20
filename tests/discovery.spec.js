import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const FIRST_ID = '0192f3a4-8f1c-7c3a-9b2e-6a1d4f8e2b90';
const SECOND_ID = '0192f3a4-8f1c-7c3a-9b2e-6a1d4f8e2b91';
const THIRD_ID = '0192f3a4-8f1c-7c3a-9b2e-6a1d4f8e2b92';
const CLAIM_ID = '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0c9d21';
const PARTY_SEARCH = '**/api/v1/parties**';
const CLAIMS_SEARCH = '**/api/v1/claims/search**';
const POLICY_LOOKUP = '**/api/v1/policies**';

function party(overrides = {}) {
  return {
    id: FIRST_ID,
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

async function routeParties(page, parties) {
  const byId = new Map(parties.map((row) => [row.id, row]));

  await page.route(PARTY_SEARCH, async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === 'GET' && url.pathname === '/api/v1/parties') {
      await json(route, 200, parties);
      return;
    }
    const match = url.pathname.match(/^\/api\/v1\/parties\/([^/]+)$/);
    if (request.method() === 'GET' && match && byId.has(match[1])) {
      await json(route, 200, byId.get(match[1]));
      return;
    }
    await route.fulfill({ status: 404, body: `unexpected route ${request.method()} ${url.pathname}` });
  });
}

async function mockClaimsSearch(page, items = []) {
  await page.route(CLAIMS_SEARCH, async (route) => {
    const url = new URL(route.request().url());
    await json(route, 200, { query: url.searchParams.get('q') || '', limit: 5, items });
  });
}

async function mockPolicyLookup(page, items = []) {
  await page.route(POLICY_LOOKUP, async (route) => {
    await json(route, 200, { items, page: 0, size: 5, total: items.length });
  });
}

/** Keeps the event-derived activity lookup independent in every spec. */
test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/events/aggregate/**', async (route) => {
    await json(route, 200, { aggregateId: '', limit: 50, items: [] });
  });
});

test('selects ?record=, re-applies it on popstate, and opens the register dialog from ?new=1', async ({ page }) => {
  const first = party();
  const second = party({
    id: SECOND_ID,
    partyNumber: 'PTY-000000002',
    displayName: 'Jordan Blake',
    legalName: 'Jordan A. Blake',
    partyType: 'PERSON',
    status: 'PROSPECT',
    sanctionsStatus: 'NOT_SCREENED'
  });

  await routeParties(page, [first, second]);
  await mockClaimsSearch(page);
  await mockPolicyLookup(page);

  await page.goto(`/?record=${SECOND_ID}`);
  await expect(page.getByRole('heading', { name: 'PTY-000000002' })).toBeVisible();
  await expect(page.getByTestId('party-name')).toHaveText('Jordan Blake');
  await expect(page.getByRole('button', { name: 'Open record PTY-000000002' }))
    .toHaveAttribute('aria-pressed', 'true');

  await page.evaluate((id) => {
    window.history.pushState({}, '', `/?record=${id}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, FIRST_ID);

  await expect(page.getByRole('heading', { name: 'PTY-000000001' })).toBeVisible();
  await expect(page.getByTestId('party-name')).toHaveText('Acme Manufacturing');

  await page.goto('/?new=1');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Register party' })).toBeVisible();
});

test('loads a deep-linked party that is not on the loaded queue', async ({ page }) => {
  const deepLinked = party({ id: SECOND_ID, partyNumber: 'PTY-000000002' });
  let detailRequests = 0;

  await page.route(PARTY_SEARCH, async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'GET' && url.pathname === '/api/v1/parties') {
      await json(route, 200, []);
      return;
    }
    if (route.request().method() === 'GET' && url.pathname === `/api/v1/parties/${SECOND_ID}`) {
      detailRequests += 1;
      await json(route, 200, deepLinked);
      return;
    }
    await route.fulfill({ status: 404, body: 'unexpected route' });
  });
  await mockClaimsSearch(page);
  await mockPolicyLookup(page);

  await page.goto(`/party?record=${SECOND_ID}`);
  await expect(page.getByRole('heading', { name: 'PTY-000000002' })).toBeVisible();
  expect(detailRequests).toBe(1);
});

test('filters the party queue by number, name, type, and status with a clear control', async ({ page }) => {
  const first = party();
  const second = party({
    id: SECOND_ID,
    partyNumber: 'PTY-000000002',
    displayName: 'Jordan Blake',
    legalName: 'Jordan A. Blake',
    partyType: 'PERSON',
    status: 'PROSPECT'
  });
  const third = party({
    id: THIRD_ID,
    partyNumber: 'PTY-000000003',
    displayName: 'Harbor Trust',
    legalName: 'Harbor Family Trust',
    partyType: 'TRUST',
    status: 'RESTRICTED'
  });

  await routeParties(page, [first, second, third]);
  await mockClaimsSearch(page);
  await mockPolicyLookup(page);

  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Open record PTY-000000001' })).toBeVisible();
  await expect(page.getByText('3', { exact: true })).toBeVisible();

  const filter = page.getByPlaceholder('Filter parties by number, name, type, or status…');

  await filter.fill('jordan');
  await expect(page.getByRole('button', { name: 'Open record PTY-000000002' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open record PTY-000000001' })).toHaveCount(0);
  await expect(page.getByText('1 of 3')).toBeVisible();

  await filter.fill('000000003');
  await expect(page.getByRole('button', { name: 'Open record PTY-000000003' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open record PTY-000000002' })).toHaveCount(0);

  await filter.fill('PERSON');
  await expect(page.getByRole('button', { name: 'Open record PTY-000000002' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open record PTY-000000003' })).toHaveCount(0);

  await filter.fill('restricted');
  await expect(page.getByRole('button', { name: 'Open record PTY-000000003' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open record PTY-000000001' })).toHaveCount(0);

  await filter.fill('no-such-party');
  await expect(page.getByText('No matching parties')).toBeVisible();
  const clear = page.getByRole('button', { name: 'Clear' });
  await expect(clear).toBeVisible();
  await clear.click();

  await expect(filter).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Open record PTY-000000001' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open record PTY-000000002' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open record PTY-000000003' })).toBeVisible();
});

test('renders shared-party context and direct-book related claim links', async ({ page }) => {
  const existing = party();
  let claimsRequest = null;

  await routeParties(page, [existing]);
  await mockPolicyLookup(page);
  await page.route(CLAIMS_SEARCH, async (route) => {
    claimsRequest = { url: new URL(route.request().url()), headers: route.request().headers() };
    await json(route, 200, {
      query: FIRST_ID,
      limit: 5,
      items: [{
        id: CLAIM_ID,
        type: 'DIRECT_CLAIM',
        label: 'CLM-2026-0000001',
        secondary: 'BODILY_INJURY · REGISTERED',
        status: 'REGISTERED',
        href: `/direct-claims?record=${CLAIM_ID}`
      }]
    });
  });

  await page.goto(`/?record=${FIRST_ID}`);
  await expect(page.getByRole('heading', { name: 'PTY-000000001' })).toBeVisible();

  const context = page.getByTestId('why-this-matters');
  await expect(context).toBeVisible();
  await expect(context).toContainText('Why this matters');
  await expect(context).toContainText(/shared master data across both books/);
  await expect(context).toContainText(/Book associations remain book-scoped/);
  await expect(context).toContainText(/Status and sanctions are process gates/);

  await expect(page.getByRole('link', { name: /CLM-2026-0000001/ }))
    .toHaveAttribute('href', `/direct-claims?record=${CLAIM_ID}`);
  await expect(page.getByRole('link', { name: 'Policy search' })).toHaveAttribute('href', '/policy');

  expect(claimsRequest.url.searchParams.get('q')).toBe(FIRST_ID);
  expect(claimsRequest.url.searchParams.get('limit')).toBe('5');
  expect(claimsRequest.headers['x-eia-book']).toBe('DIRECT');
  expect(claimsRequest.headers['x-eia-tenant']).toBe(TENANT);

  await page.getByRole('link', { name: /CLM-2026-0000001/ }).click();
  await expect(page).toHaveURL(new RegExp(`/direct-claims\\?record=${CLAIM_ID}$`));
});
