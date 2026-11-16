import { guarded } from "../guard.mjs";
import { journeys as list } from "./parts/procedures-page-list.mjs";
import { journeys as actions } from "./parts/procedures-page-actions.mjs";
import { journeys as dialogs } from "./parts/procedures-page-dialogs.mjs";

export const journeys = guarded([...list, ...actions, ...dialogs]);
