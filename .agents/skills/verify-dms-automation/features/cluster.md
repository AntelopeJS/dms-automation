---
covers:
  - packages/dms-automation/src/cluster/**
  - packages/dms-automation/src/index.ts
docs:
  - packages/dms-automation/docs/3.configuration.md
  - packages/dms-automation/docs/6.faq.md
  - packages/dms-automation/docs/4.usage/5.library.md
---

# Cluster

`cluster.driver` (`auto`, `redis`, `memory`) and what a single standalone instance does with it: the mode line in the backend log, the warning for `redis` without `@antelopejs/interface-redis`, the leader-only singleton triggers firing on the one instance, and the cluster mode every trigger shows in the Library. Everything that needs Redis is checked by `formal-leader-triggers`, not here.

## Sub-features

- `cluster-driver-auto-runs-standalone-without-redis`: by default and with `auto` the log says `cluster mode: standalone (memory)` once, no warning, and a singleton trigger arms and fires on the instance.
- `cluster-driver-memory-runs-standalone-and-says-nothing-more`: `memory` logs the mode line and no warning, and nothing about Redis.
- `cluster-driver-redis-without-the-interface-warns-and-runs-standalone`: `redis` without the interface logs the documented warning before the mode line and runs standalone.
- `the-library-shows-each-trigger-with-its-cluster-mode`: the library's trigger types and detail cards show `replicated` or `singleton` after the id and as Replicated across instances or Runs on one instance.
- `the-leadership-numbers-in-the-docs-are-the-ones-of-the-code`: the 30 second TTL, the 10 second renewal and the hourly purge the docs state are those of the code.

## How to get to it (user POV)

- `cluster: { driver: "auto" | "redis" | "memory" }` in the module's `config`; Library, then a trigger.

## Driving it with dms-control

```bash
dms-control journey "$RUN" cluster
```

## Gotchas

- The journeys restart the backend through `withConfig` with `VERIFY_AUTO_CLUSTER_DRIVER` and read the new lines of `logs/backend.log` from the size it had before the restart. The playground has no Redis, so leadership, handover, the bus and `cluster mode: redis (instance ...)` are not driven.
