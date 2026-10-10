// `./category` must run first so RegisterModule("automation") fires before
// any @RegisterPage decorator below: pages look the module up synchronously
// when their decorator runs at import time.
//
// Menu order follows the two jobs of the module: monitoring (Overview, Run
// history; the run trace is reached from a run) then building (Procedures,
// Builder, Library). The page ids are unchanged, so roles keep their grants.
import "./category";
import "./overview";
import "./runs";
import "./trace";
import "./procedures";
import "./builder";
import "./library";
