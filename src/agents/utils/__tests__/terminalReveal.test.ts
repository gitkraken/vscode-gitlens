import * as assert from 'node:assert';
import type { TerminalLike } from '../-webview/terminalReveal.js';
import { findTerminalForProcess } from '../-webview/terminalReveal.js';

function terminal(
	name: string,
	processId: number | undefined | Promise<number | undefined>,
): TerminalLike & {
	name: string;
} {
	return {
		name: name,
		processId: processId instanceof Promise ? processId : Promise.resolve(processId),
	};
}

suite('findTerminalForProcess', () => {
	test('matches a terminal whose shell pid is the process itself', async () => {
		const target = terminal('a', 100);
		const other = terminal('b', 200);

		const match = await findTerminalForProcess(100, [other, target], new Map());
		assert.strictEqual(match, target);
	});

	test('matches a terminal whose shell pid is an ancestor of the process', async () => {
		const shell = terminal('shell', 100);
		const other = terminal('other', 999);
		const parentPidMap = new Map([[300, 100]]); // 300's parent is 100 (the shell)

		const match = await findTerminalForProcess(300, [other, shell], parentPidMap);
		assert.strictEqual(match, shell);
	});

	test('the nearest ancestor wins over a farther one', async () => {
		const nearShell = terminal('near', 200); // 300 -> 200 (nearest)
		const farShell = terminal('far', 100); // 200 -> 100 (farther)
		const parentPidMap = new Map([
			[300, 200],
			[200, 100],
		]);

		const match = await findTerminalForProcess(300, [farShell, nearShell], parentPidMap);
		assert.strictEqual(match, nearShell);
	});

	test('returns undefined when no terminal matches', async () => {
		const other = terminal('other', 999);

		const match = await findTerminalForProcess(100, [other], new Map());
		assert.strictEqual(match, undefined);
	});

	test('skips a terminal whose processId rejects instead of failing', async () => {
		const disposed: TerminalLike = { processId: Promise.reject(new Error('terminal disposed')) };
		const target = terminal('target', 100);

		const match = await findTerminalForProcess(100, [disposed, target], new Map());
		assert.strictEqual(match, target);
	});

	test('skips a terminal whose processId resolves to undefined', async () => {
		const unresolved = terminal('unresolved', undefined);
		const target = terminal('target', 100);

		const match = await findTerminalForProcess(100, [unresolved, target], new Map());
		assert.strictEqual(match, target);
	});
});
