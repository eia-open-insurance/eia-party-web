import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const FIRST_ID = '0192f3a4-8f1c-7c3a-9b2e-6a1d4f8e2b90';
const SECOND_ID = '0192f3a4-8f1c-7c3a-9b2e-6a1d4f8e2b91';
const FIRST_NUMBER = 'PTY-000000001';
const SECOND_NUMBER = 'PTY-000000002';

function party(overrides = {}) {
  return {
    id: FIRST_ID,
    tenantId: TENANT,
    partyNumber: FIRST_NUMBER,
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

function notification(overrides = {}) {
  return {
    id: '99999999-9999-7999-8999-999999999991',
    tenantId: TENANT,
    notificationNumber: 'NTF-2026-000000001',
    notificationType: 'PARTY_CREATED',
    channel: 'EMAIL',
    status: 'SENT',
    recipientPartyId: FIRST_ID,
    subject: 'Party created',
    body: 'The party record was created.',
    templateCode: 'PARTY_CREATED_STANDARD',
    templateVersion: 1,
    scheduledAt: null,
    sentAt: '2026-10-18T12:00:00Z',
    version: 1,
    createdAt: '2026-10-18T12:00:00Z',
    updatedAt: '2026-10-18T12:00:00Z',
    sourceType: 'PARTY',
    sourceId: FIRST_ID,
    sourceReference: FIRST_NUMBER,
    ...overrides
  };
}

// Deliberately not newest-first and mixed with rows that point at another party
// or another source: the card must show only this party's newest three.
const NOTIFICATION_NEWEST = notification({
  id: '99999999-9999-7999-8999-999999999911',
  notificationNumber: 'NTF-2026-000011',
  notificationType: 'PARTY_SANCTIONS_HIT',
  status: 'DELIVERED',
  subject: 'Sanctions screening flagged a hit',
  createdAt: '2026-10-20T09:30:00Z'
});

const NOTIFICATION_MIDDLE = notification({
  id: '99999999-9999-7999-8999-999999999922',
  notificationNumber: 'NTF-2026-000022',
  notificationType: 'PARTY_SCREENING_COMPLETE',
  status: 'READ',
  subject: 'Sanctions screening complete',
  createdAt: '2026-10-19T16:15:00Z'
});

const NOTIFICATION_OLD = notification({
  id: '99999999-9999-7999-8999-999999999933',
  notificationNumber: 'NTF-2026-000033',
  notificationType: 'PARTY_BANK_ACCOUNT_CHANGED',
  status: 'QUEUED',
  subject: 'Bank account changed',
  createdAt: '2026-10-18T08:05:00Z'
});

const NOTIFICATION_OLDEST = notification({
  id: '99999999-9999-7999-8999-999999999944',
  notificationNumber: 'NTF-2026-000044',
  notificationType: 'PARTY_MERGED',
  status: 'FAILED',
  subject: 'Old merge notice',
  createdAt: '2026-10-01T07:00:00Z'
});

const NOTIFICATION_OTHER_PARTY = notification({
  id: '99999999-9999-7999-8999-999999999955',
  notificationNumber: 'NTF-2026-000055',
  sourceId: SECOND_ID,
  sourceReference: SECOND_NUMBER,
  subject: 'Other party notice',
  createdAt: '2026-10-21T08:00:00Z'
});

const NOTIFICATION_OTHER_SOURCE = notification({
  id: '99999999-9999-7999-8999-999999999966',
  notificationNumber: 'NTF-2026-000066',
  sourceType: 'PAYMENT',
  subject: 'Payment settled',
  createdAt: '2026-10-22T08:00:00Z'
});

const RELATED = [
  NOTIFICATION_OLD,
  NOTIFICATION_NEWEST,
  NOTIFICATION_MIDDLE,
  NOTIFICATION_OLDEST,
  NOTIFICATION_OTHER_PARTY,
  NOTIFICATION_OTHER_SOURCE
];

async function json(route, status, body, headers = {}) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers,
    body: JSON.stringify(body)
  });
}

/**
 * Mocks everything the party workbench calls on selection: the register, the
 * party detail read, identifiers and addresses, related records, policies,
 * linked documents, the event-derived activity, and related notifications.
 * `notificationsGate` keeps the notification response pending so a test can
 * observe the record while the Notifications API is still in flight.
 */
async function mockPartyApi(page, {
  parties = [party()],
  notifications = [],
  notificationsStatus = 200,
  notificationsEnvelope = false,
  notificationsTotal = undefined,
  notificationsGate = null,
  onNotifications = null
} = {}) {
  const byId = new Map(parties.map((row) => [row.id, row]));

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (method === 'GET' && path === '/api/v1/parties') {
      await json(route, 200, parties);
      return;
    }
    if (method === 'GET' && /^\/api\/v1\/parties\/[^/]+\/identifiers$/.test(path)) {
      await json(route, 200, []);
      return;
    }
    if (method === 'GET' && /^\/api\/v1\/parties\/[^/]+\/addresses$/.test(path)) {
      await json(route, 200, []);
      return;
    }
    const detail = path.match(/^\/api\/v1\/parties\/([^/]+)$/);
    if (method === 'GET' && detail && byId.has(detail[1])) {
      const record = byId.get(detail[1]);
      await json(route, 200, record, { ETag: `"${record.version}"` });
      return;
    }
    if (method === 'GET' && path === '/api/v1/claims/search') {
      await json(route, 200, { query: url.searchParams.get('q') || '', limit: 5, items: [] });
      return;
    }
    if (method === 'GET' && path === '/api/v1/policies') {
      await json(route, 200, { items: [], page: 0, size: 5, total: 0 });
      return;
    }
    if (method === 'GET' && path === '/api/v1/documents') {
      await json(route, 200, []);
      return;
    }
    if (method === 'GET' && path.startsWith('/api/v1/events/aggregate/')) {
      await json(route, 200, { aggregateId: '', limit: 50, items: [] });
      return;
    }
    if (method === 'GET' && path === '/api/v1/notifications') {
      if (onNotifications) onNotifications(request, url);
      if (notificationsGate) await notificationsGate;

      if (notificationsStatus >= 400) {
        const failure = typeof notifications === 'function'
          ? notifications(url)
          : notifications;
        await json(route, notificationsStatus, failure);
        return;
      }

      const rows = typeof notifications === 'function' ? notifications(url) : notifications;
      const body = notificationsEnvelope
        ? { items: rows, total: notificationsTotal ?? rows.length }
        : rows;
      await json(route, 200, body);
      return;
    }

    await json(route, 404, {
      code: 'NOT_FOUND',
      message: `Unhandled ${method} ${path}`
    });
  });
}

test('shows the count and newest three related notifications with the source query', async ({ page }) => {
  const first = party();
  const second = party({
    id: SECOND_ID,
    partyNumber: SECOND_NUMBER,
    displayName: 'Jordan Blake',
    legalName: 'Jordan A. Blake',
    partyType: 'PERSON',
    status: 'PROSPECT'
  });
  const secondRows = [
    notification({
      id: '99999999-9999-7999-8999-999999999977',
      notificationNumber: 'NTF-2026-000077',
      sourceId: SECOND_ID,
      sourceReference: SECOND_NUMBER,
      subject: 'Second party notice',
      status: 'SENT',
      createdAt: '2026-10-21T11:00:00Z'
    })
  ];
  const requests = [];

  await mockPartyApi(page, {
    parties: [first, second],
    notifications: (url) => (
      url.searchParams.get('sourceId') === SECOND_ID ? secondRows : RELATED
    ),
    onNotifications: (request, url) => {
      requests.push({
        method: request.method(),
        path: url.pathname,
        sourceType: url.searchParams.get('sourceType'),
        sourceId: url.searchParams.get('sourceId'),
        tenant: request.headers()['x-eia-tenant'],
        book: request.headers()['x-eia-book'] || null
      });
    }
  });

  await page.goto(`/?record=${FIRST_ID}`);
  await expect(page.getByRole('heading', { name: FIRST_NUMBER })).toBeVisible();

  const card = page.getByTestId('related-notifications');
  await expect(card).toBeVisible();
  await expect(card.getByRole('heading', { name: 'Related notifications' })).toBeVisible();
  await expect(card.getByTestId('related-notifications-count')).toHaveText('4 notifications');
  await expect(card.getByTestId('related-notifications-more'))
    .toHaveText('Showing the newest 3 of 4.');

  const rows = card.getByTestId('related-notification-row');
  await expect(rows).toHaveCount(3);

  // Newest first; the oldest related row and the unrelated rows stay hidden.
  await expect(rows.nth(0)).toContainText(NOTIFICATION_NEWEST.notificationNumber);
  await expect(rows.nth(0)).toContainText(NOTIFICATION_NEWEST.subject);
  await expect(rows.nth(0)).toContainText('DELIVERED');
  await expect(rows.nth(0).getByTestId('related-notification-status')).toHaveClass(/green/);
  await expect(rows.nth(0)).toContainText('2026-10-20 09:30:00 UTC');
  await expect(rows.nth(1)).toContainText(NOTIFICATION_MIDDLE.notificationNumber);
  await expect(rows.nth(1)).toContainText('READ');
  await expect(rows.nth(2)).toContainText(NOTIFICATION_OLD.notificationNumber);
  await expect(rows.nth(2)).toContainText('QUEUED');
  await expect(rows.nth(2).getByTestId('related-notification-status')).toHaveClass(/amber/);
  await expect(card.getByText(NOTIFICATION_OLDEST.notificationNumber)).toHaveCount(0);
  await expect(card.getByText(NOTIFICATION_OTHER_PARTY.notificationNumber)).toHaveCount(0);
  await expect(card.getByText(NOTIFICATION_OTHER_SOURCE.notificationNumber)).toHaveCount(0);

  // Each notification number opens that notification record.
  await expect(card.getByTestId(`related-notification-link-${NOTIFICATION_NEWEST.id}`))
    .toHaveAttribute('href', `/notifications?record=${NOTIFICATION_NEWEST.id}`);

  // View all keeps the party's source filter.
  await expect(card.getByTestId('related-notifications-view-all')).toHaveAttribute(
    'href',
    `/notifications?sourceType=PARTY&sourceId=${FIRST_ID}`
  );
  await expect(card).toContainText('opens the Notifications queue filtered to this party');

  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toEqual({
    method: 'GET',
    path: '/api/v1/notifications',
    sourceType: 'PARTY',
    sourceId: FIRST_ID,
    tenant: TENANT,
    book: null
  });

  // Selecting another party refetches notifications for its source id.
  await page.getByRole('button', { name: `Open record ${SECOND_NUMBER}` }).click();
  await expect(page.getByRole('heading', { name: SECOND_NUMBER })).toBeVisible();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].sourceType).toBe('PARTY');
  expect(requests[1].sourceId).toBe(SECOND_ID);
  expect(requests[1].tenant).toBe(TENANT);
  await expect(card.getByTestId('related-notifications-count')).toHaveText('1 notification');
  await expect(card.getByTestId('related-notification-row')).toHaveCount(1);
  await expect(card).toContainText('Second party notice');
});

test('accepts an {items} envelope and renders a single notification', async ({ page }) => {
  await mockPartyApi(page, {
    notifications: [notification({ status: 'SENT' })],
    notificationsEnvelope: true,
    notificationsTotal: 1
  });

  await page.goto(`/?record=${FIRST_ID}`);
  await expect(page.getByRole('heading', { name: FIRST_NUMBER })).toBeVisible();

  const card = page.getByTestId('related-notifications');
  await expect(card.getByTestId('related-notifications-count')).toHaveText('1 notification');
  await expect(card.getByTestId('related-notification-row')).toHaveCount(1);
  await expect(card.getByTestId('related-notification-row')).toContainText('NTF-2026-000000001');
  await expect(card.getByTestId('related-notification-row'))
    .toContainText('2026-10-18 12:00:00 UTC');
  await expect(card.getByTestId('related-notifications-more')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('shows the empty state without disturbing the party record', async ({ page }) => {
  await mockPartyApi(page, { notifications: [] });

  await page.goto(`/?record=${FIRST_ID}`);
  await expect(page.getByRole('heading', { name: FIRST_NUMBER })).toBeVisible();

  const card = page.getByTestId('related-notifications');
  await expect(card.getByTestId('related-notifications-count')).toHaveText('0 notifications');
  await expect(card.getByTestId('related-notifications-empty'))
    .toHaveText('No notifications reference this party yet.');
  await expect(card.getByRole('table')).toHaveCount(0);
  await expect(card.getByTestId('related-notifications-more')).toHaveCount(0);

  // The card is still a working hand-off, and the record is untouched.
  await expect(card.getByTestId('related-notifications-view-all')).toHaveAttribute(
    'href',
    `/notifications?sourceType=PARTY&sourceId=${FIRST_ID}`
  );
  await expect(page.getByTestId('party-status')).toHaveText('ACTIVE');
  await expect(page.getByTestId('summary-status')).toHaveText('ACTIVE');
  await expect(page.getByTestId('party-policies')).toBeVisible();
  await expect(page.getByTestId('party-documents')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('contains a Notifications failure inside the card', async ({ page }) => {
  await mockPartyApi(page, {
    notificationsStatus: 503,
    notifications: {
      title: 'Notifications expert unavailable',
      status: 503,
      code: 'NOTIFICATIONS_UNAVAILABLE',
      detail: 'The Notifications expert is unavailable; retry later.'
    }
  });

  await page.goto(`/?record=${FIRST_ID}`);
  await expect(page.getByRole('heading', { name: FIRST_NUMBER })).toBeVisible();

  const card = page.getByTestId('related-notifications');
  const error = card.getByTestId('related-notifications-error');
  await expect(error).toContainText('Related notifications are temporarily unavailable');
  await expect(error).toContainText('The Notifications expert is unavailable; retry later.');
  await expect(error).toContainText('The party record is unaffected.');
  await expect(card.getByTestId('related-notifications-count')).toHaveText('—');
  await expect(card.getByRole('table')).toHaveCount(0);
  await expect(card.getByTestId('related-notifications-view-all')).toBeVisible();

  // The failure never becomes a page-level alert or replaces the record, and
  // identifiers, addresses, and the status action keep working.
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByTestId('party-status')).toHaveText('ACTIVE');
  await expect(page.getByTestId('summary-status')).toHaveText('ACTIVE');

  await page.getByRole('tab', { name: 'Identifiers' }).click();
  await expect(page.getByTestId('identifiers-empty')).toBeVisible();

  await page.getByRole('tab', { name: 'Names & Addresses' }).click();
  await expect(page.getByRole('heading', { name: 'Names' })).toBeVisible();
  await expect(page.getByTestId('addresses-empty')).toBeVisible();

  await page.getByRole('tab', { name: 'Overview' }).click();
  await expect(page.getByTestId('party-status')).toHaveText('ACTIVE');
  await expect(page.getByTestId('change-status')).toBeEnabled();
});

test('renders the party while the Notifications API is still in flight', async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  await mockPartyApi(page, {
    notifications: RELATED,
    notificationsGate: gate
  });

  try {
    await page.goto(`/?record=${FIRST_ID}`);

    // The record and its existing Overview cards are usable before notifications resolve.
    await expect(page.getByRole('heading', { name: FIRST_NUMBER })).toBeVisible();
    await expect(page.getByTestId('party-status')).toHaveText('ACTIVE');
    await expect(page.getByTestId('party-policies')).toBeVisible();
    await expect(page.getByTestId('party-documents')).toBeVisible();

    const card = page.getByTestId('related-notifications');
    await expect(card.getByTestId('related-notifications-loading')).toHaveText(
      'Loading related notifications…'
    );
    await expect(card.getByTestId('related-notifications-count')).toHaveText('…');
  } finally {
    release();
  }

  const card = page.getByTestId('related-notifications');
  await expect(card.getByTestId('related-notifications-count')).toHaveText('4 notifications');
  await expect(card.getByTestId('related-notification-row')).toHaveCount(3);
});

test('opens a notification record and the filtered Notifications queue', async ({ page }) => {
  await mockPartyApi(page, {
    notifications: [notification({ id: NOTIFICATION_NEWEST.id })]
  });

  await page.goto(`/?record=${FIRST_ID}`);
  const card = page.getByTestId('related-notifications');
  await expect(card).toBeVisible();

  await card.getByTestId(`related-notification-link-${NOTIFICATION_NEWEST.id}`).click();
  await expect(page).toHaveURL(
    new RegExp(`/notifications\\?record=${NOTIFICATION_NEWEST.id}$`)
  );

  await page.goto(`/?record=${FIRST_ID}`);
  await expect(page.getByTestId('related-notifications')).toBeVisible();
  await page.getByTestId('related-notifications-view-all').click();
  await expect(page).toHaveURL(
    new RegExp(`/notifications\\?sourceType=PARTY&sourceId=${FIRST_ID}$`)
  );
});
