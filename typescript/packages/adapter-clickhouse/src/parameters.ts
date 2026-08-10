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
  if (!match) return value;
  const name = match[1];
  if (!name) return value;
  if (seen.has(name)) {
    throw new AdapterError(
      "INVALID_PARAMETER",
      `Parameter '${name}' contains a circular reference.`,
      { path },
    );
  }

  const resolved = queryParameters[name] ?? variables?.[name];
  if (resolved === undefined) {
    throw new AdapterError(
      "INVALID_PARAMETER",
      `Parameter '${name}' has not been resolved.`,
      { path, details: { parameter: name } },
    );
  }

  return resolveParameterValue(
    resolved,
    queryParameters,
    variables,
    path,
    new Set([...seen, name]),
  );
}

export function resolveParameterMap(
  parameters: ParameterMap,
  variables: ParameterMap | undefined,
): Record<string, ScalarValue | ScalarValue[]> {
  return Object.fromEntries(
    Object.entries(parameters).map(([name, value]) => {
      const otherParameters = Object.fromEntries(
        Object.entries(parameters).filter(([candidate]) => candidate !== name),
      );
      return [
        name,
        resolveParameterValue(
          value,
          otherParameters,
          variables,
          `/spec/parameters/${name}`,
        ),
      ];
    }),
  );
}

export function scalarClickHouseType(value: ScalarValue): string {
  if (typeof value === "number") return "Float64";
  if (typeof value === "boolean") return "Bool";
  if (value === null) return "Nullable(String)";
  return "String";
}
