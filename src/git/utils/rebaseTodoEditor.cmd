@echo off
REM git `sequence.editor` wrapper (Windows). Runs the bundled rebase-todo editor as Node, scoping
REM ELECTRON_RUN_AS_NODE to this subprocess so it can't affect git's `core.editor`. The Node and
REM script paths come from the environment; the rebase-todo file is passed as %*.
set ELECTRON_RUN_AS_NODE=1
"%GL_REBASE_EDITOR_NODE%" "%GL_REBASE_EDITOR_SCRIPT%" %*
