import type { NativeQuery, ParameterMap } from "@openplait/core";
import { AdapterError } from "@openplait/adapter-sdk";

import { resolveParameterMap } from "./parameters.js";

const FORBIDDEN_KEYWORDS = new Set([
  "ALTER",
  "ATTACH",
  "CREATE",
  "DELETE",
  "DETACH",
  "DROP",
  "GRANT",
  "INSERT",
  "INTO",
  "KILL",
  "OPTIMIZE",
  "OUTFILE",
  "RENAME",
  "REPLACE",
  "REVOKE",
  "SYSTEM",
  "TRUNCATE",
  "UPDATE",
]);

const ALLOWED_FIRST_KEYWORDS = new Set(["EXPLAIN", "SELECT", "WITH"]);
const BOUND_PARAMETER = /\{([A-Za-z_][A-Za-z0-9_]*):[^{}]+\}/g;

function codeOutsideLiterals(statement: string): string {
  let output = "";
  let index = 0;
  let state: "code" | "single" | "double" | "backtick" | "line" | "block" =
    "code";

  while (index < statement.length) {
    const character = statement[index] ?? "";
    const next = statement[index + 1] ?? "";

    if (state === "code") {
      if (character === "'") state = "single";
      else if (character === '"') state = "double";
      else if (character === "`") state = "backtick";
      else if (character === "-" && next === "-") {
        state = "line";
        index += 1;
      } else if (character === "/" && next === "*") {
        state = "block";
        index += 1;
      } else output += character;
    } else if (state === "line") {
      if (character === "\n") {
        state = "code";
        output += "\n";
      }
    } else if (state === "block") {
      if (character === "*" && next === "/") {
        state = "code";
        index += 1;
        output += " ";
      }
    } else {
      const quote = state === "single" ? "'" : state === "double" ? '"' : "`";
      if (character === "\\") {
        index += 1;
      } else if (character === quote) {
        if (next === quote) index += 1;
        else state = "code";
      }
    }

    index += 1;
  }

  if (state === "single" || state === "double" || state === "backtick") {
    throw new AdapterError(
      "NATIVE_QUERY_REJECTED",
      "Native SQL contains an unterminated quoted value.",
      { path: "/spec/native/statement" },
    );
  }
  if (state === "block") {
    throw new AdapterError(
      "NATIVE_QUERY_REJECTED",
      "Native SQL contains an unterminated block comment.",
      { path: "/spec/native/statement" },
    );
  }
  return output;
}

export function validateNativeStatement(statement: string): void {
  const code = codeOutsideLiterals(statement).trim();
  if (code.includes(";")) {
    throw new AdapterError(
      "NATIVE_QUERY_REJECTED",
      "Native SQL must not contain statement separators.",
      { path: "/spec/native/statement" },
    );
  }

  const keywords = code.match(/[A-Za-z_][A-Za-z0-9_]*/g)?.map((word) => word.toUpperCase()) ?? [];
  const first = keywords[0];
  if (!first || !ALLOWED_FIRST_KEYWORDS.has(first)) {
    throw new AdapterError(
      "NATIVE_QUERY_REJECTED",
      "Native SQL must be a SELECT, WITH, or EXPLAIN query.",
      { path: "/spec/native/statement" },
    );
  }
  const forbidden = keywords.find((keyword) => FORBIDDEN_KEYWORDS.has(keyword));
  if (forbidden) {
    throw new AdapterError(
      "NATIVE_QUERY_REJECTED",
      `Native SQL keyword '${forbidden}' is not allowed.`,
      { path: "/spec/native/statement", details: { keyword: forbidden } },
    );
  }
  if (keywords.includes("FORMAT")) {
    throw new AdapterError(
      "NATIVE_QUERY_REJECTED",
      "Native SQL must not include FORMAT; the adapter controls the result format.",
      { path: "/spec/native/statement" },
    );
  }
}

function referencedParameters(statement: string): Set<string> {
  return new Set(
    [...codeOutsideLiterals(statement).matchAll(BOUND_PARAMETER)].map(
      (match) => match[1] as string,
    ),
  );
}

export function compileNativeQuery(
  query: NativeQuery,
  variables?: ParameterMap,
): { statement: string; parameters: Record<string, unknown> } {
  if (query.spec.mode !== "native" || query.spec.native.language.toLowerCase() !== "sql") {
    throw new AdapterError(
      "NATIVE_QUERY_REJECTED",
      "The ClickHouse adapter accepts only native SQL queries.",
      { path: "/spec/native/language" },
    );
  }
  validateNativeStatement(query.spec.native.statement);

  const supplied = resolveParameterMap(query.spec.parameters ?? {}, variables);
  const referenced = referencedParameters(query.spec.native.statement);
  for (const name of referenced) {
    if (!(name in supplied)) {
      throw new AdapterError(
        "INVALID_PARAMETER",
        `Native SQL parameter '${name}' has not been supplied.`,
        { path: `/spec/parameters/${name}` },
      );
    }
  }
  for (const name of Object.keys(supplied)) {
    if (!referenced.has(name)) {
      throw new AdapterError(
        "INVALID_PARAMETER",
        `Native SQL parameter '${name}' is not referenced by the statement.`,
        { path: `/spec/parameters/${name}` },
      );
    }
  }

  return {
    statement: query.spec.native.statement.trim(),
    parameters: supplied,
  };
}
