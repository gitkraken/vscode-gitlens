#!/bin/sh
# git `GIT_EDITOR` for automatic-rebase continues (git runs editors through its bundled sh on every
# platform, including Windows). Auto-accepts git's prepared commit message (exit 0) — the behavior
# `GIT_EDITOR=true` used to provide for conflict-commit confirmations — EXCEPT when the step being
# executed is a `reword`/`squash`/`fixup -c` (each explicitly asks for the editor; `fixup -C` takes
# its message verbatim and never invokes one), whose message is the user's to write: then the message
# opens in the host VS Code window via GL_MESSAGE_EDITOR (e.g. `code --wait`), blocking until the tab
# closes.
#
# "$1" is the message file (e.g. <gitdir>/COMMIT_EDITMSG); the step git is executing is the last
# line of <gitdir>/rebase-merge/done (git moves each todo line there before running it). An
# unreadable/missing done file auto-accepts; a missing GL_MESSAGE_EDITOR exits non-zero, making git
# stop at the step (the commit exists with its original/auto-generated message) instead of silently
# discarding the user's reword.
f="$1"
d="${f%/*}"
last=
if [ -f "$d/rebase-merge/done" ]; then
	while IFS= read -r line || [ -n "$line" ]; do
		[ -n "$line" ] && last="$line"
	done <"$d/rebase-merge/done"
fi
case "$last" in
reword\ * | squash\ * | fixup\ -c\ * | r\ * | s\ * | f\ -c\ *)
	[ -n "$GL_MESSAGE_EDITOR" ] || exit 1
	eval "$GL_MESSAGE_EDITOR \"\$f\""
	;;
*) exit 0 ;;
esac
