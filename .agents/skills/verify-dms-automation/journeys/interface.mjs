import { guarded } from "../guard.mjs";
import { armingJourneys } from "./parts/interface-contract-arming.mjs";
import { contractJourneys } from "./parts/interface-contract.mjs";
import { moreContractJourneys } from "./parts/interface-contract-more.mjs";
import { declareJourneys } from "./parts/interface-declare.mjs";
import { keepJourneys } from "./parts/interface-declare-keeps.mjs";
import { startJourneys } from "./parts/interface-declare-start.mjs";
import { queueJourneys } from "./parts/interface-queue.mjs";
import { moreRunJourneys } from "./parts/interface-runs-more.mjs";
import { runJourneys } from "./parts/interface-runs.mjs";
import { moreTypeJourneys } from "./parts/interface-types-more.mjs";
import { typeJourneys } from "./parts/interface-types.mjs";

export const journeys = guarded([...typeJourneys, ...moreTypeJourneys, ...runJourneys, ...moreRunJourneys, ...declareJourneys, ...keepJourneys, ...startJourneys, ...contractJourneys, ...moreContractJourneys, ...armingJourneys, ...queueJourneys]);
