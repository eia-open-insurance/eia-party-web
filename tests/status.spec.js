import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const PARTY_ID = '0192f3a4-8f1c-7c3a-9b2e-6a1d4f8e2b90';
const PARTY_ROUTE = '**/api/v1/parties**';
const CLAIMS_SEARCH = '**/api/v1/claims/search**';
const POLICY_LOOKUP = '**/api/v1/policies**';
const DOCUMENTS = '**/api/v1/documents**';
const EVENTS = '**/api/v1/events/aggregate/**';

const STATUSES = [
  'PROSPECT',
  'ACTIVE',
  'INACTIVE',
  'DECEASED',
  'DISSOLVED',
  'MERGED',
  'RESTRICTED',
  'BLOCKED'
];

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

async function json(route, status, body, headers = {}) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers,
    body: JSON.stringify(body)
  });
}

/**
 * One mutable party behind the public API. Detail reads carry an ETag and
 * every accepted PATCH advances the version, so the UI sees the same contract
 * whether it uses the header or the quoted version for If-Match.
 */
async function mockPartyApi(page, { status = 'ACTIVE', version = 2, etag } = {}) {
  const state = {
    party: party({ status, version }),
    etag: etag === undefined ? `"${version}"` : etag,
    detailReads: 0,
    activityReads: 0,
    patches: [],
    patchHandler: null
  };

  await page.route(PARTY_ROUTE, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const statusPath = url.pathname.match(/^\/api\/v1\/parties\/([^/]+)\/status$/);

    if (request.method() === 'PATCH' && statusPath) {
      state.patches.push({
        headers: request.headers(),
        body: request.postDataJSON(),
        path: url.pathname
      });
      if (state.patchHandler) {
        await state.patchHandler({ route, request, state });
        return;
      }
      const next = request.postDataJSON();
      state.party = {
        ...state.party,
        status: next.status,
        version: state.party.version + 1,
        updatedAt: '2026-10-22T12:00:00Z'
      };
      state.etag = `"${state.party.version}"`;
      await json(route, 200, state.party, { ETag: state.etag });
      return;
    }

    if (request.method() === 'GET' && url.pathname === '/api/v1/parties') {
      await json(route, 200, [state.party]);
      return;
    }

    if (request.method() === 'GET' && url.pathname === `/api/v1/parties/${PARTY_ID}`) {
      state.detailReads += 1;
      const headers = state.etag ? { ETag: state.etag } : {};
      await json(route, 200, state.party, headers);
      return;
    }

    await route.fulfill({
      status: 404,
      body: `unexpected route ${request.method()} ${url.pathname}`
    });
  });

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
    state.activityReads += 1;
    await json(route, 200, { aggregateId: PARTY_ID, limit: 50, items: [] });
  });

  return state;
}

async function openStatusDialog(page) {
  await page.getByTestId('change-status').click();
  const dialog = page.getByTestId('status-dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

test('offers every other status and excludes the current status', async ({ page }) => {
  const state = await mockPartyApi(page, { status: 'ACTIVE' });

  for (const currentStatus of STATUSES) {
    state.party = party({ status: currentStatus });
    state.etag = `"${state.party.version}"`;

    await page.goto(`/?record=${PARTY_ID}`);
    await expect(page.getByTestId('party-status')).toHaveText(currentStatus);

    const dialog = await openStatusDialog(page);
    await expect(dialog.getByTestId('status-current-pill')).toHaveText(currentStatus);
    await expect(dialog.getByTestId('status-party-number')).toHaveText('PTY-000000001');

    const options = await dialog
      .getByTestId('status-target')
      .locator('option')
      .evaluateAll((nodes) => nodes.map((node) => node.value));
    expect(options).toEqual(STATUSES.filter((value) => value !== currentStatus));
    await expect(dialog.getByTestId('status-target')).toHaveValue(
      STATUSES.filter((value) => value !== currentStatus)[0]
    );

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  }
});

test('changes every status with If-Match, updates the party, reloads activity, and notices', async ({ page }) => {
  const state = await mockPartyApi(page, { status: 'ACTIVE', version: 2 });

  for (const target of STATUSES) {
    const fromStatus = target === 'PROSPECT' ? 'ACTIVE' : 'PROSPECT';
    state.party = party({ status: fromStatus, version: 2 });
    state.etag = '"2"';
    state.patches = [];

    await page.goto(`/?record=${PARTY_ID}`);
    await expect(page.getByTestId('party-status')).toHaveText(fromStatus);
    const activityBefore = state.activityReads;

    const dialog = await openStatusDialog(page);
    await dialog.getByTestId('status-target').selectOption(target);
    const reason = target === 'BLOCKED' ? '  Confirmed sanctions match  ' : '';
    if (reason) await dialog.getByTestId('status-reason').fill(reason);
    await dialog.getByTestId('status-submit').click();

    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('party-status')).toHaveText(target);
    await expect(page.getByTestId('summary-status')).toHaveText(target);
    await expect(page.getByTestId('app-notice')).toContainText(
      `status changed from ${fromStatus} to ${target}`
    );

    await expect.poll(() => state.patches.length).toBe(1);
    expect(state.patches[0].path).toBe(`/api/v1/parties/${PARTY_ID}/status`);
    expect(state.patches[0].headers['if-match']).toBe('"2"');
    expect(state.patches[0].headers['x-eia-tenant']).toBe(TENANT);
    expect(state.patches[0].headers['content-type']).toContain('application/json');
    expect(state.patches[0].body).toEqual(
      reason ? { status: target, reason: 'Confirmed sanctions match' } : { status: target }
    );

    // One read for the initial selection, one after a successful transition.
    await expect.poll(() => state.activityReads - activityBefore).toBe(2);
  }
});

test('prefers the detail ETag for If-Match and falls back to the quoted version', async ({ page }) => {
  const state = await mockPartyApi(page, { status: 'ACTIVE', version: 2, etag: '"detail-2"' });

  await page.goto(`/?record=${PARTY_ID}`);
  let dialog = await openStatusDialog(page);
  await dialog.getByTestId('status-target').selectOption('BLOCKED');
  await dialog.getByTestId('status-submit').click();
  await expect(dialog).toBeHidden();
  expect(state.patches[0].headers['if-match']).toBe('"detail-2"');

  state.party = party({ status: 'ACTIVE', version: 5 });
  state.etag = null;
  state.patches = [];
  await page.goto(`/?record=${PARTY_ID}`);
  await expect(page.getByTestId('party-status')).toHaveText('ACTIVE');
  dialog = await openStatusDialog(page);
  await dialog.getByTestId('status-target').selectOption('INACTIVE');
  await dialog.getByTestId('status-submit').click();
  await expect(dialog).toBeHidden();
  expect(state.patches[0].headers['if-match']).toBe('"5"');
});

test('explains the downstream effect, warns for restrictive targets, and removes the caveat', async ({ page }) => {
  await mockPartyApi(page, { status: 'ACTIVE' });

  await page.goto(`/?record=${PARTY_ID}`);
  await expect(page.getByTestId('available-operations')).not.toContainText(
    'Status transitions are not exposed'
  );

  const dialog = await openStatusDialog(page);
  const downstream = dialog.getByTestId('status-downstream');
  await expect(downstream).toContainText(
    'INACTIVE, BLOCKED, or RESTRICTED can stop new claims, policies, and payments'
  );
  await expect(downstream).toContainText(
    'Existing claims, policies, payments, and other records are unchanged'
  );
  await expect(dialog.getByTestId('status-warning')).toHaveCount(0);

  await dialog.getByTestId('status-target').selectOption('BLOCKED');
  await expect(dialog.getByTestId('status-warning')).toContainText(
    'Changing to BLOCKED can stop new claims, policies, and payments'
  );
  await expect(dialog.getByTestId('status-warning')).toContainText('Existing records are unchanged');

  await expect(dialog.getByTestId('status-reason')).toHaveAttribute('maxlength', '500');
  await dialog.getByTestId('status-reason').fill('x'.repeat(500));
  await expect(dialog.getByTestId('status-reason')).toHaveValue('x'.repeat(500));

  await dialog.getByTestId('status-target').selectOption('PROSPECT');
  await expect(dialog.getByTestId('status-warning')).toHaveCount(0);
});

test('keeps the dialog open and refreshes the current status when a race loses', async ({ page }) => {
  const state = await mockPartyApi(page, { status: 'ACTIVE', version: 2 });

  state.patchHandler = async ({ route }) => {
    state.party = party({ status: 'BLOCKED', version: 3 });
    state.etag = '"3"';
    await route.fulfill({
      status: 409,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        code: 'VERSION_CONFLICT',
        message: 'If-Match expected version 2 but the party is now version 3'
      })
    });
  };

  await page.goto(`/?record=${PARTY_ID}`);
  await expect.poll(() => state.activityReads).toBe(1);
  const activityBefore = state.activityReads;
  const dialog = await openStatusDialog(page);
  await dialog.getByTestId('status-target').selectOption('INACTIVE');
  await dialog.getByTestId('status-submit').click();

  const error = dialog.getByTestId('status-error');
  await expect(error).toContainText('The party changed while the dialog was open.');
  await expect(error).toContainText('The party is now BLOCKED.');
  await expect(error).toContainText('If-Match expected version 2 but the party is now version 3');
  await expect(dialog.getByTestId('status-current-pill')).toHaveText('BLOCKED');

  const options = await dialog
    .getByTestId('status-target')
    .locator('option')
    .evaluateAll((nodes) => nodes.map((node) => node.value));
  expect(options).toEqual(STATUSES.filter((value) => value !== 'BLOCKED'));
  await expect(dialog.getByTestId('status-target')).toHaveValue('PROSPECT');

  // The background record is refreshed too, but nothing is reported as saved.
  await expect(page.getByTestId('party-status')).toHaveText('BLOCKED');
  await expect(page.getByTestId('app-notice')).toHaveCount(0);
  expect(state.activityReads).toBe(activityBefore);
  expect(state.patches).toHaveLength(1);
});

test('shows a validation problem inside the dialog without changing the party', async ({ page }) => {
  const state = await mockPartyApi(page, { status: 'ACTIVE', version: 2 });

  state.patchHandler = async ({ route }) => {
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'VALIDATION',
        message: 'Request validation failed',
        details: { reason: 'must be 500 characters or fewer' }
      })
    });
  };

  await page.goto(`/?record=${PARTY_ID}`);
  const dialog = await openStatusDialog(page);
  await dialog.getByTestId('status-target').selectOption('DECEASED');
  await dialog.getByTestId('status-reason').fill('x'.repeat(500));
  await dialog.getByTestId('status-submit').click();

  const error = dialog.getByTestId('status-error');
  await expect(error).toContainText('Request validation failed');
  await expect(error).toContainText('reason: must be 500 characters or fewer');
  await expect(dialog.getByTestId('status-current-pill')).toHaveText('ACTIVE');
  await expect(page.getByTestId('party-status')).toHaveText('ACTIVE');
  await expect(page.getByTestId('app-notice')).toHaveCount(0);
  expect(state.patches).toHaveLength(1);
  expect(state.patches[0].body.reason).toHaveLength(500);
});
