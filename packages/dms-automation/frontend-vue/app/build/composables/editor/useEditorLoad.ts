import type { EditorContext } from "./useEditorContext";
import type {
  GroupPort,
  ProcedureGraph,
} from "../../../composables/useGraphConnect";
import type { ProcedureRecord } from "../../types/editor";

/** Reads what the builder opens, the procedure list or the template `?template=` names, and opens it. */
export function useEditorLoad(ctx: EditorContext) {
  const {
    editorMode,
    editorTemplateId,
    loadError,
    loading,
    missingProcedureId,
    procedures,
    queryValue,
    selectedId,
    t,
    templateIcon,
    templateNotFound,
    templatePorts,
  } = ctx;

  const PROCEDURES_PAGE_SIZE = 200;

  // What the builder opens, read with the page: every procedure, or the
  // template `?template=` names. The editor works on its own copy of what they
  // answered (`procedures`), which its drafts change.
  const procedureListRead = useApiData<ProcedureRecord[]>(
    () =>
      editorMode.value === "procedure"
        ? "dms-automation-builder-procedures"
        : null,
    async ({ $authFetch, signal }) => {
      // The API serves pages of PROCEDURES_PAGE_SIZE at most: read them all.
      const list: ProcedureRecord[] = [];
      for (let page = 0; ; page++) {
        const { results } = await $authFetch<{ results: ProcedureRecord[] }>(
          `/api/automation/procedures?limit=${PROCEDURES_PAGE_SIZE}&page=${page}`,
          { signal },
        );
        list.push(...results);
        if (results.length < PROCEDURES_PAGE_SIZE) break;
      }
      return list;
    },
  );

  interface AutomationTemplateApi {
    _id: string;
    name: string;
    description?: string;
    icon?: string;
    ports: GroupPort[];
    subgraph: ProcedureGraph;
  }

  const templateRead = useApiData<AutomationTemplateApi>(() =>
    editorTemplateId.value
      ? `/api/automation/templates/${editorTemplateId.value}`
      : null,
  );

  /** Opens what the procedure list answered: `?selected=`, else the procedure open, else the first. */
  function openList() {
    const error = procedureListRead.error.value;
    if (error) {
      loadError.value = describeApiError(error);
      return;
    }
    loadError.value = null;
    // Copies: a draft changes the editor's records, not the read's.
    procedures.value = (procedureListRead.data.value ?? []).map((p) => ({
      ...p,
    }));
    if (
      selectedId.value &&
      !procedures.value.some((p) => p._id === selectedId.value)
    ) {
      selectedId.value = null;
    }
    const requested = queryValue("selected");
    if (requested && procedures.value.some((p) => p._id === requested)) {
      selectedId.value = requested;
    } else if (requested && !selectedId.value) {
      // A link to a deleted procedure opens none: the builder says so
      // and offers the switcher (see onMounted).
      missingProcedureId.value = requested;
      return;
    }
    if (!selectedId.value && procedures.value.length > 0) {
      const first = procedures.value[0];
      selectedId.value = first ? first._id : null;
    }
  }

  /** Reads the procedure list again (one was created) and opens it. */
  async function loadList() {
    loading.value = true;
    await procedureListRead.refresh();
    loading.value = false;
    openList();
  }

  /** Opens what the template read answered, or says why there is none. */
  function openTemplate() {
    const id = editorTemplateId.value;
    if (!id) {
      templateNotFound.value = true;
      loadError.value = t("dms_automation.editor.templateNotFound");
      return;
    }
    const error = templateRead.error.value;
    const tpl = templateRead.data.value;
    if (error || !tpl) {
      // Worded for users, the same on the server and in the browser (the
      // raw fetch error names an internal URL that differs between them).
      templateNotFound.value = apiErrorStatus(error) === 404;
      loadError.value = templateNotFound.value
        ? t("dms_automation.editor.templateNotFound")
        : describeApiError(error);
      procedures.value = [];
      selectedId.value = null;
      templatePorts.value = [];
      return;
    }
    templateNotFound.value = false;
    loadError.value = null;
    // Adapt the template into the ProcedureRecord shape so the rest of
    // the editor (history, dirty-tracking, sentinel sync, group toolbar)
    // keeps working unchanged. `enabled` is meaningless for templates;
    // pin it to true so the "disabled" warning banner never appears.
    const adapted: ProcedureRecord = {
      _id: tpl._id,
      name: tpl.name,
      description: tpl.description ?? "",
      enabled: true,
      graph: tpl.subgraph,
    };
    procedures.value = [adapted];
    selectedId.value = adapted._id;
    templateIcon.value = tpl.icon || "i-ph-package";
    templatePorts.value = Array.isArray(tpl.ports)
      ? tpl.ports.map((p) => ({ ...p }))
      : [];
  }

  return {
    procedureListRead,
    templateRead,
    openList,
    loadList,
    openTemplate,
  };
}

export type EditorLoad = ReturnType<typeof useEditorLoad>;
