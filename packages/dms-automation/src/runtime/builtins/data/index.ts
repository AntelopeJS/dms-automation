import type { DataNodeType } from "@antelopejs/interface-dms-automation";
import { booleanNodes } from "./boolean";
import { compareNodes } from "./compare";
import { constantNodes } from "./constant";
import { jsonNodes } from "./json";
import { mathNodes } from "./math";
import { objectNodes } from "./object";
import { stringNodes } from "./string";

export const builtinDataNodes: DataNodeType[] = [
  ...constantNodes,
  ...mathNodes,
  ...compareNodes,
  ...booleanNodes,
  ...stringNodes,
  ...objectNodes,
  ...jsonNodes,
];
