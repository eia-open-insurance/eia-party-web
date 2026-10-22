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

### Changed

- Replaced the identifier and address availability caveats with the
  master-data sections and context. The status-transitions limitation is still
  documented because the Party API does not expose lifecycle transitions.
