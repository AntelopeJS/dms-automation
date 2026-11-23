import type { EditorContext } from "./useEditorContext";
import type {
  GroupPort,
  ProcedureGraph,
} from "../../../composables/useGraphConnect";
import type { ProcedureRecord } from "../../types/editor";

interface AutomationTemplateApi {
  _id: string;
  name: string;
  description?: string;
  icon?: string;
  ports: GroupPort[];
  subgraph: ProcedureGraph;
}

const PROCEDURES_PAGE_SIZE = 200;

/** A template as the record the editor works on; `enabled` is pinned to true so the disabled banner never shows for it. */
function templateAsProcedure(tpl: AutomationTemplateApi): ProcedureRecord {
  return {
    _id: tpl._id,
    name: tpl.name,
    description: tpl.description ?? "",
    enabled: true,
    graph: tpl.subgraph,
  };
}

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

  const procedureListRead = useApiData<ProcedureRecord[]>(
    () =>
      editorMode.value === "procedure"
        ? "dms-automation-builder-procedures"
        : null,
    async ({ $authFetch, signal }) => {
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

  const templateRead = useApiData<AutomationTemplateApi>(() =>
    editorTemplateId.value
      ? `/api/automation/templates/${editorTemplateId.value}`
      : null,
  );

  function openList() {
    const error = procedureListRead.error.value;
    if (error) {
      loadError.value = describeApiError(error);
      return;
    }
    loadError.value = null;
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
      missingProcedureId.value = requested;
      return;
    }
    if (!selectedId.value && procedures.value.length > 0) {
      const first = procedures.value[0];
      selectedId.value = first ? first._id : null;
    }
  }

  async function loadList() {
    loading.value = true;
    await procedureListRead.refresh();
    loading.value = false;
    openList();
  }

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
    const adapted = templateAsProcedure(tpl);
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
