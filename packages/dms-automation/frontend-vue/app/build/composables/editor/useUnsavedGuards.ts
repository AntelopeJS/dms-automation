import { ref, watch } from "vue";
import type { EditorContext } from "./useEditorContext";
import type { ChoiceQuestion } from "../../types/editor";
import type { GraphHistory } from "./useGraphHistory";
import type { DraftProblems } from "./useDraftProblems";
import { isBoolean, isRecord, isString } from "../../../utils/json";

type ChoiceDialogState = ChoiceQuestion<string> & {
  open: boolean;
  resolve?(choice: string): void;
};

/** A visit the DMS leave guard does not hold, as Inertia announces it before it starts. */
interface PendingVisit {
  url: URL;
  method?: string;
  prefetch: boolean;
  preserveState: boolean;
  replace?: boolean;
}

interface TraverseDestination {
  url: string;
  key: string;
  sameDocument: boolean;
}

interface NavigationLike extends EventTarget {
  traverseTo: (key: string) => void;
}

function pendingVisit(event: Event): PendingVisit | undefined {
  if (!(event instanceof CustomEvent)) return undefined;
  const detail: unknown = event.detail;
  if (!isRecord(detail) || !isRecord(detail.visit)) return undefined;
  const { url, method, prefetch, preserveState, replace } = detail.visit;
  if (!(url instanceof URL)) return undefined;
  return {
    url,
    method: isString(method) ? method : undefined,
    prefetch: Boolean(prefetch),
    preserveState: preserveState === true,
    replace: isBoolean(replace) ? replace : undefined,
  };
}

function traverseDestination(event: Event): TraverseDestination | undefined {
  if (!("navigationType" in event) || event.navigationType !== "traverse")
    return undefined;
  if (!("destination" in event) || !isRecord(event.destination))
    return undefined;
  const { url, key, sameDocument } = event.destination;
  if (!isString(url) || !isString(key) || !isBoolean(sameDocument))
    return undefined;
  return { url, key, sameDocument };
}

function isNavigationLike(value: unknown): value is NavigationLike {
  return (
    value instanceof EventTarget &&
    "traverseTo" in value &&
    typeof value.traverseTo === "function"
  );
}

function browserNavigation(): NavigationLike | undefined {
  if (typeof window === "undefined" || !("navigation" in window))
    return undefined;
  const navigation: unknown = window.navigation;
  return isNavigationLike(navigation) ? navigation : undefined;
}

function chosenAnswer<C extends string>(
  question: ChoiceQuestion<C>,
  answer: string,
): C {
  return (
    question.choices.find((choice) => choice.value === answer)?.value ??
    question.dismiss
  );
}

function leaveQuestion(
  t: EditorContext["t"],
  name: string,
  count: number,
): ChoiceQuestion<"discard" | "stay" | "save"> {
  return {
    title: t("dms_automation.editor.leave.title", { name }),
    description: t("dms_automation.editor.leave.description", { count }),
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
  };
}

/** The pending question of a choice dialog: `askChoice` opens it, an answer or a dismissal closes it. */
function useChoiceDialog() {
  const choiceDialog = ref<ChoiceDialogState>({
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
        resolve: (answer) => resolve(chosenAnswer(question, answer)),
      };
    });
  }

  function answerChoice(choice: string) {
    const dialog = choiceDialog.value;
    choiceDialog.value = { ...dialog, open: false, resolve: undefined };
    dialog.resolve?.(choice);
  }

  function onChoiceDialogOpen(open: boolean) {
    if (!open && choiceDialog.value.open)
      answerChoice(choiceDialog.value.dismiss);
  }

  return { choiceDialog, askChoice, onChoiceDialogOpen, answerChoice };
}

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

  const choices = useChoiceDialog();
  const { askChoice } = choices;

  async function confirmDiscard(): Promise<boolean> {
    if (!isDirty.value) return true;
    const choice = await askChoice(
      leaveQuestion(t, savedName.value, changeCount.value),
    );
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

  watch(isDirty, (dirty) => (unsavedDraft.value = dirty), { immediate: true });

  function onInertiaBefore(event: Event) {
    const visit = pendingVisit(event);
    if (!visit || visit.prefetch) return;
    if (visit.method && visit.method.toLowerCase() !== "get") return;
    if (visit.url.pathname !== builderPath() || !isDirty.value) return;
    const keepsPage = visit.preserveState;
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

  let traverseAllowed = false;

  function onNavigate(event: Event) {
    const destination = traverseDestination(event);
    if (!destination) return;
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
      browserNavigation()?.traverseTo(destination.key);
    });
  }

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
    ...choices,
    confirmDiscard,
    onPickProcedure,
    onInertiaBefore,
    onNavigate,
    browserNavigation,
  };
}

export type UnsavedGuards = ReturnType<typeof useUnsavedGuards>;
