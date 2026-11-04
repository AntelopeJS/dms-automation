# Coverage: cluster

Docs read: `docs/3.configuration.md` Clustering (cfg), `docs/1.introduction.md` requirements (intro), `docs/6.faq.md` (faq), `docs/4.usage/5.library.md` (lib), the `Config` TSDoc of `src/index.ts` (tsdoc), the module skill's `cluster.driver` lines (mskill). Journey ids are `cluster/<id>`.

| Source | Claim | Journey | Check |
|---|---|---|---|
| cfg:11-14, tsdoc Config.cluster | `cluster.driver` is `auto`, `redis` or `memory`, default `auto`; omitted means standalone | cluster-driver-auto-runs-standalone-without-redis | the default boot > the standalone line is logged once by the last boot; no warning about redis |
| cfg:68 | by default the module runs standalone; a single instance owns every trigger | cluster-driver-auto-runs-standalone-without-redis | driver auto > a singleton trigger is armed here at once (the instance is the leader); and it fires |
| cfg:72 | `auto`: Redis when a module provides `@antelopejs/interface-redis`, standalone otherwise | cluster-driver-auto-runs-standalone-without-redis | driver auto > the standalone line is logged once at info; no redis mode, no leader election line |
| cfg:72 | `auto` with Redis available | Not driven | the playground has no module providing `@antelopejs/interface-redis`, and no Redis server |
| cfg:73 | `redis` without the interface: the module logs a warning and runs standalone | cluster-driver-redis-without-the-interface-warns-and-runs-standalone | driver redis > one warning, at warn level, with the documented text; the warning comes before the mode line; the standalone checks |
| cfg:73 | `redis` with the interface: Redis mode, leader election, `cluster mode: redis (instance ...)` | Not driven | needs Redis; `formal-leader-triggers` covers leadership |
| cfg:74 | `memory`: standalone, even when a module provides Redis | cluster-driver-memory-runs-standalone-and-says-nothing-more | driver memory > the standalone checks; no warning is logged; nothing about redis |
| cfg:74 | `memory` with Redis provided | Not driven | needs a module providing the interface |
| cfg:76-79, ref:124 | each trigger type declares `singleton` (cron schedule, table watch) or `replicated` (webhook, manual trigger) | the-library-shows-each-trigger-with-its-cluster-mode | the modes by trigger id > the documented ones; every trigger has one of the two modes |
| cfg:78 | a singleton trigger fires once cluster-wide; only the elected leader activates it | cluster-driver-memory-runs-standalone-and-says-nothing-more | driver memory > a singleton trigger is armed here at once (the instance is the leader). The election itself is Not driven (needs Redis) |
| cfg:78 | leadership is a Redis lock with a 30-second TTL renewed every 10 seconds | the-leadership-numbers-in-the-docs-are-the-ones-of-the-code | the leadership numbers > the docs' TTL; the docs' renew interval |
| cfg:78 | another instance takes over when the leader stops | Not driven | needs two instances and Redis |
| cfg:79 | a replicated trigger activates on every instance, the load balancer routes each event to one | the-library-shows-each-trigger-with-its-cluster-mode | the modes by trigger id > the documented ones (replicated for the webhook and the manual trigger). The multi-instance behaviour is Not driven (needs Redis) |
| cfg:81 | an edit on one instance reaches the others over Redis pub/sub | Not driven | needs Redis and two instances |
| cfg:84, faq:52 | singleton triggers are not transactionally exactly-once: a missed occurrence up to the TTL, a double one up to a renew interval | the-leadership-numbers-in-the-docs-are-the-ones-of-the-code | the leadership numbers > the docs' warning repeats both. The misses and doubles themselves are Not driven (need a leader that dies) |
| cfg:11, faq:48 | the leader deletes older runs when the module starts and every hour after | the-leadership-numbers-in-the-docs-are-the-ones-of-the-code | the leadership numbers > the purge runs every hour, as the docs say. The deletion itself is owned by `redaction-and-retention` |
| intro:58, mreadme:Compatibility | `@antelopejs/interface-redis` is optional, only to run several instances | package/the-manifests-declare-skills-entry-points-and-ranges-that-agree | the README compatibility tables > module README row @antelopejs/interface-redis: supported is the declared range |
| lib:22 | the Library shows a trigger's cluster mode after its id, as Replicated across instances or Runs on one instance | the-library-shows-each-trigger-with-its-cluster-mode | manual, schedule.cron, webhook and verify.leader-event in the Library > id · <type> · cluster · <mode>; the card text |
| mskill:Config | `cluster.driver` (`auto` \| `redis` \| `memory`) | package/the-module-skill-statements-name-things-that-exist | config keys > the cluster driver values |
| mskill:Gotchas | in a Redis cluster, singleton triggers (cron, table watch) are fire-once, not exactly-once | Not driven | needs Redis |
| src/index.ts | the log line `cluster mode: standalone (memory)` and the warning text | cluster-driver-auto-runs-standalone-without-redis; cluster-driver-redis-without-the-interface-warns-and-runs-standalone | the standalone line; the warning with the documented text |
