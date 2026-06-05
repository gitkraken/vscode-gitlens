#!/bin/sh
# git `sequence.editor` wrapper (Unix). Runs the bundled rebase-todo editor as Node, scoping
# ELECTRON_RUN_AS_NODE to this subprocess so it can't affect git's `core.editor` (the VS Code
# instance used for the combined-message edit). The Node and script paths are provided by the
# extension via the environment; the rebase-todo file git wants edited is passed as "$@".
ELECTRON_RUN_AS_NODE=1 "$GL_REBASE_EDITOR_NODE" "$GL_REBASE_EDITOR_SCRIPT" "$@"
