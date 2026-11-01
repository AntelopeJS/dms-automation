const assert = require("node:assert/strict");
const { describe, test } = require("node:test");
const {
  API,
  component,
  paths,
  respond,
  serverRender,
  vue,
} = require("./server-render.cjs");

/**
 * What a server render of each page reads from the backend, and that it
 * hands the browser every response it read: a read the page does not hand
 * over is made again by the browser, after a server request for nothing.
 * The pages render on the renderer's real data layer and the DMS's real
 * `useApiData`, as installed by frontend-vue.
 */

/**
 * What the builder hands over under keys of its own: the procedure list,
 * read in pages, and the templates its palette places.
 */
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
    assert.doesNotMatch(
      JSON.stringify(render.payload.data["dms-automation-palette-templates"]),
      /subgraph/,
    );
    assert.match(render.html, /every day at 03:00/);
  });

  test("leaves the draft check and the test payload to the browser", async () => {
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

describe("run now dialog", () => {
  test("reads the last payload only once opened", async () => {
    const render = await serverRender(
      component("Editor/RunNowDialog.vue"),
      {
        apiUrl: API,
        procedureId: "p-echo",
        procedureName: "Manual echo",
        triggers: [{ nodeId: "manual-1", typeId: "manual", text: "Manual" }],
        open: false,
      },
      { respond },
    );
    assert.deepEqual(render.reads, []);
    assert.deepEqual(render.payload.data, {});
  });
});
