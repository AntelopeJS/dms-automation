import { computed, nextTick, ref, watch } from "vue";
import type { EditorContext } from "./useEditorContext";
import type { DockRun } from "../../../components/Editor/BottomDock.vue";
import type { NodeRunState } from "../../../components/Editor/nodes/GenericNode.vue";
import type {
  RunDetail,
  TraceStep,
} from "../../../composables/useAutomationRuns";
import type { ProcedureGraph } from "../../../composables/useGraphConnect";
import {
  describeDuration,
  describeTime,
  stepTitle,
} from "../../../utils/describe";
import { issuesOf } from "../../utils/editor/apiErrors";
import type { ChoiceQuestion } from "../../types/editor";
import type { GraphHistory } from "./useGraphHistory";
import type { DraftProblems } from "./useDraftProblems";
import type { SavedTriggers } from "./useSavedTriggers";
import type { UnsavedGuards } from "./useUnsavedGuards";

const RECENT_RUNS = 8;

/** A step a test runs for real, as `POST /procedures/:id/test-effects` lists it. */
interface RealEffectStep {
  nodeId: string;
  typeId: string;
  typeName: string;
  label?: string;
}

/** The id of the node a step ran for: a step inside a loop or a group carries the node's id, then `__` and its own. */
function nodeIdOfStep(stepNodeId: string): string {
  const [nodeId = stepNodeId] = stepNodeId.split("__");
  return nodeId;
}

function runSavedQuestion(
  t: EditorContext["t"],
  count: number,
): ChoiceQuestion<"cancel" | "test" | "saved"> {
  return {
    title: t("dms_automation.editor.runSaved.title"),
    description: t("dms_automation.editor.runSaved.description", { count }),
    choices: [
      {
        value: "cancel",
        label: t("dms_automation.common.cancel"),
        color: "neutral",
        variant: "ghost",
      },
      {
        value: "test",
        label: t("dms_automation.editor.runSaved.testDraft"),
        color: "neutral",
        variant: "outline",
      },
      {
        value: "saved",
        label: t("dms_automation.editor.runSaved.runSaved"),
        color: "warning",
      },
    ],
    dismiss: "cancel",
  };
}

/**
 * Asks before a test that acts for real: the steps that would (actions that
 * cannot simulate) are listed. Resolves `true` at once when there are none.
 */
async function confirmRealEffects(
  ctx: EditorContext,
  procedureId: string,
  graph: ProcedureGraph,
): Promise<boolean> {
  const { $authFetch, confirm, processI18n, props, t } = ctx;
  const { realEffects } = await $authFetch<{ realEffects: RealEffectStep[] }>(
    `${props.apiUrl}/procedures/${procedureId}/test-effects`,
    {
      method: "POST",
      body: { graph },
    },
  );
  if (realEffects.length === 0) return true;
  return await confirm({
    title: t("dms_automation.editor.testEffects.title"),
    description: t("dms_automation.editor.testEffects.description", {
      count: realEffects.length,
    }),
    color: "warning",
    icon: "i-ph-flask",
    confirmLabel: t("dms_automation.editor.testEffects.confirm"),
    initialFocus: "cancel",
    impact: realEffects.map((step) =>
      step.label
        ? {
            icon: "i-ph-lightning",
            label: processI18n(step.typeName),
            count: step.label,
          }
        : { icon: "i-ph-lightning", label: processI18n(step.typeName) },
    ),
  });
}

/** The dock's last runs, its tab counting the failed ones, and the last real payload of the trigger a Test run starts from, which fills the test payload the user then edits. */
function useRecentRuns(ctx: EditorContext, triggers: SavedTriggers) {
  const { testPayload, testPayloadSource, testTriggerNodeId } = ctx;
  const { ofSelected, selectedProcedureUrl } = triggers;
  const recentRunsRead = useApiData<DockRun[]>(selectedProcedureUrl("runs"), {
    query: { limit: RECENT_RUNS },
  });
  const recentRuns = computed(() => {
    const list = ofSelected(recentRunsRead);
    return Array.isArray(list) ? list.slice(0, RECENT_RUNS) : [];
  });

  const lastPayloadRead = useApiData<{
    last: { runId: string; payload: unknown } | null;
  }>(selectedProcedureUrl("last-payload"), {
    query: () =>
      testTriggerNodeId.value ? { triggerNodeId: testTriggerNodeId.value } : {},
    server: false,
    refreshOnPageRefresh: false,
  });
  watch(
    [() => lastPayloadRead.data.value, () => lastPayloadRead.error.value],
    ([answer, error]) => {
      if (!error && lastPayloadRead.placeholder.value) return;
      const last = error ? null : answer?.last;
      testPayload.value = JSON.stringify(last?.payload ?? {}, null, 2);
      testPayloadSource.value = last?.runId ?? null;
    },
  );

  return { recentRunsRead, recentRuns };
}

/** What the run on screen looks like: the state of each node on the canvas, the steps for the dock and the inspector, and the banner's label, description, summary and look. */
function useOverlayView(ctx: EditorContext) {
  const {
    dateTimeFormat,
    dockTab,
    locale,
    overlayIsTest,
    overlayRun,
    processI18n,
    selected,
    selectedNodeId,
    subgraphPath,
    t,
  } = ctx;

  const runStates = computed<Map<string, NodeRunState> | undefined>(() => {
    const run = overlayRun.value;
    if (!run || subgraphPath.value.length > 1) return undefined;
    const out = new Map<string, NodeRunState>();
    for (const step of run.trace.steps) {
      const id = nodeIdOfStep(step.nodeId);
      const previous = out.get(id);
      const status = step.status === "failed" ? "failed" : "ok";
      if (!previous || status === "failed") {
        out.set(id, {
          status,
          durationMs: (previous?.durationMs ?? 0) + (step.durationMs ?? 0),
        });
      }
    }
    for (const skipped of run.trace.skipped)
      out.set(skipped.nodeId, { status: "skipped" });
    return out;
  });

  const overlaySteps = computed<TraceStep[] | null>(() =>
    overlayIsTest.value ? (overlayRun.value?.trace.steps ?? null) : null,
  );

  watch(overlaySteps, (steps) => {
    if (!steps && dockTab.value === "test") dockTab.value = "problems";
  });

  const selectedRunStep = computed<TraceStep | null>(() => {
    const id = selectedNodeId.value;
    const steps = overlayRun.value?.trace.steps ?? [];
    if (!id) return null;
    const own = steps.filter(
      (s) => s.nodeId === id || s.nodeId.startsWith(`${id}__`),
    );
    return own.find((s) => s.status === "failed") ?? own.at(-1) ?? null;
  });

  const overlayLabel = computed(() => {
    const run = overlayRun.value;
    if (!run) return "";
    const when = describeTime(run.startedAt, dateTimeFormat);
    return overlayIsTest.value
      ? t("dms_automation.editor.debug.testLabel", { when })
      : t("dms_automation.editor.debug.runLabel", {
          run: run._id.slice(-6),
          when,
        });
  });

  const overlayDescription = computed(() => {
    const run = overlayRun.value;
    const version = selected.value?.version;
    if (
      !run ||
      overlayIsTest.value ||
      !run.procedureVersion ||
      !version ||
      run.procedureVersion === version
    )
      return overlayLabel.value;
    return `${overlayLabel.value} · ${t("dms_automation.editor.debug.olderVersion", { run: run.procedureVersion, current: version })}`;
  });

  const overlaySummary = computed(() => {
    const run = overlayRun.value;
    if (!run) return "";
    const duration = describeDuration(run.durationMs, locale.value);
    if (run.status === "failed") {
      const step = stepTitle(run.failedStep, processI18n);
      return step
        ? t("dms_automation.editor.debug.failedAt", { step, duration })
        : t("dms_automation.editor.debug.failed", { duration });
    }
    return t("dms_automation.editor.debug.passed", { duration });
  });

  const overlayLook = computed(() => {
    const status = overlayRun.value?.status;
    if (status === "failed")
      return { tone: "error", icon: "i-ph-bug" } as const;
    return { tone: "success", icon: "i-ph-check-circle" } as const;
  });

  return {
    runStates,
    overlaySteps,
    selectedRunStep,
    overlayLabel,
    overlayDescription,
    overlaySummary,
    overlayLook,
  };
}

/** Showing a stored run over the canvas, and leaving it. A test run is told by its kind. `?run=` shows the run over the procedure it ran, which the builder opens if another one is asked; a run that no longer exists is said. */
function useRunDisplay(ctx: EditorContext, problems: DraftProblems) {
  const errorPresenter = useApiErrorPresenter();
  const {
    builderPath,
    overlayIsTest,
    overlayRun,
    procedures,
    queryValue,
    router,
    runsApi,
    selectedId,
    t,
    toast,
  } = ctx;
  const { selectNode } = problems;

  function displayRun(run: RunDetail) {
    overlayRun.value = run;
    overlayIsTest.value = run.kind === "test";
    if (run.failedNodeId) selectNode(nodeIdOfStep(run.failedNodeId));
  }

  async function showRun(runId: string): Promise<RunDetail> {
    const run = await runsApi.getRun(runId);
    displayRun(run);
    return run;
  }

  function exitDebug() {
    overlayRun.value = null;
    overlayIsTest.value = false;
    if (queryValue("run"))
      void router.replace(`${builderPath()}?selected=${selectedId.value}`);
  }

  async function openRunFromUrl(runId: string) {
    const notFound = () => {
      toast.add({
        title: t("dms_automation.editor.debug.runNotFound"),
        color: "warning",
        icon: "i-ph-warning",
      });
      exitDebug();
    };
    let run: RunDetail;
    try {
      run = await runsApi.getRun(runId);
    } catch (error) {
      errorPresenter.presentError(error, {
        fallbackKey: "dms_automation.editor.debug.runNotFound",
      });
      exitDebug();
      return;
    }
    if (run.procedureId !== selectedId.value) {
      if (!procedures.value.some((p) => p._id === run.procedureId)) {
        notFound();
        return;
      }
      selectedId.value = run.procedureId;
      await nextTick();
    }
    displayRun(run);
  }

  return { showRun, exitDebug, openRunFromUrl };
}

/** Test run of the draft. Steps that act for real (an e-mail sent, a record written) are named before the test runs, never after: closing the question runs nothing. */
function useTestRun(
  ctx: EditorContext,
  display: ReturnType<typeof useRunDisplay>,
  recent: ReturnType<typeof useRecentRuns>,
) {
  const errorPresenter = useApiErrorPresenter();
  const {
    $authFetch,
    dockCollapsed,
    dockTab,
    editorMode,
    issues,
    overlayIsTest,
    overlayRun,
    props,
    selected,
    testPayload,
    testTriggerNodeId,
    testing,
  } = ctx;

  async function onTestRun() {
    const current = selected.value;
    if (!current || editorMode.value !== "procedure" || testing.value) return;
    let payload: unknown;
    try {
      payload = JSON.parse(testPayload.value || "null");
    } catch (error) {
      dockTab.value = "payload";
      dockCollapsed.value = false;
      errorPresenter.presentError(error, {
        fallbackKey: "dms_automation.editor.dock.invalidJson",
      });
      return;
    }
    testing.value = true;
    try {
      if (!(await confirmRealEffects(ctx, current._id, current.graph))) return;
      overlayRun.value = null;
      overlayIsTest.value = false;
      const res = await $authFetch<{ runId: string }>(
        `${props.apiUrl}/procedures/${current._id}/test`,
        {
          method: "POST",
          body: {
            graph: current.graph,
            payload,
            triggerNodeId: testTriggerNodeId.value,
            confirmRealEffects: true,
          },
        },
      );
      await display.showRun(res.runId);
      dockTab.value = "test";
      dockCollapsed.value = false;
      void recent.recentRunsRead.refresh();
    } catch (e) {
      const refused = issuesOf(e);
      if (refused) {
        issues.value = refused;
        dockTab.value = "problems";
        dockCollapsed.value = false;
      }
      errorPresenter.presentError(e, {
        fallbackKey: "dms_automation.editor.testRunError",
      });
    } finally {
      testing.value = false;
    }
  }

  return { onTestRun };
}

/** The runs shown over the canvas: a test of the draft, or a stored run being debugged. */
export function useRunOverlay(
  ctx: EditorContext,
  history: GraphHistory,
  problems: DraftProblems,
  triggers: SavedTriggers,
  guards: UnsavedGuards,
) {
  const errorPresenter = useApiErrorPresenter();
  const {
    builderPath,
    confirm,
    processI18n,
    props,
    queryValue,
    router,
    runNowOpen,
    runsApi,
    selected,
    selectedId,
    t,
    toast,
  } = ctx;
  const { isDirty } = history;
  const { changeCount, savedName, summariesRead } = problems;
  const { askChoice } = guards;

  const recent = useRecentRuns(ctx, triggers);
  const view = useOverlayView(ctx);
  const display = useRunDisplay(ctx, problems);
  const { onTestRun } = useTestRun(ctx, display, recent);

  async function openRunNow() {
    if (!selected.value) return;
    if (isDirty.value) {
      const choice = await askChoice(runSavedQuestion(t, changeCount.value));
      if (choice === "cancel") return;
      if (choice === "test") {
        await onTestRun();
        return;
      }
    }
    runNowOpen.value = true;
  }

  async function onRunStarted(runId: string) {
    const name = savedName.value;
    const trace = {
      label: t("dms_automation.runs.trace"),
      onClick: () => void router.push(`${props.traceUrl}?run=${runId}`),
    };
    void recent.recentRunsRead.refresh();
    void summariesRead.refresh();
    let run: RunDetail;
    try {
      run = await display.showRun(runId);
    } catch (error) {
      errorPresenter.presentError(error, {
        fallbackKey: "dms_automation.editor.runStarted",
        params: { name },
        actions: [
          { labelKey: "dms_automation.runs.trace", onSelect: trace.onClick },
        ],
      });
      return;
    }
    const step = stepTitle(run.failedStep, processI18n);
    const failed = run.status === "failed";
    toast.add({
      title: failed
        ? step
          ? t("dms_automation.editor.runFailedAt", { name, step })
          : t("dms_automation.editor.runFailed", { name })
        : t("dms_automation.editor.runSucceeded", { name }),
      color: failed ? "error" : "success",
      icon: failed ? "i-ph-x-circle" : "i-ph-check-circle",
      actions: [trace],
    });
  }

  async function rerunOverlay() {
    const run = ctx.overlayRun.value;
    if (!run || ctx.overlayIsTest.value) return;
    const rerunId = ref<string | null>(null);
    const confirmed = await confirm({
      title: t("dms_automation.runs.rerunConfirmTitle"),
      description: t("dms_automation.runs.rerunConfirmDescription"),
      color: "warning",
      icon: "i-ph-arrow-clockwise",
      confirmLabel: t("dms_automation.runs.rerun"),
      onConfirm: async () => {
        rerunId.value = (await runsApi.rerun(run._id)).runId;
      },
    });
    const newRunId = rerunId.value;
    if (!confirmed || !newRunId) return;
    await onRunStarted(newRunId);
    if (queryValue("run"))
      void router.replace(
        `${builderPath()}?selected=${selectedId.value}&run=${newRunId}`,
      );
  }

  function openTrace(runId: string) {
    void router.push(`${props.traceUrl}?run=${runId}`);
  }

  return {
    ...recent,
    ...view,
    exitDebug: display.exitDebug,
    onTestRun,
    openRunNow,
    onRunStarted,
    rerunOverlay,
    openTrace,
    openRunFromUrl: display.openRunFromUrl,
  };
}

export type RunOverlay = ReturnType<typeof useRunOverlay>;
