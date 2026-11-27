# Norfleet Connect contracts (Billy as provider)

Billy serves `billy.obligations` v1.0.0 to Norfleet One at `/api/connect/v1/obligations` (signed GET, see
`docs/NORFLEET-ONE-BRIDGE.md`). These files are copies of Norfleet One's pinned consumer contracts
(`norfleet-crm/app/contracts`). Change a contract only together with Norfleet One: a new optional field is a minor
version, anything else a new major version served side by side. `tests/db/connect.test.ts` checks every record the
endpoint serves against `billy/obligations.v1.schema.json`, and the fixtures' poison records against the same rules.
