# Coverage: redaction-and-retention

Docs: `packages/dms-automation/docs/3.configuration.md` (Credentials in runs, `runs.*`), `docs/6.faq.md`, `docs/4.usage/4.runs.md`, `skills/dms-automation/SKILL.md`. Journeys are in `journeys/redaction-and-retention.mjs` (+ `journeys/parts/redaction-*.mjs`, `retention.mjs`).

| Source | Documented behaviour | Journey | Check |
| --- | --- | --- | --- |
| 3.configuration.md:11 | `runs.retentionDays` defaults to 30 | runs-older-than-the-retention-are-deleted-when-the-module-starts | default: 30 days (the runs kept) |
| 3.configuration.md:11 | Days a run is kept; runs 30 days + 2 h old are deleted, 29 d 22 h kept | runs-older-than-the-retention-are-deleted-when-the-module-starts | default: 30 days; the runs kept |
| 3.configuration.md:11 | Test runs and re-runs are deleted with the others | runs-older-than-the-retention-are-deleted-when-the-module-starts | the runs kept (the 30d+2h test and rerun gone) |
| 3.configuration.md:11 | `0` keeps every run | runs-older-than-the-retention-are-deleted-when-the-module-starts | retentionDays 0 keeps every run, however old |
| 3.configuration.md:11 | Another N keeps N days | runs-older-than-the-retention-are-deleted-when-the-module-starts | retentionDays 7 |
| 3.configuration.md:11 | The leader deletes older runs when the module starts | runs-older-than-the-retention-are-deleted-when-the-module-starts | the runs kept (after a backend restart) |
| 3.configuration.md:11, 6.faq.md:48 | ... and every hour after | Not driven | needs a wait of an hour (or a clock); only the start purge is driven |
| 3.configuration.md:11 | Only the leader instance purges | Not driven | needs Redis and a second instance; `formal-leader-triggers` covers leadership |
| 6.faq.md:48 | 30 days by default, 0 keeps every run | runs-older-than-the-retention-are-deleted-when-the-module-starts | default; retentionDays 0 |
| 2.procedures.md:62 | Deleting a procedure leaves its runs until retention | runs-older-than-the-retention-are-deleted-when-the-module-starts | the procedure stays; (the run history of a deleted procedure: view-runs journey, deleted procedure still named) |
| 4.runs.md:21 | Footer by retention value | the-retention-footer-says-how-long-runs-are-kept (runs) | the footer sentence by configuration |
| 1.overview.md:28 (usage) | previous year comparison needs retentionDays 395 or more | Not driven | owned by the overview feature (E1) |
| 3.configuration.md:12 | `runs.sensitiveNames` default `[]` | runs-sensitive-names-add-to-the-built-in-credential-names | without the option |
| 3.configuration.md:12 | Names containing a configured string are credentials | runs-sensitive-names-add-to-the-built-in-credential-names | a new run: names containing a configured string are redacted |
| 3.configuration.md:12 | Compared case-insensitively | runs-sensitive-names-add-to-the-built-in-credential-names | (Tenant-Ref vs x-tenant-ref-id; CUSTOMER vs My-Customer-Code, Customer_Id) |
| 3.configuration.md:12 | They add to the built-in list | runs-sensitive-names-add-to-the-built-in-credential-names | Authorization still redacted |
| 3.configuration.md:12 | A run stores, shows and replays these values as `[redacted]` | runs-sensitive-names-add-to-the-built-in-credential-names | stored payload; its re-run confirmation names the newly redacted headers |
| 6.faq.md:40 | To redact more names add them to `runs.sensitiveNames` | runs-sensitive-names-add-to-the-built-in-credential-names | with runs.sensitiveNames |
| design-v2-grill-me-2.md:237 | Older runs included are redacted | runs-sensitive-names-add-to-the-built-in-credential-names | the older run reads redacted: payload; error; log; trace |
| 3.configuration.md:18 | A run keeps the headers and query its webhook received, except credential values | every-built-in-credential-name-is-stored-redacted-whatever-its-case | the stored payload, every name redacted, every other name kept |
| 3.configuration.md:18 | ... for events from a trigger | a-trigger-event-keeps-its-headers-and-query-redacted-like-run-now | stored redacted, other values kept |
| 3.configuration.md:18 | Webhook calls themselves | Not driven | webhook calls answer 500 in this playground (the cached `@antelopejs/api` 1.6.0 has no `ReadBody`); the payload shape is the same through Run now and the event trigger |
| 3.configuration.md:18 | Names compared case-insensitively | every-built-in-credential-name-is-stored-redacted-whatever-its-case | the stored payload (AUTHORIZATION, COOKIE, AUTH, Key, SIG, accessTOKEN, X_API_KEY, X-AUTH, Stripe-KEY) |
| 3.configuration.md:20 | Exact names Authorization, Proxy-Authorization, Cookie, Set-Cookie, auth, key, sig | every-built-in-credential-name-is-stored-redacted-whatever-its-case | the stored payload; near misses author, authorizations, key-id, signal, design, sigma stay |
| 3.configuration.md:21 | Contains token | every-built-in-credential-name-is-stored-redacted-whatever-its-case | x-token, accessTOKEN, tokens |
| 3.configuration.md:21 | Contains secret | every-built-in-credential-name-is-stored-redacted-whatever-its-case | client_secret, X-Secret-Thing |
| 3.configuration.md:21 | Contains signature | every-built-in-credential-name-is-stored-redacted-whatever-its-case | X-Signature |
| 3.configuration.md:21 | Contains hmac | every-built-in-credential-name-is-stored-redacted-whatever-its-case | x-hub-HMAC-sha256 |
| 3.configuration.md:21 | Contains password | every-built-in-credential-name-is-stored-redacted-whatever-its-case | Password |
| 3.configuration.md:21 | Contains passwd | every-built-in-credential-name-is-stored-redacted-whatever-its-case | db_passwd (pass and passenger stay) |
| 3.configuration.md:21 | Contains session | every-built-in-credential-name-is-stored-redacted-whatever-its-case | sessionid, X-Session-Id |
| 3.configuration.md:21 | Contains apikey, api-key, api_key | every-built-in-credential-name-is-stored-redacted-whatever-its-case | X-ApiKey, x-api-key, X_API_KEY |
| 3.configuration.md:21 | Contains accesskey, access-key, access_key | every-built-in-credential-name-is-stored-redacted-whatever-its-case | accesskey, Access-Key-Id, aws_access_key_id |
| 3.configuration.md:22 | Starts with x-auth | every-built-in-credential-name-is-stored-redacted-whatever-its-case | X-Auth-User, x-authentication, X-AUTH (xauth, x-aut stay) |
| 3.configuration.md:22 | Ends with -key or _key | every-built-in-credential-name-is-stored-redacted-whatever-its-case | x-custom-key, My_Key, Stripe-KEY (keyboard, monkey, my-keys stay) |
| 3.configuration.md:23 | Contains a string of `runs.sensitiveNames` | runs-sensitive-names-add-to-the-built-in-credential-names | a new run |
| 3.configuration.md:25 | The run itself receives the full values | every-built-in-credential-name-is-stored-redacted-whatever-its-case | the run itself received the full value (ledger) |
| 3.configuration.md:25 | Only the stored copy holds `[redacted]` | every-built-in-credential-name-is-stored-redacted-whatever-its-case | no secret value is stored anywhere in the run document |
| 3.configuration.md:12 | Stored, shown | every-built-in-credential-name-is-stored-redacted-whatever-its-case | the API shows the same payload; the trigger step of the trace |
| 3.configuration.md:12 | Replayed as `[redacted]` | every-built-in-credential-name-is-stored-redacted-whatever-its-case | the next test payload offered (last payload) is redacted; trace journeys re-run |
| 4.runs.md:41 | A re-run sends `[redacted]` and its confirmation says so | the-re-run-confirmation-warns-in-the-words-of-the-run | redacted line names the headers (trace feature) |
| 6.faq.md:38-40 | A re-run sends what the run stored; the confirmation lists the header names | the-re-run-confirmation-warns-in-the-words-of-the-run | the confirmation by API |
| SKILL.md:30 | A re-run sends `[redacted]` where the original held credentials | runs-sensitive-names-add-to-the-built-in-credential-names | its re-run confirmation names the newly redacted headers |
| TSDoc runProcedure.ts writeRun | A credential a step copied into inputs, output or message is not stored | a-credential-a-step-copied-into-its-log-is-not-stored | the stored log; the trace inputs; the stored document |
| TSDoc secretForms | Whole value, its token after the scheme, each cookie value | a-credential-a-step-copied-into-its-log-is-not-stored | the messages |
| TSDoc MIN_SECRET_LENGTH | Values shorter than 6 characters are not scrubbed | a-credential-a-step-copied-into-its-log-is-not-stored | the messages (12345 kept, 123456 replaced) |
| TSDoc MAX_TRIGGER_PAYLOAD_BYTES | A payload over 256 KB is replaced by a marker with its size and a 4096-character preview | a-payload-over-256-kb-is-kept-as-a-preview-and-cannot-be-re-run | the limit |
| 4.runs.md:37 | A payload too large to keep refuses the re-run | a-payload-over-256-kb-is-kept-as-a-preview-and-cannot-be-re-run | no re-run |
| i18n trace.payloadTooLarge | The trace says the payload was too large to keep and shows a preview | a-payload-over-256-kb-is-kept-as-a-preview-and-cannot-be-re-run | the trace |
| TSDoc lastPayloadOf | Run now offers the newest payload kept and says a newer one was too large | a-payload-over-256-kb-is-kept-as-a-preview-and-cannot-be-re-run | Run now offers the newest payload that was kept |
| TSDoc runs-table errorContains | An older run holding a credential is left out of the error search | Not driven | the search by error text is driven for stored-after runs; the leave-out needs a payload read back through the database regex, covered by `tests/` only |
