import type { CompiledQuery } from "./types.js";

export function isCompiledQuery<TCompiledQuery>(
  value: unknown,
): value is CompiledQuery<TCompiledQuery> {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "CompiledQuery"
  );
}
