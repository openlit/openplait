import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import type {
  AlertRule,
  Dashboard,
  OpenPlaitResource,
  Query,
  TransformationPipeline,
} from "./types/index.js";
import {
  validateResource,
  type ValidationError,
} from "./validation.js";

export type SerializationFormat = "json" | "yaml";

export class OpenPlaitValidationError extends Error {
  readonly errors: ValidationError[];

  constructor(message: string, errors: ValidationError[]) {
    super(message);
    this.name = "OpenPlaitValidationError";
    this.errors = errors;
  }
}

export function parseDocument(source: string, format?: SerializationFormat): unknown {
  const resolvedFormat = format ?? (source.trimStart().startsWith("{") ? "json" : "yaml");
  return resolvedFormat === "json" ? JSON.parse(source) : parseYaml(source);
}

export function parseResource(source: string, format?: SerializationFormat): OpenPlaitResource {
  let parsed: unknown;

  try {
    parsed = parseDocument(source, format);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new OpenPlaitValidationError(`Document could not be parsed: ${message}`, [
      {
        code: "SCHEMA_VALIDATION_FAILED",
        path: "/",
        message,
      },
    ]);
  }

  const result = validateResource(parsed);
  if (!result.valid) {
    throw new OpenPlaitValidationError("Document is not a valid OpenPlait resource.", result.errors);
  }

  return result.value;
}

function unexpectedKind(
  expected: "Query" | "Dashboard" | "TransformationPipeline" | "AlertRule",
  actual: string,
): never {
  throw new OpenPlaitValidationError(`Document is not an OpenPlait ${expected} resource.`, [
    {
      code: "UNSUPPORTED_KIND",
      path: "/kind",
      message: `Expected resource kind '${expected}', received '${actual}'.`,
    },
  ]);
}

export function parseQuery(source: string, format?: SerializationFormat): Query {
  const resource = parseResource(source, format);
  if (resource.kind !== "Query") return unexpectedKind("Query", resource.kind);
  return resource;
}

export function parseDashboard(source: string, format?: SerializationFormat): Dashboard {
  const resource = parseResource(source, format);
  if (resource.kind !== "Dashboard") return unexpectedKind("Dashboard", resource.kind);
  return resource;
}

export function parseTransformationPipeline(
  source: string,
  format?: SerializationFormat,
): TransformationPipeline {
  const resource = parseResource(source, format);
  if (resource.kind !== "TransformationPipeline") {
    return unexpectedKind("TransformationPipeline", resource.kind);
  }
  return resource;
}

export function parseAlertRule(source: string, format?: SerializationFormat): AlertRule {
  const resource = parseResource(source, format);
  if (resource.kind !== "AlertRule") return unexpectedKind("AlertRule", resource.kind);
  return resource;
}

export function serializeDocument(
  value: unknown,
  format: SerializationFormat = "yaml",
): string {
  if (format === "json") return `${JSON.stringify(value, null, 2)}\n`;
  return stringifyYaml(value, { lineWidth: 100 });
}
