# Application pipeline

<!-- AUTO-GENERATED — do not edit by hand. Regenerated on every push by
     .github/workflows/architecture-diagram.yml. States come from the Status union in shared/src/types.ts; transitions are declared in scripts/gen-pipeline-diagram.ts (each annotated with where the rule lives). Run `npm run diagram:pipeline` to regenerate. -->

How a posting moves through the board. Each arrow is labelled with the CoWork job
or event that triggers it. Terminal states (rejected, ghost, skipped) collapse into
the board's "Closed" column.

```mermaid
stateDiagram-v2
  direction LR
  discovered : Discovered
  assessed : Fit assessment
  tailoring : Tailoring
  skipped : Skipped
  applied : Applied
  interview : Interviewing
  ghost : No response
  rejected : Rejected
  [*] --> discovered : ingest job (scrape)
  discovered --> assessed : fit job · scored
  discovered --> tailoring : tailoring job
  assessed --> tailoring : tailoring job
  discovered --> skipped : you pass
  assessed --> skipped : you pass
  tailoring --> applied : you submit
  applied --> interview : inbox-sync
  applied --> ghost : no response
  applied --> rejected : inbox-sync
  interview --> rejected : inbox-sync
  rejected --> [*]
  ghost --> [*]
  skipped --> [*]
```
