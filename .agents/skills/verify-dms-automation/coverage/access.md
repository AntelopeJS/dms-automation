# Coverage: access

Journey ids are `access/<id>`.

| Source | Claim | Journey | Check |
|---|---|---|---|
| 1.introduction.md:51 | The Automation pages sit in the Modules group, which only the platform owner sees | a-member-cannot-open-the-automation-pages | each page lands a member on /settings; /modules is 403 Forbidden |
| 1.introduction.md:51 | Every route of the API answers the platform owner only | a-member-without-permissions-gets-403-owner-only-on-every-route | every route and method: 403 Owner-only (runs table: missing permission text) |
| SKILL.md:15 | Pages are owner-only | a-member-cannot-open-the-automation-pages | the six paths for a plain member and one holding page permissions |
| SKILL.md:17 | API under /api/automation is owner-only | a-member-without-permissions-gets-403-owner-only-on-every-route | page permissions do not help; the owner passes the guard on the same routes |
| 1.introduction.md:51 | The owner opens the pages | a-member-cannot-open-the-automation-pages | owner sees Overview and Procedures |
| 1.introduction.md:51 | No session means no access | every-automation-route-answers-401-without-a-session | 401 No jwt token provided on every route; forged token 401 |
| (implied) | A refused call changes nothing | every-automation-route-answers-401-without-a-session; a-member-without-permissions-gets-403-owner-only-on-every-route | the procedure is untouched |
| (implied) | Wrong methods stay 404 for a member | a-member-without-permissions-gets-403-owner-only-on-every-route | PATCH/DELETE/PUT/POST 404 |
