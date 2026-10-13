import type {
  BannerAction,
  BannerContent,
  BannerTone,
} from "@antelopejs/interface-dms/base";
import type {
  BlockText,
  ComposedTextParam,
} from "@antelopejs/interface-dms/base/types";
import { asParam, stepText } from "../runtime/wording";
import type { HealthHero } from "./overview";

/**
 * The overview's opening line as the DMS `Banner` draws it from a route: how
 * automation is doing over the selected window, said in one sentence, with
 * the next action. With no procedure yet it is the first-run state instead:
 * recipes that open "New procedure" with their trigger picked.
 */

const HEALTH = "dms_automation.health";

/** The links the banner points to, and the recipe dialogs it opens. */
export interface HealthBannerLinks {
  runsUrl: string;
  /** The run history's period matching the banner's, to open it on. */
  runsPeriod?: { scope: string; preset: string };
  traceUrl: string;
  proceduresUrl: string;
  /** The "New procedure" dialog with a trigger picked, one per recipe. */
  recipes: BannerAction[];
}

const TONE_BY_STATE: Record<HealthHero["state"], BannerTone> = {
  failing: "error",
  degraded: "warning",
  healthy: "success",
  idle: "info",
  empty: "primary",
};

const ICON_BY_STATE: Record<HealthHero["state"], string> = {
  failing: "i-ph-x-circle",
  degraded: "i-ph-warning",
  healthy: "i-ph-check-circle",
  idle: "i-ph-moon",
  empty: "i-ph-flow-arrow",
};

function headline(hero: HealthHero): BlockText {
  if (hero.state === "failing") {
    return {
      key: `${HEALTH}.failing`,
      params: { count: { type: "count", value: hero.failing.length } },
    };
  }
  if (hero.state === "degraded") {
    return {
      key: `${HEALTH}.degraded`,
      params: { count: { type: "count", value: hero.degraded } },
    };
  }
  return { key: `${HEALTH}.${hero.state === "healthy" ? "healthy" : "idle"}` };
}

/** The last failure's cause: "fetch failed at HTTP request". */
function failureCause(hero: HealthHero): BlockText {
  const failure = hero.lastFailure;
  if (!failure) return "";
  const step = stepText(failure.step);
  return step
    ? {
        key: `${HEALTH}.lastFailureAt`,
        params: { error: failure.error, step: asParam(step) },
      }
    : failure.error;
}

function detail(hero: HealthHero): BlockText {
  const [first, ...others] = hero.failing;
  if (hero.state === "failing" && first) {
    const since: ComposedTextParam = first.since
      ? { type: "datetime", value: first.since, format: "day" }
      : "—";
    // Worded as the procedure list words it, from the code of the refusal.
    const cause: ComposedTextParam = first.armError
      ? {
          key: "dms_automation.procedures.detail.triggerError",
          params: {
            error: {
              key: `dms_automation.editor.problems.codes.${first.armError.code}`,
              params: first.armError.params ?? {},
            },
          },
        }
      : failureCause(hero);
    // Several failing: the first of "Needs attention", and how many more.
    return others.length > 0
      ? {
          key: `${HEALTH}.failingDetailMany`,
          params: {
            name: first.name,
            others: { type: "count", value: others.length },
            since,
            cause,
          },
        }
      : {
          key: `${HEALTH}.failingDetail`,
          params: { name: first.name, since, cause },
        };
  }
  const { total, failed } = hero.figures;
  return {
    key: `${HEALTH}.summaryCount`,
    params: {
      count: { type: "count", value: total },
      failed,
      enabled: hero.enabled,
      total: hero.procedures,
    },
  };
}

/** The failed runs in the run history, over the banner's period when it has one. */
function failedRunsUrl(links: HealthBannerLinks): string {
  const query = new URLSearchParams({ tab: "failed" });
  if (links.runsPeriod) {
    query.set(`${links.runsPeriod.scope}.period`, links.runsPeriod.preset);
  }
  return `${links.runsUrl}?${query}`;
}

function actions(hero: HealthHero, links: HealthBannerLinks): BannerAction[] {
  const list: BannerAction[] = [];
  const failing = hero.state === "failing";
  // Only while something is wrong: a calm or idle window would point to a
  // failure that may be weeks old.
  if (hero.lastFailure && (failing || hero.state === "degraded")) {
    list.push({
      label: `$${HEALTH}.inspectLastFailure`,
      icon: "i-ph-path",
      to: `${links.traceUrl}?run=${hero.lastFailure.runId}`,
      variant: failing ? "solid" : "outline",
      color: failing ? "error" : "neutral",
    });
  }
  // Several failing: which ones comes before their runs, and a third button
  // would squeeze the sentence on a laptop screen.
  if (hero.failing.length > 1) {
    list.push({
      label: `$${HEALTH}.showFailingProcedures`,
      icon: "i-ph-flow-arrow",
      to: `${links.proceduresUrl}?tab=failing`,
      variant: "outline",
      color: "neutral",
    });
  } else if (hero.figures.failed > 0) {
    list.push({
      label: `$${HEALTH}.showFailedRuns`,
      icon: "i-ph-x-circle",
      to: failedRunsUrl(links),
      variant: "outline",
      color: "neutral",
    });
  }
  return list;
}

export function healthBanner(
  hero: HealthHero,
  links: HealthBannerLinks,
): BannerContent {
  const base = {
    tone: TONE_BY_STATE[hero.state],
    icon: ICON_BY_STATE[hero.state],
  };
  if (hero.state === "empty") {
    return {
      ...base,
      title: "$dms_automation.firstRun.title",
      description: "$dms_automation.firstRun.description",
      actions: links.recipes,
    };
  }
  return {
    ...base,
    title: headline(hero),
    description: detail(hero),
    actions: actions(hero, links),
  };
}
