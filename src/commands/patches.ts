import type { TextEditor } from 'vscode';
import { env, window, workspace } from 'vscode';
import { Commands } from '../constants';
import type { Container } from '../container';
import { GitCommit, GitCommitIdentity } from '../git/models/commit';
import { showPatchesView } from '../plus/patches/actions';
import type { CloudPatch, CloudPatchData } from '../plus/patches/cloudPatchService';
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
			repo = await getRepositoryOrShowPicker('Create Patch');
		} else {
			repo = this.container.git.getRepository(args.repoPath);
		}
		if (repo == null) return;

		const diff = await this.container.git.getDiff(repo.uri, args?.ref1 ?? 'HEAD', args?.ref2);
		if (diff == null) return;

		const d = await workspace.openTextDocument({ content: diff.contents, language: 'diff' });
		await window.showTextDocument(d);

		const patch = await this.container.cloudPatches.create(repo, diff.baseSha, diff.contents);
		void this.showPatchNotification(patch);
	}

	private async showPatchNotification(patch: CloudPatch | undefined) {
		if (patch == null) return;

		await env.clipboard.writeText(patch.linkUrl);

		const copy = { title: 'Copy Link' };
		const result = await window.showInformationMessage(`Created cloud patch ${patch.id}`, copy);

		if (result === copy) {
			await env.clipboard.writeText(patch.linkUrl);
		}
	}
}

@command()
export class OpenPatchCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super(Commands.OpenPatch);
	}

	async execute(editor?: TextEditor) {
		if (this.container.git.highlander == null) return;

		let document;
		if (editor?.document?.languageId === 'diff') {
			document = editor.document;
		} else {
			const uris = await window.showOpenDialog({
				canSelectFiles: true,
				canSelectFolders: false,
				canSelectMany: false,
				filters: { Patches: ['patch'] },
				openLabel: 'Open Patch',
				title: 'Open Patch File',
			});
			const uri = uris?.[0];
			if (uri == null) return;

			document = await workspace.openTextDocument(uri);
			await window.showTextDocument(document);
		}

		const repoPath = this.container.git.highlander.path;
		const diffFiles = await this.container.git.getDiffFiles(repoPath, document.getText());

		// Total hack here creating a fake commit object to pass to the details view -- this won't really work (e.g. clicking on the files won't open a valid diff)
		// Need to think about how to best provide this -- either create a real, but unreachable, commit and then use that sha which should work until a GC
		// Or need to fully virtualize the patch into a new URI structure with a new FS provider or something

		const date = new Date();

		const commit = new GitCommit(
			this.container,
			repoPath,
			`0000000000000000000000000000000000000000-`,
			new GitCommitIdentity('You', undefined, date),
			new GitCommitIdentity('You', undefined, date),
			'Patch changes',
			['HEAD'],
			'Patch changes',
			diffFiles?.files,
		);

		void showPatchesView(commit, { pin: true });
	}
}

export interface OpenCloudPatchCommandArgs {
	id: string;
	patchId?: string;
}

@command()
export class OpenCloudPatchCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.OpenCloudPatch);
	}

	async execute(args?: OpenCloudPatchCommandArgs) {
		// TODO: We need to be able to infer the repo path from the patch id, rather than using the current repo. Then we should take the user through
		// the flow of getting the repo open (clone if it's not available, etc., use the repo mapping file) and then open the patch in the details view
		if (this.container.git.highlander == null) {
			void window.showErrorMessage('Cannot open cloud patch: no active repository');
			return;
		}

		if (args?.id == null) {
			void window.showErrorMessage('Cannot open cloud patch: no patch id provided');
			return;
		}

		const repoPath = this.container.git.highlander.path;

		const cloudPatch = await this.container.cloudPatches.get(args?.id);
		if (cloudPatch == null) {
			void window.showErrorMessage(`Cannot open cloud patch: patch ${args.id} not found`);
			return;
		}

		let patch: CloudPatchData | undefined;
		if (args?.patchId) {
			patch = await this.container.cloudPatches.getPatch(args.patchId);
		} else {
			const patches = await this.container.cloudPatches.getPatches(cloudPatch.id);

			if (patches == null || patches.length === 0) {
				void window.showErrorMessage(`Cannot open cloud patch: no patch found under id ${args.patchId}`);
				return;
			}

			patch = patches[0];

			const patchContents = await this.container.cloudPatches.getPatchContents(patch.id);
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

		const diffFiles = await this.container.git.getDiffFiles(repoPath, patch.contents);

		// Total hack here creating a fake commit object to pass to the details view -- this won't really work (e.g. clicking on the files won't open a valid diff)
		// Need to think about how to best provide this -- either create a real, but unreachable, commit and then use that sha which should work until a GC
		// Or need to fully virtualize the patch into a new URI structure with a new FS provider or something

		const date = new Date();

		const commit = new GitCommit(
			this.container,
			repoPath,
			`0000000000000000000000000000000000000000-`,
			new GitCommitIdentity('You', undefined, date),
			new GitCommitIdentity('You', undefined, date),
			'Patch changes',
			['HEAD'],
			'Patch changes',
			diffFiles?.files,
		);

		void showPatchesView(commit, { pin: true });
	}
}
