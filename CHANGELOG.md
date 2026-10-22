# Changelog

All notable changes to this repository are documented here.

The format is based on Keep a Changelog and the project uses Semantic Versioning.

## [Unreleased]

### Added

- Repository baseline.
- Party operational record: queue filtering, `?record=` selection, registration,
  shared-party context, and direct-book related claim links.
- "Policies for this party" card on Overview. Selecting a party requests
  `GET /api/v1/policies?insuredPartyId=<id>&page=0&size=5` with `X-EIA-Tenant`
  and `X-EIA-Book: DIRECT`, then links each row to `/policy?record=<id>` with
  policy number, product, and status. Empty and failed lookups render inline
  without blocking the party record.
- Event-derived Activity timeline. Selecting a party requests
  `GET /api/v1/events/aggregate/<partyId>?limit=50` with `X-EIA-Tenant` and
  renders newest-first events with a readable event type, delivery status,
  aggregate version, and payload facts (party type, status, name). Loading,
  empty, and failure states are card-local, and the timeline refetches for
  each selected party or on demand. Events are append-only; the party record
  remains the source of truth.
- Party identifiers. The Identifiers tab reads
  `GET /api/v1/parties/<id>/identifiers` and lists type, value, issuing
  authority, effective date, and created timestamp. The add form validates
  required fields and posts `identifierType`, `value`, `issuingAuthority`, and
  `effectiveDate` to the same path.
- Party addresses. The Names & Addresses tab reads
  `GET /api/v1/parties/<id>/addresses` and lists type, lines, city,
  state/region, postal code, and country. The add form validates required
  fields, normalizes the country code, and posts `addressType`, `line1`,
  `line2`, `city`, `state`, `postalCode`, and `country`.
- List failures, validation problems, and duplicate (409) responses stay inside
  the identifiers or addresses section. The party record and companion
  sections remain usable, and conflicts point at the existing entries.
- Party lifecycle status changes. The header action opens a dialog with the
  current status and every other `PartyStatus` as a target, plus an optional
  reason of up to 500 characters. It sends
  `PATCH /api/v1/parties/<id>/status` with `{status, reason?}` and the detail
  read's `If-Match`, refreshes the party, reloads the activity timeline, and
  shows a notice. A 409/412 conflict keeps the dialog open with the refreshed
  current status. The dialog explains that `INACTIVE`, `BLOCKED`, and
  `RESTRICTED` can stop new claims, policies, and payments while existing
  records are unchanged.
- Related-notifications Overview card. Selecting a party fetches
  `GET /api/v1/notifications?sourceType=PARTY&sourceId=<id>` with the tenant
  header and shows the total count plus the three newest notifications (number,
  subject, delivery status, and creation time, newest first). Each number opens
  `/notifications?record=<id>`, and **View all notifications** opens the
  Notifications queue filtered to this party
  (`/notifications?sourceType=PARTY&sourceId=<id>`). Rows that explicitly name
  another source are dropped, an `{ items }` envelope is accepted, and loading,
  empty, and failure states stay inside the card so a slow or unavailable
  Notifications service never blocks the party record or its tabs.
- Playwright coverage for related notifications: the source query and tenant
  header, the count and newest-three preview, record and filtered-queue links,
  refetching on selection, the envelope and single-notification case, the empty
  state, a contained 503 that leaves status and the identifiers/addresses tabs
  usable, and rendering the party while the lookup is in flight.

### Changed

- Replaced the identifier, address, and status-transition availability caveats
  with the implemented master-data and lifecycle sections and their downstream
  context.
