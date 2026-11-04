---
covers:
  - packages/dms-automation/src/runtime/builtins/actions/**
  - packages/dms-automation/src/runtime/builtins/nodes/action.ts
  - packages/dms-automation/src/routes/action-types.ts
  - packages/dms-automation/src/runtime/typeSwitches.ts
docs:
  - packages/dms-automation/docs/3.configuration.md
  - packages/dms-automation/docs/4.usage/3.builder.md
  - packages/dms-automation/docs/4.usage/5.library.md
  - packages/interface-dms-automation/docs/1.index.md
---

# Actions

The built-in Log and HTTP request actions, the rules every action follows (the object-or-nothing result, throws, the execution context, a disabled or unregistered type) and `httpRequest.blockPrivateNetwork`. HTTP requests go to the verification playground's sink (`GET /verify-auto/sink`), which echoes what it received and answers a given status, redirect, size, content type or delay.

## Sub-features

- `log-writes-its-message-and-value-to-the-run-and-the-server-log`: levels, default level, structured values, output, the backend log line and a refused level.
- `an-action-sees-its-ids-and-logs-through-ctx`: `procedureId`, `runId`, `nodeId`, `dryRun` (false in a run, true in a test) and `ctx.log`.
- `an-action-resolves-with-an-object-or-nothing`: object fields downstream, nothing, an array and a text refused with the documented text.
- `a-throw-fails-the-step-whatever-was-thrown`: an Error and seven non-Error values.
- `a-step-of-a-disabled-or-unregistered-action-type-fails`: the library switch, the typeDisabled warning, the unknownType refusal.
- `http-request-sends-the-method-headers-and-body-it-is-given`: five methods, defaults, headers, JSON and text bodies, bodyless GET.
- `http-request-hands-on-status-headers-body-and-parsed-json`: status, headers, body, json for seven content types, redirects, credentials masked in the stored run only.
- `http-request-publishes-its-fields-and-defaults`: the schema defaults and limits.
- `http-request-fails-outside-200-299-and-says-what-to-check`: 13 statuses with their hints, 500 and 4000 character limits, failOnStatus.
- `http-request-says-in-words-why-it-got-no-answer`: closed port, unknown host, forbidden port, cut connection, timeouts.
- `http-request-refuses-urls-and-headers-it-cannot-use`: URL and headers errors.
- `http-request-caps-the-timeout-at-5-minutes-and-the-response-at-2-mb`: 2 MB exactly and one byte more, with and without a content length; the cap and its warning.
- `http-request-waits-30-seconds-by-default`: a 28 s answer arrives, a 32 s answer does not (about 33 s).
- `block-private-network-refuses-every-internal-address-range`: the option on, every range of the configuration page with edge addresses, their neighbours let through, `localhost`.
- `the-library-describes-the-built-in-actions`: the Library's Actions tab in the browser.

## How to get to it (user POV)

- The builder palette's Actions group and the Library's Actions tab (`/modules/automation/library?tab=actions`).

## Driving it with dms-control

```bash
dms-control journey "$RUN" actions
```

## Gotchas

- `block-private-network-refuses-every-internal-address-range` restarts the backend with `VERIFY_AUTO_BLOCK_PRIVATE=1` and again without it. The sink is on loopback, so with the option on no request can succeed: the redirect limit of 5 and the limits "whatever the option says" cannot be driven (see the coverage file).
- The sink needs the `chunked`, `ctype`, `reset` routes added to `playground/src/sink.ts` for this feature.
- `http-request-waits-30-seconds-by-default` reads the run through `raw`, because the journey harness's API client gives up at 30 s.
- Addresses next to a blocked range are connected to with a 1.2 s timeout; the check is that the failure is not the private-network refusal.
