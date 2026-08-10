import type { NativeQuery, SemanticQuery } from "@openplait/core";
import type { CompileContext, ExecutionContext } from "@openplait/adapter-sdk";

import { RuntimeError } from "./errors.js";
import type {
  DatasourceScope,
  RuntimeDatasourceHandle,
  RuntimeDatasourceRegistration,
} from "./types.js";

const SCOPE_PRIORITY: readonly DatasourceScope[] = ["dashboard", "workspace", "global"];

function key(scope: DatasourceScope, name: string): string {
  return `${scope}:${name}`;
}

export class DatasourceRegistry {
  private readonly registrations = new Map<string, RuntimeDatasourceHandle>();

  register<TConfig, TCompiled>(
    registration: RuntimeDatasourceRegistration<TConfig, TCompiled>,
  ): this {
    const scope = registration.scope ?? "global";
    const validation = registration.adapter.validateConfig(registration.config);
    if (!validation.valid) {
      throw new RuntimeError(
        "DATASOURCE_CONFIG_INVALID",
        `Datasource '${registration.name}' configuration is invalid.`,
        { details: { errors: validation.errors } },
      );
    }

    const handle: RuntimeDatasourceHandle = {
      name: registration.name,
      kind: registration.kind,
      scope,
      manifest: registration.adapter.manifest,
      getCapabilities: () => registration.adapter.getCapabilities(registration.config),
      compile: (query, context) => registration.adapter.compile(query as SemanticQuery, context),
      execute: (query, context: ExecutionContext) =>
        registration.adapter.execute(
          query as Awaited<ReturnType<typeof registration.adapter.compile>> | NativeQuery,
          context,
        ),
    };
    this.registrations.set(key(scope, registration.name), handle);
    return this;
  }

  unregister(name: string, scope: DatasourceScope = "global"): boolean {
    return this.registrations.delete(key(scope, name));
  }

  resolve(reference: { name: string; kind: string; scope?: DatasourceScope }): RuntimeDatasourceHandle {
    const scopes = reference.scope ? [reference.scope] : SCOPE_PRIORITY;
    const handle = scopes
      .map((scope) => this.registrations.get(key(scope, reference.name)))
      .find((candidate) => candidate !== undefined);
    if (!handle) {
      throw new RuntimeError(
        "DATASOURCE_NOT_FOUND",
        `Datasource '${reference.name}' could not be resolved.`,
        { path: "/spec/datasource/name", details: { reference } },
      );
    }
    if (handle.kind !== reference.kind) {
      throw new RuntimeError(
        "DATASOURCE_KIND_MISMATCH",
        `Datasource '${reference.name}' is '${handle.kind}', not '${reference.kind}'.`,
        { path: "/spec/datasource/kind", details: { reference, actualKind: handle.kind } },
      );
    }
    return handle;
  }

  list(): RuntimeDatasourceHandle[] {
    return [...this.registrations.values()];
  }
}
