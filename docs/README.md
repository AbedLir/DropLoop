# DropLoop Documentation

This directory contains versioned product and architecture decisions for DropLoop.

## Source-of-truth boundaries

- The latest user research defines product priorities and validation hypotheses.
- ADRs define accepted architecture decisions and their consequences.
- The repository and automated checks define implemented behavior.
- Mock screens, placeholder prices, and deterministic scores are not evidence of product completion.
- Private source recordings and reports remain in the project Drive; this repository stores summaries and links.

## Index

- [Latest research baseline](product/latest-research-baseline.md)
- [MVP acceptance criteria](product/mvp-acceptance.md)
- [Architecture decision records](adr/README.md)

## Updating product direction

When new research changes a priority:

1. Add the source and date to the research baseline.
2. Separate multi-user evidence from one-person requests and unvalidated hypotheses.
3. Update acceptance criteria before changing implementation scope.
4. Add or supersede an ADR when the architecture changes.
