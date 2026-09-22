import * as assert from 'node:assert';
// Imported for its side effect, FIRST and deliberately — see the same import in
// `startAgentSession.test.ts`: the `@command()` decorator's module imports `container.ts` as a
// value, and letting container initialize first breaks the import cycle.
import '../../container.js';
import * as sinon from 'sinon';
import { env } from 'vscode';
import type { PullRequest } from '@gitlens/git/models/pullRequest.js';
import type { Container } from '../../container.js';
import type { CommandContext } from '../commandContext.js';
import type { KeplerCommandArgs } from '../kepler.js';
import { KeplerCommand } from '../kepler.js';

const localPath = '/Users/keith/code/vscode-gitlens';

const pr = {
	url: 'https://github.com/gitkraken/vscode-gitlens/pull/1',
	provider: { id: 'github', name: 'GitHub', domain: 'github.com', icon: 'github' },
	repository: { owner: 'gitkraken', repo: 'vscode-gitlens' },
} as unknown as PullRequest;

function makeNode(type: string, props: Record<string, unknown>): unknown {
	return {
		type: type,
		is: (t: string) => t === type,
		isAny: (...types: string[]) => types.includes(type),
		...props,
	};
}

function makeContainer(options: { knownRepoPath?: string; identityRepoPath?: string }): Container {
	const repoFor = (path: string | undefined) =>
		path != null ? { virtual: false, path: path, uri: { fsPath: path } } : undefined;

	return {
		kepler: { channel: 'production', scheme: 'kepler://' },
		telemetry: { sendEvent: () => {} },
		git: { getRepository: (p: string) => (p === options.knownRepoPath ? repoFor(p) : undefined) },
		repositoryIdentity: { getRepository: () => Promise.resolve(repoFor(options.identityRepoPath)) },
	} as unknown as Container;
}

/** `GlCommandBase`'s constructor registers with real `vscode.commands`, which would collide with
 *  the running extension's instance — build around the prototype instead (as
 *  `startAgentSession.test.ts` does) and drive the protected `preExecute` directly. */
function makeCommand(container: Container): {
	preExecute: (context: CommandContext, args?: KeplerCommandArgs) => Promise<void>;
} {
	const instance = Object.create(KeplerCommand.prototype) as KeplerCommand;
	(instance as unknown as { container: Container }).container = container;
	return instance as unknown as { preExecute: (context: CommandContext, args?: KeplerCommandArgs) => Promise<void> };
}

function viewItemContext(command: 'gitlens.kepler.startReview' | 'gitlens.kepler.newTask', node: unknown) {
	return { type: 'viewItem', command: command, node: node, args: [] } as unknown as CommandContext;
}

function parseLink(link: string): Record<string, string> {
	return Object.fromEntries(new URL(link).searchParams);
}

suite('KeplerCommand', () => {
	let sandbox: sinon.SinonSandbox;
	let openExternal: sinon.SinonStub;

	setup(() => {
		sandbox = sinon.createSandbox();
		openExternal = sandbox.stub(env, 'openExternal').resolves(true);
	});

	teardown(() => {
		sandbox.restore();
	});

	test('startReview from a PR node sends the PR identity, its repo path, and the review action', async () => {
		const command = makeCommand(makeContainer({ knownRepoPath: localPath }));

		await command.preExecute(
			viewItemContext(
				'gitlens.kepler.startReview',
				makeNode('pullrequest', { pullRequest: pr, repoPath: localPath }),
			),
		);

		assert.deepStrictEqual(parseLink(String(openExternal.firstCall.args[0])), {
			url: pr.url,
			kind: 'pr',
			provider: 'github',
			repo: localPath,
			action: 'default-review',
		});
	});

	test('startReview from a Launchpad item with no open repo falls back to a silent identity lookup', async () => {
		const command = makeCommand(makeContainer({ knownRepoPath: localPath, identityRepoPath: localPath }));

		await command.preExecute(
			viewItemContext(
				'gitlens.kepler.startReview',
				makeNode('launchpad-item', { pullRequest: pr, repoPath: undefined }),
			),
		);

		assert.strictEqual(parseLink(String(openExternal.firstCall.args[0])).repo, localPath);
	});

	test('startReview omits repo when no local clone resolves', async () => {
		const command = makeCommand(makeContainer({}));

		await command.preExecute(
			viewItemContext(
				'gitlens.kepler.startReview',
				makeNode('launchpad-item', { pullRequest: pr, repoPath: undefined }),
			),
		);

		assert.ok(!('repo' in parseLink(String(openExternal.firstCall.args[0]))));
	});

	test('newTask from a repository node sends only the repo', async () => {
		const command = makeCommand(makeContainer({ knownRepoPath: localPath }));

		await command.preExecute(
			viewItemContext('gitlens.kepler.newTask', makeNode('repository', { repo: { path: localPath } })),
		);

		assert.deepStrictEqual(parseLink(String(openExternal.firstCall.args[0])), { repo: localPath });
	});

	test('startReview without a PR does nothing', async () => {
		const command = makeCommand(makeContainer({}));

		await command.preExecute({ type: 'unknown', command: 'gitlens.kepler.startReview', args: [] });

		assert.strictEqual(openExternal.callCount, 0);
	});
});
