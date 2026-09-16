import { RegisterModule } from "@antelopejs/interface-dms/page";

// Registered for its side effect only: RegisterModule("automation") must fire
// at import time (before any @RegisterPage decorator runs) so pages can look
// the module up synchronously. The returned handle is intentionally not bound.
RegisterModule({
  id: "automation",
  title: "$dms_automation.module.title",
  description: "$dms_automation.module.description",
  icon: "i-ph-flow-arrow",
});
