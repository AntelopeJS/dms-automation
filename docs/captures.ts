import { defineScenes } from "@antelopejs/tooling-configs/capture";

/** The selector of one node of the builder canvas, by its graph id. */
function canvasNode(id: string): string {
  return `.vue-flow__node[data-id="${id}"]`;
}

/** A group whose steps hand one number to its `value` output. */
function summaryGroup(id: string, label: string, x: number, panels: number) {
  return {
    id,
    kind: "group",
    label,
    config: {},
    position: { x, y: 0 },
    ports: [
      { name: "in", kind: "trigger", direction: "in" },
      { name: "out", kind: "trigger", direction: "out" },
      {
        name: "value",
        kind: "data",
        direction: "out",
        schema: { type: "number" },
      },
    ],
    subgraph: {
      nodes: [
        { id: "gi", kind: "groupInput", config: {}, position: { x: 0, y: 0 } },
        {
          id: "panels",
          kind: "data",
          typeId: "const.number",
          label: "Panneaux",
          config: { value: panels },
          position: { x: 300, y: 160 },
        },
        {
          id: "go",
          kind: "groupOutput",
          config: {},
          position: { x: 600, y: 0 },
        },
      ],
      triggerEdges: [
        {
          id: "s1",
          from: { node: "gi", branch: "in" },
          to: { node: "go", branch: "out" },
        },
      ],
      dataEdges: [
        {
          id: "s2",
          from: { node: "panels", port: "value" },
          to: { node: "go", field: "value" },
        },
      ],
    },
  };
}

/** The procedure the group scenes import: a manual trigger, then a local group, then the group saved as a template. */
const groupsProcedure = {
  name: "Récapitulatif de chantier",
  description:
    "Compte les panneaux posés sur un chantier, avec un groupe local et un modèle partagé.",
  graph: {
    nodes: [
      {
        id: "run",
        kind: "trigger",
        typeId: "manual",
        label: "Lancer le récapitulatif",
        config: {},
        position: { x: 0, y: 0 },
      },
      summaryGroup("local", "Récapitulatif local", 380, 12),
      summaryGroup("shared", "Récapitulatif partagé", 760, 24),
    ],
    triggerEdges: [
      { id: "e1", from: { node: "run" }, to: { node: "local", branch: "in" } },
      {
        id: "e2",
        from: { node: "local", branch: "out" },
        to: { node: "shared", branch: "in" },
      },
    ],
    dataEdges: [],
  },
};

const MONITORING =
  "/modules/automation/builder?selected=helio.monitoring-alert-ticket";

/**
 * The screenshots of the Automation docs, taken on the Helio demo. The setup scenes run first, in order: the
 * onboarding creates the administrator every scene runs as, a Run now of the monitoring procedure without a
 * payload gives the failed run the Overview and the trace show, and an import gives the procedure with a local
 * group and a template. No scene signs out, because every scene shares one browser session.
 */
export default defineScenes([
  {
    id: "onboarding",
    route: "/onboarding",
    setup: true,
    steps: [
      { action: "fill", selector: 'input[name="name"]', value: "Helio" },
      {
        action: "click",
        selector: 'button:has-text("Continue to administrator")',
      },
      { action: "wait", selector: 'input[name="firstName"]' },
      { action: "fill", selector: 'input[name="firstName"]', value: "Sophie" },
      { action: "fill", selector: 'input[name="lastName"]', value: "Lambert" },
      {
        action: "fill",
        selector: 'input[name="email"]',
        value: "sophie.lambert@helio.be",
      },
      {
        action: "fill",
        selector: 'input[name="password"]',
        value: "HelioDocs2026!",
      },
      {
        action: "click",
        selector: 'button:has-text("Create administrator account")',
      },
      { action: "wait", selector: 'button:has-text("Open the dashboard")' },
      { action: "click", selector: 'button:has-text("Open the dashboard")' },
    ],
  },
  {
    id: "automation-failed-run",
    route: MONITORING,
    setup: true,
    steps: [
      { action: "wait", selector: canvasNode("ticket") },
      { action: "click", selector: 'button:has-text("Run now")' },
      { action: "wait", selector: '[role="dialog"]' },
      { action: "click", selector: '[role="dialog"] button:text-is("Run")' },
      { action: "wait", selector: "text=/failed/i" },
    ],
  },
  {
    id: "automation-import-groups",
    route: "/modules/automation/procedures",
    setup: true,
    steps: [
      { action: "click", selector: 'button:has-text("Import JSON")' },
      { action: "wait", selector: '[role="dialog"] .cm-content' },
      {
        action: "fill",
        selector: '[role="dialog"] .cm-content',
        value: JSON.stringify(groupsProcedure, null, 2),
      },
      {
        action: "click",
        selector: 'button:has-text("Import and open the builder")',
      },
      { action: "wait", selector: canvasNode("shared") },
      { action: "click", selector: canvasNode("shared") },
      { action: "click", selector: 'button:has-text("Save as template")' },
      { action: "wait", selector: 'input[placeholder="Template name"]' },
      {
        action: "fill",
        selector: 'input[placeholder="Template name"]',
        value: "Récapitulatif partagé",
      },
      { action: "click", selector: 'button:has-text("Save template")' },
      { action: "wait", selector: "text=Linked" },
      { action: "press", key: "Control+s" },
      { action: "wait", selector: "text=Saved" },
    ],
  },
  {
    id: "automation-overview",
    route: "/modules/automation/overview",
    steps: [{ action: "wait", selector: 'text="Open last failure"' }],
    output:
      "packages/dms-automation/docs/images/captures/automation-overview.webp",
  },
  {
    id: "automation-procedures",
    route: "/modules/automation/procedures",
    steps: [{ action: "wait", selector: 'text="Récapitulatif de chantier"' }],
    output:
      "packages/dms-automation/docs/images/captures/automation-procedures.webp",
  },
  {
    id: "automation-builder",
    route: "/modules/automation/builder?selected=helio.urgent-ticket-dispatch",
    steps: [{ action: "wait", selector: canvasNode("notify") }],
    output:
      "packages/dms-automation/docs/images/captures/automation-builder.webp",
  },
  {
    id: "automation-builder-inspector",
    route: MONITORING,
    steps: [
      { action: "wait", selector: canvasNode("ticket") },
      { action: "click", selector: canvasNode("ticket") },
    ],
    output:
      "packages/dms-automation/docs/images/captures/automation-builder-inspector.webp",
  },
  {
    id: "automation-builder-wire-values",
    route: MONITORING,
    steps: [
      { action: "wait", selector: canvasNode("log") },
      { action: "click", selector: canvasNode("log") },
    ],
    output:
      "packages/dms-automation/docs/images/captures/automation-builder-wire-values.webp",
  },
  {
    id: "automation-builder-local-group",
    route: "/modules/automation/procedures",
    steps: [
      { action: "wait", selector: 'text="Récapitulatif de chantier"' },
      { action: "click", selector: 'text="Récapitulatif de chantier"' },
      { action: "wait", selector: canvasNode("local") },
      { action: "click", selector: canvasNode("local") },
      { action: "wait", selector: 'text="Group ports"' },
    ],
    output:
      "packages/dms-automation/docs/images/captures/automation-builder-local-group.webp",
  },
  {
    id: "automation-builder-shared-template",
    route: "/modules/automation/procedures",
    steps: [
      { action: "wait", selector: 'text="Récapitulatif de chantier"' },
      { action: "click", selector: 'text="Récapitulatif de chantier"' },
      { action: "wait", selector: canvasNode("shared") },
      { action: "click", selector: canvasNode("shared") },
      { action: "wait", selector: 'button:has-text("Fork to local group")' },
    ],
    output:
      "packages/dms-automation/docs/images/captures/automation-builder-shared-template.webp",
  },
  {
    id: "automation-runs",
    route: "/modules/automation/runs",
    steps: [{ action: "wait", selector: "tbody >> text=Failed" }],
    output: "packages/dms-automation/docs/images/captures/automation-runs.webp",
  },
  {
    id: "automation-trace",
    route: "/modules/automation/overview",
    steps: [
      { action: "click", selector: 'text="Open last failure"' },
      { action: "wait", selector: 'text="Path taken"' },
    ],
    output:
      "packages/dms-automation/docs/images/captures/automation-trace.webp",
  },
  {
    id: "automation-library",
    route: "/modules/automation/library",
    steps: [{ action: "wait", selector: 'text="Used by"' }],
    output:
      "packages/dms-automation/docs/images/captures/automation-library.webp",
  },
]);
