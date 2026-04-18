# Contributing to OpenTomo

Thanks for contributing to OpenTomo.

## Workflow

1. Fork the repository and create a focused branch.
2. Make changes that are small, reviewable, and scoped to one problem.
3. Run the relevant checks before opening a pull request.
4. Open a pull request with a clear description of what changed, why it changed, and how it was verified.

## Guidelines

- Keep changes aligned with the project's local-first desktop agent direction.
- Prefer clear behavior and simple onboarding over unnecessary abstraction.
- Update documentation when behavior, setup, or extension points change.
- Add or update tests when you change logic with meaningful runtime impact.
- Do not introduce references to unrelated commercial products or future-product positioning.

## Development Checks

Common commands from the repository root:

```bash
bun run test
bun run lint
bun run typecheck
```

For desktop runtime work:

```bash
bun run electron:dev
```

## Pull Requests

When opening a PR, include:

- The problem being solved
- The approach taken
- User-facing impact
- Validation performed
- Any known risks or follow-up work

## License of Contributions

By contributing, you agree that your contributions may be used
for commercial purposes and redistributed under the project license.
