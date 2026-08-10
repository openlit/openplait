# Specifications

The canonical `openplait.io/v1alpha1` JSON Schemas are shipped by
[`@openplait/core`](../typescript/packages/core/schemas/v1alpha1). Keeping schemas
beside the package ensures published runtime validation and ecosystem schemas
use the same artifacts.

The current schema set covers Query resources, Dashboard resources,
TransformationPipeline resources, AlertRule resources, and normalized
QueryResult documents. Perses
interoperability is implemented by [`@openplait/perses`](../typescript/packages/perses),
and transformation execution by [`@openplait/runtime`](../typescript/packages/runtime).
