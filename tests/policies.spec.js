import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const FIRST_ID = '0192f3a4-8f1c-7c3a-9b2e-6a1d4f8e2b90';
const SECOND_ID = '0192f3a4-8f1c-7c3a-9b2e-6a1d4f8e2b91';
const POLICY_ID = '0192f3a4-5c6d-7e8f-a0b1-c2d3e4f5a6b7';
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

function policy(overrides = {}) {
  return {
    id: POLICY_ID,
    tenantId: TENANT,
    policyNumber: 'POL-2026-0000007',
    productCode: 'CGL',
    insuredPartyId: FIRST_ID,
    status: 'IN_FORCE',
    effectiveDate: '2026-01-01',
    expirationDate: '2027-01-01',
    premiumAmount: '125000.0000',
    premiumCurrency: 'USD',
    limitAmount: '2000000.0000',
    limitCurrency: 'USD',
    version: 3,
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

async function mockClaims(page) {
  await page.route(CLAIMS_SEARCH, async (route) => {
    await json(route, 200, { query: FIRST_ID, limit: 5, items: [] });
  });
}

test('looks up policies on party selection with tenant and DIRECT book and links each row', async ({ page }) => {
  const first = party();
  const second = party({
    id: SECOND_ID,
    partyNumber: 'PTY-000000002',
    displayName: 'Jordan Blake',
    legalName: 'Jordan A. Blake',
    partyType: 'PERSON',
    status: 'PROSPECT'
  });
  const requests = [];

  await routeParties(page, [first, second]);
  await mockClaims(page);
  await page.route(POLICY_LOOKUP, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push({ url, headers: request.headers() });
    await json(route, 200, {
      items: [policy({ insuredPartyId: url.searchParams.get('insuredPartyId') })],
      page: 0,
      size: 5,
      total: 1
    });
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'PTY-000000001' })).toBeVisible();
  await expect(page.getByTestId('party-policies').getByRole('link', { name: 'POL-2026-0000007' }))
    .toBeVisible();

  expect(requests).toHaveLength(1);
  expect(requests[0].url.pathname).toBe('/api/v1/policies');
  expect(requests[0].url.searchParams.get('insuredPartyId')).toBe(FIRST_ID);
  expect(requests[0].url.searchParams.get('page')).toBe('0');
  expect(requests[0].url.searchParams.get('size')).toBe('5');
  expect(requests[0].headers['x-eia-tenant']).toBe(TENANT);
  expect(requests[0].headers['x-eia-book']).toBe('DIRECT');

  await page.getByRole('button', { name: 'Open record PTY-000000002' }).click();
  await expect(page.getByRole('heading', { name: 'PTY-000000002' })).toBeVisible();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].url.searchParams.get('insuredPartyId')).toBe(SECOND_ID);
  expect(requests[1].url.searchParams.get('page')).toBe('0');
  expect(requests[1].url.searchParams.get('size')).toBe('5');
  expect(requests[1].headers['x-eia-tenant']).toBe(TENANT);
  expect(requests[1].headers['x-eia-book']).toBe('DIRECT');

  const card = page.getByTestId('party-policies');
  await expect(card.getByRole('heading', { name: 'Policies for this party' })).toBeVisible();
  await expect(card.getByRole('row', { name: /POL-2026-0000007/ })).toContainText('CGL');
  await expect(card.getByRole('row', { name: /POL-2026-0000007/ })).toContainText('IN_FORCE');

  const link = card.getByRole('link', { name: 'POL-2026-0000007' });
  await expect(link).toHaveAttribute('href', `/policy?record=${POLICY_ID}`);
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/policy\\?record=${POLICY_ID}$`));
});

test('shows an empty policy state without blocking the party record', async ({ page }) => {
  const existing = party();

  await routeParties(page, [existing]);
  await mockClaims(page);
  await page.route(POLICY_LOOKUP, async (route) => {
    await json(route, 200, { items: [], page: 0, size: 5, total: 0 });
  });

  await page.goto(`/?record=${FIRST_ID}`);

  await expect(page.getByRole('heading', { name: 'PTY-000000001' })).toBeVisible();
  await expect(page.getByTestId('party-name')).toHaveText('Acme Manufacturing');
  const card = page.getByTestId('party-policies');
  await expect(card.getByText('No direct policies reference this party.')).toBeVisible();
  await expect(card.getByRole('table')).toHaveCount(0);
});

test('keeps the party record usable when the policy lookup fails', async ({ page }) => {
  const existing = party();

  await routeParties(page, [existing]);
  await mockClaims(page);
  await page.route(POLICY_LOOKUP, async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        type: 'https://errors.eia-open-insurance.example/policy/expert-unavailable',
        title: 'Policy expert unavailable',
        status: 503,
        code: 'EXPERT_UNAVAILABLE',
        detail: 'The Policy expert is unavailable; retry later.'
      })
    });
  });

  await page.goto(`/?record=${FIRST_ID}`);

  await expect(page.getByRole('heading', { name: 'PTY-000000001' })).toBeVisible();
  await expect(page.getByTestId('party-name')).toHaveText('Acme Manufacturing');
  await expect(
    page.getByTestId('party-policies').getByText('Policy links are unavailable right now.')
  ).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
