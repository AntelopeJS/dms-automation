// `./category` must run first so RegisterModule("automation") fires
// before any @RegisterPage decorator below — pages look up the module
// synchronously when their decorator is invoked at import time.
//
// Nav order (per the v2 DMS mockups): Overview, Procedures, Builder, Library,
// Runs. Library consolidates the former Triggers / Actions / Data Nodes /
// Templates pages into one tabbed page; Builder is the node editor (formerly
// "Editor"); Procedures is the dedicated procedure list.
import "./category";
import "./overview";
import "./procedures";
import "./builder";
import "./library";
import "./runs";
