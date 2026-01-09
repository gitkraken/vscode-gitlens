#!/usr/bin/env node
/**
 * A sequence editor that waits for a signal file before exiting.
 * Used for E2E tests to allow VS Code to open and interact with the rebase editor.
 *
 * Usage: node waitEditor.js <todo-file>
 *
 * The script:
 * 1. Writes the todo file path to <todo-file>.ready
 * 2. Waits for <todo-file>.done to exist
 * 3. Exits with code 0
 */
import fs from 'fs';

const todoFile = process.argv[2];
if (!todoFile) {
	console.error('Usage: node waitEditor.mjs <todo-file>');
	process.exit(1);
}

const readyFile = todoFile + '.ready';
const doneFile = todoFile + '.done';
const abortFile = todoFile + '.abort';

// Signal that we're ready (todo file exists and can be opened)
fs.writeFileSync(readyFile, todoFile);

// Poll for done signal
const checkDone = () => {
	if (fs.existsSync(doneFile)) {
		// Cleanup signal files
		try {
			fs.unlinkSync(readyFile);
		} catch {}
		try {
			fs.unlinkSync(doneFile);
		} catch {}
		process.exit(0);
	}
	if (fs.existsSync(abortFile)) {
		// Cleanup signal files
		try {
			fs.unlinkSync(readyFile);
		} catch {}
		try {
			fs.unlinkSync(abortFile);
		} catch {}
		process.exit(1);
	}
	setTimeout(checkDone, 100);
};

checkDone();
