import { byRunner, guarded } from "../guard.mjs";
import { journeys as list } from "./parts/procedures-page-list.mjs";
import { journeys as actions } from "./parts/procedures-page-actions.mjs";
import { journeys as dialogs } from "./parts/procedures-page-dialogs.mjs";

const all = guarded([...list, ...actions, ...dialogs]);

export const { journeys, integration } = byRunner(all);
