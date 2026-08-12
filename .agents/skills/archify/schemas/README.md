# Archify JSON IR Schemas

Each typed renderer consumes a JSON intermediate representation (IR) validated
against one of the schemas in this folder before any layout work happens.

## Files

| Schema                     | Governs                                     | Structural arrays                                         |
| -------------------------- | ------------------------------------------- | --------------------------------------------------------- |
| `workflow.schema.json`     | `diagram_type: "workflow"`                  | `lanes`, `phases`, `groups`, `mainPath`, `nodes`, `edges` |
| `sequence.schema.json`     | `diagram_type: "sequence"`                  | `participants`, `segments`, `messages`, `activations`     |
| `dataflow.schema.json`     | `diagram_type: "dataflow"`                  | `stages`, `nodes`, `flows`                                |
| `lifecycle.schema.json`    | `diagram_type: "lifecycle"`                 | `lanes`, `states`, `transitions`                          |
| `architecture.schema.json` | `diagram_type: "architecture"`              | `components`, `boundaries`, `connections`                 |
| `common.schema.json`       | shared `$defs` only (no top-level document) | —                                                         |

Every diagram schema requires `schema_version`, `diagram_type`, `meta` (with
`title`), and its structural arrays — except `segments`, `activations`, and
`cards`, which are optional — and sets `additionalProperties: false` at every
level, so unknown fields are rejected rather than silently ignored.

Every `meta` object also accepts `animation: "trace"` for opt-in SVG/CSS motion
in generated HTML. Omit it, or set `"none"`, for the default static output.

## schema_version policy

`schema_version` pins the IR contract: a file that validates today keeps
rendering identically on every 2.x release. A breaking change to any IR shape
bumps the constant; renderers then reject older-version files with a clear
schema error instead of misrendering them. Additive, backwards-compatible
fields do not bump the version.

The **architecture** schema is currently **v2** (`"const": 2`): it replaced
the boundary discriminator with `type` as an intentionally incompatible clean
cut, so all v1 architecture IR is deliberately rejected. The other four
diagram schemas (`workflow`, `sequence`, `dataflow`, `lifecycle`) remain
**v1** (`"const": 1`) and are unchanged.

## Shared definitions (common.schema.json)

The five diagram schemas reference `common.schema.json#/$defs/...`:

- `id` — element identifiers, pattern `^[a-zA-Z][a-zA-Z0-9_-]*$`
- `point` — an `[x, y]` pair of numbers (used by `via` and `labelAt`)
- `componentType` — `frontend`, `backend`, `database`, `cloud`, `security`,
  `messagebus`, `external`
- `variant` — `default`, `emphasis`, `security`, `dashed` (sequence messages
  extend this list locally with `return`)
- `cards` — the summary-card blocks rendered below the SVG

Lifecycle state `type` is mode-specific (`start`/`active`/`waiting`/...) and
stays in `lifecycle.schema.json`.

## Runtime validation

At development time, `scripts/generate-validators.mjs` compiles all five
schemas with ajv's draft 2020-12 standalone generator using `strict: true` and
`allErrors: true`. The generated `renderers/shared/generated-validators.mjs`
is committed and shipped with the skill, so runtime validation has no npm or
network dependency. `renderers/shared/validator.mjs` applies the matching
standalone validator before the renderer's own layout checks.

`npm test` runs the generator in check mode and fails when the committed
validators drift from their schemas.

## Error format

Schema violations exit non-zero. Each ajv error is reported on its own line as
the instance path — annotated with the nearest enclosing element's `id` or
`label` — followed by the message and parameters:

```text
workflow schema validation failed:
  /nodes/3 (id/label: "router") must NOT have additional properties {"additionalProperty":"colour"}
```

Schemas catch shape errors (types, enums, ranges, unknown fields); geometry
problems such as overlaps and label collisions are the renderers' job.
