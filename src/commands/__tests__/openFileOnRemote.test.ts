import * as assert from 'node:assert';
// Initialize the container before the command decorators' circular imports.
import '../../container.js';
import * as sinon from 'sinon';
import type { TextEditor } from 'vscode';
import { commands, Selection, Uri } from 'vscode';
import type { LineRange } from '@gitlens/git/models/lineRange.js';
import type { Container } from '../../container.js';
import { GitUri } from '../../git/gitUri.js';
import { OpenFileOnRemoteCommand } from '../openFileOnRemote.js';
import type { OpenOnRemoteCommandArgs } from '../openOnRemote.js';

suite('OpenFileOnRemoteCommand', () => {
	const repoPath = '/test/repo';
	const fileUri = Uri.file(`${repoPath}/file.txt`);
	let sandbox: sinon.SinonSandbox;
	let executeCommand: sinon.SinonStub;
	let command: OpenFileOnRemoteCommand;

	setup(() => {
		sandbox = sinon.createSandbox();
		executeCommand = sandbox.stub(commands, 'executeCommand').resolves();
		sandbox
			.stub(GitUri, 'fromUri')
			.resolves({ repoPath: repoPath, relativePath: 'file.txt', sha: undefined } as unknown as GitUri);
		const container = {
			git: {
				getRepositoryService: () => ({
					remotes: { getRemotesWithProviders: () => Promise.resolve([]) },
				}),
			},
		} as unknown as Container;
		// Avoid registering a second instance of the running extension's command.
		command = Object.create(OpenFileOnRemoteCommand.prototype) as OpenFileOnRemoteCommand;
		(command as unknown as { container: Container }).container = container;
	});

	teardown(() => {
		sandbox.restore();
	});

	/** Runs the command for a zero-based editor selection and returns the one-based range it links to */
	async function getRange(
		anchorLine: number,
		anchorCharacter: number,
		activeLine: number,
		activeCharacter: number,
	): Promise<LineRange | undefined> {
		const editor = {
			document: { uri: fileUri },
			selection: new Selection(anchorLine, anchorCharacter, activeLine, activeCharacter),
		} as unknown as TextEditor;

		await command.execute(editor, fileUri, { branchOrTag: 'main', clipboard: true });

		assert.strictEqual(executeCommand.callCount, 1);
		const [id, args] = executeCommand.firstCall.args as [string, OpenOnRemoteCommandArgs];
		assert.strictEqual(id, 'gitlens.openOnRemote');
		assert.ok('resource' in args && !Array.isArray(args.resource) && 'range' in args.resource);

		return args.resource.range;
	}

	test('a cursor at the start of a line links to that line', async () => {
		assert.deepStrictEqual(await getRange(2, 0, 2, 0), {
			startLine: 3,
			startCharacter: 1,
			endLine: 3,
			endCharacter: 1,
		});
	});

	test('a cursor at the start of the first line links to the first line', async () => {
		assert.deepStrictEqual(await getRange(0, 0, 0, 0), {
			startLine: 1,
			startCharacter: 1,
			endLine: 1,
			endCharacter: 1,
		});
	});

	test('a cursor in the middle of a line links to that line', async () => {
		assert.deepStrictEqual(await getRange(2, 4, 2, 4), {
			startLine: 3,
			startCharacter: 5,
			endLine: 3,
			endCharacter: 5,
		});
	});

	test('a selection within lines links to every line it touches', async () => {
		assert.deepStrictEqual(await getRange(1, 2, 3, 5), {
			startLine: 2,
			startCharacter: 3,
			endLine: 4,
			endCharacter: 6,
		});
	});

	test('a selection that ends at the start of a line excludes that line', async () => {
		assert.deepStrictEqual(await getRange(1, 0, 4, 0), {
			startLine: 2,
			startCharacter: 1,
			endLine: 4,
			endCharacter: 1,
		});
	});

	test('a reversed selection that starts at the start of a line links to the same lines', async () => {
		assert.deepStrictEqual(await getRange(4, 0, 1, 0), {
			startLine: 2,
			startCharacter: 1,
			endLine: 4,
			endCharacter: 1,
		});
	});

	test('a selection of a single whole line links to that line', async () => {
		assert.deepStrictEqual(await getRange(2, 0, 3, 0), {
			startLine: 3,
			startCharacter: 1,
			endLine: 3,
			endCharacter: 1,
		});
	});
});
