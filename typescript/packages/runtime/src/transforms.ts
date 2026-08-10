import type {
  BooleanExpression,
  DataField,
  DataFieldType,
  DataFrame,
  ParameterMap,
  QueryResult,
  ScalarValue,
  Transformation,
  ValueExpression,
} from "@openplait/core";

import { RuntimeError } from "./errors.js";

type Row = Record<string, unknown>;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function field(frame: DataFrame, name: string): DataField {
  const result = frame.fields.find((candidate) => candidate.name === name);
  if (!result) {
    throw new RuntimeError("TRANSFORM_FAILED", `Frame '${frame.name ?? "unnamed"}' has no field '${name}'.`);
  }
  return result;
}

function rows(frame: DataFrame): Row[] {
  return Array.from({ length: frame.length }, (_, index) =>
    Object.fromEntries(frame.fields.map((item) => [item.name, item.values[index] ?? null])),
  );
}

function inferType(values: unknown[]): DataFieldType {
  const value = values.find((candidate) => candidate !== null && candidate !== undefined);
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "string") return "string";
  return "json";
}

function frameFromRows(
  name: string | undefined,
  sourceFields: DataField[],
  resultRows: Row[],
  fieldOrder?: string[],
): DataFrame {
  const source = new Map(sourceFields.map((item) => [item.name, item]));
  const names = fieldOrder ?? (
    resultRows.length > 0
      ? [...new Set(resultRows.flatMap((row) => Object.keys(row)))]
      : sourceFields.map(({ name }) => name)
  );
  const fields = names.map((fieldName): DataField => {
    const values = resultRows.map((row) => row[fieldName] ?? null);
    const template = source.get(fieldName);
    const result: DataField = {
      name: fieldName,
      type: template?.type ?? inferType(values),
      values,
    };
    if (template?.labels) result.labels = clone(template.labels);
    if (template?.unit) result.unit = template.unit;
    return result;
  });
  const result: DataFrame = { fields, length: resultRows.length };
  if (name !== undefined) result.name = name;
  return result;
}

function parameter(value: unknown, variables: ParameterMap): unknown {
  if (typeof value !== "string") return value;
  const match = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(value);
  return match?.[1] && match[1] in variables ? variables[match[1]] : value;
}

function compare(actual: unknown, operator: string, expected: unknown): boolean {
  if (operator === "equals") return actual === expected;
  if (operator === "notEquals") return actual !== expected;
  if (operator === "isNull") return actual === null || actual === undefined;
  if (operator === "isNotNull") return actual !== null && actual !== undefined;
  if (operator === "greaterThan") return (actual as number) > (expected as number);
  if (operator === "greaterThanOrEqual") return (actual as number) >= (expected as number);
  if (operator === "lessThan") return (actual as number) < (expected as number);
  if (operator === "lessThanOrEqual") return (actual as number) <= (expected as number);
  if (operator === "in") return Array.isArray(expected) && expected.includes(actual as never);
  if (operator === "notIn") return Array.isArray(expected) && !expected.includes(actual as never);
  if (operator === "contains") {
    return typeof actual === "string"
      ? actual.includes(String(expected))
      : Array.isArray(actual) && actual.includes(expected);
  }
  if (operator === "notContains") return !compare(actual, "contains", expected);
  if (operator === "startsWith") return String(actual).startsWith(String(expected));
  if (operator === "endsWith") return String(actual).endsWith(String(expected));
  if (operator === "matches") return new RegExp(String(expected)).test(String(actual));
  return false;
}

function matches(row: Row, condition: BooleanExpression, variables: ParameterMap): boolean {
  if ("and" in condition) return condition.and.every((child) => matches(row, child, variables));
  if ("or" in condition) return condition.or.some((child) => matches(row, child, variables));
  if ("not" in condition) return !matches(row, condition.not, variables);
  const expected = "value" in condition ? parameter(condition.value, variables) : undefined;
  return compare(row[condition.field], condition.operator, expected);
}

function calculate(row: Row, expression: ValueExpression): unknown {
  if ("field" in expression) return row[expression.field] ?? null;
  if ("value" in expression) return expression.value;
  const values = ("add" in expression
    ? expression.add
    : "subtract" in expression
      ? expression.subtract
      : "multiply" in expression
        ? expression.multiply
        : expression.divide
  ).map((child) => Number(calculate(row, child)));
  if (values.some((value) => !Number.isFinite(value))) return null;
  if ("add" in expression) return values.reduce((sum, value) => sum + value, 0);
  if ("subtract" in expression) return values[0]! - values[1]!;
  if ("multiply" in expression) return values.reduce((product, value) => product * value, 1);
  return values[1] === 0 ? null : values[0]! / values[1]!;
}

function mapRows(frame: DataFrame, mapper: (row: Row, index: number) => Row): DataFrame {
  return frameFromRows(frame.name, frame.fields, rows(frame).map(mapper));
}

function selectFields(frame: DataFrame, names: string[]): DataFrame {
  const selected = names.map((name) => clone(field(frame, name)));
  return { ...(frame.name ? { name: frame.name } : {}), fields: selected, length: frame.length };
}

function renameFields(frame: DataFrame, mappings: Record<string, string>): DataFrame {
  for (const source of Object.keys(mappings)) field(frame, source);
  const names = frame.fields.map(({ name }) => mappings[name] ?? name);
  if (new Set(names).size !== names.length) {
    throw new RuntimeError("TRANSFORM_FAILED", "RenameFields creates duplicate field names.");
  }
  return {
    ...(frame.name ? { name: frame.name } : {}),
    fields: frame.fields.map((item) => ({ ...clone(item), name: mappings[item.name] ?? item.name })),
    length: frame.length,
  };
}

function sortFrame(frame: DataFrame, order: { field: string; direction: "asc" | "desc" }[]): DataFrame {
  for (const item of order) field(frame, item.field);
  const indices = Array.from({ length: frame.length }, (_, index) => index);
  indices.sort((left, right) => {
    for (const item of order) {
      const values = field(frame, item.field).values;
      const a = values[left];
      const b = values[right];
      if (a === b) continue;
      if (a === null || a === undefined) return item.direction === "asc" ? 1 : -1;
      if (b === null || b === undefined) return item.direction === "asc" ? -1 : 1;
      const comparison = a < b ? -1 : 1;
      return item.direction === "asc" ? comparison : -comparison;
    }
    return left - right;
  });
  return {
    ...(frame.name ? { name: frame.name } : {}),
    fields: frame.fields.map((item) => ({ ...clone(item), values: indices.map((index) => item.values[index]) })),
    length: frame.length,
  };
}

function reduceValues(values: unknown[], fn: string): unknown {
  if (fn === "count") return values.length;
  if (fn === "first") return values[0] ?? null;
  if (fn === "last") return values.at(-1) ?? null;
  const numbers = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (numbers.length === 0) return null;
  if (fn === "sum") return numbers.reduce((sum, value) => sum + value, 0);
  if (fn === "avg") return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  if (fn === "min") return Math.min(...numbers);
  if (fn === "max") return Math.max(...numbers);
  return null;
}

function groupAndReduce(
  frame: DataFrame,
  spec: Extract<Transformation, { kind: "GroupAndReduce" }>["spec"],
): DataFrame {
  const groupFields = spec.by ?? [];
  for (const name of groupFields) field(frame, name);
  for (const reduction of spec.reductions) if (reduction.field) field(frame, reduction.field);
  const grouped = new Map<string, Row[]>();
  for (const row of rows(frame)) {
    const key = JSON.stringify(groupFields.map((name) => row[name]));
    const bucket = grouped.get(key) ?? [];
    bucket.push(row);
    grouped.set(key, bucket);
  }
  if (frame.length === 0 && groupFields.length === 0) grouped.set("[]", []);
  const resultRows = [...grouped.values()].map((group): Row => {
    const result: Row = {};
    for (const name of groupFields) result[name] = group[0]?.[name] ?? null;
    for (const reduction of spec.reductions) {
      const values = reduction.field ? group.map((row) => row[reduction.field!]) : group;
      result[reduction.as] = reduceValues(values, reduction.function);
    }
    return result;
  });
  const templates = [
    ...groupFields.map((name) => field(frame, name)),
    ...spec.reductions.map((reduction): DataField => ({
      name: reduction.as,
      type: reduction.function === "first" || reduction.function === "last"
        ? (reduction.field ? field(frame, reduction.field).type : "json")
        : "number",
      values: [],
      ...(reduction.field && field(frame, reduction.field).unit
        ? { unit: field(frame, reduction.field).unit }
        : {}),
    })),
  ];
  return frameFromRows(frame.name, templates, resultRows, [
    ...groupFields,
    ...spec.reductions.map(({ as }) => as),
  ]);
}

function frameByName(frames: DataFrame[], name: string): DataFrame {
  const result = frames.find((frame) => frame.name === name);
  if (!result) throw new RuntimeError("TRANSFORM_FAILED", `Frame '${name}' does not exist.`);
  return result;
}

function joinFrames(
  frames: DataFrame[],
  spec: Extract<Transformation, { kind: "JoinFrames" }>["spec"],
): DataFrame[] {
  const left = frameByName(frames, spec.left);
  const right = frameByName(frames, spec.right);
  for (const name of spec.on) {
    field(left, name);
    field(right, name);
  }
  const rightRows = rows(right);
  const rightIndex = new Map<string, Row[]>();
  for (const row of rightRows) {
    const key = JSON.stringify(spec.on.map((name) => row[name]));
    const bucket = rightIndex.get(key) ?? [];
    bucket.push(row);
    rightIndex.set(key, bucket);
  }
  const rightNames = right.fields.filter(({ name }) => !spec.on.includes(name)).map(({ name }) => name);
  const leftNames = new Set(left.fields.map(({ name }) => name));
  const outputRightName = (name: string): string => leftNames.has(name) ? `${spec.right}.${name}` : name;
  const resultRows: Row[] = [];
  const matched = new Set<Row>();
  for (const leftRow of rows(left)) {
    const key = JSON.stringify(spec.on.map((name) => leftRow[name]));
    const matches = rightIndex.get(key) ?? [];
    if (matches.length === 0 && (spec.type ?? "inner") !== "inner") {
      resultRows.push({
        ...leftRow,
        ...Object.fromEntries(rightNames.map((name) => [outputRightName(name), null])),
      });
    }
    for (const rightRow of matches) {
      matched.add(rightRow);
      resultRows.push({
        ...leftRow,
        ...Object.fromEntries(rightNames.map((name) => [outputRightName(name), rightRow[name]])),
      });
    }
  }
  if (spec.type === "full") {
    const leftNonKeys = left.fields.filter(({ name }) => !spec.on.includes(name)).map(({ name }) => name);
    for (const rightRow of rightRows.filter((row) => !matched.has(row))) {
      resultRows.push({
        ...Object.fromEntries(leftNonKeys.map((name) => [name, null])),
        ...Object.fromEntries(spec.on.map((name) => [name, rightRow[name]])),
        ...Object.fromEntries(rightNames.map((name) => [outputRightName(name), rightRow[name]])),
      });
    }
  }
  const templates = [
    ...left.fields,
    ...right.fields
      .filter(({ name }) => !spec.on.includes(name))
      .map((item) => ({ ...item, name: outputRightName(item.name) })),
  ];
  const joined = frameFromRows(spec.as ?? `${spec.left}_${spec.right}`, templates, resultRows);
  return [...frames.filter((frame) => frame !== left && frame !== right), joined];
}

function mergeFrames(
  frames: DataFrame[],
  spec: Extract<Transformation, { kind: "MergeFrames" }>["spec"],
): DataFrame[] {
  const selected = spec.frames?.map((name) => frameByName(frames, name)) ?? frames;
  if (selected.length === 0) return frames;
  const templates = new Map<string, DataField>();
  for (const frame of selected) {
    for (const item of frame.fields) {
      const current = templates.get(item.name);
      if (current && current.type !== item.type) {
        throw new RuntimeError("TRANSFORM_FAILED", `Cannot merge field '${item.name}' with conflicting types.`);
      }
      if (!current) templates.set(item.name, item);
    }
  }
  const names = [...templates.keys()];
  const mergedRows = selected.flatMap((frame) =>
    rows(frame).map((row) => Object.fromEntries(names.map((name) => [name, row[name] ?? null]))),
  );
  const merged = frameFromRows(spec.as ?? "merged", [...templates.values()], mergedRows, names);
  return [...frames.filter((frame) => !selected.includes(frame)), merged];
}

function pivotFrame(
  frame: DataFrame,
  spec: Extract<Transformation, { kind: "Pivot" }>["spec"],
): DataFrame {
  for (const name of [...spec.index, spec.column, spec.value]) field(frame, name);
  const grouped = new Map<string, { base: Row; values: Map<string, unknown[]> }>();
  for (const row of rows(frame)) {
    const key = JSON.stringify(spec.index.map((name) => row[name]));
    const group = grouped.get(key) ?? {
      base: Object.fromEntries(spec.index.map((name) => [name, row[name]])),
      values: new Map(),
    };
    const column = String(row[spec.column]);
    const values = group.values.get(column) ?? [];
    values.push(row[spec.value]);
    group.values.set(column, values);
    grouped.set(key, group);
  }
  const columns = [...new Set([...grouped.values()].flatMap(({ values }) => [...values.keys()]))];
  const aggregation = spec.aggregation ?? "first";
  const resultRows = [...grouped.values()].map(({ base, values }) => ({
    ...base,
    ...Object.fromEntries(columns.map((name) => [name, reduceValues(values.get(name) ?? [], aggregation)])),
  }));
  const valueTemplate = field(frame, spec.value);
  return frameFromRows(
    frame.name,
    [...spec.index.map((name) => field(frame, name)), ...columns.map((name) => ({ ...valueTemplate, name }))],
    resultRows,
    [...spec.index, ...columns],
  );
}

function unpivotFrame(
  frame: DataFrame,
  spec: Extract<Transformation, { kind: "Unpivot" }>["spec"],
): DataFrame {
  for (const name of spec.fields) field(frame, name);
  const keep = spec.keep ?? frame.fields.map(({ name }) => name).filter((name) => !spec.fields.includes(name));
  for (const name of keep) field(frame, name);
  const resultRows = rows(frame).flatMap((row) =>
    spec.fields.map((name) => ({
      ...Object.fromEntries(keep.map((kept) => [kept, row[kept]])),
      [spec.namesTo]: name,
      [spec.valuesTo]: row[name],
    })),
  );
  const sourceTypes = new Set(spec.fields.map((name) => field(frame, name).type));
  const templates: DataField[] = [
    ...keep.map((name) => field(frame, name)),
    { name: spec.namesTo, type: "string", values: [] },
    { name: spec.valuesTo, type: sourceTypes.size === 1 ? field(frame, spec.fields[0]!).type : "json", values: [] },
  ];
  return frameFromRows(frame.name, templates, resultRows, [...keep, spec.namesTo, spec.valuesTo]);
}

const UNIT_FACTORS: Record<string, { dimension: string; factor: number }> = {
  ns: { dimension: "time", factor: 1e-9 },
  us: { dimension: "time", factor: 1e-6 },
  ms: { dimension: "time", factor: 1e-3 },
  s: { dimension: "time", factor: 1 },
  m: { dimension: "time", factor: 60 },
  h: { dimension: "time", factor: 3600 },
  B: { dimension: "bytes", factor: 1 },
  KB: { dimension: "bytes", factor: 1e3 },
  MB: { dimension: "bytes", factor: 1e6 },
  GB: { dimension: "bytes", factor: 1e9 },
  KiB: { dimension: "bytes", factor: 1024 },
  MiB: { dimension: "bytes", factor: 1024 ** 2 },
  GiB: { dimension: "bytes", factor: 1024 ** 3 },
  fraction: { dimension: "ratio", factor: 1 },
  percent: { dimension: "ratio", factor: 0.01 },
};

function convertUnit(
  frame: DataFrame,
  spec: Extract<Transformation, { kind: "ConvertUnit" }>["spec"],
): DataFrame {
  const result = clone(frame);
  const target = field(result, spec.field);
  const from = spec.from ?? target.unit;
  const sourceUnit = from ? UNIT_FACTORS[from] : undefined;
  const targetUnit = UNIT_FACTORS[spec.to];
  if (!sourceUnit || !targetUnit || sourceUnit.dimension !== targetUnit.dimension) {
    throw new RuntimeError("TRANSFORM_FAILED", `Cannot convert '${from ?? "unknown"}' to '${spec.to}'.`);
  }
  target.values = target.values.map((value) =>
    typeof value === "number" ? (value * sourceUnit.factor) / targetUnit.factor : value,
  );
  target.unit = spec.to;
  return result;
}

function fillMissing(
  frame: DataFrame,
  spec: Extract<Transformation, { kind: "FillMissing" }>["spec"],
): DataFrame {
  const result = clone(frame);
  const selected = spec.fields?.map((name) => field(result, name)) ?? result.fields;
  const strategy = spec.strategy ?? "constant";
  for (const item of selected) {
    if (strategy === "previous") {
      let previous: unknown = null;
      item.values = item.values.map((value) => {
        if (value !== null && value !== undefined) previous = value;
        return value === null || value === undefined ? previous : value;
      });
    } else if (strategy === "next") {
      let next: unknown = null;
      item.values = [...item.values].reverse().map((value) => {
        if (value !== null && value !== undefined) next = value;
        return value === null || value === undefined ? next : value;
      }).reverse();
    } else {
      const replacement: ScalarValue = strategy === "zero" ? 0 : (spec.value ?? null);
      item.values = item.values.map((value) => value === null || value === undefined ? replacement : value);
    }
  }
  return result;
}

function windowCalculation(
  frame: DataFrame,
  spec: Extract<Transformation, { kind: "WindowCalculation" }>["spec"],
): DataFrame {
  const source = field(frame, spec.field);
  const size = spec.size ?? (spec.function === "movingAverage" ? 3 : 1);
  const values = source.values.map((value, index, all) => {
    if (spec.function === "difference") {
      const previous = index >= size ? all[index - size] : undefined;
      return typeof value === "number" && typeof previous === "number" ? value - previous : null;
    }
    const window = all
      .slice(spec.function === "runningSum" ? 0 : Math.max(0, index - size + 1), index + 1)
      .filter((candidate): candidate is number => typeof candidate === "number");
    if (window.length === 0) return null;
    const sum = window.reduce((total, candidate) => total + candidate, 0);
    return spec.function === "movingAverage" ? sum / window.length : sum;
  });
  const result = clone(frame);
  result.fields.push({
    name: spec.as,
    type: "number",
    values,
    ...(spec.unit ?? source.unit ? { unit: spec.unit ?? source.unit } : {}),
  });
  return result;
}

function labelsToFields(
  frame: DataFrame,
  spec: Extract<Transformation, { kind: "LabelsToFields" }>["spec"],
): DataFrame {
  const selected = spec.fields?.map((name) => field(frame, name)) ?? frame.fields;
  const labels = new Map<string, string>();
  for (const item of selected) {
    for (const [name, value] of Object.entries(item.labels ?? {})) {
      const output = `${spec.prefix ?? ""}${name}`;
      const current = labels.get(output);
      if (current !== undefined && current !== value) {
        throw new RuntimeError("TRANSFORM_FAILED", `Label '${name}' has conflicting values in one frame.`);
      }
      labels.set(output, value);
    }
  }
  const result = clone(frame);
  for (const [name, value] of labels) {
    if (result.fields.some((item) => item.name === name)) {
      throw new RuntimeError("TRANSFORM_FAILED", `Label field '${name}' already exists.`);
    }
    result.fields.push({ name, type: "string", values: Array(frame.length).fill(value) });
  }
  return result;
}

function jsonPath(value: unknown, path: string): unknown {
  let current: unknown = typeof value === "string" ? JSON.parse(value) : value;
  for (const part of path.split(".")) {
    if (typeof current !== "object" || current === null) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current ?? null;
}

function applyOne(result: QueryResult, transformation: Transformation, variables: ParameterMap): QueryResult {
  const transformed = clone(result);
  if (transformation.kind === "JoinFrames") {
    transformed.frames = joinFrames(transformed.frames, transformation.spec);
    return transformed;
  }
  if (transformation.kind === "MergeFrames") {
    transformed.frames = mergeFrames(transformed.frames, transformation.spec);
    return transformed;
  }

  transformed.frames = transformed.frames.map((frame) => {
    if (transformation.kind === "FilterRows") {
      return frameFromRows(
        frame.name,
        frame.fields,
        rows(frame).filter((row) => matches(row, transformation.spec.condition, variables)),
      );
    }
    if (transformation.kind === "SelectFields") return selectFields(frame, transformation.spec.fields);
    if (transformation.kind === "RenameFields") return renameFields(frame, transformation.spec.mappings);
    if (transformation.kind === "CalculateField") {
      const calculated = mapRows(frame, (row) => ({
        ...row,
        [transformation.spec.as]: calculate(row, transformation.spec.expression),
      }));
      const output = field(calculated, transformation.spec.as);
      output.type = transformation.spec.type ?? output.type;
      if (transformation.spec.unit) output.unit = transformation.spec.unit;
      return calculated;
    }
    if (transformation.kind === "Sort") {
      const order = Array.isArray(transformation.spec.by) ? transformation.spec.by : [transformation.spec.by];
      return sortFrame(frame, order);
    }
    if (transformation.kind === "Limit") {
      const count = Math.min(frame.length, transformation.spec.count);
      return {
        ...(frame.name ? { name: frame.name } : {}),
        fields: frame.fields.map((item) => ({ ...clone(item), values: item.values.slice(0, count) })),
        length: count,
      };
    }
    if (transformation.kind === "GroupAndReduce") return groupAndReduce(frame, transformation.spec);
    if (transformation.kind === "Pivot") return pivotFrame(frame, transformation.spec);
    if (transformation.kind === "Unpivot") return unpivotFrame(frame, transformation.spec);
    if (transformation.kind === "ConvertUnit") return convertUnit(frame, transformation.spec);
    if (transformation.kind === "FillMissing") return fillMissing(frame, transformation.spec);
    if (transformation.kind === "WindowCalculation") return windowCalculation(frame, transformation.spec);
    if (transformation.kind === "LabelsToFields") return labelsToFields(frame, transformation.spec);
    if (transformation.kind === "ExtractJsonProperty") {
      const extracted = mapRows(frame, (row) => ({
        ...row,
        [transformation.spec.as]: jsonPath(row[transformation.spec.field], transformation.spec.path),
      }));
      const output = field(extracted, transformation.spec.as);
      output.type = transformation.spec.type ?? output.type;
      return extracted;
    }
    return frame;
  });
  return transformed;
}

export function executeTransformations(
  result: QueryResult,
  transformations: Transformation[],
  variables: ParameterMap = {},
): QueryResult {
  return transformations.reduce((current, transformation, index) => {
    try {
      return applyOne(current, transformation, variables);
    } catch (error) {
      if (error instanceof RuntimeError) {
        throw new RuntimeError(error.code, error.message, {
          path: `/transformations/${index}`,
          ...(error.details === undefined ? {} : { details: error.details }),
          cause: error,
        });
      }
      throw new RuntimeError(
        "TRANSFORM_FAILED",
        `Transformation '${transformation.kind}' failed.`,
        { path: `/transformations/${index}`, cause: error },
      );
    }
  }, clone(result));
}
