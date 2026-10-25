# Contributing to EVOLT

## Ground rules

1. **No invented data.** Never present demo or generated records as real, and never add a
   metric the data cannot support. If a figure cannot be calculated, say why in the UI.
2. **Evidence before conclusions.** Every finding must be traceable to a rule, a calculation
   or an evaluated model output. A detected pattern is never presented as a confirmed fault.
3. **Test what you change.** Calculations go in pure functions under `src/features/` with unit
   tests. API changes need an integration test; user-visible flows need a Playwright test.

## Workflow

```bash
npm install
npm run lint && npm run typecheck
npm run test:unit
npm run test:integration   # needs TEST_DATABASE_URL in .env.test.local
npm run build && npm run test:e2e   # needs E2E_DATABASE_URL in .env.test.local
```

- Schema changes: add a new forward-only SQL file in `database/migrations/` and register it in
  `meta/_journal.json`. Never edit an applied migration.
- Never commit `.env.local`, `.env.test.local`, `.evolt/` or build output.
- Keep the driver and company experiences separate: driver pages live under `src/app/driver`,
  operator pages under `src/app/company`.

## Reporting a security issue

Do not open a public issue. Contact the maintainer privately, with steps to reproduce.
