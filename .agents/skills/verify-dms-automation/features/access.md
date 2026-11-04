---
covers:
  - packages/dms-automation/src/routes/index.ts
  - packages/dms-automation/src/pages/procedures.ts
  - packages/dms-automation/src/data/procedures-table.ts
  - packages/dms-automation/src/data/runs-table.ts
  - packages/dms-automation/src/routes/*-types.ts
  - packages/dms-automation/src/routes/procedures.ts
docs:
  - packages/dms-automation/docs/1.introduction.md
  - packages/dms-automation/skills/dms-automation/SKILL.md
---

# Access

The module is the platform owner's: every API route answers the owner only and the pages are in the owner-only Modules group.

## Sub-features

- `every-automation-route-answers-401-without-a-session`: 55 routes, each method, plus a forged token.
- `a-member-without-permissions-gets-403-owner-only-on-every-route`: a plain member and one holding page permissions; the owner passes the guard; wrong methods are 404.
- `a-member-cannot-open-the-automation-pages`: pages redirect a member to Settings; the module list is 403.

## How to get to it (user POV)

- Sign in as a member and open `/modules/automation/procedures`.

## Driving it with dms-control

```bash
dms-control journey "$RUN" access
```

## Gotchas

- The runs table routes name their permission (`modules.automation.runs.table.list`); every other route says `Owner-only`.
- Members are created by `parts/access-members.mjs` through an invite and sign-up.
