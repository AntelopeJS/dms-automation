---
covers:
  - packages/dms-automation/package.json
  - packages/interface-dms-automation/package.json
  - packages/dms-automation/skills/**
  - packages/interface-dms-automation/skills/**
  - packages/dms-automation/README.md
  - packages/interface-dms-automation/README.md
  - packages/dms-automation/docs/.navigation.yml
  - packages/dms-automation/docs/4.usage/.navigation.yml
  - packages/dms-automation/frontend-vue/package.json
  - packages/dms-automation/frontend-vue/i18n/**
docs:
  - packages/dms-automation/docs/2.installation.md
  - packages/dms-automation/docs/1.introduction.md
  - packages/dms-automation/docs/5.extending.md
  - packages/interface-dms-automation/docs/1.index.md
---

# Package

What a project installs from the registry and what an agent reads: the module's and the interface's tarballs, the manifests and the compatibility tables, the two shipped skills with their cases, and the docs pages with their links and code blocks.

## Sub-features

- `npm-pack-holds-what-package-json-files-lists-for-both-packages`: each tarball holds its build, skills, docs or dashboard layer and every entry point the manifest names, and none of the sources, tests, playground or scripts.
- `the-manifests-declare-skills-entry-points-and-ranges-that-agree`: names, licences, publish settings, `antelopeJs` keys, the interface range from its version to the next minor, the README compatibility tables, the ranges the docs quote, the renderer range and the renamed CMS-era names.
- `the-shipped-skills-have-valid-front-matter-and-cases`: skill names, descriptions, icons, categories, tags and the cases whose expectations name shipped skills and phrases the skill contains.
- `the-module-skill-statements-name-things-that-exist`: the module skill's config keys and defaults, routes, page paths, reserved webhook prefixes and states are the docs' and the source's.
- `the-module-skill-api-walk-works-as-written`: import, enable, run-now, test-effects and the 409 of a test, as the skill writes them.
- `the-module-skill-webhook-prefixes-are-refused`: each reserved prefix is refused, a path that only begins with the same letters is not.
- `the-module-skill-pages-open-for-the-owner`: the pages the skill names open in the browser.
- `the-interface-skill-and-docs-name-what-the-interface-exports`: the skill's imports are exported, there is one entry point, and the docs' TypeScript blocks compile against the interface.
- `docs-pages-have-front-matter-and-a-navigation-order`: front matter, numbering, navigation groups.
- `docs-and-readme-links-and-anchors-resolve`: every link, anchor and image of the docs, READMEs and skills that points into this repository resolves.

## How to get to it (user POV)

- `ajs project modules add @antelopejs/dms-automation`; the agent skills arrive with the packages.

## Driving it with dms-control

```bash
dms-control journey "$RUN" package
```

## Gotchas

- The journeys run `npm pack --dry-run --json --ignore-scripts` in each package and read the file list; nothing is packed to disk or published, and the `dist` that exists in the checkout is what is judged.
- The docs' code blocks are compiled with the checkout's `tsc` into the journey's evidence folder, with a path mapping to the interface's `dist/index.d.ts`.
- Links to other modules' docs (`/docs/modules/database/...`, `/docs/modules/api/...`) and to external sites are not followed. `/docs/modules/automation/reference` is the interface's `docs/1.index.md`.
