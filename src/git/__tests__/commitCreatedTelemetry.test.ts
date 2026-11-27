import * as assert from 'node:assert';
// KEEP: imported first for its side effect, or the decorator-registry import cycle breaks
import '../../container.js';
import * as sinon from 'sinon';
import type { GitReflogEntry } from '@gitlens/git/models/reflog.js';
import type { RepositoryChange } from '@gitlens/git/models/repository.js';
import type { Container } from '../../container.js';
import { CommitCreatedTelemetry } from '../commitCreatedTelemetry.js';

type RepositoryChangeListener = (e: {
	readonly repository: { readonly path: string };
	changed(...changes: RepositoryChange[]): boolean;
}) => void;

type Harness = {
	readonly telemetry: { enabled: boolean; sendEvent: sinon.SinonStub };
	readonly service: CommitCreatedTelemetry;
	log(sha: string, message: string): void;
	fire(...changes: RepositoryChange[]): void;
};

function makeHarness(
	sandbox: sinon.SinonSandbox,
	entries: GitReflogEntry[] = [{ sha: 'a', message: 'commit (initial): init' }],
): Harness {
	// Like git, an unborn HEAD fails the reflog read and doesn't resolve
	const refs = {
		getReflogEntries: () =>
			entries.length ? Promise.resolve([...entries]) : Promise.reject(new Error("fatal: bad revision 'HEAD'")),
		validateReference: () => Promise.resolve(entries[0]?.sha),
	};

	const repo = { path: '/repo' };
	let listener: RepositoryChangeListener | undefined;
	const noopDisposable = { dispose: () => {} };
	const telemetry = { enabled: true, sendEvent: sandbox.stub() };
	const container = {
		git: {
			openRepositories: [repo],
			getRepositoryService: () => ({ refs: refs }),
			onDidChangeRepository: (l: RepositoryChangeListener) => {
				listener = l;
				return noopDisposable;
			},
			onDidChangeRepositories: () => noopDisposable,
		},
		telemetry: telemetry,
	} as unknown as Container;

	return {
		telemetry: telemetry,
		service: new CommitCreatedTelemetry(container),
		log: (sha, message) => entries.unshift({ sha: sha, message: message }),
		fire: (...changes) => {
			listener?.({ repository: repo, changed: (...affected) => affected.some(c => changes.includes(c)) });
		},
	};
}

async function settle(): Promise<void> {
	for (let i = 0; i < 20; i++) {
		await new Promise<void>(resolve => setImmediate(resolve));
	}
	await new Promise<void>(resolve => setTimeout(resolve, 20));
}

suite('CommitCreatedTelemetry Test Suite', () => {
	let sandbox: sinon.SinonSandbox;
	let harness: Harness;

	setup(async () => {
		sandbox = sinon.createSandbox();
		harness = makeHarness(sandbox);
		await settle();
	});

	teardown(() => {
		harness.service.dispose();
		sandbox.restore();
	});

	test('sends nothing for the commits already there when a repository opens', async () => {
		harness.fire('heads');
		await settle();

		assert.strictEqual(harness.telemetry.sendEvent.callCount, 0);
	});

	test('sends once for a commit reported by several heads changes', async () => {
		harness.log('b', 'commit: second');
		harness.fire('head', 'heads');
		harness.fire('heads');
		await settle();

		assert.deepStrictEqual(harness.telemetry.sendEvent.args, [['commit/created']]);
	});

	test('sends nothing for a revert or a pull', async () => {
		harness.log('b', 'revert: Revert "init"');
		harness.fire('heads');
		await settle();
		harness.log('c', 'pull: Fast-forward');
		harness.fire('heads');
		await settle();

		assert.strictEqual(harness.telemetry.sendEvent.callCount, 0);
	});

	test('sends nothing for a commit made while telemetry is off, after it is turned back on', async () => {
		harness.telemetry.enabled = false;
		harness.log('b', 'commit: second');
		harness.fire('heads');
		harness.telemetry.enabled = true;
		harness.fire('heads');
		await settle();

		assert.strictEqual(harness.telemetry.sendEvent.callCount, 0);
	});

	test('keeps counting commits after a failed send', async () => {
		harness.telemetry.sendEvent.onFirstCall().throws(new Error('send failed'));
		for (const sha of ['b', 'c', 'd']) {
			harness.log(sha, `commit: ${sha}`);
			harness.fire('heads');
			await settle();
		}

		assert.strictEqual(harness.telemetry.sendEvent.callCount, 3);
	});

	test('sends for the first commit of a repository that had none when it opened', async () => {
		harness.service.dispose();
		harness = makeHarness(sandbox, []);
		await settle();

		harness.log('a', 'commit (initial): init');
		harness.fire('heads');
		await settle();

		assert.deepStrictEqual(harness.telemetry.sendEvent.args, [['commit/created']]);
	});
});
