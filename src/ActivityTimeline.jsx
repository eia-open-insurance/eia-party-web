import React from 'react';
import {
  eventStatus,
  eventStatusTone,
  eventTimestamp,
  eventVersionLabel,
  payloadFacts,
  readableEventType
} from './events.js';

function ActivityItem({ event }) {
  const status = eventStatus(event) || 'UNKNOWN';
  const facts = payloadFacts(event);
  const timestamp = eventTimestamp(event);
  const versionLabel = eventVersionLabel(event);

  return (
    <li
      className="eia-timeline-item"
      data-testid="activity-item"
      data-event-id={event.eventId || undefined}
    >
      <div className="eia-timeline-head">
        <time
          className="eia-activity-time"
          data-testid="activity-time"
          dateTime={timestamp.iso || undefined}
          title={event.occurredAt || undefined}
        >
          {timestamp.label}
        </time>
        <strong
          className="eia-activity-type"
          data-testid="activity-type"
          title={event.eventType || undefined}
        >
          {readableEventType(event.eventType)}
        </strong>
        <span
          className={`eia-pill ${eventStatusTone(status)}`}
          data-testid="activity-status"
        >
          {status}
        </span>
        <span
          className="eia-mono eia-activity-version"
          data-testid="activity-version"
          title={event.aggregateVersion !== undefined
            ? `Aggregate version ${event.aggregateVersion}`
            : 'Event version'}
        >
          {versionLabel}
        </span>
      </div>

      {facts.length > 0 && (
        <ul className="eia-activity-facts" aria-label="Event payload summary">
          {facts.map((fact) => (
            <li
              key={fact.key}
              className="eia-activity-fact"
              data-testid={`activity-fact-${fact.key}`}
            >
              <span className="eia-activity-fact-label">{fact.label}</span>{' '}
              <b>{fact.value}</b>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Card-local activity timeline for the selected party. Loading, error, and
 * empty states render inside the card so an unavailable event service never
 * blocks the party record or the other tabs.
 */
export default function ActivityTimeline({ items = [], loading = false, error = '', onRefresh }) {
  const countLabel = loading
    ? '…'
    : `${items.length} ${items.length === 1 ? 'event' : 'events'}`;

  return (
    <section
      className="eia-card eia-activity"
      data-testid="party-activity"
      aria-label="Party activity timeline"
    >
      <div className="eia-toolbar" style={{ marginBottom: 4 }}>
        <span className="eia-muted" data-testid="activity-count">{countLabel}</span>
        <span className="spacer" />
        <button
          type="button"
          className="eia-btn-secondary"
          data-testid="activity-refresh"
          onClick={() => {
            if (onRefresh) onRefresh();
          }}
          disabled={loading}
          aria-label="Refresh activity timeline"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <p
        className="eia-muted eia-activity-note"
        data-testid="activity-context-note"
        style={{ margin: 0 }}
      >
        Event-derived timeline: entries come from immutable party events, are append-only, and are
        never edited or removed. The party record remains the source of truth for current state.
      </p>

      {loading ? (
        <p className="eia-muted" data-testid="activity-loading" style={{ margin: '12px 0 0' }}>
          Loading activity…
        </p>
      ) : error ? (
        <p className="eia-muted" data-testid="activity-error" style={{ margin: '12px 0 0' }}>
          {error}
        </p>
      ) : items.length === 0 ? (
        <div className="eia-empty" data-testid="activity-empty" style={{ marginTop: 12 }}>
          No activity has been recorded for this party yet.
        </div>
      ) : (
        <ol
          className="eia-timeline"
          data-testid="activity-timeline"
          aria-label="Party event timeline"
        >
          {items.map((event, index) => (
            <ActivityItem
              key={event.eventId || `activity-${event.eventType || 'event'}-${index}`}
              event={event}
            />
          ))}
        </ol>
      )}
    </section>
  );
}
