---
covers:
  - packages/dms-automation/src/runtime/builtins/triggers/webhook.ts
  - packages/dms-automation/src/runtime/webhookRoutes.ts
  - packages/dms-automation/src/routes/library.ts
  - packages/dms-automation/src/routes/procedureChecks.ts
  - packages/dms-automation/frontend-vue/app/components/WebhookEndpoint.vue
docs:
  - packages/dms-automation/docs/3.configuration.md
  - packages/dms-automation/docs/6.faq.md
  - packages/dms-automation/docs/4.usage/1.overview.md
  - packages/dms-automation/docs/4.usage/2.procedures.md
  - packages/dms-automation/docs/4.usage/5.library.md
---

# Webhooks

The API server serves each webhook under the path set on its trigger. The module refuses a path that is malformed, reserved, already served by a route, or held by another enabled procedure, runs the procedure on each call with the request as payload, and shows each webhook's full URL on the DMS `apiBaseUrl`.

## Sub-features

- `webhook-paths-follow-the-documented-rules`: a path must start with `/`, use only letters, digits and `- . _ ~ : /`, hold no empty, `.` or `..` segment, and not be `/api`, `/auth`, `/dms`, `/modules` or `/settings` or sit under one; the methods are GET, POST, PUT, DELETE and PATCH; an invalid path cannot be enabled.
- `a-webhook-on-the-same-route-as-an-enabled-procedure-is-refused`: the same method on the same path (trailing slash ignored) as another enabled procedure is refused naming it, a draft only warns, a paused procedure frees its path, a duplicate moves its webhooks to free paths, two webhooks of one procedure on one route are refused.
- `a-webhook-on-a-route-the-server-already-serves-is-refused`: a route the server answers on the same method and path (`:param` standing for any segment) refuses the webhook.
- `two-paths-are-the-same-when-their-segments-are-equal-or-a-param`: same segment count with each pair equal or one a `:param`: the procedure that arms second is Failing with the reason, the first keeps answering, and pausing the first lets the other arm.
- `a-called-webhook-starts-a-run-with-its-method-headers-query-body-and-params`: the call answers `{"ok":true}` and starts a run whose payload is the method, headers, query (repeated keys as lists), body (JSON, form, text) and params; the last payload; the 1 MiB body limit; wrong methods, unknown paths and the dashboard's server.
- `each-webhook-method-answers-and-the-method-is-in-the-payload`: GET, POST (the default), PUT, DELETE and PATCH webhooks, and a text body wired to a step arrives exactly.
- `a-webhook-answers-only-while-its-procedure-is-enabled-and-follows-its-edits`: draft, paused, deleted, edited away or restarted.
- `a-webhook-the-server-cannot-arm-makes-its-procedure-failing-with-the-reason`: a stored enabled procedure with an invalid path, a reserved path or a served route is Failing, with its reason on the Procedures page, the Overview banner and Needs attention.
- `the-webhook-url-is-built-on-the-api-base-url`: a public `apiBaseUrl`, one with slashes, an empty one and the default, in the API, the Builder's inspector (URL, curl example, hint) and the Library's Used by.
- `a-loopback-api-base-url-is-shown-as-it-is-with-a-hint`: `localhost`, `[::1]` and `127.x` are unconfigured, other hosts configured.
- `the-webhook-recipe-places-a-path-from-the-procedure-name`: New procedure with a webhook places `POST /webhooks/<name>` in lower case with dashes.

## How to get to it (user POV)

- A webhook trigger in the Builder, a Procedures row (Starts when), the Library's Triggers tab › Webhook › Used by, and a call to the API server's address.

## Driving it with dms-control

```bash
dms-control journey "$RUN" webhooks
```

## Gotchas

- The webhook routes need an API module that reads `RouteHandler.controller`, as the published `@antelopejs/api` 2.x does; an older one answers every webhook call 500 `Cannot read properties of undefined (reading 'constructor')` and the journeys end NOT VERIFIED. `dms-control up --env VERIFY_AUTO_API_PATH=<path of a local @antelopejs/api build>` runs another build (`playground/antelope.config.ts`).
- Import JSON, New procedure and Duplicate move a webhook path another procedure uses to a free one (`-2`, `-3`), so a journey that needs two procedures on one route saves the graph afterwards (`PUT /procedures/:id`) or stores the procedure in the database (`withProcedures`, `storeEnabled` in `parts/triggers-common.mjs`) and restarts the backend.
- Calls go to the API server with `callWebhook` (`parts/triggers-common.mjs`); the run is stored after the answer, so read it with `runsUntil`.
- The `apiBaseUrl` variants restart the backend once each (`VERIFY_AUTO_API_BASE_URL`: `default`, `empty` or a URL).
