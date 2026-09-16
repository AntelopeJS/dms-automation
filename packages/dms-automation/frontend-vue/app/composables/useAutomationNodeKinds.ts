import type { JsonSchema } from "./useGraphConnect";
import { type ListEnvelope, unwrapList } from "../utils/automation";

export interface PortRef {
  name: string;
  type?: string;
}

export interface NodeKindUI {
  label: string;
  icon?: string;
  hasTriggerIn: boolean;
  hasMainTriggerOut: boolean;
  staticTriggerOuts: string[];
  staticDataIns: PortRef[];
  staticDataOuts: PortRef[];
  dynamicTriggerOutsFromConfig?: string;
  typeRegistry?: "triggers" | "actions" | "dataNodes";
  dataInsFromTypeSchema?: "inputSchema" | "outputSchema" | "configSchema";
  dataOutsFromTypeSchema?: "inputSchema" | "outputSchema" | "configSchema";
  labelFromType?: boolean;
  iconFromType?: boolean;
  categoryFromType?: boolean;
  category?: string;
  defaultConfig?: Record<string, unknown>;
  configSchema?: JsonSchema;
}

export interface NodeKindEntry {
  kind: string;
  meta: {
    continuationPorts: string[];
    sidePorts: string[];
    ui?: NodeKindUI;
  };
}

export function useAutomationNodeKinds() {
  const { $authFetch } = useAuthFetch();
  return {
    async list(): Promise<NodeKindEntry[]> {
      const data = await $authFetch<
        NodeKindEntry[] | ListEnvelope<NodeKindEntry>
      >("/api/automation/node-kinds");
      return unwrapList(data);
    },
  };
}
