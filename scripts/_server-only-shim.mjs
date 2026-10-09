/**
 * Node loader hook for operator scripts: the "server-only" package throws when
 * imported outside a React server environment, which is exactly where these
 * scripts run. Register it before importing app modules:
 *
 *   import { register } from "node:module";
 *   register("./_server-only-shim.mjs", import.meta.url);
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return { url: "data:text/javascript,export%20{}", shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
