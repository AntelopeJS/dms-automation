import {
  RegisterActionType,
  RegisterTriggerType,
} from "@antelopejs/interface-dms-automation";

/**
 * Catalog entries registered by a module OTHER than dms-automation. They exist
 * so the playground exercises type-origin attribution: the builder palette
 * must list these under a "playground" sub-header instead of folding them into
 * the unlabeled built-in section.
 */
export function construct(): void {
  RegisterTriggerType({
    id: "playground.manual",
    name: "Playground trigger",
    description: "Demo trigger registered by the playground module.",
    icon: "i-ph-flask",
    configSchema: { type: "object", properties: {} },
    outputSchema: { type: "object", properties: {} },
    cluster: "replicated",
    activate: () => Promise.resolve(undefined),
    deactivate: () => Promise.resolve(),
  });

  RegisterActionType({
    id: "playground.echo",
    name: "Playground echo",
    description: "Demo action registered by the playground module.",
    icon: "i-ph-flask",
    inputSchema: {
      type: "object",
      properties: { value: { type: "string" } },
    },
    outputSchema: {
      type: "object",
      properties: { value: { type: "string" } },
    },
    execute: (input: { value?: string }) =>
      Promise.resolve({ value: input.value ?? "" }),
  });
}
