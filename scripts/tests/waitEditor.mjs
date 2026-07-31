#!/usr/bin/env node
/**
 * A sequence editor that waits for a signal file before exiting.
 * Used for E2E tests to allow VS Code to open and interact with the rebase editor.
 *
 * Usage: node waitEditor.mjs <todo-file>
 *
 * The script:
 * 1. Writes the todo file path to <todo-file>.ready
 * 2. Waits for <todo-file>.done to exist
 * 3. Exits with code 0
 *
 * It also gives up on its own, exiting non-zero so git aborts the rebase, when no signal can still
 * arrive. The signal files live in `.git/rebase-merge`, which both `rebase --abort` and the fixture's
 * `cleanupRebaseState` delete — after that a `.done`/`.abort` write fails with ENOENT and the poll
 * below would spin forever, holding a blocked `git rebase -i` behind it. The lifetime cap covers
 * every other way a run can end without signalling, such as the test process being killed.
 */
import fs from 'fs';
import path from 'path';

const todoFile = process.argv[2];
if (!todoFile) {
	console.error('Usage: node waitEditor.mjs <todo-file>');
	process.exit(1);
}

// Bounds how long this can stay alive, well above a single test's timeout so it only ever fires on a
// run that has already stopped signalling.
const maxLifetime = Number(process.env.GL_WAIT_EDITOR_TIMEOUT ?? 120000);

const todoDir = path.dirname(todoFile);
const readyFile = todoFile + '.ready';
const doneFile = todoFile + '.done';
const abortFile = todoFile + '.abort';

const start = Date.now();

function exit(code, reason) {
	if (reason) {
		console.error(`waitEditor: giving up on ${todoFile} — ${reason}`);
	}

	// Cleanup signal files
	for (const file of [readyFile, doneFile, abortFile]) {
		try {
			fs.unlinkSync(file);
		} catch {}
	}

	process.exit(code);
}

for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
	process.on(signal, () => exit(1, `received ${signal}`));
}

// Signal that we're ready (todo file exists and can be opened)
fs.writeFileSync(readyFile, todoFile);

// Poll for done signal
const checkDone = () => {
	if (fs.existsSync(doneFile)) {
		exit(0);
	}
	if (fs.existsSync(abortFile)) {
		exit(1);
	}
	if (!fs.existsSync(todoDir)) {
		exit(1, `${todoDir} no longer exists, so no signal file can be written`);
	}
	if (Date.now() - start > maxLifetime) {
		exit(1, `no signal after ${maxLifetime}ms`);
	}
	setTimeout(checkDone, 100);
};

checkDone();
