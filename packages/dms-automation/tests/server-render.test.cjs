const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const { describe, test } = require("node:test");
const { FRONTEND, frontendRequire, component } = require("./frontend.cjs");

// What a server render of each page reads from the backend, and that it
// hands the browser every response it read: a read the page does not hand
// over is made again by the browser, after a server request for nothing.
// The pages render on the renderer's real data layer and the DMS's real
// `useApiData`, as installed by frontend-vue.

const vue = frontendRequire("vue");
const { renderToString } = frontendRequire("vue/server-renderer");

// What the renderer imports of Inertia and vue-i18n serves the browser only.
const BROWSER_ONLY = {
  "@inertiajs/vue3": {
    Link: {},
    router: { visit() {}, on: () => () => {} },
    usePage: () => ({ url: undefined }),
  },
  "vue-i18n": {
    useI18n() {
      throw new Error("vue-i18n is not available in these tests");
    },
  },
};
const load = Module._load;
Module._load = function (request, ...rest) {
  return BROWSER_ONLY[request] ?? load.call(this, request, ...rest);
};

const ANTELOPE = path.join(FRONTEND, "node_modules/@antelopejs");
const engine = require(
  path.join(ANTELOPE, "dms-frontend/templates/vue/frontend-module.ts"),
);
const { useApiData } = require(
  path.join(
    ANTELOPE,
    "dms/frontend-vue/layers/dms-core/app/composables/auth/useApiData.ts",
  ),
);

const API = "/api/automation";
let backend = () => ({});
const reads = [];

/** A failure as `$authFetch` throws it for an HTTP status. */
const httpError = (statusCode) =>
  Object.assign(new Error(`HTTP ${statusCode}`), {
    statusCode,
    statusMessage: `HTTP ${statusCode}`,
  });

/** A message as its key, followed by its parameters. */
const t = (key, params) =>
  params ? `${key} ${Object.values(params).join(" ")}` : key;
const same = (value) => value;
const noop = () => {};

// The application's auto-imports: Vue's API, the renderer's, the DMS
// layers' the components call, and the module's own composables.
for (const [name, value] of Object.entries(vue))
  if (/^[a-z]/.test(name)) globalThis[name] = value;
for (const name of [
  "useDmsFetch",
  "useDmsAsyncData",
  "useDmsState",
  "useDmsRoute",
  "useDmsRouter",
])
  globalThis[name] = engine[name];
Object.assign(globalThis, {
  useApiData,
  useAuthFetch: () => ({
    async $authFetch(url, options = {}) {
      const read = {
        url,
        method: (options.method ?? "GET").toUpperCase(),
        query: options.query ?? {},
      };
      reads.push(read);
      return backend(read);
    },
  }),
  useI18n: () => ({ t, te: () => false, locale: vue.ref("en") }),
  useRegionalFormat: () => ({
    dateTimeFormat: (options) =>
      new Intl.DateTimeFormat("en", { ...options, timeZone: "UTC" }),
  }),
  useTranslation: () => ({ processI18n: same }),
  useComposedText: () => ({
    processText: (text) => (typeof text === "string" ? text : ""),
  }),
  useKeyboardPlatform: () => ({ formatShortcut: same }),
  useToast: () => ({ add: noop }),
  useConfirm: () => ({ confirm: async () => false }),
  useConfirmFrom: () => ({ confirmFrom: async () => {} }),
  useUnsavedChanges: () => ({ confirmLeave: async () => true }),
  useFieldErrors: () => ({
    errors: {},
    clear: noop,
    setError: async () => {},
    aria: () => ({}),
    errorId: same,
  }),
  useHead: noop,
  describeApiError: (error) => `error ${error?.statusCode ?? ""}`.trim(),
  apiErrorStatus: (error) => error?.statusCode,
});
for (const name of ["useAutomationNodeKinds", "useAutomationRuns"])
  globalThis[name] = require(
    path.join(FRONTEND, "app/composables", `${name}.ts`),
  )[name];

// Every DMS, Nuxt UI and module component the templates use renders its
// default slot, its props as attributes.
const stubs = new Map();
function stub(name) {
  if (!stubs.has(name))
    stubs.set(
      name,
      vue.defineComponent({
        name,
        inheritAttrs: false,
        setup:
          (_, { slots, attrs }) =>
          () =>
            vue.h("div", { "data-stub": name, ...attrs }, slots.default?.()),
      }),
    );
  return stubs.get(name);
}
const STUBBED = /^(Dms|U[A-Z]|I18nT)/;

/** The requests the payload carries the responses of, by their key. */
function transferredRequests(payload) {
  return Object.keys({ ...payload.data, ...payload.errors })
    .filter((key) => key.startsWith("$dmsfetch:"))
    .map((key) => {
      const [method, , url, query] = JSON.parse(key.slice("$dmsfetch:".length));
      return { method, url, query: query ?? {} };
    });
}
const queryKey = (query) =>
  JSON.stringify(Object.entries(query).sort(([a], [b]) => a.localeCompare(b)));
const sameRead = (a, b) =>
  a.method === b.method &&
  a.url === b.url &&
  queryKey(a.query) === queryKey(b.query);

/**
 * Renders `root` with `props` as a server renders the page `url`. `keyed`
 * names the reads handed over under a key of their own (a handler, the `key`
 * option), by that key. `settle` is how long after the render the requests
 * it left behind (a timer, a read nobody waited for) are counted, in ms.
 */
async function serverRender(root, props, options = {}) {
  backend = options.respond ?? (() => ({}));
  reads.length = 0;
  const runtime = engine.createDmsFrontendRuntime(undefined, {}, true);
  runtime.route.fullPath = options.url ?? "/";
  const app = vue.createSSRApp({ render: () => vue.h(root, props) });
  engine.provideDmsFrontendRuntime(app, runtime);
  const registry = app._context.components;
  app._context.components = new Proxy(registry, {
    get: (target, name) =>
      target[name] ??
      (typeof name === "string" && STUBBED.test(name) ? stub(name) : undefined),
  });
  app.config.globalProperties.$t = t;
  app.config.warnHandler = noop;
  const html = await renderToString(app);
  await new Promise((resolve) => setTimeout(resolve, options.settle ?? 50));
  const payload = engine.serializeDmsPayload(runtime);
  const transferred = transferredRequests(payload);
  const keyed = Object.entries(options.keyed ?? {})
    .filter(([key]) => key in payload.data || key in payload.errors)
    .map(([, matches]) => matches);
  const made = [...reads];
  return {
    html,
    payload,
    reads: made,
    untransferred: made.filter(
      (read) =>
        !transferred.some((handed) => sameRead(read, handed)) &&
        !keyed.some((matches) => matches(read)),
    ),
  };
}

const graph = (nodes = []) => ({ nodes, triggerEdges: [], dataEdges: [] });
const procedure = (id, name, enabled, nodes = []) => ({
  _id: id,
  name,
  description: "",
  enabled,
  graph: graph(nodes),
  version: 1,
  revision: 1,
});
const cron = {
  id: "cron-1",
  kind: "trigger",
  typeId: "schedule.cron",
  config: { cron: "0 3 * * *" },
  position: { x: 0, y: 0 },
};
const template = {
  _id: "tpl-1",
  name: "Notify team",
  description: "Posts a message",
  icon: "i-ph-bell",
  ports: [],
  subgraph: graph(),
  usageCount: 1,
};
const run = {
  _id: "run-1",
  procedureId: "p-echo",
  startedAt: "2026-10-14T08:00:00.000Z",
  endedAt: "2026-10-14T08:00:01.000Z",
  status: "failed",
  errorMessage: "connect ECONNREFUSED",
  triggerNodeId: "manual-1",
  payloadKept: true,
  kind: "run",
  procedureVersion: 1,
  procedureName: "Failing call",
  durationMs: 1000,
  usualDurationMs: null,
  procedure: { _id: "p-echo", name: "Failing call", enabled: true, version: 1 },
  graph: null,
  trigger: null,
  triggerText: "Manual",
  failedStep: null,
  trace: { steps: [], skipped: [] },
};

function respond({ url, method }) {
  if (method === "POST") return { issues: [] };
  switch (url.split("?")[0].replace(API, "")) {
    case "/procedures":
      return {
        results: [
          procedure("p-cron", "Nightly cleanup", false, [cron]),
          procedure("p-echo", "Manual echo", true),
        ],
      };
    case "/procedures/summary":
      return [
        { procedureId: "p-cron", name: "Nightly cleanup", status: "draft" },
        { procedureId: "p-echo", name: "Manual echo", status: "healthy" },
      ];
    case "/procedures/p-cron/triggers":
      return {
        triggers: [
          {
            nodeId: "cron-1",
            typeId: "schedule.cron",
            typeName: "Schedule",
            text: "every day at 03:00",
            nextAt: "2026-10-15T03:00:00.000Z",
          },
        ],
      };
    case "/procedures/p-cron/runs":
      return [
        {
          _id: "run-0",
          startedAt: "2026-10-14T03:00:00.000Z",
          status: "failed",
          kind: "run",
        },
      ];
    case "/trigger-types":
      return [
        { id: "schedule.cron", name: "Schedule", module: "dms-automation" },
        { id: "webhook", name: "Webhook", module: "dms-automation" },
      ];
    case "/action-types":
      return [{ id: "playground.echo", name: "Playground echo" }];
    case "/data-node-types":
      return [];
    case "/node-kinds":
      return [
        {
          kind: "if",
          meta: { continuationPorts: [], sidePorts: [], ui: { label: "If" } },
        },
      ];
    case "/templates":
      return { results: [template], total: 1 };
    case "/templates/tpl-1":
      return template;
    case "/templates/tpl-1/usages":
      return {
        procedures: [{ procedureId: "p-echo", nodeId: "n1", groupPath: [] }],
        templates: [],
      };
    case "/templates/gone":
    case "/runs/gone":
      throw httpError(404);
    case "/runs/run-1":
      return run;
    case "/library/usage/triggers":
      return { "schedule.cron": [] };
    case "/library/webhook-base":
      return { url: "https://hooks.example.test", configured: true };
    default:
      return {};
  }
}

const paths = (made) =>
  made
    .map((read) => `${read.method} ${read.url.split("?")[0].replace(API, "")}`)
    .sort();
// What the builder hands over under keys of its own: the procedure list,
// read in pages, and the templates its palette places.
const keyed = {
  "dms-automation-builder-procedures": (read) =>
    read.url.startsWith(`${API}/procedures?`),
  "dms-automation-palette-templates": (read) => read.url === `${API}/templates`,
};
const builder = (url, settle) =>
  serverRender(
    component("Editor.vue"),
    { apiUrl: API },
    { url, respond, keyed, settle },
  );

describe("builder", () => {
  test("reads what it opens, its palette and its bar once, and hands every answer over", async () => {
    const render = await builder("/modules/automation/builder?selected=p-cron");
    assert.deepEqual(paths(render.reads), [
      "GET /action-types",
      "GET /data-node-types",
      "GET /node-kinds",
      "GET /procedures",
      "GET /procedures/p-cron/runs",
      "GET /procedures/p-cron/triggers",
      "GET /procedures/summary",
      "GET /templates",
      "GET /trigger-types",
    ]);
    assert.deepEqual(render.untransferred, []);
    // The palette keeps the fields placing a template needs, not its graph.
    assert.doesNotMatch(
      JSON.stringify(render.payload.data["dms-automation-palette-templates"]),
      /subgraph/,
    );
    // The paused banner names the saved schedule.
    assert.match(render.html, /every day at 03:00/);
  });

  test("leaves the draft check and the test payload to the browser", async () => {
    // Past the draft check's delay (500 ms): no timer of the render sends it.
    const render = await builder(
      "/modules/automation/builder?selected=p-cron",
      700,
    );
    assert.deepEqual(
      render.reads.filter(
        (read) => read.method === "POST" || read.url.endsWith("/last-payload"),
      ),
      [],
    );
  });

  test("opens a template without reading the procedures", async () => {
    const render = await builder("/modules/automation/builder?template=tpl-1");
    assert.deepEqual(paths(render.reads), [
      "GET /action-types",
      "GET /data-node-types",
      "GET /node-kinds",
      "GET /templates",
      "GET /templates/tpl-1",
      "GET /trigger-types",
    ]);
    assert.deepEqual(render.untransferred, []);
  });

  test("says a template does not exist from the server, and hands the failure over", async () => {
    const render = await builder("/modules/automation/builder?template=gone");
    assert.deepEqual(render.untransferred, []);
    assert.deepEqual(
      Object.values(render.payload.errors).map((error) => error.statusCode),
      [404],
    );
    assert.match(render.html, /dms_automation\.editor\.templateNotFound/);
  });
});

describe("library", () => {
  test("renders a catalog and where its entries are used", async () => {
    const render = await serverRender(
      component("Catalog.vue"),
      { kind: "triggers", apiUrl: API, builderUrl: "/b" },
      { url: "/modules/automation/library?tab=triggers", respond },
    );
    assert.deepEqual(paths(render.reads), [
      "GET /library/usage/triggers",
      "GET /trigger-types",
    ]);
    assert.deepEqual(render.untransferred, []);
    assert.match(render.html, /Webhook/);
  });

  test("renders the templates, the one shown filled in its form, and where it is used", async () => {
    const render = await serverRender(
      component("Templates.vue"),
      { apiUrl: API, builderUrl: "/b" },
      { url: "/modules/automation/library?tab=templates", respond },
    );
    assert.deepEqual(paths(render.reads), [
      "GET /procedures/summary",
      "GET /templates",
      "GET /templates/tpl-1/usages",
    ]);
    assert.deepEqual(render.untransferred, []);
    assert.match(render.html, /modelvalue="Notify team"/i);
  });

  test("reads the webhook address once for every endpoint of the page", async () => {
    const WebhookEndpoint = component("WebhookEndpoint.vue");
    const render = await serverRender(
      {
        render: () => [
          vue.h(WebhookEndpoint, { path: "/a" }),
          vue.h(WebhookEndpoint, { path: "/b", compact: true }),
        ],
      },
      {},
      { respond },
    );
    assert.deepEqual(paths(render.reads), ["GET /library/webhook-base"]);
    assert.deepEqual(render.untransferred, []);
    assert.match(render.html, /https:\/\/hooks\.example\.test\/b/);
  });
});

describe("run trace", () => {
  const trace = (id) =>
    serverRender(
      component("RunTrace.vue"),
      { apiUrl: API, runsUrl: "/r", builderUrl: "/b", traceUrl: "/t" },
      { url: `/modules/automation/trace?run=${id}`, respond },
    );

  test("renders the run and hands it over", async () => {
    const render = await trace("run-1");
    assert.deepEqual(paths(render.reads), ["GET /runs/run-1"]);
    assert.deepEqual(render.untransferred, []);
    assert.match(render.html, /Failing call/);
  });

  test("says a run does not exist from the server", async () => {
    const render = await trace("gone");
    assert.deepEqual(render.untransferred, []);
    assert.match(render.html, /dms_automation\.trace\.notFound/);
  });
});
