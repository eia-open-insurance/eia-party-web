import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const FIRST_ID = '0192f3a4-8f1c-7c3a-9b2e-6a1d4f8e2b90';
const SECOND_ID = '0192f3a4-8f1c-7c3a-9b2e-6a1d4f8e2b91';
const DOC_ONE_ID = '99999999-9999-7999-8999-999999999991';
const DOC_TWO_ID = '99999999-9999-7999-8999-999999999992';
const PARTY_SEARCH = '**/api/v1/parties**';
const CLAIMS_SEARCH = '**/api/v1/claims/search**';
const POLICY_LOOKUP = '**/api/v1/policies**';
const DOCUMENTS = '**/api/v1/documents**';

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

function documentRow(overrides = {}) {
  return {
    id: DOC_ONE_ID,
    tenantId: TENANT,
    documentNumber: 'DOC-2026-0000001',
    title: 'Certificate of incorporation',
    documentType: 'KYC',
    classification: 'CONFIDENTIAL',
    status: 'ACTIVE',
    retentionUntil: '2033-12-31',
    version: 1,
    createdAt: '2026-10-19T12:00:00Z',
    updatedAt: '2026-10-19T12:00:00Z',
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

async function mockPolicies(page) {
  await page.route(POLICY_LOOKUP, async (route) => {
    await json(route, 200, { items: [], page: 0, size: 5, total: 0 });
  });
}

/** Keeps the event-derived activity lookup independent in every spec. */
test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/events/aggregate/**', async (route) => {
    await json(route, 200, { aggregateId: '', limit: 50, items: [] });
  });
});

test('loads linked documents on party selection with tenant query/header and working links', async ({ page }) => {
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
  await mockPolicies(page);
  await page.route(DOCUMENTS, async (route) => {
    const request = route.request();
    requests.push({
      method: request.method(),
      url: new URL(request.url()),
      headers: request.headers()
    });
    await json(route, 200, [
      documentRow(),
      documentRow({
        id: DOC_TWO_ID,
        documentNumber: 'DOC-2026-0000002',
        title: 'Sanctions screening result',
        documentType: 'SANCTIONS_RESULT',
        status: 'RECEIVED'
      })
    ]);
  });

  await page.goto(`/?record=${FIRST_ID}`);
  await expect(page.getByRole('heading', { name: 'PTY-000000001' })).toBeVisible();

  const card = page.getByTestId('party-documents');
  await expect(card).toBeVisible();
  await expect(card.getByRole('heading', { name: 'Documents' })).toBeVisible();
  await expect(page.getByTestId('party-documents-count')).toHaveText('2 documents');
  await expect(card.getByTestId('documents-evidence-note')).toContainText('evidence');

  const firstRow = card.getByRole('row', { name: /DOC-2026-0000001/ });
  await expect(firstRow).toContainText('Certificate of incorporation');
  await expect(firstRow).toContainText('KYC');
  await expect(firstRow).toContainText('ACTIVE');
  await expect(firstRow.getByRole('link', { name: 'DOC-2026-0000001' }))
    .toHaveAttribute('href', `/document?record=${DOC_ONE_ID}`);

  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].method).toBe('GET');
  expect(requests[0].url.pathname).toBe('/api/v1/documents');
  expect(requests[0].url.searchParams.get('linkedType')).toBe('PARTY');
  expect(requests[0].url.searchParams.get('linkedId')).toBe(FIRST_ID);
  expect(requests[0].headers['x-eia-tenant']).toBe(TENANT);

  await page.getByRole('button', { name: 'Open record PTY-000000002' }).click();
  await expect(page.getByRole('heading', { name: 'PTY-000000002' })).toBeVisible();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].url.searchParams.get('linkedType')).toBe('PARTY');
  expect(requests[1].url.searchParams.get('linkedId')).toBe(SECOND_ID);
  expect(requests[1].headers['x-eia-tenant']).toBe(TENANT);

  await card.getByRole('link', { name: 'DOC-2026-0000001' }).click();
  await expect(page).toHaveURL(new RegExp(`/document\\?record=${DOC_ONE_ID}$`));
});

test('shows the linked-documents empty state without disturbing the party record', async ({ page }) => {
  const existing = party();

  await routeParties(page, [existing]);
  await mockClaims(page);
  await mockPolicies(page);
  await page.route(DOCUMENTS, async (route) => {
    await json(route, 200, { items: [], page: 0, size: 20, total: 0 });
  });

  await page.goto(`/?record=${FIRST_ID}`);

  await expect(page.getByRole('heading', { name: 'PTY-000000001' })).toBeVisible();
  await expect(page.getByTestId('party-name')).toHaveText('Acme Manufacturing');
  await expect(page.getByTestId('party-status')).toHaveText('ACTIVE');
  await expect(page.getByTestId('party-policies')).toBeVisible();
  await expect(page.getByTestId('related-records')).toBeVisible();

  const card = page.getByTestId('party-documents');
  await expect(page.getByTestId('party-documents-count')).toHaveText('0 documents');
  await expect(card.getByText('No documents are linked to this party.')).toBeVisible();
  await expect(card.getByRole('table')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('keeps the party record usable when the linked-document lookup fails', async ({ page }) => {
  const existing = party();

  await routeParties(page, [existing]);
  await mockClaims(page);
  await mockPolicies(page);
  await page.route(DOCUMENTS, async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        title: 'Document expert unavailable',
        status: 503,
        code: 'EXPERT_UNAVAILABLE',
        detail: 'The Document expert is unavailable; retry later.'
      })
    });
  });

  await page.goto(`/?record=${FIRST_ID}`);

  await expect(page.getByRole('heading', { name: 'PTY-000000001' })).toBeVisible();
  await expect(page.getByTestId('party-name')).toHaveText('Acme Manufacturing');
  await expect(page.getByTestId('party-status')).toHaveText('ACTIVE');
  const card = page.getByTestId('party-documents');
  await expect(card).toContainText('Document links are temporarily unavailable.');
  await expect(page.getByTestId('party-documents-count')).toHaveText('0 documents');
  await expect(page.getByTestId('party-policies')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('renders the party record before linked documents resolve', async ({ page }) => {
  const existing = party();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  await routeParties(page, [existing]);
  await mockClaims(page);
  await mockPolicies(page);
  await page.route(DOCUMENTS, async (route) => {
    await gate;
    await json(route, 200, [documentRow()]);
  });

  try {
    await page.goto(`/?record=${FIRST_ID}`);
    await expect(page.getByRole('heading', { name: 'PTY-000000001' })).toBeVisible();
    await expect(page.getByTestId('party-name')).toHaveText('Acme Manufacturing');
    await expect(page.getByTestId('party-status')).toHaveText('ACTIVE');
    await expect(page.getByTestId('party-policies')).toBeVisible();
    await expect(page.getByTestId('party-documents')).toContainText('Loading documents…');
    await expect(page.getByTestId('party-documents-count')).toHaveText('…');
  } finally {
    release();
  }

  await expect(page.getByTestId('party-documents-count')).toHaveText('1 document');
  await expect(page.getByTestId('party-documents').getByRole('link', { name: 'DOC-2026-0000001' }))
    .toBeVisible();
});
