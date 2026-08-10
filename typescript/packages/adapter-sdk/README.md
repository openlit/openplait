# `@openplait/adapter-sdk`

Contracts shared by OpenPlait datasource adapters. The package defines adapter
manifests and capabilities, configuration validation, compile and execution
contexts, compiled-query envelopes, schema discovery, explain output, audit
context, and stable adapter error codes.

It contains no datasource client and no backend-specific query representation.
Adapters depend on this package and `@openplait/core`; core never depends on an
adapter.
