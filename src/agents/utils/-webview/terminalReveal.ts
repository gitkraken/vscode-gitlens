import { window } from 'vscode';
import { Logger } from '@gitlens/utils/logger.js';
import { walkAncestorChain } from '../processAncestry.js';

/** Minimal terminal shape so the matcher is unit-testable without a live VS Code `Terminal`. */
export interface TerminalLike {
	readonly processId: Thenable<number | undefined>;
}

/** Finds the terminal whose shell process is `pid` or the NEAREST ancestor of `pid` in
 *  `parentPidMap` (the agent binary descends from the terminal's shell). Nearest wins so a
 *  nested shell (tmux, a subshell) doesn't lose to the outer terminal. `undefined` when nothing
 *  matches — no process table (web), a severed tree, or an external terminal. */
export async function findTerminalForProcess<T extends TerminalLike>(
	pid: number,
	terminals: readonly T[],
	parentPidMap: Map<number, number>,
): Promise<T | undefined> {
	const chain = [pid, ...walkAncestorChain(pid, parentPidMap)];

	const resolved = await Promise.allSettled(terminals.map(t => t.processId));

	let best: T | undefined;
	let bestIndex = Infinity;

	for (const [i, terminal] of terminals.entries()) {
		const result = resolved[i];
		if (result.status !== 'fulfilled' || result.value == null) continue;

		const index = chain.indexOf(result.value);
		if (index === -1 || index >= bestIndex) continue;

		bestIndex = index;
		best = terminal;
	}

	return best;
}

/** Shows (and focuses) the integrated terminal hosting `pid`, whether it lives in the panel or
 *  as an editor tab. Returns `true` when a terminal was revealed. Best-effort, never throws. */
export async function revealTerminalForProcess(pid: number): Promise<boolean> {
	try {
		const { getProcessParentPidMap } = await import(/* webpackChunkName: "agents" */ '@env/focusWindow.js');
		const parentPidMap = await getProcessParentPidMap();
		if (parentPidMap == null) return false;

		const terminal = await findTerminalForProcess(pid, window.terminals, parentPidMap);
		if (terminal == null) return false;

		terminal.show();
		return true;
	} catch (ex) {
		Logger.warn(`revealTerminalForProcess: failed to reveal terminal for PID ${pid}: ${ex}`);
		return false;
	}
}
