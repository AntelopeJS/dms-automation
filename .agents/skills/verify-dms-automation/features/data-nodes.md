---
covers:
  - packages/dms-automation/src/runtime/builtins/data/**
  - packages/dms-automation/src/runtime/resolveInputs.ts
  - packages/dms-automation/src/routes/data-node-types.ts
  - packages/dms-automation/src/types/dataValue.ts
docs:
  - packages/dms-automation/docs/1.introduction.md
  - packages/dms-automation/docs/4.usage/3.builder.md
  - packages/dms-automation/docs/4.usage/5.library.md
  - packages/interface-dms-automation/docs/1.index.md
---

# Data nodes

Data nodes compute values that data edges wire into the fields of other steps: Constants, Math, Comparison, Logic, Text, Objects and JSON, plus the data nodes a module registers. Every journey evaluates the nodes in a procedure (one Log step per case receives the node's output as its `value`) and compares the received value, and its type tag, with the documented one. The cases are tables in `journeys/parts/data-cases-a.mjs` and `data-cases-b.mjs`; the name of a check is the label of its case.

## Sub-features

- `constants-emit-their-typed-value-or-the-default-of-their-type`: Text, Number, True or false and JSON constants with their values and with none.
- `math-nodes-compute-and-fail-by-name`: all 14 math nodes, text operands, division and remainder by 0, and 12 failures whose messages name the node, the port and the value.
- `comparison-nodes-compare-numbers-text-and-kinds`: the six comparisons in auto, number and text modes, kinds that only equal themselves, alphabetical order, and number mode failures.
- `logic-nodes-read-false-0-and-empty-text-as-false`: And, Or, Exactly one and Not on booleans, numbers, empty values and texts.
- `text-nodes-count-characters-as-a-reader-does`: nine text nodes with accents, CJK, emoji, flags and combining accents.
- `object-nodes-read-and-write-fields-by-path`: Get, Set, field names and values, Merge, paths, inherited keys, non-objects.
- `json-nodes-read-and-write-json-text`: Read JSON and Write JSON, valid and invalid text, pretty.
- `data-edges-feed-fields-over-their-settings-and-defaults`: chains, wired over configured over default, missing ports, trigger payload and action outputs as sources, a node read twice evaluated once.
- `a-cycle-of-data-nodes-is-refused-naming-the-nodes`: Run now answers 400 with the cycle.
- `the-library-lists-every-built-in-data-node-with-its-ports`: `GET /data-node-types`, ids by category, ports, settings, the compare mode.
- `a-module-data-node-applies-defaults-merges-settings-and-must-return-an-object`: the fixture's `verify.upper`, `verify.suffix`, `verify.bad-data`, `verify.throwing-data`, and a type unregistered then registered again.
- `the-library-words-each-data-node-as-the-docs-do`: the Library's Data nodes tab in the browser, 44 name and description pairs.

## How to get to it (user POV)

- The builder palette's Data group and the Library's Data nodes tab (`/modules/automation/library?tab=dataNodes`).

## Driving it with dms-control

```bash
dms-control journey "$RUN" data-nodes
```

## Gotchas

- A data node's output reaches a step through a data edge from its port: constants output `value`, the others `result`.
- A data node that fails fails the step that reads it, so the failing cases wire to a Log step and read the run's error and failed node.
- A cycle and an unregistered type are caught by the graph's validation: Run now answers 400 with the issues, the runtime messages for them are not reachable.
- Do not read a data node inside a loop in a new journey: the node keeps its first value (issue draft `dms-automation-data-node-stale-in-loop.md`).
