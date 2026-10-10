import type {
  BannerAction,
  BannerContent,
  BannerTone,
} from "@antelopejs/interface-dms/base";
import type { BlockText } from "@antelopejs/interface-dms/base/types";
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
  traceUrl: string;
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
  const first = hero.failing[0];
  if (hero.state === "failing" && first) {
    return {
      key: `${HEALTH}.failingDetail`,
      params: {
        name: first.name,
        since: first.since
          ? { type: "datetime", value: first.since, format: "short" }
          : "—",
        cause: failureCause(hero),
      },
    };
  }
  const { total, failed } = hero.figures;
  return {
    key: `${HEALTH}.summary`,
    params: {
      runs: total,
      failed,
      enabled: hero.enabled,
      total: hero.procedures,
    },
  };
}

function actions(hero: HealthHero, links: HealthBannerLinks): BannerAction[] {
  const list: BannerAction[] = [];
  const failing = hero.state === "failing";
  if (hero.lastFailure && hero.state !== "healthy") {
    list.push({
      label: `$${HEALTH}.inspectLastFailure`,
      icon: "i-ph-path",
      to: `${links.traceUrl}?run=${hero.lastFailure.runId}`,
      variant: failing ? "solid" : "outline",
      color: failing ? "error" : "neutral",
    });
  }
  if (hero.figures.failed > 0) {
    list.push({
      label: `$${HEALTH}.showFailedRuns`,
      icon: "i-ph-x-circle",
      to: `${links.runsUrl}?tab=failed`,
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
