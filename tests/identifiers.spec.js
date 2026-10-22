import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const PARTY_ID = '0192f3a4-8f1c-7c3a-9b2e-6a1d4f8e2b90';
const OTHER_IDENTIFIER_ID = '88888888-8888-7888-8888-888888888882';
const NEW_IDENTIFIER_ID = '88888888-8888-7888-8888-888888888883';
const PARTY_SEARCH = '**/api/v1/parties**';
const IDENTIFIERS = '**/api/v1/parties/*/identifiers';
const IDENTIFIER_RECORD = '**/api/v1/parties/*/identifiers/*';
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

function identifier(overrides = {}) {
  return {
    id: '88888888-8888-7888-8888-888888888881',
    tenantId: TENANT,
    partyId: PARTY_ID,
    identifierType: 'LEI',
    value: '529900T8BM49AURSDO55',
    issuingAuthority: 'GLEIF',
    effectiveDate: '2026-01-01',
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

async function problem(route, status, body) {
  await route.fulfill({
    status,
    contentType: 'application/problem+json',
    body: JSON.stringify(body)
  });
}

/**
 * Serves the identifier collection and its child records, recording every
 * write so a test can assert the exact PATCH/DELETE request and the refresh
 * that follows it.
 */
async function mockIdentifierApi(page, state) {
  state.gets = 0;
  state.patches = [];
  state.deletes = [];

  await page.route(IDENTIFIERS, async (route) => {
    if (route.request().method() === 'GET') {
      state.gets += 1;
      await json(route, 200, state.items);
      return;
    }
    await route.fulfill({ status: 405, body: 'unexpected collection method' });
  });

  await page.route(IDENTIFIER_RECORD, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const id = decodeURIComponent(url.pathname.split('/').pop());
    if (request.method() === 'PATCH') {
      state.patches.push({
        path: url.pathname,
        id,
        body: request.postDataJSON(),
        headers: request.headers()
      });
      if (state.patchFailure) {
        await problem(route, state.patchFailure.status, state.patchFailure.body);
        return;
      }
      const existing = state.items.find((item) => item.id === id) || identifier();
      const body = request.postDataJSON();
      const updated = {
        ...existing,
        ...body,
        id,
        value: body.identifierValue,
        createdAt: existing.createdAt
      };
      state.items = state.items.map((item) => (item.id === id ? updated : item));
      await json(route, 200, updated);
      return;
    }
    if (request.method() === 'DELETE') {
      state.deletes.push({ path: url.pathname, id, headers: request.headers() });
      if (state.deleteFailure) {
        await problem(route, state.deleteFailure.status, state.deleteFailure.body);
        return;
      }
      state.items = state.items.filter((item) => item.id !== id);
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fulfill({ status: 405, body: 'unexpected record method' });
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

async function openIdentifiers(page) {
  await page.goto(`/?record=${PARTY_ID}`);
  await expect(page.getByRole('heading', { name: 'PTY-000000001' })).toBeVisible();
  await page.getByRole('tab', { name: 'Identifiers' }).click();
  await expect(page.getByTestId('party-identifiers')).toBeVisible();
}

test('lists identifiers with type, value, issuing authority, effective date, and created', async ({ page }) => {
  const rows = [
    identifier(),
    identifier({
      id: OTHER_IDENTIFIER_ID,
      identifierType: 'TIN',
      value: '12-3456789',
      issuingAuthority: 'Internal Revenue Service',
      effectiveDate: '2025-04-01',
      createdAt: '2026-10-19T12:00:00Z'
    })
  ];
  let request = null;

  await mockParty(page);
  await mockSupportingLookups(page);
  await page.route(IDENTIFIERS, async (route) => {
    request = {
      method: route.request().method(),
      url: new URL(route.request().url()),
      headers: route.request().headers()
    };
    await json(route, 200, { items: rows });
  });

  await openIdentifiers(page);

  await expect(page.getByTestId('identifiers-count')).toHaveText('2 identifiers');
  const rendered = page.getByTestId('identifier-row');
  await expect(rendered).toHaveCount(2);

  const first = rendered.nth(0);
  await expect(first.getByTestId('identifier-type')).toHaveText('LEI');
  await expect(first.getByTestId('identifier-value')).toHaveText('529900T8BM49AURSDO55');
  await expect(first.getByTestId('identifier-authority')).toHaveText('GLEIF');
  await expect(first.getByTestId('identifier-effective')).toHaveText('2026-01-01');
  await expect(first.getByTestId('identifier-created')).toHaveText('2026-10-20 09:30:00 UTC');

  const second = rendered.nth(1);
  await expect(second.getByTestId('identifier-type')).toHaveText('TIN');
  await expect(second.getByTestId('identifier-value')).toHaveText('12-3456789');
  await expect(second.getByTestId('identifier-authority')).toContainText('Internal Revenue Service');
  await expect(second.getByTestId('identifier-created')).toHaveText('2026-10-19 12:00:00 UTC');

  await expect(page.getByTestId('identifiers-context')).toContainText('party master data');
  await expect(page.getByTestId('identifiers-context')).toContainText('Claims, policies, and payments');
  await expect(page.getByText('No identifier endpoint is available in this release.')).toHaveCount(0);
  await expect(page.getByText('Not available')).toHaveCount(0);

  expect(request.method).toBe('GET');
  expect(request.url.pathname).toBe(`/api/v1/parties/${PARTY_ID}/identifiers`);
  expect(request.headers['x-eia-tenant']).toBe(TENANT);
});

test('adds an identifier with a trimmed payload and the tenant header', async ({ page }) => {
  let items = [];
  let create = null;
  let posts = 0;

  await mockParty(page);
  await mockSupportingLookups(page);
  await page.route(IDENTIFIERS, async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      await json(route, 200, items);
      return;
    }
    if (request.method() === 'POST') {
      posts += 1;
      create = { body: request.postDataJSON(), headers: request.headers() };
      const created = identifier({
        ...create.body,
        value: create.body.identifierValue,
        id: NEW_IDENTIFIER_ID,
        createdAt: '2026-10-21T10:00:00Z'
      });
      items = [...items, created];
      await json(route, 201, created);
      return;
    }
    await route.fulfill({ status: 405, body: 'unexpected method' });
  });

  await openIdentifiers(page);
  await expect(page.getByTestId('identifiers-count')).toHaveText('0 identifiers');

  const form = page.getByTestId('identifier-form');
  await form.getByLabel('Identifier type').selectOption('TIN');
  await form.getByLabel('Value').fill('  12-3456789  ');
  await form.getByLabel('Issuing authority').fill('  Internal Revenue Service  ');
  await form.getByLabel('Effective date').fill('2026-01-01');
  await form.getByRole('button', { name: 'Add identifier' }).click();

  await expect(page.getByTestId('identifiers-count')).toHaveText('1 identifier');
  await expect(page.getByTestId('identifier-notice')).toHaveText('Identifier added.');
  await expect(page.getByTestId('identifier-row')).toHaveCount(1);
  const row = page.getByTestId('identifier-row').first();
  await expect(row.getByTestId('identifier-type')).toHaveText('TIN');
  await expect(row.getByTestId('identifier-value')).toHaveText('12-3456789');
  await expect(row.getByTestId('identifier-authority')).toHaveText('Internal Revenue Service');
  await expect(row.getByTestId('identifier-effective')).toHaveText('2026-01-01');

  expect(posts).toBe(1);
  expect(create.body).toEqual({
    identifierType: 'TIN',
    identifierValue: '12-3456789',
    issuingAuthority: 'Internal Revenue Service',
    effectiveDate: '2026-01-01'
  });
  expect(create.headers['x-eia-tenant']).toBe(TENANT);
  expect(create.headers['content-type']).toContain('application/json');

  await expect(form.getByLabel('Value')).toHaveValue('');
  await expect(form.getByLabel('Identifier type')).toHaveValue('');
});

test('validates the add form without posting an invalid identifier', async ({ page }) => {
  let posts = 0;

  await mockParty(page);
  await mockSupportingLookups(page);
  await page.route(IDENTIFIERS, async (route) => {
    if (route.request().method() === 'GET') {
      await json(route, 200, []);
      return;
    }
    posts += 1;
    await route.fulfill({ status: 500, body: 'must not be called' });
  });

  await openIdentifiers(page);
  const form = page.getByTestId('identifier-form');
  await form.getByRole('button', { name: 'Add identifier' }).click();

  await expect(page.getByTestId('identifier-form-error')).toContainText(
    'Fix the highlighted fields before adding this identifier.'
  );
  await expect(form.getByText('Select an identifier type.')).toBeVisible();
  await expect(form.getByText('Enter the identifier value.')).toBeVisible();
  expect(posts).toBe(0);
  await expect(page.getByTestId('identifier-row')).toHaveCount(0);
});

test('contains a duplicate 409 inside the form and keeps the record usable', async ({ page }) => {
  let posts = 0;

  await mockParty(page);
  await mockSupportingLookups(page);
  await page.route(IDENTIFIERS, async (route) => {
    if (route.request().method() === 'GET') {
      await json(route, 200, []);
      return;
    }
    posts += 1;
    await route.fulfill({
      status: 409,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        type: 'https://errors.eia-open-insurance.example/party/duplicate-identifier',
        title: 'Duplicate party identifier',
        status: 409,
        code: 'DUPLICATE_IDENTIFIER',
        detail: 'An identifier with this type and value already exists for the party.',
        details: { value: 'already recorded' }
      })
    });
  });

  await openIdentifiers(page);
  const form = page.getByTestId('identifier-form');
  await form.getByLabel('Identifier type').selectOption('LEI');
  await form.getByLabel('Value').fill('529900T8BM49AURSDO55');
  await form.getByRole('button', { name: 'Add identifier' }).click();

  const formError = page.getByTestId('identifier-form-error');
  await expect(formError).toContainText('Duplicate identifier');
  await expect(formError).toContainText('An identifier with this type and value already exists');
  await expect(formError).toContainText('Review the existing identifiers before retrying.');

  expect(posts).toBe(1);
  await expect(page.getByTestId('identifiers-count')).toHaveText('0 identifiers');
  await expect(page.getByTestId('identifier-row')).toHaveCount(0);
  await expect(page.getByTestId('app-error')).toHaveCount(0);
  await expect(page.getByTestId('party-status')).toHaveText('ACTIVE');
  await expect(form.getByLabel('Value')).toHaveValue('529900T8BM49AURSDO55');

  await page.getByRole('tab', { name: 'Overview' }).click();
  await expect(page.getByTestId('overview-party-number')).toHaveText('PTY-000000001');
});

test('renders the empty state and replaces the old availability caveat', async ({ page }) => {
  await mockParty(page);
  await mockSupportingLookups(page);
  await page.route(IDENTIFIERS, async (route) => {
    await json(route, 200, []);
  });

  await openIdentifiers(page);

  await expect(page.getByTestId('identifiers-count')).toHaveText('0 identifiers');
  await expect(page.getByTestId('identifiers-empty')).toHaveText(
    'No identifiers are recorded for this party yet.'
  );
  await expect(page.getByTestId('party-identifiers').getByRole('table')).toHaveCount(0);
  await expect(page.getByText('No identifier endpoint is available in this release.')).toHaveCount(0);
  await expect(page.getByTestId('party-identifiers').getByText('Not available')).toHaveCount(0);
  await expect(page.getByTestId('identifier-form')).toBeVisible();
});

test('contains a list failure and still allows an identifier to be added', async ({ page }) => {
  let posts = 0;

  await mockParty(page);
  await mockSupportingLookups(page);
  await page.route(IDENTIFIERS, async (route) => {
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
    await json(route, 201, identifier({
      identifierType: 'LEI',
      value: '529900T8BM49AURSDO55',
      issuingAuthority: 'GLEIF',
      effectiveDate: '2026-01-01'
    }));
  });

  await openIdentifiers(page);

  await expect(page.getByTestId('identifiers-error')).toHaveText(
    'Identifiers are temporarily unavailable.'
  );
  await expect(page.getByTestId('identifiers-count')).toHaveText('0 identifiers');
  await expect(page.getByTestId('app-error')).toHaveCount(0);
  await expect(page.getByTestId('party-status')).toHaveText('ACTIVE');

  const form = page.getByTestId('identifier-form');
  await form.getByLabel('Identifier type').selectOption('LEI');
  await form.getByLabel('Value').fill('529900T8BM49AURSDO55');
  await form.getByLabel('Issuing authority').fill('GLEIF');
  await form.getByLabel('Effective date').fill('2026-01-01');
  await form.getByRole('button', { name: 'Add identifier' }).click();

  expect(posts).toBe(1);
  await expect(page.getByTestId('identifier-row')).toHaveCount(1);
  await expect(page.getByTestId('identifiers-count')).toHaveText('1 identifier');
  await expect(page.getByTestId('identifier-notice')).toHaveText('Identifier added.');
  await expect(page.getByTestId('app-error')).toHaveCount(0);
});

test('edits an identifier from the prefilled form, patches it, and refreshes the list', async ({ page }) => {
  const state = { items: [identifier()] };

  await mockParty(page);
  await mockSupportingLookups(page);
  await mockIdentifierApi(page, state);

  await openIdentifiers(page);
  const row = page.getByTestId('identifier-row').first();
  const form = page.getByTestId('identifier-form');

  await row.getByTestId('identifier-edit').click();
  await expect(page.getByTestId('identifier-form-title')).toHaveText('Edit identifier');
  await expect(page.getByTestId('identifier-edit-context')).toContainText('party master data');
  await expect(form.getByLabel('Identifier type')).toHaveValue('LEI');
  await expect(form.getByLabel('Value')).toHaveValue('529900T8BM49AURSDO55');
  await expect(form.getByLabel('Issuing authority')).toHaveValue('GLEIF');
  await expect(form.getByLabel('Effective date')).toHaveValue('2026-01-01');
  await expect(page.getByTestId('identifier-cancel')).toBeVisible();

  // Cancel restores the add form without sending anything.
  await page.getByTestId('identifier-cancel').click();
  await expect(page.getByTestId('identifier-form-title')).toHaveText('Add identifier');
  await expect(form.getByLabel('Value')).toHaveValue('');
  expect(state.patches).toHaveLength(0);

  await row.getByTestId('identifier-edit').click();
  await form.getByLabel('Value').fill('529900T8BM49AURSDO56');
  await form.getByLabel('Issuing authority').fill('GLEIF Registry');
  await page.getByTestId('identifier-submit').click();

  await expect.poll(() => state.patches.length).toBe(1);
  expect(state.patches[0].path).toBe(
    `/api/v1/parties/${PARTY_ID}/identifiers/${identifier().id}`
  );
  expect(state.patches[0].body).toEqual({
    identifierType: 'LEI',
    identifierValue: '529900T8BM49AURSDO56',
    issuingAuthority: 'GLEIF Registry',
    effectiveDate: '2026-01-01'
  });
  expect(state.patches[0].headers['x-eia-tenant']).toBe(TENANT);
  expect(state.patches[0].headers['content-type']).toContain('application/json');

  await expect(page.getByTestId('identifier-notice')).toHaveText('Identifier updated.');
  await expect(page.getByTestId('identifier-form-title')).toHaveText('Add identifier');
  await expect(form.getByLabel('Value')).toHaveValue('');
  await expect(page.getByTestId('identifier-row')).toHaveCount(1);
  const updated = page.getByTestId('identifier-row').first();
  await expect(updated.getByTestId('identifier-value')).toHaveText('529900T8BM49AURSDO56');
  await expect(updated.getByTestId('identifier-authority')).toHaveText('GLEIF Registry');
  expect(state.gets).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId('app-error')).toHaveCount(0);
});

test('contains a 400 and a 409 from an identifier edit inside the form', async ({ page }) => {
  const state = { items: [identifier()] };

  await mockParty(page);
  await mockSupportingLookups(page);
  await mockIdentifierApi(page, state);

  await openIdentifiers(page);
  await page.getByTestId('identifier-row').first().getByTestId('identifier-edit').click();
  const form = page.getByTestId('identifier-form');
  const formError = page.getByTestId('identifier-form-error');

  state.patchFailure = {
    status: 400,
    body: {
      type: 'https://errors.eia-open-insurance.example/party/invalid-identifier',
      title: 'Invalid party identifier',
      status: 400,
      code: 'VALIDATION_FAILED',
      detail: 'The identifier type is not recognized.'
    }
  };
  await page.getByTestId('identifier-submit').click();
  await expect(formError).toContainText('The identifier was rejected.');
  await expect(formError).toContainText('The identifier type is not recognized.');
  await expect(page.getByTestId('identifier-form-title')).toHaveText('Edit identifier');
  await expect(page.getByTestId('identifier-row')).toHaveCount(1);
  await expect(page.getByTestId('app-error')).toHaveCount(0);

  state.patchFailure = {
    status: 409,
    body: {
      type: 'https://errors.eia-open-insurance.example/party/duplicate-identifier',
      title: 'Duplicate party identifier',
      status: 409,
      code: 'DUPLICATE_IDENTIFIER',
      detail: 'An identifier with this type and value already exists for the party.'
    }
  };
  await form.getByLabel('Value').fill('12-3456789');
  await page.getByTestId('identifier-submit').click();

  await expect.poll(() => state.patches.length).toBe(2);
  await expect(formError).toContainText('Duplicate identifier');
  await expect(formError).toContainText('An identifier with this type and value already exists');
  await expect(formError).toContainText('Review the existing identifiers before retrying.');
  await expect(form.getByLabel('Value')).toHaveValue('12-3456789');
  await expect(page.getByTestId('identifier-form-title')).toHaveText('Edit identifier');
  await expect(page.getByTestId('identifiers-count')).toHaveText('1 identifier');
  await expect(page.getByTestId('identifier-row').getByTestId('identifier-value')).toHaveText(
    '529900T8BM49AURSDO55'
  );
  await expect(page.getByTestId('app-error')).toHaveCount(0);
  await expect(page.getByTestId('party-status')).toHaveText('ACTIVE');
});

test('deletes an identifier only after a master-data confirmation and refreshes the list', async ({ page }) => {
  const state = { items: [identifier()] };
  const dialogs = [];
  let acceptDialogs = false;

  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message());
    if (acceptDialogs) {
      await dialog.accept();
    } else {
      await dialog.dismiss();
    }
  });

  await mockParty(page);
  await mockSupportingLookups(page);
  await mockIdentifierApi(page, state);

  await openIdentifiers(page);
  const row = page.getByTestId('identifier-row').first();

  // Dismissing the confirmation sends nothing and keeps the identifier.
  await row.getByTestId('identifier-delete').click();
  await page.waitForTimeout(150);
  expect(state.deletes).toHaveLength(0);
  await expect(page.getByTestId('identifier-row')).toHaveCount(1);
  await expect(page.getByTestId('identifier-notice')).toHaveCount(0);

  expect(dialogs).toHaveLength(1);
  expect(dialogs[0]).toContain('Delete LEI 529900T8BM49AURSDO55?');
  expect(dialogs[0]).toContain('party master data');
  expect(dialogs[0]).toContain('claims, policies, and payments');
  expect(dialogs[0]).toContain('cannot be undone');

  acceptDialogs = true;
  await row.getByTestId('identifier-delete').click();

  await expect.poll(() => state.deletes.length).toBe(1);
  expect(state.deletes[0].path).toBe(
    `/api/v1/parties/${PARTY_ID}/identifiers/${identifier().id}`
  );
  expect(state.deletes[0].headers['x-eia-tenant']).toBe(TENANT);
  expect(dialogs).toHaveLength(2);

  await expect(page.getByTestId('identifier-notice')).toHaveText('Identifier deleted.');
  await expect(page.getByTestId('identifier-row')).toHaveCount(0);
  await expect(page.getByTestId('identifiers-empty')).toHaveText(
    'No identifiers are recorded for this party yet.'
  );
  await expect(page.getByTestId('identifiers-count')).toHaveText('0 identifiers');
  expect(state.gets).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId('app-error')).toHaveCount(0);
});

test('contains a 404 from an identifier delete inside the section', async ({ page }) => {
  const state = { items: [identifier()] };

  page.on('dialog', async (dialog) => {
    await dialog.accept();
  });

  await mockParty(page);
  await mockSupportingLookups(page);
  await mockIdentifierApi(page, state);
  state.deleteFailure = {
    status: 404,
    body: {
      type: 'https://errors.eia-open-insurance.example/party/identifier-not-found',
      title: 'Party identifier not found',
      status: 404,
      code: 'IDENTIFIER_NOT_FOUND',
      detail: 'The identifier does not belong to this party.'
    }
  };

  await openIdentifiers(page);
  await page.getByTestId('identifier-row').first().getByTestId('identifier-delete').click();

  const actionError = page.getByTestId('identifier-action-error');
  await expect(actionError).toContainText('This identifier no longer exists on the party.');
  await expect(actionError).toContainText('The identifier does not belong to this party.');
  await expect(actionError).toContainText('Refresh the list and try again.');
  await expect(page.getByTestId('identifier-row')).toHaveCount(1);
  await expect(page.getByTestId('app-error')).toHaveCount(0);
  await expect(page.getByTestId('party-status')).toHaveText('ACTIVE');
  await expect(page.getByTestId('identifier-form')).toBeVisible();
  expect(state.deletes).toHaveLength(1);
});
