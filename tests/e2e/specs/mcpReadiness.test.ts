/**
 * MCP readiness — the guarantee `waitForCliInstall` makes (#5945)
 *
 * The MCP specs reach this helper only through the happy path, where the CLI is already whole by the
 * time anything asks for it, so nothing in the suite notices if readiness goes back to meaning "the
 * path exists". These cases force the states that distinction exists for, against a file this spec
 * owns rather than a real install, so they are deterministic rather than a race waiting to be lost.
 *
 * Each state is covered twice, because the two halves can fail independently. The polling cases flip
 * the file while a single call is already waiting: a helper that probed once and then slept out its
 * budget would satisfy a before/after pair of calls, but not these. The give-up cases pin what the
 * failure says, since `ETXTBSY` and `EACCES` send a reader to different places.
 *
 * No editor is launched: no test takes the `vscode` fixture, and the harness has no auto-use fixture
 * that would start one anyway.
 *
 * POSIX only. `ETXTBSY` is how Linux and macOS refuse to exec a file a writer holds open; Windows
 * reports a sharing violation through different codes, and `chmod` there does not take an executable
 * bit away, so neither state can be staged.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import * as process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { createTmpDir, expect, test } from '../baseTest.js';
import { waitForCliInstall } from '../helpers/mcpHelper.js';

/** Room for several poll intervals (250ms, doubling) without padding the suite. */
const pollingBudgetMs = 4000;
/** Long enough to show the call is still waiting, short enough to stay well inside the budget. */
const blockedForMs = 400;
/** Just enough to prove the helper gave up rather than hung. */
const giveUpBudgetMs = 600;

const script = '#!/bin/sh\necho probe\n';

/** Tracks settlement without awaiting, so a pending call can be asserted on mid-flight. */
function track(promise: Promise<void>): { settled: () => boolean; done: Promise<void> } {
	let settled = false;
	const done = promise.then(
		() => void (settled = true),
		(ex: unknown) => {
			settled = true;
			throw ex;
		},
	);
	return { settled: () => settled, done: done };
}

test.describe('MCP readiness', () => {
	test.skip(process.platform === 'win32', 'ETXTBSY and a missing executable bit are POSIX states');

	test('keeps polling while a writer holds the binary open, and proceeds once it closes', async () => {
		const gkPath = join(await createTmpDir(), 'gk');

		// Written in full and left open: the file is complete, so size says ready while exec does not.
		const handle = await open(gkPath, 'w', 0o755);
		await handle.write(script);

		const wait = track(waitForCliInstall(gkPath, pollingBudgetMs));
		await delay(blockedForMs);
		expect(wait.settled(), 'must still be waiting while the writer holds the file').toBe(false);

		await handle.close();

		await wait.done;
		expect(spawnSync(gkPath, ['--version']).error, 'the binary the helper accepted must run').toBeUndefined();
	});

	test('keeps polling while the executable bit is missing, and proceeds once it lands', async () => {
		const gkPath = join(await createTmpDir(), 'gk');

		// Closed, complete, and not executable — the window an installer leaves when it chmods second.
		writeFileSync(gkPath, script, { mode: 0o644 });

		const wait = track(waitForCliInstall(gkPath, pollingBudgetMs));
		await delay(blockedForMs);
		expect(wait.settled(), 'must still be waiting while the file cannot be executed').toBe(false);

		chmodSync(gkPath, 0o755);

		await wait.done;
		expect(spawnSync(gkPath, ['--version']).error, 'the binary the helper accepted must run').toBeUndefined();
	});

	test('names ETXTBSY when a writer never lets go', async () => {
		const gkPath = join(await createTmpDir(), 'gk');

		const handle = await open(gkPath, 'w', 0o755);
		await handle.write(script);

		try {
			await expect(waitForCliInstall(gkPath, giveUpBudgetMs)).rejects.toThrow(
				/never became executable.*ETXTBSY/s,
			);
		} finally {
			await handle.close();
		}
	});

	test('names EACCES when the executable bit never lands', async () => {
		const gkPath = join(await createTmpDir(), 'gk');
		writeFileSync(gkPath, script, { mode: 0o644 });

		await expect(waitForCliInstall(gkPath, giveUpBudgetMs)).rejects.toThrow(/never became executable.*EACCES/s);
	});
});
