import { ref, watch } from "vue";
import type { EditorContext } from "./useEditorContext";
import type { ChoiceQuestion } from "../../types/editor";
import type { GraphHistory } from "./useGraphHistory";
import type { DraftProblems } from "./useDraftProblems";

/**
 * The questions with more than a yes and a no, and the guards that ask them
 * before an unsaved draft is left.
 */
export function useUnsavedGuards(
  ctx: EditorContext,
  history: GraphHistory,
  problems: DraftProblems,
  later: { onSave: () => Promise<boolean> },
) {
  const {
    builderPath,
    editorMode,
    missingProcedureId,
    procedures,
    queryValue,
    router,
    selectedId,
    switcherOpen,
    t,
    unsavedDraft,
  } = ctx;
  const { isDirty } = history;
  const { changeCount, onCancel, savedName } = problems;
  const { onSave } = later;

  const choiceDialog = ref<
    ChoiceQuestion<string> & {
      open: boolean;
      resolve?: (choice: string) => void;
    }
  >({
    open: false,
    title: "",
    description: "",
    choices: [],
    dismiss: "",
  });

  function askChoice<C extends string>(
    question: ChoiceQuestion<C>,
  ): Promise<C> {
    return new Promise((resolve) => {
      choiceDialog.value = {
        ...question,
        open: true,
        resolve: resolve as (choice: string) => void,
      };
    });
  }

  /** Escape, ✕ or a click outside answers the question's `dismiss`. */
  function onChoiceDialogOpen(open: boolean) {
    if (!open && choiceDialog.value.open)
      answerChoice(choiceDialog.value.dismiss);
  }

  function answerChoice(choice: string) {
    const resolve = choiceDialog.value.resolve;
    choiceDialog.value = {
      ...choiceDialog.value,
      open: false,
      resolve: undefined,
    };
    resolve?.(choice);
  }

  /** Resolves `true` when the draft may be left: saved, discarded or clean. */
  async function confirmDiscard(): Promise<boolean> {
    if (!isDirty.value) return true;
    const choice = await askChoice({
      title: t("dms_automation.editor.leave.title", { name: savedName.value }),
      description: t("dms_automation.editor.leave.description", {
        count: changeCount.value,
      }),
      choices: [
        {
          value: "discard",
          label: t("dms_automation.editor.discard"),
          color: "error",
          variant: "ghost",
        },
        {
          value: "stay",
          label: t("dms_automation.editor.leave.keep"),
          color: "neutral",
          variant: "outline",
        },
        {
          value: "save",
          label: t("dms_automation.editor.leave.save"),
          color: "primary",
        },
      ],
      dismiss: "stay",
    });
    if (choice === "stay") return false;
    if (choice === "save") return await onSave();
    onCancel();
    return true;
  }

  async function onPickProcedure(id: string) {
    if (!(await confirmDiscard())) return;
    selectedId.value = id;
    void router.replace(`${builderPath()}?selected=${id}`);
  }

  // The template editor guards its draft like the procedure editor.
  watch(isDirty, (dirty) => (unsavedDraft.value = dirty), { immediate: true });

  // The DMS leave guard only holds a visit to another path. A visit to the
  // builder itself that remounts it (the sidebar's "Builder", a link with
  // another ?selected=), or that keeps it mounted but opens another procedure,
  // loses the draft just the same: it is held here and run again once the
  // draft is saved or discarded. The builder's own URL updates go through.
  interface PendingVisit {
    url?: URL;
    method?: string;
    prefetch?: boolean;
    preserveState?: unknown;
    replace?: boolean;
  }

  function onInertiaBefore(event: Event) {
    const visit = (event as CustomEvent<{ visit?: PendingVisit }>).detail
      ?.visit;
    if (!visit?.url || visit.prefetch) return;
    if (visit.method && visit.method.toLowerCase() !== "get") return;
    if (visit.url.pathname !== builderPath() || !isDirty.value) return;
    const keepsPage = visit.preserveState === true;
    if (
      keepsPage &&
      !opensAnotherProcedure(visit.url.searchParams.get("selected"))
    )
      return;
    event.preventDefault();
    const href = `${visit.url.pathname}${visit.url.search}${visit.url.hash}`;
    void confirmDiscard().then((leave) => {
      if (leave)
        void navigateDms(href, {
          preserveState: keepsPage,
          replace: visit.replace,
        });
    });
  }

  function opensAnotherProcedure(id: string | null): id is string {
    return editorMode.value === "procedure" && !!id && id !== selectedId.value;
  }

  // Back and Forward between two addresses of the builder: the DMS guard lets
  // them through (same path). Where the browser announces them before they
  // happen (Navigation API), the draft is asked about first and the step is
  // taken again once it is saved or discarded. A browser without it remounts
  // the page on the step: the DMS guard has the same gap.
  interface TraverseEvent extends Event {
    navigationType?: string;
    destination?: { url: string; key: string; sameDocument: boolean };
  }

  interface NavigationLike extends EventTarget {
    traverseTo: (key: string) => unknown;
  }

  function browserNavigation(): NavigationLike | undefined {
    return typeof window === "undefined"
      ? undefined
      : (window as unknown as { navigation?: NavigationLike }).navigation;
  }

  // Set while the history step the user chose to take is taken again.
  let traverseAllowed = false;

  function onNavigate(event: Event) {
    const { navigationType, destination } = event as TraverseEvent;
    if (navigationType !== "traverse" || !destination) return;
    if (traverseAllowed) {
      traverseAllowed = false;
      return;
    }
    if (!destination.sameDocument || !event.cancelable || !isDirty.value)
      return;
    if (new URL(destination.url).pathname !== builderPath()) return;
    event.preventDefault();
    void confirmDiscard().then((leave) => {
      if (!leave) return;
      traverseAllowed = true;
      void browserNavigation()?.traverseTo(destination.key);
    });
  }

  // ?selected= changed while the page stayed mounted (a visit that keeps it,
  // such as a link to the builder from the builder): the builder opens that

  watch(
    () => queryValue("selected"),
    async (id) => {
      if (!opensAnotherProcedure(id)) return;
      if (!(await confirmDiscard())) {
        void router.replace(`${builderPath()}?selected=${selectedId.value}`);
        return;
      }
      if (procedures.value.some((p) => p._id === id)) {
        selectedId.value = id;
        return;
      }
      missingProcedureId.value = id;
      selectedId.value = null;
      switcherOpen.value = true;
    },
  );

  return {
    choiceDialog,
    askChoice,
    onChoiceDialogOpen,
    answerChoice,
    confirmDiscard,
    onPickProcedure,
    onInertiaBefore,
    onNavigate,
    browserNavigation,
  };
}

export type UnsavedGuards = ReturnType<typeof useUnsavedGuards>;
