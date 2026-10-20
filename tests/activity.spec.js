import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const FIRST_ID = '0192f3a4-8f1c-7c3a-9b2e-6a1d4f8e2b90';
const SECOND_ID = '0192f3a4-8f1c-7c3a-9b2e-6a1d4f8e2b91';
const CREATED_EVENT_ID = 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeee1';
const UPDATED_EVENT_ID = 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeee2';
const PARTY_SEARCH = '**/api/v1/parties**';
const CLAIMS_SEARCH = '**/api/v1/claims/search**';
const POLICY_LOOKUP = '**/api/v1/policies**';
const DOCUMENTS = '**/api/v1/documents**';
const EVENTS = '**/api/v1/events/aggregate/**';

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

/**
 * The aggregate endpoint embeds the canonical event envelope in `payload`; the
 * party facts live in `payload.data`. The service returns events newest first,
 * but tests pass them oldest first to prove the card sorts them itself.
 */
function aggregateEvent({
  eventId,
  eventType,
  occurredAt,
  aggregateVersion,
  aggregateId = FIRST_ID,
  eventVersion = 1,
  status = 'PROCESSED',
  data = {},
  payload
}) {
  return {
    eventId,
    eventType,
    eventVersion,
    tenantId: TENANT,
    book: 'DIRECT',
    aggregateType: 'Party',
    aggregateId,
    aggregateVersion,
    occurredAt,
    receivedAt: occurredAt,
    status,
    payload: payload ?? {
      eventId,
      eventType,
      eventVersion: 1,
      tenantId: TENANT,
      book: 'DIRECT',
      aggregateType: 'Party',
      aggregateId,
      aggregateVersion,
      occurredAt,
      data
    }
  };
}

function createdEvent(overrides = {}) {
  return aggregateEvent({
    eventId: CREATED_EVENT_ID,
    eventType: 'party.party.created',
    occurredAt: '2026-10-18T12:00:00Z',
    aggregateVersion: 1,
    data: {
      partyId: FIRST_ID,
      partyNumber: 'PTY-000000001',
      partyType: 'ORGANIZATION',
      status: 'PROSPECT',
      displayName: 'Acme Manufacturing',
      roles: []
    },
    ...overrides
  });
}

function updatedEvent(overrides = {}) {
  return aggregateEvent({
    eventId: UPDATED_EVENT_ID,
    eventType: 'party.party.updated',
    occurredAt: '2026-10-19T09:30:00Z',
    aggregateVersion: 2,
    data: {
      partyId: FIRST_ID,
      partyNumber: 'PTY-000000001',
      changedFields: ['status'],
      version: 1,
      from: 'PROSPECT',
      to: 'ACTIVE',
      reason: 'Sanctions screening cleared'
    },
    ...overrides
  });
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
    const url = new URL(route.request().url());
    await json(route, 200, { query: url.searchParams.get('q') || '', limit: 5, items: [] });
  });
}

async function mockPolicies(page) {
  await page.route(POLICY_LOOKUP, async (route) => {
    await json(route, 200, { items: [], page: 0, size: 5, total: 0 });
  });
}

async function mockDocuments(page) {
  await page.route(DOCUMENTS, async (route) => {
    await json(route, 200, []);
  });
}

async function mockEvents(page, handler) {
  await page.route(EVENTS, async (route) => {
    const request = route.request();
    await handler({ route, request, url: new URL(request.url()) });
  });
}

test('loads activity on party selection with tenant header, newest-first order, and a card-local loader', async ({ page }) => {
  const existing = party();
  const requests = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  await routeParties(page, [existing]);
  await mockClaims(page);
  await mockPolicies(page);
  await mockDocuments(page);
  await mockEvents(page, async ({ route, request, url }) => {
    requests.push({ method: request.method(), url, headers: request.headers() });
    if (requests.length === 1) await firstGate;
    // Deliberately oldest-first: the card must present newest-first.
    await json(route, 200, {
      aggregateId: FIRST_ID,
      limit: 50,
      items: [createdEvent(), updatedEvent()]
    });
  });

  try {
    await page.goto(`/?record=${FIRST_ID}`);
    await expect(page.getByRole('heading', { name: 'PTY-000000001' })).toBeVisible();

    // Selection alone fetches the timeline, before the Activity tab is opened.
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0].method).toBe('GET');
    expect(requests[0].url.pathname).toBe(`/api/v1/events/aggregate/${FIRST_ID}`);
    expect(requests[0].url.searchParams.get('limit')).toBe('50');
    expect(requests[0].headers['x-eia-tenant']).toBe(TENANT);

    await page.getByRole('tab', { name: 'Activity' }).click();
    const card = page.getByTestId('party-activity');
    await expect(card).toBeVisible();
    await expect(card.getByTestId('activity-loading')).toBeVisible();
    await expect(card.getByTestId('activity-count')).toHaveText('…');
    releaseFirst();

    await expect(card.getByTestId('activity-count')).toHaveText('2 events');
    const items = card.getByTestId('activity-item');
    await expect(items).toHaveCount(2);

    const newest = items.nth(0);
    await expect(newest.getByTestId('activity-type')).toHaveText('Party updated');
    await expect(newest.getByTestId('activity-status')).toHaveText('PROCESSED');
    await expect(newest.getByTestId('activity-status')).toHaveClass(/green/);
    await expect(newest.getByTestId('activity-version')).toHaveText('v2');
    await expect(newest.getByTestId('activity-time')).toHaveAttribute(
      'dateTime',
      '2026-10-19T09:30:00.000Z'
    );
    await expect(newest.getByTestId('activity-time')).toContainText('Oct 19, 2026');
    await expect(newest.getByTestId('activity-fact-status')).toContainText('PROSPECT → ACTIVE');

    const oldest = items.nth(1);
    await expect(oldest.getByTestId('activity-type')).toHaveText('Party created');
    await expect(oldest.getByTestId('activity-version')).toHaveText('v1');
    await expect(oldest.getByTestId('activity-fact-party-type')).toContainText('ORGANIZATION');
    await expect(oldest.getByTestId('activity-fact-status')).toContainText('PROSPECT');
    await expect(oldest.getByTestId('activity-fact-name')).toContainText('Acme Manufacturing');
  } finally {
    releaseFirst();
  }
});

test('shows the card-local empty state with the event-source context note', async ({ page }) => {
  const existing = party();

  await routeParties(page, [existing]);
  await mockClaims(page);
  await mockPolicies(page);
  await mockDocuments(page);
  await mockEvents(page, async ({ route }) => {
    await json(route, 200, { aggregateId: FIRST_ID, limit: 50, items: [] });
  });

  await page.goto(`/?record=${FIRST_ID}`);
  await expect(page.getByRole('heading', { name: 'PTY-000000001' })).toBeVisible();
  await page.getByRole('tab', { name: 'Activity' }).click();

  const card = page.getByTestId('party-activity');
  await expect(card.getByTestId('activity-count')).toHaveText('0 events');
  await expect(card.getByTestId('activity-empty')).toContainText(
    'No activity has been recorded for this party yet.'
  );
  await expect(card.getByTestId('activity-timeline')).toHaveCount(0);
  await expect(card.getByTestId('activity-context-note')).toContainText('Event-derived timeline');
  await expect(card.getByTestId('activity-context-note')).toContainText('append-only');
  await expect(card.getByTestId('activity-context-note')).toContainText('source of truth');
  await expect(page.getByTestId('party-status')).toHaveText('ACTIVE');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('contains an event-service 503 inside the activity card', async ({ page }) => {
  const existing = party();

  await routeParties(page, [existing]);
  await mockClaims(page);
  await mockPolicies(page);
  await mockDocuments(page);
  await mockEvents(page, async ({ route }) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        type: 'https://errors.eia-open-insurance.example/platform/event-store-unavailable',
        title: 'Event store unavailable',
        status: 503,
        code: 'EVENT_STORE_UNAVAILABLE',
        detail: 'The event service is unavailable; retry later.'
      })
    });
  });

  await page.goto(`/?record=${FIRST_ID}`);
  await expect(page.getByRole('heading', { name: 'PTY-000000001' })).toBeVisible();
  await page.getByRole('tab', { name: 'Activity' }).click();

  const card = page.getByTestId('party-activity');
  await expect(card.getByTestId('activity-error')).toContainText(
    'Activity timeline is temporarily unavailable.'
  );
  await expect(card.getByTestId('activity-count')).toHaveText('0 events');
  await expect(card.getByTestId('activity-timeline')).toHaveCount(0);
  await expect(page.getByTestId('party-status')).toHaveText('ACTIVE');
  await expect(page.getByTestId('party-name')).toHaveText('Acme Manufacturing');
  await expect(page.getByRole('alert')).toHaveCount(0);

  // The rest of the record still works: Overview remains readable.
  await page.getByRole('tab', { name: 'Overview' }).click();
  await expect(page.getByTestId('overview-party-number')).toHaveText('PTY-000000001');
});

test('renders party type, status, and name facts from the event payload', async ({ page }) => {
  const existing = party();

  await routeParties(page, [existing]);
  await mockClaims(page);
  await mockPolicies(page);
  await mockDocuments(page);
  await mockEvents(page, async ({ route }) => {
    // Some projections return the event data object directly rather than the
    // canonical envelope; both shapes must surface the same facts.
    await json(route, 200, {
      aggregateId: FIRST_ID,
      limit: 50,
      items: [
        aggregateEvent({
          eventId: CREATED_EVENT_ID,
          eventType: 'party.party.created',
          occurredAt: '2026-10-18T12:00:00Z',
          aggregateVersion: 1,
          payload: {
            partyId: FIRST_ID,
            partyType: 'TRUST',
            status: 'ACTIVE',
            displayName: 'Blake Family Trust'
          }
        })
      ]
    });
  });

  await page.goto(`/?record=${FIRST_ID}`);
  await expect(page.getByRole('heading', { name: 'PTY-000000001' })).toBeVisible();
  await page.getByRole('tab', { name: 'Activity' }).click();

  const item = page.getByTestId('activity-item').first();
  await expect(item.getByTestId('activity-type')).toHaveText('Party created');
  await expect(item.getByTestId('activity-fact-party-type')).toContainText('Party type TRUST');
  await expect(item.getByTestId('activity-fact-status')).toContainText('Status ACTIVE');
  await expect(item.getByTestId('activity-fact-name')).toContainText('Name Blake Family Trust');
});

test('refetches the timeline when another party is selected and on card refresh', async ({ page }) => {
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
  await mockDocuments(page);
  await mockEvents(page, async ({ route, request, url }) => {
    requests.push({ url, headers: request.headers() });
    const partyId = url.pathname.split('/').pop();
    if (partyId === FIRST_ID) {
      await json(route, 200, { aggregateId: FIRST_ID, limit: 50, items: [createdEvent()] });
      return;
    }
    await json(route, 200, {
      aggregateId: SECOND_ID,
      limit: 50,
      items: [
        aggregateEvent({
          eventId: UPDATED_EVENT_ID,
          eventType: 'party.party.created',
          aggregateId: SECOND_ID,
          occurredAt: '2026-10-20T10:00:00Z',
          aggregateVersion: 1,
          data: {
            partyId: SECOND_ID,
            partyType: 'PERSON',
            status: 'PROSPECT',
            displayName: 'Jordan Blake'
          }
        })
      ]
    });
  });

  await page.goto(`/?record=${FIRST_ID}`);
  await expect(page.getByRole('heading', { name: 'PTY-000000001' })).toBeVisible();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].url.pathname).toBe(`/api/v1/events/aggregate/${FIRST_ID}`);
  expect(requests[0].headers['x-eia-tenant']).toBe(TENANT);

  // Opening the tab must not duplicate the selection-time lookup.
  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(page.getByTestId('party-activity').getByTestId('activity-count')).toHaveText('1 event');
  expect(requests.length).toBe(1);

  await page.getByRole('button', { name: 'Open record PTY-000000002' }).click();
  await expect(page.getByRole('heading', { name: 'PTY-000000002' })).toBeVisible();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].url.pathname).toBe(`/api/v1/events/aggregate/${SECOND_ID}`);
  expect(requests[1].url.searchParams.get('limit')).toBe('50');
  expect(requests[1].headers['x-eia-tenant']).toBe(TENANT);

  await page.getByRole('tab', { name: 'Activity' }).click();
  const card = page.getByTestId('party-activity');
  await expect(card.getByTestId('activity-count')).toHaveText('1 event');
  await expect(card.getByTestId('activity-item')).toContainText('Jordan Blake');

  // The card's own Refresh re-reads the same aggregate without changing selection.
  await card.getByRole('button', { name: 'Refresh activity timeline' }).click();
  await expect.poll(() => requests.length).toBe(3);
  expect(requests[2].url.pathname).toBe(`/api/v1/events/aggregate/${SECOND_ID}`);
  expect(requests[2].url.searchParams.get('limit')).toBe('50');
  expect(requests[2].headers['x-eia-tenant']).toBe(TENANT);
  await expect(card.getByTestId('activity-count')).toHaveText('1 event');
});
