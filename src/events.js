/**
 * Party activity-event helpers.
 *
 * The platform event-ingest service exposes the append-only event stream for
 * one aggregate. An event is a fact that *already happened*: the party record
 * remains the source of truth for current state, and nothing in this timeline
 * can change identity, status, or classification.
 *
 * `GET /api/v1/events/aggregate/{partyId}?limit=50` returns
 * `{ aggregateId, limit, items: [EventView] }`; `payload` is the canonical
 * event envelope with the event-specific facts in its `data` object. The page
 * is normalized and sorted here so the timeline stays newest-first regardless
 * of the order the service returns.
 */

export const ACTIVITY_LIMIT = 50;

/** Builds GET /api/v1/events/aggregate/{partyId}?limit=… for one record. */
export function activityEndpoint(partyId, limit = ACTIVITY_LIMIT) {
  const id = String(partyId || '').trim();
  if (!id) return '';
  return `/api/v1/events/aggregate/${encodeURIComponent(id)}?limit=${encodeURIComponent(limit)}`;
}

/** The aggregate endpoint returns `{ items }`; a bare array is tolerated too. */
export function eventItems(body) {
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.items)) return body.items;
  return [];
}

function eventTime(event) {
  const occurred = Date.parse(event && event.occurredAt);
  if (Number.isFinite(occurred)) return occurred;
  const received = Date.parse(event && event.receivedAt);
  return Number.isFinite(received) ? received : 0;
}

function numericVersion(value) {
  const version = Number(value);
  return Number.isFinite(version) ? version : -1;
}

/**
 * Newest first. The aggregate version and event id break timestamp ties so
 * two events recorded at the same instant keep a deterministic order.
 */
export function sortActivityEvents(items) {
  return items
    .filter((item) => item && typeof item === 'object')
    .slice()
    .sort((left, right) => {
      const byTime = eventTime(right) - eventTime(left);
      if (byTime !== 0) return byTime;

      const byVersion = numericVersion(right.aggregateVersion) - numericVersion(left.aggregateVersion);
      if (byVersion !== 0) return byVersion;

      return String(left.eventId || '').localeCompare(String(right.eventId || ''));
    });
}

const WORD_SEPARATOR = /[._\-\s]+/;

function capitalize(value) {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : '';
}

/**
 * Turns `party.party.created` into `Party created`: every separator is a word
 * break and adjacent repeated tokens collapse so the vertical prefix does not
 * stutter. Unknown names still produce a readable label from their last words.
 */
export function readableEventType(eventType) {
  const words = String(eventType || '')
    .split(WORD_SEPARATOR)
    .map((word) => word.trim().toLowerCase())
    .filter(Boolean);

  const deduped = [];
  for (const word of words) {
    if (deduped[deduped.length - 1] === word) continue;
    deduped.push(word);
  }

  if (deduped.length === 0) return 'Party event';
  return capitalize(deduped[0]) + (deduped.length > 1 ? ` ${deduped.slice(1).join(' ')}` : '');
}

export function eventStatus(event) {
  return String((event && event.status) || '').trim().toUpperCase();
}

/** Inbox delivery/processing status, distinct from the party status fact. */
export function eventStatusTone(status) {
  const value = String(status || '').trim().toUpperCase();
  if (['PROCESSED', 'APPLIED', 'ACCEPTED', 'CONFIRMED', 'DELIVERED', 'COMPLETED'].includes(value)) {
    return 'green';
  }
  if (['FAILED', 'REJECTED', 'ERROR', 'DEAD_LETTERED', 'DEAD_LETTER'].includes(value)) {
    return 'red';
  }
  if (['RECEIVED', 'PENDING', 'RETRYING', 'IN_PROGRESS'].includes(value)) return 'amber';
  return 'blue';
}

const TIMESTAMP_FORMAT = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
  timeZoneName: 'short'
});

/** Occurred-at timestamp rendered in UTC with an accessible ISO value. */
export function eventTimestamp(event) {
  const raw = String((event && event.occurredAt) || '').trim();
  const date = new Date(raw);
  if (!raw || Number.isNaN(date.getTime())) return { iso: '', label: '—' };
  return { iso: date.toISOString(), label: TIMESTAMP_FORMAT.format(date) };
}

/**
 * Version displayed on the timeline head: the aggregate version is the
 * ordering authority for the party stream; eventVersion is the fallback for
 * projections that only expose the envelope version.
 */
export function eventVersionLabel(event) {
  const aggregateVersion = Number(event && event.aggregateVersion);
  if (event && event.aggregateVersion !== null && event.aggregateVersion !== undefined
    && Number.isFinite(aggregateVersion)) {
    return `v${aggregateVersion}`;
  }
  const envelopeVersion = Number(event && event.eventVersion);
  if (Number.isFinite(envelopeVersion)) return `v${envelopeVersion}`;
  return '—';
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/** The event payload is the envelope object; tolerate a JSON string. */
export function eventPayload(event) {
  let payload = event && event.payload;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      return {};
    }
  }
  return asObject(payload) || {};
}

/**
 * Event facts live in the envelope's `data` object. Tests and projections may
 * also send the data object directly, so both shapes are accepted.
 */
export function eventData(event) {
  const payload = eventPayload(event);
  const data = asObject(payload.data);
  return data ? { ...payload, ...data } : payload;
}

function readPath(source, path) {
  let current = source;
  for (const segment of path.split('.')) {
    const object = asObject(current);
    if (!object || !Object.prototype.hasOwnProperty.call(object, segment)) return undefined;
    current = object[segment];
  }
  return current;
}

function textValue(source, paths) {
  for (const path of paths) {
    const value = readPath(source, path);
    if (value === undefined || value === null) continue;
    if (typeof value === 'object') continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

/**
 * The business facts carried by this event's payload: party type, status (a
 * transition when the event carries from/to), and name. Absent facts are
 * omitted rather than rendered as blanks, because not every event type
 * carries every fact.
 */
export function payloadFacts(event) {
  const data = eventData(event);
  const facts = [];

  const partyType = textValue(data, ['partyType', 'party.type', 'partyPartyType']);
  if (partyType) facts.push({ key: 'party-type', label: 'Party type', value: partyType });

  const from = textValue(data, ['from', 'fromStatus', 'previousStatus', 'oldStatus']);
  const to = textValue(data, ['to', 'toStatus', 'newStatus']);
  const status = textValue(data, ['status', 'partyStatus']);
  if (from && to) {
    facts.push({ key: 'status', label: 'Status', value: `${from} → ${to}` });
  } else if (from) {
    facts.push({ key: 'status', label: 'Status', value: `${from} →` });
  } else if (to || status) {
    facts.push({ key: 'status', label: 'Status', value: to || status });
  }

  const name = textValue(data, [
    'displayName',
    'partyName',
    'legalName',
    'name',
    'party.displayName',
    'party.name'
  ]);
  if (name) facts.push({ key: 'name', label: 'Name', value: name });

  return facts;
}
