import { defineConfig } from "@antelopejs/interface-core/config";

const preferredApiPort = process.env.PORT ?? "5010";
const dmsClientUrl = process.env.DMS_CLIENT_BASE_URL;

type ClusterDriver = "auto" | "redis" | "memory";

interface AutomationConfig {
  runs?: { retentionDays?: number; sensitiveNames?: string[] };
  httpRequest?: { blockPrivateNetwork?: boolean };
  cluster?: { driver?: ClusterDriver };
}

/**
 * The module's options, each from a `VERIFY_AUTO_*` variable a journey sets in
 * the run's environment before it restarts the backend. Unset, the module
 * runs its own defaults.
 */
function automationConfig(): AutomationConfig {
  const env = process.env;
  const config: AutomationConfig = {};
  const runs: NonNullable<AutomationConfig["runs"]> = {};
  if (env.VERIFY_AUTO_RETENTION_DAYS) runs.retentionDays = Number(env.VERIFY_AUTO_RETENTION_DAYS);
  if (env.VERIFY_AUTO_SENSITIVE_NAMES) runs.sensitiveNames = env.VERIFY_AUTO_SENSITIVE_NAMES.split(",");
  if (Object.keys(runs).length > 0) config.runs = runs;
  if (env.VERIFY_AUTO_BLOCK_PRIVATE) config.httpRequest = { blockPrivateNetwork: env.VERIFY_AUTO_BLOCK_PRIVATE === "1" };
  if (env.VERIFY_AUTO_CLUSTER_DRIVER) {
    const driver = (["auto", "redis", "memory"] as const).find((candidate) => candidate === env.VERIFY_AUTO_CLUSTER_DRIVER);
    if (driver) config.cluster = { driver };
  }
  return config;
}

/**
 * The DMS `apiBaseUrl`: the API's public URL by default, left out (the DMS
 * default, a loopback address) with `default`, empty with `empty`, or the
 * given URL.
 */
function apiBaseUrl(): string | undefined {
  const mode = process.env.VERIFY_AUTO_API_BASE_URL;
  if (mode === "default") return undefined;
  if (mode === "empty") return "";
  return mode || "${@api.API_PUBLIC_BASE_URL}";
}

/**
 * The `@antelopejs/api` module: the published package, or a local copy that
 * reads `RouteHandler.controller` (`VERIFY_AUTO_API_PATH`), which webhooks
 * need when the published package still reads `proto`.
 */
function apiSource() {
  return { type: "local", path: process.env.VERIFY_AUTO_API_PATH ?? "../api-module" } as const;
}

/**
 * The repository's playground with the ports, origins, secrets and mail
 * `dms-control` sets for a run, a fixture module (`app`) and the module under
 * verification built from the checkout.
 */
export default defineConfig({
  name: "verify-dms-automation",
  modules: {
    app: {
      source: { type: "local", path: "." },
    },
    "dms-automation": {
      source: { type: "local", path: "../../../../packages/dms-automation" },
      config: automationConfig(),
    },
    dms: {
      source: {
        type: "package",
        package: "@antelopejs/dms",
        version: ">=0.11.0 <1.0.0",
      },
      config: {
        homepage: "/modules/automation/overview",
        meta: { title: "AntelopeJS Automation", description: "Automation verification" },
        auth: {
          jwtSecret: process.env.DMS_JWT_SECRET ?? "dev",
          signInCountry: { database: false },
        },
        htmlRender: {
          serviceSecret: process.env.DMS_HTML_RENDER_SECRET ?? "dev",
          renderEndpoint: dmsClientUrl && `${dmsClientUrl}/api/html/render`,
        },
        apiBaseUrl: apiBaseUrl(),
        clientBaseUrl: dmsClientUrl,
        frontend: { bootstrapSecret: process.env.DMS_BOOTSTRAP_SECRET },
        docsPreview: true,
      },
    },
    mongodb: {
      source: {
        type: "package",
        package: "@antelopejs/mongodb",
        version: "^1.5.0",
      },
      config: {
        url: process.env.MONGO_URL ?? "mongodb://localhost:27017",
        database: process.env.MONGO_DATABASE ?? "verify_dms_automation",
      },
      importOverrides: [],
      disabledExports: [],
    },
    "auth-jwt": {
      source: {
        type: "package",
        package: "@antelopejs/auth-jwt",
        version: "^1.0.3",
      },
      config: { secret: process.env.AUTH_JWT_SECRET ?? "dev" },
    },
    "file-storage-local": {
      source: {
        type: "package",
        package: "@antelopejs/file-storage-local",
        version: ">=0.1.13 <1.0.0",
      },
      config: {
        storagePath: ".antelope/file-storage",
        baseUrl: "${@api.API_PUBLIC_BASE_URL}",
        defaultVisibility: "private",
      },
    },
    nodemailer: {
      source: {
        type: "package",
        package: "@antelopejs/nodemailer",
        version: ">=0.0.6 <1.0.0",
      },
      config: {
        host: "127.0.0.1",
        port: Number(process.env.DMS_SMTP_PORT ?? "9"),
      },
    },
    api: {
      source: apiSource(),
      config: {
        servers: [{ protocol: "http", port: preferredApiPort }],
        publicBaseUrl: process.env.DMS_CLIENT_BASE_URL,
        cors: {
          allowedOrigins: [process.env.DMS_CLIENT_BASE_URL ?? "http://localhost:3001"],
        },
      },
    },
  },
});
