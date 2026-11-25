import * as assert from 'node:assert';
// KEEP: the container must initialize before the command decorators' circular imports
import '../../container.js';
import * as sinon from 'sinon';
import type { TextEditor } from 'vscode';
import { Selection, Uri } from 'vscode';
import { createReference } from '@gitlens/git/utils/reference.utils.js';
import type { Container } from '../../container.js';
import type { CommandContext } from '../commandContext.js';
import type { CopyFileDeepLinkCommandArgs } from '../copyDeepLink.js';
import { CopyFileDeepLinkCommand } from '../copyDeepLink.js';

suite('CopyFileDeepLinkCommand', () => {
	const repoPath = '/test/repo';
	const fileUri = Uri.file(`${repoPath}/file.txt`);
	const remoteUrl = 'https://github.com/test/repo.git';
	let copyFileDeepLinkUrl: sinon.SinonStub;
	let command: CopyFileDeepLinkCommand;

	setup(() => {
		copyFileDeepLinkUrl = sinon.stub().resolves();
		const container = {
			git: {
				getRepositoryService: () => ({
					remotes: {
						getRemotes: () => Promise.resolve([{ name: 'origin', default: true, url: remoteUrl }]),
					},
				}),
			},
			deepLinks: { copyFileDeepLinkUrl: copyFileDeepLinkUrl },
		} as unknown as Container;
		// KEEP: constructing the command would register a second instance of the running extension's command
		command = Object.create(CopyFileDeepLinkCommand.prototype) as CopyFileDeepLinkCommand;
		(command as unknown as { container: Container }).container = container;
	});

	async function getLinesForContext(context: Partial<CommandContext>): Promise<number[] | undefined> {
		const args: CopyFileDeepLinkCommandArgs = {
			repoPath: repoPath,
			filePath: 'file.txt',
			ref: createReference('a'.repeat(40), repoPath, { refType: 'revision' }),
		};

		await (
			command as unknown as {
				preExecute(context: CommandContext, args?: CopyFileDeepLinkCommandArgs): Promise<void>;
			}
		).preExecute(
			{
				command: 'gitlens.copyDeepLinkToLines',
				type: 'uri',
				uri: fileUri,
				args: [],
				...context,
			} as CommandContext,
			args,
		);

		assert.strictEqual(copyFileDeepLinkUrl.callCount, 1);
		const [linkRepoPath, linkFilePath, linkRemoteUrl, lines] = copyFileDeepLinkUrl.firstCall.args as [
			string,
			string,
			string,
			number[] | undefined,
		];
		assert.strictEqual(linkRepoPath, repoPath);
		assert.strictEqual(linkFilePath, 'file.txt');
		assert.strictEqual(linkRemoteUrl, remoteUrl);

		return lines;
	}

	function getLines(
		anchorLine: number,
		anchorCharacter: number,
		activeLine: number,
		activeCharacter: number,
	): Promise<number[] | undefined> {
		return getLinesForContext({
			editor: {
				document: { uri: fileUri },
				selection: new Selection(anchorLine, anchorCharacter, activeLine, activeCharacter),
			} as unknown as TextEditor,
		});
	}

	test('a selection that ends at the start of a line excludes that line', async () => {
		assert.deepStrictEqual(await getLines(1, 0, 4, 0), [2, 4]);
	});

	test('a reversed selection that starts at the start of a line links to the same lines', async () => {
		assert.deepStrictEqual(await getLines(4, 0, 1, 0), [2, 4]);
	});

	test('a selection that starts inside a line and ends at the start of a line excludes the last line', async () => {
		assert.deepStrictEqual(await getLines(1, 3, 4, 0), [2, 4]);
	});

	test('a selection of a single whole line links to that line', async () => {
		assert.deepStrictEqual(await getLines(2, 0, 3, 0), [3]);
	});

	test('a selection from inside a line to the start of the next line links to that line', async () => {
		assert.deepStrictEqual(await getLines(2, 4, 3, 0), [3]);
	});

	test('a selection that ends inside a line links to every line it touches', async () => {
		assert.deepStrictEqual(await getLines(1, 2, 3, 5), [2, 4]);
	});

	test('a selection that ends after the first character of a line includes that line', async () => {
		assert.deepStrictEqual(await getLines(1, 0, 4, 1), [2, 5]);
	});

	test('a selection within a line links to that line', async () => {
		assert.deepStrictEqual(await getLines(2, 1, 2, 6), [3]);
	});

	test('a selection on the first line links to the first line', async () => {
		assert.deepStrictEqual(await getLines(0, 0, 1, 0), [1]);
	});

	test('a cursor with nothing selected links to no lines', async () => {
		assert.strictEqual(await getLines(2, 0, 2, 0), undefined);
	});

	test('a line from the gutter links to that line', async () => {
		assert.deepStrictEqual(await getLinesForContext({ type: 'editorLine', line: 6 }), [7]);
	});
});
