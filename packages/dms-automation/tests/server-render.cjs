const Module = require("node:module");
const path = require("node:path");
const {
  FRONTEND,
  frontendRequire,
  component,
} = require("./helpers/frontend.cjs");

// Server renders of the pages and components, for the render tests: what a
// render reads from the backend (answered by `respond`) and what it hands
// the browser. The pages render on the renderer's real data layer and the
// DMS's real `useApiData`, as installed by frontend-vue.

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
/** The key the payload carries the response of `read` under, as `useDmsFetch` keys it. */
const fetchKey = (read) =>
  engine.dmsRequestKey(read.url, { method: read.method, query: read.rawQuery });
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
        rawQuery: options.query,
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
        !(fetchKey(read) in payload.data) &&
        !(fetchKey(read) in payload.errors) &&
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
    case "/runs/run-1/logs":
      return {
        entries: [
          {
            ts: 1,
            seq: 0,
            level: "error",
            source: "executor",
            message: "Refused connection",
          },
        ],
      };
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

module.exports = { API, component, paths, respond, serverRender, vue };
