import { computed, nextTick, watch } from "vue";
import type { EditorContext } from "./useEditorContext";
import type { DockRun } from "../../../components/Editor/BottomDock.vue";
import type { NodeRunState } from "../../../components/Editor/nodes/GenericNode.vue";
import {
  type RunDetail,
  type TraceStep,
} from "../../../composables/useAutomationRuns";
import {
  describeDuration,
  describeTime,
  stepTitle,
} from "../../../utils/describe";
import { issuesOf } from "../../utils/editor/apiErrors";
import type { GraphHistory } from "./useGraphHistory";
import type { DraftProblems } from "./useDraftProblems";
import type { SavedTriggers } from "./useSavedTriggers";
import type { UnsavedGuards } from "./useUnsavedGuards";

/** The runs shown over the canvas: a test of the draft, or a stored run being debugged. */
export function useRunOverlay(
  ctx: EditorContext,
  history: GraphHistory,
  problems: DraftProblems,
  triggers: SavedTriggers,
  guards: UnsavedGuards,
) {
  const { presentError } = useApiErrorPresenter();
  const {
    $authFetch,
    builderPath,
    confirm,
    dateTimeFormat,
    dockCollapsed,
    dockTab,
    editorMode,
    issues,
    locale,
    overlayIsTest,
    overlayRun,
    procedures,
    processI18n,
    props,
    queryValue,
    router,
    runNowOpen,
    runsApi,
    selected,
    selectedId,
    selectedNodeId,
    subgraphPath,
    t,
    testPayload,
    testPayloadSource,
    testTriggerNodeId,
    testing,
    toast,
  } = ctx;
  const { isDirty } = history;
  const { changeCount, savedName, selectNode, summariesRead } = problems;
  const { ofSelected, selectedProcedureUrl } = triggers;
  const { askChoice } = guards;

  // ---------------------------------------------------------------------------
  // Runs over the canvas: Test run of the draft, debugging a stored run (AU-05)
  // ---------------------------------------------------------------------------

  // The dock's last runs: its tab counts the failed ones, folded too.
  const RECENT_RUNS = 8;
  const recentRunsRead = useApiData<DockRun[]>(selectedProcedureUrl("runs"), {
    query: { limit: RECENT_RUNS },
  });
  const recentRuns = computed(() => {
    const list = ofSelected(recentRunsRead);
    return Array.isArray(list) ? list.slice(0, RECENT_RUNS) : [];
  });

  // The last real payload of the trigger a Test run starts from, which fills
  // the test payload the user then edits. Left to the browser: it is shown
  // only once the dock's payload tab is opened, and may be large.
  const lastPayloadRead = useApiData<{
    last: { runId: string; payload: unknown } | null;
  }>(selectedProcedureUrl("last-payload"), {
    query: () =>
      testTriggerNodeId.value ? { triggerNodeId: testTriggerNodeId.value } : {},
    server: false,
    // Copied into an editable field: the page's refreshes leave the draft alone.
    refreshOnPageRefresh: false,
  });
  // Each answer (or failure) of another procedure or trigger replaces the
  // payload; the previous procedure's, still on screen meanwhile, does not.
  watch(
    [() => lastPayloadRead.data.value, () => lastPayloadRead.error.value],
    ([answer, error]) => {
      if (!error && lastPayloadRead.placeholder.value) return;
      const last = error ? null : answer?.last;
      testPayload.value = JSON.stringify(last?.payload ?? {}, null, 2);
      testPayloadSource.value = last?.runId ?? null;
    },
  );

  const runStates = computed<Record<string, NodeRunState> | undefined>(() => {
    const run = overlayRun.value;
    if (!run || subgraphPath.value.length > 1) return undefined;
    const out: Record<string, NodeRunState> = {};
    for (const step of run.trace.steps) {
      const id = step.nodeId.split("__")[0]!;
      const previous = out[id];
      const status = step.status === "failed" ? "failed" : "ok";
      if (!previous || status === "failed") {
        out[id] = {
          status,
          durationMs: (previous?.durationMs ?? 0) + (step.durationMs ?? 0),
        };
      }
    }
    for (const skipped of run.trace.skipped)
      out[skipped.nodeId] = { status: "skipped" };
    return out;
  });

  const overlaySteps = computed<TraceStep[] | null>(() =>
    overlayIsTest.value ? (overlayRun.value?.trace.steps ?? null) : null,
  );

  // The dock's "Test run" tab only exists while a test run is on screen.
  watch(overlaySteps, (steps) => {
    if (!steps && dockTab.value === "test") dockTab.value = "problems";
  });

  /** The step of the selected node in the run on screen, for the inspector. */
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

  /** A real run of an older version than the one open says so. */
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

  /** The overlay banner's tone and icon, by how the run ended. */
  const overlayLook = computed(() => {
    const status = overlayRun.value?.status;
    if (status === "failed")
      return { tone: "error", icon: "i-ph-bug" } as const;
    return { tone: "success", icon: "i-ph-check-circle" } as const;
  });

  /** Shows a stored run over the canvas; a test run is told by its kind. */
  function displayRun(run: RunDetail) {
    overlayRun.value = run;
    overlayIsTest.value = run.kind === "test";
    if (run.failedNodeId) selectNode(run.failedNodeId.split("__")[0]!);
  }

  async function showRun(runId: string): Promise<RunDetail> {
    const run = await runsApi.getRun(runId);
    displayRun(run);
    return run;
  }

  /**
   * `?run=`: the run is shown over the procedure it ran, which the builder
   * opens if another one is asked; a run that no longer exists is said.
   */
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
      presentError(error, {
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
      // Switching clears the run on screen: show this one after it.
      await nextTick();
    }
    displayRun(run);
  }

  function exitDebug() {
    overlayRun.value = null;
    overlayIsTest.value = false;
    if (queryValue("run"))
      void router.replace(`${builderPath()}?selected=${selectedId.value}`);
  }

  /** A step a test runs for real, as `POST /procedures/:id/test-effects` lists it. */
  interface RealEffectStep {
    nodeId: string;
    typeId: string;
    typeName: string;
    label?: string;
  }

  /**
   * Asks before a test that acts for real: the steps that would (actions that
   * cannot simulate) are listed. Resolves `true` at once when there are none.
   */
  async function confirmRealEffects(
    procedureId: string,
    graph: unknown,
  ): Promise<boolean> {
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
      impact: realEffects.map((step) => ({
        icon: "i-ph-lightning",
        label: processI18n(step.typeName),
        ...(step.label ? { count: step.label } : {}),
      })),
    });
  }

  async function onTestRun() {
    const current = selected.value;
    // One test at a time: Ctrl+Enter pressed again waits for it.
    if (!current || editorMode.value !== "procedure" || testing.value) return;
    let payload: unknown;
    try {
      payload = JSON.parse(testPayload.value || "null");
    } catch (error) {
      dockTab.value = "payload";
      dockCollapsed.value = false;
      presentError(error, {
        fallbackKey: "dms_automation.editor.dock.invalidJson",
      });
      return;
    }
    testing.value = true;
    try {
      // Steps that act for real (an e-mail sent, a record written) are named
      // before the test runs, never after: closing the question runs nothing.
      if (!(await confirmRealEffects(current._id, current.graph))) return;
      // The previous result leaves the canvas while this test runs.
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
      await showRun(res.runId);
      dockTab.value = "test";
      dockCollapsed.value = false;
      void recentRunsRead.refresh();
    } catch (e) {
      const refused = issuesOf(e);
      if (refused) {
        issues.value = refused;
        dockTab.value = "problems";
        dockCollapsed.value = false;
      }
      presentError(e, {
        fallbackKey: "dms_automation.editor.testRunError",
      });
    } finally {
      testing.value = false;
    }
  }

  /** Run now runs the saved graph: with unsaved changes, say so first. */
  async function openRunNow() {
    if (!selected.value) return;
    if (isDirty.value) {
      // Closing the question (Escape, ✕, a click outside) runs nothing.
      const choice = await askChoice({
        title: t("dms_automation.editor.runSaved.title"),
        description: t("dms_automation.editor.runSaved.description", {
          count: changeCount.value,
        }),
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
      });
      if (choice === "cancel") return;
      if (choice === "test") {
        await onTestRun();
        return;
      }
    }
    runNowOpen.value = true;
  }

  /** A run of the saved version ended: show it, and say how it went. */
  async function onRunStarted(runId: string) {
    const name = savedName.value;
    const trace = {
      label: t("dms_automation.runs.trace"),
      onClick: () => void router.push(`${props.traceUrl}?run=${runId}`),
    };
    void recentRunsRead.refresh();
    void summariesRead.refresh();
    let run: RunDetail;
    try {
      run = await showRun(runId);
    } catch (error) {
      presentError(error, {
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

  /**
   * Debugging a real run: once the fix is saved, run it again with the payload
   * it received, on the saved version, and show the new run in its place.
   */
  async function rerunOverlay() {
    const run = overlayRun.value;
    if (!run || overlayIsTest.value) return;
    let newRunId: string | null = null;
    const confirmed = await confirm({
      title: t("dms_automation.runs.rerunConfirmTitle"),
      description: t("dms_automation.runs.rerunConfirmDescription"),
      color: "warning",
      icon: "i-ph-arrow-clockwise",
      confirmLabel: t("dms_automation.runs.rerun"),
      onConfirm: async () => {
        newRunId = (await runsApi.rerun(run._id)).runId;
      },
    });
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
    recentRunsRead,
    recentRuns,
    runStates,
    overlaySteps,
    selectedRunStep,
    overlayLabel,
    overlayDescription,
    overlaySummary,
    overlayLook,
    exitDebug,
    onTestRun,
    openRunNow,
    onRunStarted,
    rerunOverlay,
    openTrace,
    openRunFromUrl,
  };
}

export type RunOverlay = ReturnType<typeof useRunOverlay>;
