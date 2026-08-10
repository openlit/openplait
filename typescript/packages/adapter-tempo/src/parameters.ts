import type { ParameterMap, ScalarValue } from "@openplait/core";
import { AdapterError } from "@openplait/adapter-sdk";

const PARAMETER_REFERENCE = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;

export function resolveParameterValue(
  value: ScalarValue | ScalarValue[],
  queryParameters: ParameterMap,
  variables: ParameterMap | undefined,
  path: string,
  seen: ReadonlySet<string> = new Set(),
): ScalarValue | ScalarValue[] {
  if (typeof value !== "string") return value;
  const match = PARAMETER_REFERENCE.exec(value);
  const name = match?.[1];
  if (!name) return value;
  if (seen.has(name)) {
    throw new AdapterError("INVALID_PARAMETER", `Parameter '${name}' contains a circular reference.`, { path });
  }
  const resolved = queryParameters[name] ?? variables?.[name];
  if (resolved === undefined) {
    throw new AdapterError("INVALID_PARAMETER", `Parameter '${name}' has not been resolved.`, {
      path,
      details: { parameter: name },
    });
  }
  return resolveParameterValue(resolved, queryParameters, variables, path, new Set([...seen, name]));
}
