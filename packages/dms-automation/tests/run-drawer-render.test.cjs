const assert = require("node:assert/strict");
const { describe, test } = require("node:test");
const {
  API,
  component,
  paths,
  respond,
  serverRender,
} = require("./server-render.cjs");

describe("run drawer and log", () => {
  test("reads the run of the row opened through useApiData, and hands it over", async () => {
    const render = await serverRender(
      component("RunPeek.vue"),
      {
        rowData: { _id: "run-1" },
        apiUrl: API,
        traceUrl: "/t",
        builderUrl: "/b",
      },
      { respond },
    );
    assert.deepEqual(paths(render.reads), ["GET /runs/run-1"]);
    assert.deepEqual(render.untransferred, []);
    assert.match(render.html, /Oct 14, 8:00 AM · 1 s · Manual/);
  });

  test("leaves the run's name to the row header, pins its actions to the bottom", async () => {
    const props = {
      rowData: { _id: "run-1" },
      apiUrl: API,
      traceUrl: "/t",
      builderUrl: "/b",
    };
    const { html } = await serverRender(component("RunPeek.vue"), props, {
      respond,
    });
    assert.doesNotMatch(html, /Failing call/);
    assert.match(html, /^<div class="flex flex-1 flex-col gap-4">/);
    assert.match(html, /<div data-stub="DmsContainerFooter" justify="start">/);
    assert.doesNotMatch(html, /dms-form-foot|min-height/);
    assert.equal(html.match(/class="whitespace-nowrap"/g).length, 2);
  });

  test("wraps a step's name while its bar takes a line of its own", async () => {
    const label = "Assign the on-call technician of the week";
    const step = {
      nodeId: "n1",
      name: { nodeId: "n1", label },
      fireId: "f1",
      startMs: 0,
      durationMs: 8,
      status: "ok",
      depth: 0,
    };
    const props = { steps: [step], skipped: [], totalMs: 8, pathOnly: true };
    const { html } = await serverRender(
      component("Run/RunWaterfall.vue"),
      props,
      { respond },
    );
    assert.match(
      html,
      new RegExp(
        `class="break-words @xl:truncate text-sm text-highlighted">${label}<`,
      ),
    );
  });

  test("says a run of the row does not exist", async () => {
    const render = await serverRender(
      component("RunPeek.vue"),
      {
        rowData: { _id: "gone" },
        apiUrl: API,
        traceUrl: "/t",
        builderUrl: "/b",
      },
      { respond },
    );
    assert.deepEqual(render.untransferred, []);
    assert.match(render.html, /dms_automation\.trace\.loadError/);
  });

  test("reads the log a run did not come with, and hands it over", async () => {
    const render = await serverRender(
      component("Run/RunLogList.vue"),
      { apiUrl: API, runId: "run-1", names: new Map() },
      { respond },
    );
    assert.deepEqual(paths(render.reads), ["GET /runs/run-1/logs"]);
    assert.deepEqual(render.untransferred, []);
    assert.match(render.html, /Refused connection/);
  });
});
