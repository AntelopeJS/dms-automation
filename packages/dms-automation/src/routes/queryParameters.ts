import { SetParameterProvider } from "@antelopejs/interface-api";
import { MakeParameterAndPropertyDecorator } from "@antelopejs/interface-core/decorators";

/**
 * Parameter Provider: the named query parameters as one object, keyed by
 * name in the order given. Each is read as `Parameter(name, "query")` reads
 * it: `undefined` when absent, `true` when present without a value.
 */
export const QueryParameters = MakeParameterAndPropertyDecorator(
  (target, key, param, ...names: string[]) => {
    SetParameterProvider(target, key, param, (context) =>
      Object.fromEntries(
        names.map((name) => {
          const value = context.url.searchParams.get(name);
          return [name, value === null ? undefined : value || true];
        }),
      ),
    );
  },
);
