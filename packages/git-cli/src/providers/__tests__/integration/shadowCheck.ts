/**
 * A shadow check for the worktree summary's base re-measure: whenever the summary keeps the re-measure's answer, it
 * also reads the base in full and hands both here. Nothing else ties the two together, so a later change to the full
 * read could otherwise leave the shortcut keeping answers the full read no longer gives, which the cases written for
 * it would not notice.
 *
 * A mismatch is recorded rather than thrown: the summary treats a throw as a failed base read and keeps going, so
 * only the root `afterEach` hook (see `rootHooks.ts`) can fail the test that caused it. A test that must see exact
 * process counts, which the extra full read would change, creates its service without this check.
 */
import * as assert from 'assert';
import type { AheadOfBase } from '@gitlens/git/providers/branches.js';

let mismatches: Error[] = [];

export function verifyBaseRemeasure(remeasured: AheadOfBase, full: AheadOfBase | undefined): void {
	try {
		// The whole answer, so the fork point and `defaultBranch` count too
		assert.deepStrictEqual(remeasured, full);
	} catch (ex) {
		mismatches.push(ex instanceof Error ? ex : new Error(String(ex)));
	}
}

/** The mismatches recorded since the last call, for the root `afterEach` hook to fail the test on */
export function takeBaseRemeasureMismatches(): Error[] {
	const taken = mismatches;
	mismatches = [];
	return taken;
}
