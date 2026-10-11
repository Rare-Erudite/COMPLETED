# RARE 032

RARE 032 adds one-step VS Code startup for the RARE local development environment.

## Startup behavior

When `RARE032_final` is opened as a VS Code folder/workspace, the workspace task `RARE: Start` is configured with `runOn: folderOpen` and starts `START_RARE.cmd` automatically. The launcher creates `.venv` when absent, installs required packages when absent, and starts RARE.

The project-local `.venv` is intentionally not included in the release ZIP because virtual environments are machine-specific.

## Release metadata

- Core: 0.26.0
- Flutter: 0.26.0+32
- Release: RARE 032
