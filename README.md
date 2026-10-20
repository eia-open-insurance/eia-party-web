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
Identifiers / Names & Addresses / Activity tabs, and cross-links to direct-book
records.

On selection, the Overview tab reads the first five direct policies for the
party with
`GET /api/v1/policies?insuredPartyId=<id>&page=0&size=5` (`X-EIA-Tenant` and
`X-EIA-Book: DIRECT`). The "Policies for this party" card lists policy number,
product, and status, and opens `/policy?record=<id>`. The lookup is independent
of the party detail read: an empty result shows an inline empty state and a
failure shows an inline unavailable message, so the party record stays usable.

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
