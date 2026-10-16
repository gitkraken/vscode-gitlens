import * as assert from 'node:assert/strict';
// Initialize the command registry before loading the terminal link provider.
import '../../container.js';
import * as sinon from 'sinon';
import type { TerminalLinkContext } from 'vscode';
import { CancellationTokenSource, Disposable, Uri, window } from 'vscode';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import type { GitTag } from '@gitlens/git/models/tag.js';
import type { Container } from '../../container.js';
import type { GlRepository } from '../../git/models/repository.js';
import { configuration } from '../../system/-webview/configuration.js';
import { GitTerminalLinkProvider } from '../linkProvider.js';

suite('GitTerminalLinkProvider', () => {
	const repoA = { path: '/repo/a' } as unknown as GlRepository;
	const repoB = { path: '/repo/b' } as unknown as GlRepository;
	let sandbox: sinon.SinonSandbox;
	let provider: GitTerminalLinkProvider;
	let cancellation: CancellationTokenSource;
	let singleRepository: GlRepository | undefined;
	let getRepository: sinon.SinonStub;
	let getRepositoryService: sinon.SinonStub;
	let getBranches: sinon.SinonStub;
	let getTags: sinon.SinonStub;
	let isValidReference: sinon.SinonStub;
	let showIn: sinon.SinonStub;

	setup(() => {
		sandbox = sinon.createSandbox();
		cancellation = new CancellationTokenSource();
		singleRepository = undefined;
		getRepository = sandbox.stub().returns(repoB);
		getBranches = sandbox.stub().resolves({ values: [] });
		getTags = sandbox.stub().resolves({ values: [] });
		isValidReference = sandbox.stub().resolves(true);
		getRepositoryService = sandbox.stub().returns({
			branches: { getBranches: getBranches },
			tags: { getTags: getTags },
			refs: { isValidReference: isValidReference },
		});
		showIn = sandbox.stub(configuration, 'get').returns('quickpick');
		sandbox.stub(window, 'registerTerminalLinkProvider').returns(new Disposable(() => {}));
		provider = new GitTerminalLinkProvider({
			git: {
				get highlander() {
					return singleRepository;
				},
				getRepository: getRepository,
				getRepositoryService: getRepositoryService,
				onDidChangeRepository: () => new Disposable(() => {}),
				onDidChangeRepositories: () => new Disposable(() => {}),
			},
		} as unknown as Container);
	});

	teardown(() => {
		provider.dispose();
		cancellation.dispose();
		sandbox.restore();
	});

	function context(line = 'abc1234', cwd: Uri | undefined = Uri.file(repoB.path)): TerminalLinkContext {
		return { line: line, terminal: { shellIntegration: { cwd: cwd } } } as unknown as TerminalLinkContext;
	}

	test('resolves a commit in the terminal cwd when multiple repositories are open', async () => {
		const input = context();
		const links = await provider.provideTerminalLinks(input, cancellation.token);

		assert.equal(links.length, 1);
		assert.deepEqual(links[0].command.args, { repoPath: repoB.path, sha: 'abc1234' });
		sinon.assert.calledOnceWithExactly(getRepository, input.terminal.shellIntegration!.cwd);
	});

	test('prefers the terminal cwd repository over the single repository', async () => {
		singleRepository = repoA;
		const links = await provider.provideTerminalLinks(context(), cancellation.token);

		assert.equal(links.length, 1);
		assert.deepEqual(links[0].command.args, { repoPath: repoB.path, sha: 'abc1234' });
	});

	test('uses the single repository when shell integration is unavailable', async () => {
		singleRepository = repoA;
		const input = { line: 'abc1234', terminal: {} } as unknown as TerminalLinkContext;
		const links = await provider.provideTerminalLinks(input, cancellation.token);

		assert.equal(links.length, 1);
		assert.deepEqual(links[0].command.args, { repoPath: repoA.path, sha: 'abc1234' });
		sinon.assert.notCalled(getRepository);
	});

	test('does not guess a repository when multiple repositories have no terminal cwd', async () => {
		const input = { line: 'abc1234', terminal: {} } as unknown as TerminalLinkContext;
		assert.deepEqual(await provider.provideTerminalLinks(input, cancellation.token), []);
		sinon.assert.notCalled(getRepositoryService);
	});

	test('falls back to the single repository when the cwd is outside every known repository', async () => {
		singleRepository = repoA;
		getRepository.returns(undefined);
		const links = await provider.provideTerminalLinks(context(), cancellation.token);

		assert.equal(links.length, 1);
		assert.deepEqual(links[0].command.args, { repoPath: repoA.path, sha: 'abc1234' });
	});

	test('does not guess a repository when the cwd is outside every known repository of several', async () => {
		getRepository.returns(undefined);

		assert.deepEqual(await provider.provideTerminalLinks(context(), cancellation.token), []);
		sinon.assert.notCalled(getRepositoryService);
	});

	test('does not resolve a repository for an already cancelled request', async () => {
		cancellation.cancel();

		assert.deepEqual(await provider.provideTerminalLinks(context(), cancellation.token), []);
		sinon.assert.notCalled(getRepository);
	});

	test('keeps cached links scoped to the repository as the terminal changes directories', async () => {
		getRepository.onFirstCall().returns(repoA);
		const first = await provider.provideTerminalLinks(context('abc1234', Uri.file(repoA.path)), cancellation.token);
		const second = await provider.provideTerminalLinks(context(), cancellation.token);

		assert.deepEqual(first[0].command.args, { repoPath: repoA.path, sha: 'abc1234' });
		assert.deepEqual(second[0].command.args, { repoPath: repoB.path, sha: 'abc1234' });
	});

	test('does not link a hexadecimal value that is not a valid reference', async () => {
		isValidReference.resolves(false);

		assert.deepEqual(await provider.provideTerminalLinks(context('1234567'), cancellation.token), []);
		sinon.assert.calledOnce(isValidReference);
	});

	[
		['graph', 'gitlens.showInCommitGraph'],
		['inspect', 'gitlens.showInDetailsView'],
		['quickpick', 'gitlens.showQuickCommitDetails'],
	].forEach(([setting, command]) => {
		test(`preserves the ${setting} destination for terminal commits`, async () => {
			showIn.returns(setting);
			const links = await provider.provideTerminalLinks(context(), cancellation.token);

			assert.equal(links.length, 1);
			assert.equal(links[0].command.command, command);
			sinon.assert.calledOnceWithMatch(getRepositoryService, repoB.path);
		});
	});

	[
		['HEAD', 'gitlens.showQuickBranchHistory'],
		['main', 'gitlens.showQuickBranchHistory'],
		['v1.0', 'gitlens.showQuickBranchHistory'],
		['abc1234..def5678', 'gitlens.gitCommands'],
	].forEach(([line, command]) => {
		test(`preserves ${line} links in the terminal repository`, async () => {
			// A single repository also exists, so the link must come from the cwd lookup, not the fallback
			singleRepository = repoA;
			getBranches.resolves({
				values: [{ name: 'main', ref: 'main', repoPath: repoB.path } as unknown as GitBranch],
			});
			getTags.resolves({ values: [{ name: 'v1.0', ref: 'v1.0', repoPath: repoB.path } as unknown as GitTag] });
			const links = await provider.provideTerminalLinks(context(line), cancellation.token);

			assert.equal(links.length, 1);
			assert.equal(links[0].command.command, command);

			const args = links[0].command.args as { repoPath?: string; state?: { repo?: string } };
			assert.equal(args.repoPath ?? args.state?.repo, repoB.path);
			sinon.assert.calledOnceWithMatch(getRepositoryService, repoB.path);
		});
	});
});
