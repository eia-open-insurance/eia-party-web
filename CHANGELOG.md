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
