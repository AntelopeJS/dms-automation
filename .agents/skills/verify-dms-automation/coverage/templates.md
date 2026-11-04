# Coverage: templates

Journey ids are `templates/<id>` unless another feature is named.

| Source | Claim | Journey | Check |
|---|---|---|---|
| 1.introduction.md:45 | Templates are your own reusable groups of nodes shared between procedures | editing-a-template-changes-every-procedure-placing-it | after the edit every placing procedure logs at error |
| 3.builder.md:77 | Save as template makes the group reusable | builder/a-group-saved-as-a-template-is-linked-read-only-and-forkable | the template is stored with the group's ports and steps |
| 3.builder.md:77 | An instance is Linked, edits to the template apply to every procedure using it | editing-a-template-changes-every-procedure-placing-it | before/after the edit; versions move on for the two placing procedures only |
| 3.builder.md:77 | Instance port controls are read-only; Edit template; Fork to local group | builder/a-group-saved-as-a-template-is-linked-read-only-and-forkable | the linked instance; the saved copy is private |
| 5.library.md:11 | The Templates tab and its count, link keeps the open tab | the-library-templates-tab-lists-searches-and-edits-templates | the tab lists the templates by name with their uses (tab Templates 2, `?tab=templates`) |
| 5.library.md:11 | Search… filters the entries | the-library-templates-tab-lists-searches-and-edits-templates | search matches names in any case; and descriptions; nothing matching says so |
| 5.library.md:30 | The tab lists templates saved from the builder, with how many places use each | the-library-templates-tab-lists-searches-and-edits-templates; the-list-pages-newest-edit-first-and-counts-each-owner-once | the rows with "N uses"; counts each owner once |
| 5.library.md:32 | Details: name, description, icon, which Save stores | the-library-templates-tab-lists-searches-and-edits-templates | Save stores the name and description; a taken name is refused under the field |
| 5.library.md:32 | The icon is stored | template-fields-have-limits-and-defaults | the icon "..." is stored / is refused |
| 5.library.md:33 | Ports with name, direction, kind and type, edited inside the graph | the-library-templates-tab-lists-searches-and-edits-templates | the Ports table (columns and rows, Edit them inside the graph) |
| 5.library.md:34 | Used in lists procedures and templates; changes apply live | the-library-templates-tab-lists-searches-and-edits-templates; usages-name-every-procedure-and-template-placing-a-template | Used in rows and "2 places"; each placement is listed with its place |
| 5.library.md:36 | Edit graph opens `/modules/automation/builder?template=<id>` | the-library-templates-tab-lists-searches-and-edits-templates | Edit graph opens the template in the builder |
| 5.library.md:36 | Delete template turns each use into a local group so procedures keep working | deleting-a-used-template-needs-force-and-forks-every-usage; deleting-a-template-from-the-library-says-how-many-places-it-forks | force=1 forks every usage and deletes; the procedure keeps working |
| 5.library.md:36 | Its confirmation says how many places that changes | deleting-a-template-from-the-library-says-how-many-places-it-forks | the confirmation counts the places and who holds them; none variant; one-use variant is not driven separately (singular text "It is used once") |
| i18n templates.* | Deleting an unused template: "No procedure or template uses it yet." | deleting-a-template-from-the-library-says-how-many-places-it-forks | an unused template says nothing uses it |
| i18n templates.truncated | "Showing the first N of M templates" past 1000 | Not driven | needs more than 1000 templates (list cap 1000 is checked through `limit=5000` -> 1000) |
| i18n templates.forkIncomplete | fork-incomplete 409 keeps the template | Not driven | no route-level way to make a usage unforkable (the fork is a no-op only for unparsable graphs) |
| routes/templates.ts | POST/PUT validate name 1-200 trimmed, description 2000, icon pattern | template-fields-have-limits-and-defaults | every named check |
| routes/templates.ts | Names unique whatever the case, 409 name-taken text | template-names-are-unique-whatever-their-case | every named check |
| routes/templates.ts | Ports unique per direction/kind/name; graph validated; nesting <= 20 | a-template-with-broken-ports-or-graph-is-refused-whole | every case |
| routes/templates.ts | Reference cycle refused with path | a-template-reference-cycle-is-refused | every loop |
| routes/templates.ts | List paged, default and max 1000, bad values 400 | the-list-pages-newest-edit-first-and-counts-each-owner-once | pages; each bad query |
| routes/templates.ts | Delete: 409 in-use, force=1/true, forked count | deleting-a-used-template-needs-force-and-forks-every-usage | force=... does not force; force=1 forks; force=true forks |
| routes/templates.ts | 404 texts, other methods 404 | template-routes-answer-404-for-unknown-ids-and-refuse-other-methods | unknown ids; other methods and paths |
| graph validation | Unknown template blocks enabling | a-procedure-placing-a-missing-template-cannot-be-enabled | the draft cannot be enabled |
| interface docs 1.index.md:234 | DeclareProcedure rejects an unknown template | Not driven here | owned by `interface` |
| 3.configuration.md:81 | An edit to a template on one instance reaches the others over Redis pub/sub | Not driven | needs redis and two instances |
| access | Templates routes are owner-only | Not driven here | owned by `access` |
