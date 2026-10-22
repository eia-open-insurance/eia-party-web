# eia-party-web

- GitHub organization: `eia-open-insurance`
- Repository URL: https://github.com/eia-open-insurance/eia-party-web
- Type: Federated front-end
- Deployable: Yes
- Owner: Party
- Runtime: React 19 and Webpack 5
- Data store: None
- Depends on: eia-frontend/packages, eia-contracts, eia-platform/gateway

## Purpose

Party federated remote: screens, widgets, record tabs, and transaction composition. Party identity, roles, merge, KYC/AML, sanctions, and consent.

## Implemented slice

The remote renders the shared Party operational record: a filterable register,
deep links via `?record=<id>` and `?new=1`, party registration, Overview /
Identifiers / Names & Addresses / Activity tabs, lifecycle status changes, and
cross-links to direct-book records.

On selection, the Overview tab reads the first five direct policies for the
party with
`GET /api/v1/policies?insuredPartyId=<id>&page=0&size=5` (`X-EIA-Tenant` and
`X-EIA-Book: DIRECT`). The "Policies for this party" card lists policy number,
product, and status, and opens `/policy?record=<id>`. The lookup is independent
of the party detail read: an empty result shows an inline empty state and a
failure shows an inline unavailable message, so the party record stays usable.

On selection, the Activity tab reads the party's aggregate event stream with
`GET /api/v1/events/aggregate/<partyId>?limit=50` and `X-EIA-Tenant`. The card
renders newest-first events with timestamp, a readable event type
(`party.party.created` becomes "Party created"), delivery status, aggregate
version, and payload facts (party type, status, name). Events are append-only
facts derived from the platform event stream; the party record remains the
source of truth. Loading, empty, and failure states stay inside the card and
are refreshed without changing the selected party.

The Identifiers tab lists the party's identifiers with
`GET /api/v1/parties/<id>/identifiers` (`X-EIA-Tenant`) and shows type, value,
issuing authority, effective date, and created timestamp. The add form posts
`{identifierType, value, issuingAuthority, effectiveDate}` to the same path.

The Names & Addresses tab keeps the core name fields and lists addresses with
`GET /api/v1/parties/<id>/addresses` and `X-EIA-Tenant`: address type, lines,
city, state/region, postal code, and country. The add form posts
`{addressType, line1, line2, city, state, postalCode, country}`.

Both add forms validate required fields before posting, and the country is
normalized to a 2- or 3-letter code. A duplicate (409), a validation problem, or
an unavailable list stays inside its section: the party record, the other tabs,
and the other section remain usable, and a conflict points the operator back at
the existing entries. Identifiers and addresses are party aggregate master data
referenced by claims, policies, and payments, so they are maintained on the
party rather than re-keyed downstream.

The party header's **Change status** action opens a dialog showing the current
status and a target select with every `PartyStatus` except the current one
(`PROSPECT`, `ACTIVE`, `INACTIVE`, `DECEASED`, `DISSOLVED`, `MERGED`,
`RESTRICTED`, `BLOCKED`). The operator may add a reason of up to 500 characters.
Submitting sends `PATCH /api/v1/parties/<id>/status` with
`{status, reason?}` and the `If-Match` value from the detail read (or the
quoted aggregate version), refreshes the party from the response, reloads the
event-derived activity timeline, and shows a notice. A 409/412 race keeps the
dialog open with the problem and the refreshed current status.

Status is a process gate: `INACTIVE`, `BLOCKED`, and `RESTRICTED` can stop new
claims, policies, and payments, while existing records keep their own facts and
history. The dialog and the Overview operations note both state the downstream
effect.

## Responsibilities

- Keep this repository focused on one deployable component or one platform concern.
- Follow the repository standard in `../CONVENTIONS.md` and the specification in `../../SPEC.md`.
- Publish and consume contracts through `eia-contracts`.
- Maintain README, CODEOWNERS, SECURITY, CHANGELOG, tests, and local verification.
- Contain no business logic in shared libraries or front-end remotes.

## Verification

- Lint and format
- Unit tests with 100% business-logic coverage where applicable
- Contract tests
- Integration or Playwright tests where applicable
- Security scan and SBOM
- Build and publish

## Notes

No business logic; all actions go through the domain service.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
