import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const PARTY_ID = '0192f3a4-8f1c-7c3a-9b2e-6a1d4f8e2b90';
const SECOND_ADDRESS_ID = '77777777-7777-7777-8777-777777777772';
const NEW_ADDRESS_ID = '77777777-7777-7777-8777-777777777773';
const PARTY_SEARCH = '**/api/v1/parties**';
const ADDRESSES = '**/api/v1/parties/*/addresses';
const CLAIMS_SEARCH = '**/api/v1/claims/search**';
const POLICY_LOOKUP = '**/api/v1/policies**';
const DOCUMENTS = '**/api/v1/documents**';
const EVENTS = '**/api/v1/events/aggregate/**';

function party(overrides = {}) {
  return {
    id: PARTY_ID,
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

function address(overrides = {}) {
  return {
    id: '77777777-7777-7777-8777-777777777771',
    tenantId: TENANT,
    partyId: PARTY_ID,
    addressType: 'LEGAL',
    line1: '100 Market Street',
    line2: 'Suite 400',
    city: 'Columbus',
    stateRegion: 'OH',
    postalCode: '43215',
    country: 'US',
    createdAt: '2026-10-20T09:30:00Z',
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

async function mockParty(page, row = party()) {
  await page.route(PARTY_SEARCH, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.pathname === '/api/v1/parties') {
      await json(route, 200, [row]);
      return;
    }
    if (request.method() === 'GET' && url.pathname === `/api/v1/parties/${row.id}`) {
      await json(route, 200, row);
      return;
    }
    await route.fulfill({ status: 404, body: `unexpected route ${request.method()} ${url.pathname}` });
  });
}

/** Keeps party selection independent from the other remotes in every spec. */
async function mockSupportingLookups(page) {
  await page.route(CLAIMS_SEARCH, async (route) => {
    await json(route, 200, { query: PARTY_ID, limit: 5, items: [] });
  });
  await page.route(POLICY_LOOKUP, async (route) => {
    await json(route, 200, { items: [], page: 0, size: 5, total: 0 });
  });
  await page.route(DOCUMENTS, async (route) => {
    await json(route, 200, []);
  });
  await page.route(EVENTS, async (route) => {
    await json(route, 200, { aggregateId: PARTY_ID, limit: 50, items: [] });
  });
}

async function openAddresses(page) {
  await page.goto(`/?record=${PARTY_ID}`);
  await expect(page.getByRole('heading', { name: 'PTY-000000001' })).toBeVisible();
  await page.getByRole('tab', { name: 'Names & Addresses' }).click();
  await expect(page.getByTestId('party-addresses')).toBeVisible();
}

test('lists addresses with type, lines, city, state, postal code, and country', async ({ page }) => {
  const rows = [
    address(),
    address({
      id: SECOND_ADDRESS_ID,
      addressType: 'MAILING',
      line1: 'PO Box 42',
      line2: null,
      city: 'Dublin',
      state: 'OH',
      postalCode: '43017',
      country: 'USA'
    })
  ];
  let request = null;

  await mockParty(page);
  await mockSupportingLookups(page);
  await page.route(ADDRESSES, async (route) => {
    request = {
      method: route.request().method(),
      url: new URL(route.request().url()),
      headers: route.request().headers()
    };
    await json(route, 200, { items: rows });
  });

  await openAddresses(page);

  await expect(page.getByTestId('addresses-count')).toHaveText('2 addresses');
  const rendered = page.getByTestId('address-row');
  await expect(rendered).toHaveCount(2);

  const first = rendered.nth(0);
  await expect(first.getByTestId('address-type')).toHaveText('LEGAL');
  await expect(first.getByTestId('address-lines')).toContainText('100 Market Street');
  await expect(first.getByTestId('address-lines')).toContainText('Suite 400');
  await expect(first.getByTestId('address-city')).toHaveText('Columbus');
  await expect(first.getByTestId('address-state')).toHaveText('OH');
  await expect(first.getByTestId('address-postal')).toHaveText('43215');
  await expect(first.getByTestId('address-country')).toHaveText('US');

  const second = rendered.nth(1);
  await expect(second.getByTestId('address-type')).toHaveText('MAILING');
  await expect(second.getByTestId('address-lines')).toContainText('PO Box 42');
  await expect(second.getByTestId('address-city')).toHaveText('Dublin');
  await expect(second.getByTestId('address-postal')).toHaveText('43017');

  await expect(page.getByTestId('addresses-context')).toContainText('party master data');
  await expect(page.getByTestId('addresses-context')).toContainText('Policies, claims, and payments');
  await expect(page.getByText('No address endpoint is available in this release.')).toHaveCount(0);
  await expect(page.getByText('Not available')).toHaveCount(0);

  expect(request.method).toBe('GET');
  expect(request.url.pathname).toBe(`/api/v1/parties/${PARTY_ID}/addresses`);
  expect(request.headers['x-eia-tenant']).toBe(TENANT);
});

test('adds an address with a normalized payload and the tenant header', async ({ page }) => {
  let items = [];
  let create = null;
  let posts = 0;

  await mockParty(page);
  await mockSupportingLookups(page);
  await page.route(ADDRESSES, async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      await json(route, 200, items);
      return;
    }
    if (request.method() === 'POST') {
      posts += 1;
      create = { body: request.postDataJSON(), headers: request.headers() };
      const created = address({
        ...create.body,
        id: NEW_ADDRESS_ID,
        createdAt: '2026-10-21T10:00:00Z'
      });
      items = [...items, created];
      await json(route, 201, created);
      return;
    }
    await route.fulfill({ status: 405, body: 'unexpected method' });
  });

  await openAddresses(page);
  await expect(page.getByTestId('addresses-count')).toHaveText('0 addresses');

  const form = page.getByTestId('address-form');
  await form.getByLabel('Address type').selectOption('PHYSICAL');
  await form.getByLabel('Address line 1').fill('  100 Market Street  ');
  await form.getByLabel('Address line 2').fill('  Floor 3  ');
  await form.getByLabel('City').fill('  Columbus  ');
  await form.getByLabel('State / region').fill('OH');
  await form.getByLabel('Postal code').fill('43215');
  await form.getByLabel('Country').fill('us');
  await form.getByRole('button', { name: 'Add address' }).click();

  await expect(page.getByTestId('addresses-count')).toHaveText('1 address');
  await expect(page.getByTestId('address-notice')).toHaveText('Address added.');
  await expect(page.getByTestId('address-row')).toHaveCount(1);
  const row = page.getByTestId('address-row').first();
  await expect(row.getByTestId('address-type')).toHaveText('PHYSICAL');
  await expect(row.getByTestId('address-lines')).toContainText('100 Market Street');
  await expect(row.getByTestId('address-lines')).toContainText('Floor 3');
  await expect(row.getByTestId('address-city')).toHaveText('Columbus');
  await expect(row.getByTestId('address-state')).toHaveText('OH');
  await expect(row.getByTestId('address-postal')).toHaveText('43215');
  await expect(row.getByTestId('address-country')).toHaveText('US');

  expect(posts).toBe(1);
  expect(create.body).toEqual({
    addressType: 'PHYSICAL',
    line1: '100 Market Street',
    line2: 'Floor 3',
    city: 'Columbus',
    stateRegion: 'OH',
    postalCode: '43215',
    country: 'US'
  });
  expect(create.headers['x-eia-tenant']).toBe(TENANT);
  expect(create.headers['content-type']).toContain('application/json');

  await expect(form.getByLabel('Address line 1')).toHaveValue('');
  await expect(form.getByLabel('Address type')).toHaveValue('');
});

test('validates the add form without posting an invalid address', async ({ page }) => {
  let posts = 0;

  await mockParty(page);
  await mockSupportingLookups(page);
  await page.route(ADDRESSES, async (route) => {
    if (route.request().method() === 'GET') {
      await json(route, 200, []);
      return;
    }
    posts += 1;
    await route.fulfill({ status: 500, body: 'must not be called' });
  });

  await openAddresses(page);
  const form = page.getByTestId('address-form');
  await form.getByRole('button', { name: 'Add address' }).click();

  await expect(page.getByTestId('address-form-error')).toContainText(
    'Fix the highlighted fields before adding this address.'
  );
  await expect(form.getByText('Select an address type.')).toBeVisible();
  await expect(form.getByText('Enter the first address line.')).toBeVisible();
  await expect(form.getByText('Enter the city.')).toBeVisible();
  await expect(form.getByText('Enter the country code.')).toBeVisible();

  await form.getByLabel('Country').fill('U');
  await form.getByRole('button', { name: 'Add address' }).click();
  await expect(form.getByText('Enter a 2-letter ISO country code (for example US).')).toBeVisible();

  expect(posts).toBe(0);
  await expect(page.getByTestId('address-row')).toHaveCount(0);
});

test('contains a duplicate 409 inside the form and keeps the record usable', async ({ page }) => {
  let posts = 0;

  await mockParty(page);
  await mockSupportingLookups(page);
  await page.route(ADDRESSES, async (route) => {
    if (route.request().method() === 'GET') {
      await json(route, 200, []);
      return;
    }
    posts += 1;
    await route.fulfill({
      status: 409,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        type: 'https://errors.eia-open-insurance.example/party/duplicate-address',
        title: 'Duplicate party address',
        status: 409,
        code: 'DUPLICATE_ADDRESS',
        detail: 'An address with the same type and lines already exists for the party.'
      })
    });
  });

  await openAddresses(page);
  const form = page.getByTestId('address-form');
  await form.getByLabel('Address type').selectOption('LEGAL');
  await form.getByLabel('Address line 1').fill('100 Market Street');
  await form.getByLabel('City').fill('Columbus');
  await form.getByLabel('Country').fill('US');
  await form.getByRole('button', { name: 'Add address' }).click();

  const formError = page.getByTestId('address-form-error');
  await expect(formError).toContainText('Duplicate address');
  await expect(formError).toContainText('An address with the same type and lines already exists');
  await expect(formError).toContainText('Review the existing addresses before retrying.');

  expect(posts).toBe(1);
  await expect(page.getByTestId('addresses-count')).toHaveText('0 addresses');
  await expect(page.getByTestId('address-row')).toHaveCount(0);
  await expect(page.getByTestId('app-error')).toHaveCount(0);
  await expect(page.getByTestId('party-status')).toHaveText('ACTIVE');
  await expect(form.getByLabel('Address line 1')).toHaveValue('100 Market Street');

  await page.getByRole('tab', { name: 'Overview' }).click();
  await expect(page.getByTestId('overview-party-number')).toHaveText('PTY-000000001');
});

test('renders the empty state and keeps the names table intact', async ({ page }) => {
  await mockParty(page);
  await mockSupportingLookups(page);
  await page.route(ADDRESSES, async (route) => {
    await json(route, 200, []);
  });

  await openAddresses(page);

  await expect(page.getByTestId('addresses-count')).toHaveText('0 addresses');
  await expect(page.getByTestId('addresses-empty')).toHaveText(
    'No addresses are recorded for this party yet.'
  );
  await expect(page.getByTestId('party-addresses').getByRole('table')).toHaveCount(0);
  await expect(page.getByText('No address endpoint is available in this release.')).toHaveCount(0);
  await expect(page.getByTestId('party-addresses').getByText('Not available')).toHaveCount(0);
  await expect(page.locator('#panel-names .eia-table-wrap')).toHaveCount(1);
  await expect(page.getByRole('cell', { name: 'Acme Manufacturing Holdings, Inc.' })).toBeVisible();
  await expect(page.getByTestId('address-form')).toBeVisible();
});

test('contains a list failure and still allows an address to be added', async ({ page }) => {
  let posts = 0;

  await mockParty(page);
  await mockSupportingLookups(page);
  await page.route(ADDRESSES, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 503,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          title: 'Party expert unavailable',
          status: 503,
          code: 'EXPERT_UNAVAILABLE',
          detail: 'The Party expert is unavailable; retry later.'
        })
      });
      return;
    }
    posts += 1;
    await json(route, 201, address({
      addressType: 'LEGAL',
      line1: '100 Market Street',
      city: 'Columbus',
      country: 'USA'
    }));
  });

  await openAddresses(page);

  await expect(page.getByTestId('addresses-error')).toHaveText(
    'Addresses are temporarily unavailable.'
  );
  await expect(page.getByTestId('addresses-count')).toHaveText('0 addresses');
  await expect(page.getByTestId('app-error')).toHaveCount(0);
  await expect(page.getByTestId('party-status')).toHaveText('ACTIVE');

  const form = page.getByTestId('address-form');
  await form.getByLabel('Address type').selectOption('LEGAL');
  await form.getByLabel('Address line 1').fill('100 Market Street');
  await form.getByLabel('City').fill('Columbus');
  await form.getByLabel('Country').fill('US');
  await form.getByRole('button', { name: 'Add address' }).click();

  expect(posts).toBe(1);
  await expect(page.getByTestId('address-row')).toHaveCount(1);
  await expect(page.getByTestId('addresses-count')).toHaveText('1 address');
  await expect(page.getByTestId('address-notice')).toHaveText('Address added.');
  await expect(page.getByTestId('app-error')).toHaveCount(0);
});
