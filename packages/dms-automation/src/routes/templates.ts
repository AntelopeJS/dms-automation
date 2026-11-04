import {
  Controller,
  Delete,
  Get,
  HTTPResult,
  JSONBody,
  Parameter,
  Post,
  Put,
} from "@antelopejs/interface-api";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { AuthUserWithPermission } from "@antelopejs/interface-dms/guards";
import { AuthOwnerOnly, AuthRawUser } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { z } from "zod";
import {
  AutomationTemplateModel,
  type AutomationTemplateRow,
  type TemplateNesting,
  type TemplateUsage,
  templateInstancesOf,
} from "../db/models/automation_template.model";
import { ProcedureModel } from "../db/models/procedure.model";
import { BuilderPageController } from "../pages/builder";
import { TEMPLATES_TOPIC } from "../pages/library";
import { notifyTopic } from "../realtime";
import {
  forkTemplateInstances,
  type TemplateCache,
} from "../runtime/resolveSubgraph";
import { subscriptions } from "../runtime/subscriptions";
import { findTemplateRefCycle } from "../runtime/validateTemplate";
import { DATABASE_NAME } from "../types/constants";
import {
  type GroupPort,
  parseGraph,
  type ProcedureGraph,
} from "../types/graph";
import type { Paginated } from "../types/pagination";
import {
  groupPortSchema,
  parseAndValidate,
  procedureGraphSchema,
} from "./graphSchema";
import { pageParams } from "./requests";
import type { DataValue } from "../types/dataValue";

/** An Iconify name, `i-<set>-<icon>`; empty keeps the default icon. */
const ICON_PATTERN = /^i-[a-z0-9]+-[a-z0-9-]+$/;

const templateBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional(),
  icon: z
    .string()
    .regex(ICON_PATTERN, "expected an icon name like i-ph-package")
    .or(z.literal(""))
    .optional(),
  ports: z.array(groupPortSchema).superRefine((ports, ctx) => {
    const seen = new Set<string>();
    for (const [index, port] of ports.entries()) {
      const key = `${port.direction}/${port.kind}/${port.name}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "name"],
          message: `duplicate port ${key}`,
        });
      }
      seen.add(key);
    }
  }),
  subgraph: procedureGraphSchema,
});

/**
 * Templates are few and every caller wants them all (the library, the
 * builder's palette), so a page holds up to 1000 of them by default.
 */
const TEMPLATE_PAGE_SIZES = { defaultSize: 1000, maxSize: 1000 };

interface ParsedTemplateBody {
  name: string;
  description?: string;
  icon?: string;
  ports: GroupPort[];
  subgraph: ProcedureGraph;
}

function parseTemplateBody(body: DataValue): ParsedTemplateBody {
  return parseAndValidate(templateBodySchema, body, (d) => d.subgraph);
}

/**
 * Pre-load every template once per request and build the synchronous lookup
 * `findTemplateRefCycle` needs. We optionally splice in a candidate (the
 * in-flight POST/PUT) so the DFS can resolve self-references through it.
 */
async function buildTemplateRefLookup(candidate?: {
  id: string;
  subgraph: ProcedureGraph;
}): Promise<TemplateCache> {
  const templateModel = GetModel(AutomationTemplateModel, DATABASE_NAME);
  const byId = new Map<string, { subgraph: ProcedureGraph }>();
  for (const t of await templateModel.listAll()) {
    byId.set(t._id, { subgraph: t.subgraph });
  }
  if (candidate) {
    byId.set(candidate.id, { subgraph: candidate.subgraph });
  }
  return {
    get(id: string) {
      return byId.get(id);
    },
  };
}

/**
 * How many procedures and other templates place each template, via a single
 * scan of both (avoids N round-trips through `findUsages`). An owner placing
 * a template twice counts once, as the library's catalogs count procedures.
 */
async function computeUsageCounts(
  templates: AutomationTemplateRow[],
): Promise<Map<string, number>> {
  const procedureModel = GetModel(ProcedureModel, DATABASE_NAME);
  const graphs: ProcedureGraph[] = templates.map((t) => t.subgraph);
  for (const p of await procedureModel.getAll()) {
    try {
      graphs.push(parseGraph(p.graph));
    } catch {
      continue;
    }
  }
  const counts = new Map<string, number>();
  for (const graph of graphs) {
    const placed = new Set<string>();
    for (const { node } of templateInstancesOf(graph)) {
      placed.add(node.templateId);
    }
    for (const id of placed) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** Where a template is placed: in procedures, and in other templates. */
type TemplateUsages = {
  procedures: TemplateUsage[];
  templates: TemplateNesting[];
};

async function usagesOf(id: string): Promise<TemplateUsages> {
  const templateModel = GetModel(AutomationTemplateModel, DATABASE_NAME);
  const [procedures, templates] = await Promise.all([
    templateModel.findUsages(id),
    templateModel.findNestings(id),
  ]);
  return { procedures, templates };
}

function usageTotal(usages: TemplateUsages): number {
  return usages.procedures.length + usages.templates.length;
}

/** 409 when another template already has this name, whatever its case. */
async function assertNameFree(name: string, exceptId?: string): Promise<void> {
  const templateModel = GetModel(AutomationTemplateModel, DATABASE_NAME);
  const wanted = name.toLocaleLowerCase();
  const taken = (await templateModel.listAll()).some(
    (t) => t._id !== exceptId && t.name.trim().toLocaleLowerCase() === wanted,
  );
  if (taken) {
    throw new HTTPResult(409, {
      error: `a template named "${name}" already exists`,
      code: "name-taken",
    });
  }
}

/**
 * Turn the instances of `template` that other templates place into local
 * groups holding a copy of its graph, so those templates keep working once it
 * is gone.
 */
async function forkNestings(
  nestings: TemplateNesting[],
  template: AutomationTemplateRow,
): Promise<void> {
  const templateModel = GetModel(AutomationTemplateModel, DATABASE_NAME);
  for (const hostId of new Set(nestings.map((n) => n.templateId))) {
    const host = await templateModel.getById(hostId);
    if (!host || forkTemplateInstances(host.subgraph, template) === 0) {
      continue;
    }
    await templateModel.updateById(hostId, { subgraph: host.subgraph });
    await subscriptions.onTemplateChange(hostId);
  }
}

interface TemplateWithUsage extends AutomationTemplateRow {
  usageCount: number;
}

/** Result of DELETE /templates/:id — the removed id and how many usages forked. */
interface RemoveTemplateResult {
  _id: string;
  forked: number;
}

/**
 * A unique sentinel id used for the cycle check on POST. The new template's
 * real id is generated by the DB on insert, so we feed the cycle detector a
 * placeholder. No other template can reference this id (it never escapes this
 * request), which means a self-cycle via the candidate is only possible if the
 * candidate's own subgraph references it — which would require the client to
 * have already sent the placeholder, which won't happen organically.
 */
const POST_CANDIDATE_ID = "__candidate__";

@AuthOwnerOnly()
export class TemplatesController extends Controller(
  "/api/automation/templates",
) {
  @Get("")
  async list(
    @AuthRawUser() _user: User,
    @Parameter("page", "query") page?: string,
    @Parameter("limit", "query") limit?: string,
  ): Promise<Paginated<TemplateWithUsage>> {
    const query = pageParams(page, limit, TEMPLATE_PAGE_SIZES);
    const templateModel = GetModel(AutomationTemplateModel, DATABASE_NAME);
    const [listed, all] = await Promise.all([
      templateModel.list(query),
      templateModel.listAll(),
    ]);
    const usageCounts = await computeUsageCounts(all);
    return {
      ...listed,
      results: listed.results.map((t) => ({
        ...t,
        usageCount: usageCounts.get(t._id) ?? 0,
      })),
    };
  }

  @Get("/:id")
  async getOne(
    @AuthRawUser() _user: User,
    @Parameter("id", "param") id: string,
  ): Promise<AutomationTemplateRow> {
    const templateModel = GetModel(AutomationTemplateModel, DATABASE_NAME);
    const template = await templateModel.getById(id);
    if (!template) {
      throw new HTTPResult(404, { error: `template "${id}" not found` });
    }
    return template;
  }

  @Post("")
  async create(
    @AuthUserWithPermission(BuilderPageController) _user: User,
    @JSONBody() body: DataValue,
  ): Promise<AutomationTemplateRow> {
    const data = parseTemplateBody(body);
    await assertNameFree(data.name);
    const lookup = await buildTemplateRefLookup({
      id: POST_CANDIDATE_ID,
      subgraph: data.subgraph,
    });
    const cycle = findTemplateRefCycle(
      POST_CANDIDATE_ID,
      data.subgraph,
      lookup,
    );
    if (cycle) {
      throw new HTTPResult(400, {
        error: "template reference cycle",
        cycle,
      });
    }
    const templateModel = GetModel(AutomationTemplateModel, DATABASE_NAME);
    const created = await templateModel.create({
      name: data.name,
      description: data.description ?? "",
      icon: data.icon ?? "",
      ports: data.ports,
      subgraph: data.subgraph,
    });
    await subscriptions.onTemplateChange(created._id);
    notifyTopic(TEMPLATES_TOPIC, "created", { id: created._id });
    return created;
  }

  @Put("/:id")
  async update(
    @AuthUserWithPermission(BuilderPageController) _user: User,
    @Parameter("id", "param") id: string,
    @JSONBody() body: DataValue,
  ): Promise<AutomationTemplateRow> {
    const data = parseTemplateBody(body);
    const templateModel = GetModel(AutomationTemplateModel, DATABASE_NAME);
    const existing = await templateModel.getById(id);
    if (!existing) {
      throw new HTTPResult(404, { error: `template "${id}" not found` });
    }
    await assertNameFree(data.name, id);
    const lookup = await buildTemplateRefLookup({
      id,
      subgraph: data.subgraph,
    });
    const cycle = findTemplateRefCycle(id, data.subgraph, lookup);
    if (cycle) {
      throw new HTTPResult(400, {
        error: "template reference cycle",
        cycle,
      });
    }
    const updated = await templateModel.updateById(id, {
      name: data.name,
      description: data.description ?? "",
      icon: data.icon ?? "",
      ports: data.ports,
      subgraph: data.subgraph,
    });
    await subscriptions.onTemplateChange(id);
    notifyTopic(TEMPLATES_TOPIC, "updated", { id });
    return updated;
  }

  /**
   * Delete a template. One still in use is refused (409) unless `force` is
   * given, which turns each usage into a local group first.
   *
   * Fork BEFORE deleting from the cache — forkUsageToLocal reads
   * templateCache to deep-clone the subgraph. onTemplateDelete() below
   * removes the cache entry; doing it the other way around leaves
   * dangling references.
   *
   * Forking rewrote those procedures' graphs in the DB. Propagate a
   * procedure change so this instance AND peers refresh their live
   * graph for the forked procedures.
   *
   * A usage left behind would fail its procedure at the next run, with the
   * template's graph gone: keep the template, and name what is left.
   */
  @Delete("/:id")
  async remove(
    @AuthUserWithPermission(BuilderPageController) _user: User,
    @Parameter("id", "param") id: string,
    @Parameter("force", "query") force?: string,
  ): Promise<RemoveTemplateResult> {
    const templateModel = GetModel(AutomationTemplateModel, DATABASE_NAME);
    const existing = await templateModel.getById(id);
    if (!existing) {
      throw new HTTPResult(404, { error: `template "${id}" not found` });
    }
    const usages = await usagesOf(id);
    const forced = force === "1" || force === "true";
    if (usageTotal(usages) > 0 && !forced) {
      throw new HTTPResult(409, {
        error: "template has usages; pass ?force=1 to fork them",
        code: "in-use",
        ...usages,
      });
    }
    if (forced) {
      for (const usage of usages.procedures) {
        await subscriptions.forkUsageToLocal(
          usage.procedureId,
          usage.nodeId,
          usage.groupPath,
        );
      }
      await forkNestings(usages.templates, existing);
      if (usages.procedures.length > 0) {
        await subscriptions.onProcedureChange();
      }
    }
    const left = await usagesOf(id);
    if (usageTotal(left) > 0) {
      throw new HTTPResult(409, {
        error:
          "some usages could not be turned into local groups; the template was kept",
        code: "fork-incomplete",
        ...left,
      });
    }
    await templateModel.deleteById(id);
    await subscriptions.onTemplateDelete(id);
    notifyTopic(TEMPLATES_TOPIC, "deleted", { id });
    return { _id: id, forked: forced ? usageTotal(usages) : 0 };
  }

  @Get("/:id/usages")
  async usages(
    @AuthRawUser() _user: User,
    @Parameter("id", "param") id: string,
  ): Promise<TemplateUsages> {
    const templateModel = GetModel(AutomationTemplateModel, DATABASE_NAME);
    if (!(await templateModel.getById(id))) {
      throw new HTTPResult(404, { error: `template "${id}" not found` });
    }
    return await usagesOf(id);
  }
}
