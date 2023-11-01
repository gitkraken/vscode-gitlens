import type { TextEditor } from 'vscode';
import { env, window, workspace } from 'vscode';
import { Commands } from '../constants';
import type { Container } from '../container';
import { showPatchesView } from '../plus/drafts/actions';
import type { Draft, DraftPatch, LocalDraft } from '../plus/drafts/draftsService';
import { getRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { command } from '../system/command';
import type { CommandContext } from './base';
import {
	ActiveEditorCommand,
	Command,
	isCommandContextViewNodeHasCommit,
	isCommandContextViewNodeHasComparison,
} from './base';

export interface CreatePatchCommandArgs {
	ref1?: string;
	ref2?: string;
	repoPath?: string;
}

@command()
export class CreatePatchCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.CreatePatch);
	}

	protected override preExecute(context: CommandContext, args?: CreatePatchCommandArgs) {
		if (args == null) {
			if (context.type === 'viewItem') {
				if (isCommandContextViewNodeHasCommit(context)) {
					args = {
						repoPath: context.node.commit.repoPath,
						ref1: context.node.commit.ref,
					};
				} else if (isCommandContextViewNodeHasComparison(context)) {
					args = {
						repoPath: context.node.uri.fsPath,
						ref1: context.node.compareWithRef.ref,
						ref2: context.node.compareRef.ref,
					};
				}
			}
		}

		return this.execute(args);
	}

	async execute(args?: CreatePatchCommandArgs) {
		let repo;
		if (args?.repoPath == null) {
			repo = await getRepositoryOrShowPicker('Create Patch');
		} else {
			repo = this.container.git.getRepository(args.repoPath);
		}
		if (repo == null) return;

		const diff = await this.container.git.getDiff(repo.uri, args?.ref1 ?? 'HEAD', args?.ref2);
		if (diff == null) return;

		const d = await workspace.openTextDocument({ content: diff.contents, language: 'diff' });
		await window.showTextDocument(d);

		// const uri = await window.showSaveDialog({
		// 	filters: { Patches: ['patch'] },
		// 	saveLabel: 'Create Patch',
		// });
		// if (uri == null) return;

		// await workspace.fs.writeFile(uri, new TextEncoder().encode(patch.contents));
	}
}

@command()
export class CreateCloudPatchCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.CreateCloudPatch);
	}

	protected override preExecute(context: CommandContext, args?: CreatePatchCommandArgs) {
		if (args == null) {
			if (context.type === 'viewItem') {
				if (isCommandContextViewNodeHasCommit(context)) {
					args = {
						repoPath: context.node.commit.repoPath,
						ref1: context.node.commit.ref,
					};
				} else if (isCommandContextViewNodeHasComparison(context)) {
					args = {
						repoPath: context.node.uri.fsPath,
						ref1: context.node.compareWithRef.ref,
						ref2: context.node.compareRef.ref,
					};
				}
			}
		}

		return this.execute(args);
	}

	async execute(args?: CreatePatchCommandArgs) {
		let repo;
		if (args?.repoPath == null) {
			repo = await getRepositoryOrShowPicker('Create Cloud Patch');
		} else {
			repo = this.container.git.getRepository(args.repoPath);
		}
		if (repo == null) return;

		const diff = await this.container.git.getDiff(repo.uri, args?.ref1 ?? 'HEAD', args?.ref2);
		if (diff == null) return;

		const d = await workspace.openTextDocument({ content: diff.contents, language: 'diff' });
		await window.showTextDocument(d);

		// ask the user for a title

		const title = await window.showInputBox({
			title: 'Create Cloud Patch',
			prompt: 'Enter a title for the patch',
			validateInput: value => (value == null || value.length === 0 ? 'A title is required' : undefined),
		});
		if (title == null) return;

		// ask the user for an optional description
		const description = await window.showInputBox({
			title: 'Create Cloud Patch',
			prompt: 'Enter an optional description for the patch',
		});

		const patch = await this.container.drafts.createDraft(
			'patch',
			title,
			{
				contents: diff.contents,
				baseSha: diff.baseSha,
				repository: repo,
			},
			{ description: description },
		);
		void this.showPatchNotification(patch);
	}

	private async showPatchNotification(patch: Draft | undefined) {
		if (patch == null) return;

		await env.clipboard.writeText(patch.deepLinkUrl);

		const copy = { title: 'Copy Link' };
		const result = await window.showInformationMessage(`Created cloud patch ${patch.id}`, copy);

		if (result === copy) {
			await env.clipboard.writeText(patch.deepLinkUrl);
		}
	}
}

@command()
export class OpenPatchCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super(Commands.OpenPatch);
	}

	async execute(editor?: TextEditor) {
		let document;
		if (editor?.document?.languageId === 'diff') {
			document = editor.document;
		} else {
			const uris = await window.showOpenDialog({
				canSelectFiles: true,
				canSelectFolders: false,
				canSelectMany: false,
				filters: { Patches: ['diff', 'patch'] },
				openLabel: 'Open Patch',
				title: 'Open Patch File',
			});
			const uri = uris?.[0];
			if (uri == null) return;

			document = await workspace.openTextDocument(uri);
			await window.showTextDocument(document);
		}

		const patch: LocalDraft = {
			_brand: 'local',
			patch: {
				_brand: 'file',
				uri: document.uri,
				contents: document.getText(),
			},
		};

		void showPatchesView({ mode: 'draft', draft: patch });
	}
}

export interface OpenCloudPatchCommandArgs {
	id: string;
	patchId?: string;
	draft?: Draft;
}

@command()
export class OpenCloudPatchCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.OpenCloudPatch);
	}

	async execute(args?: OpenCloudPatchCommandArgs) {
		if (args?.id == null && args?.draft == null) {
			void window.showErrorMessage('Cannot open cloud patch: no patch or patch id provided');
			return;
		}

		const draft = args?.draft ?? (await this.container.drafts.getDraft(args?.id));
		if (draft == null) {
			void window.showErrorMessage(`Cannot open cloud patch: patch ${args.id} not found`);
			return;
		}

		let patch: DraftPatch | undefined;
		if (args?.patchId) {
			patch = await this.container.drafts.getPatch(args.patchId);
		} else {
			const patches = draft.changesets?.[0]?.patches;

			if (patches == null || patches.length === 0) {
				void window.showErrorMessage(`Cannot open cloud patch: no patch found under id ${args.patchId}`);
				return;
			}

			patch = patches[0];

			if (patch.repo == null && patch.repoData != null) {
				const repo = await this.container.git.findMatchingRepository({
					firstSha: patch.repoData.initialCommitSha,
					remoteUrl: patch.repoData.remote?.url,
				});
				if (repo != null) {
					patch.repo = repo;
				}
			}

			if (patch.repo == null) {
				void window.showErrorMessage(`Cannot open cloud patch: no repository found for patch ${args.patchId}`);
				return;
			} else if (this.container.git.highlander == null) {
				await this.container.git.getOrOpenRepository(patch.repo.uri.fsPath);
			}

			const patchContents = await this.container.drafts.getPatchContents(patch.id);
			if (patchContents == null) {
				void window.showErrorMessage(`Cannot open cloud patch: patch not found of contents empty`);
				return;
			}
			patch.contents = patchContents;
		}

		if (patch == null) {
			void window.showErrorMessage(`Cannot open cloud patch: patch not found`);
			return;
		}

		void showPatchesView({ mode: 'draft', draft: draft });
	}
}
