import type { TextDocumentShowOptions, TextEditor } from 'vscode';
import { env, Range, Uri, window, workspace } from 'vscode';
import type { DiffWithCommandArgs } from '../../commands/diffWith';
import type { DiffWithPreviousCommandArgs } from '../../commands/diffWithPrevious';
import type { DiffWithWorkingCommandArgs } from '../../commands/diffWithWorking';
import type { OpenFileOnRemoteCommandArgs } from '../../commands/openFileOnRemote';
import type { OpenOnlyChangedFilesCommandArgs } from '../../commands/openOnlyChangedFiles';
import type { OpenWorkingFileCommandArgs } from '../../commands/openWorkingFile';
import type { ShowQuickCommitCommandArgs } from '../../commands/showQuickCommit';
import type { ShowQuickCommitFileCommandArgs } from '../../commands/showQuickCommitFile';
import type { FileAnnotationType } from '../../config';
import { Commands, GlyphChars } from '../../constants';
import { Container } from '../../container';
import type { ShowInCommitGraphCommandArgs } from '../../plus/webviews/graph/protocol';
import { showRevisionPicker } from '../../quickpicks/revisionPicker';
import { executeCommand, executeEditorCommand } from '../../system/command';
import { configuration } from '../../system/configuration';
import { findOrOpenEditor, findOrOpenEditors, openChangesEditor } from '../../system/utils';
import { GitUri } from '../gitUri';
import type { GitCommit } from '../models/commit';
import { isCommit } from '../models/commit';
import { deletedOrMissing } from '../models/constants';
import type { GitFile } from '../models/file';
import type { GitRevisionReference } from '../models/reference';
import { getReferenceFromRevision, isUncommitted, isUncommittedStaged, shortenRevision } from '../models/reference';

type Ref = { repoPath: string; ref: string };
type RefRange = { repoPath: string; rhs: string; lhs: string };

export async function applyChanges(file: string | GitFile, rev1: GitRevisionReference, rev2?: GitRevisionReference) {
	let create = false;
	let ref1 = rev1.ref;
	let ref2 = rev2?.ref;
	if (typeof file !== 'string') {
		// If the file is `?` (untracked), then this must be a stash, so get the ^3 commit to access the untracked file
		if (file.status === '?') {
			ref1 = `${ref1}^3`;
			create = true;
		} else if (file.status === 'A') {
			create = true;
		} else if (file.status === 'D') {
			// If the file is deleted, check to see if it exists, if so, apply the delete, otherwise restore it from the previous commit
			const uri = GitUri.fromFile(file, rev1.repoPath);
			try {
				await workspace.fs.stat(uri);
			} catch {
				create = true;

				ref2 = ref1;
				ref1 = `${ref1}^`;
			}
		}
	}

	if (create) {
		const uri = GitUri.fromFile(file, rev1.repoPath);
		await Container.instance.git.applyChangesToWorkingFile(uri, ref1, ref2);
		await openFile(uri, { preserveFocus: true, preview: false });
	} else {
		// Open the working file to ensure undo will work
		await openFile(file, rev1, { preserveFocus: true, preview: false });
		await Container.instance.git.applyChangesToWorkingFile(GitUri.fromFile(file, rev1.repoPath, ref1), ref1, ref2);
	}
}

export async function copyIdToClipboard(ref: Ref | GitCommit) {
	await env.clipboard.writeText(ref.ref);
}

export async function copyMessageToClipboard(ref: Ref | GitCommit): Promise<void> {
	let commit;
	if (isCommit(ref)) {
		commit = ref;
		if (commit.message == null) {
			await commit.ensureFullDetails();
		}
	} else {
		commit = await Container.instance.git.getCommit(ref.repoPath, ref.ref);
		if (commit == null) return;
	}

	const message = commit.message ?? commit.summary;
	await env.clipboard.writeText(message);
}

export async function openAllChanges(commit: GitCommit, options?: TextDocumentShowOptions): Promise<void>;
export async function openAllChanges(
	files: GitFile[],
	refs: RefRange,
	options?: TextDocumentShowOptions,
): Promise<void>;
export async function openAllChanges(
	commitOrFiles: GitCommit | GitFile[],
	refsOrOptions: RefRange | TextDocumentShowOptions | undefined,
	options?: TextDocumentShowOptions,
) {
	const useChangesEditor = configuration.get('experimental.openChangesInMultiDiffEditor');

	let files;
	let refs: RefRange | undefined;
	let title;
	if (isCommit(commitOrFiles)) {
		if (commitOrFiles.files == null) {
			await commitOrFiles.ensureFullDetails();
		}

		files = commitOrFiles.files ?? [];
		refs = {
			repoPath: commitOrFiles.repoPath,
			rhs: commitOrFiles.sha,
			lhs:
				commitOrFiles.resolvedPreviousSha ??
				(useChangesEditor
					? (await commitOrFiles.getPreviousSha()) ?? commitOrFiles.unresolvedPreviousSha
					: // Don't need to worry about verifying the previous sha, as the DiffWith command will
					  commitOrFiles.unresolvedPreviousSha),
		};

		options = refsOrOptions as TextDocumentShowOptions | undefined;
		title = `Changes in ${shortenRevision(refs.rhs)}`;
	} else {
		files = commitOrFiles;
		refs = refsOrOptions as RefRange;
		title = `Changes between ${shortenRevision(refs.lhs)} ${GlyphChars.ArrowLeftRightLong} ${shortenRevision(
			refs.rhs,
		)}`;
	}

	if (files.length > (useChangesEditor ? 50 : 10)) {
		const result = await window.showWarningMessage(
			`Are you sure you want to open the changes for all ${files.length} files?`,
			{ title: 'Yes' },
			{ title: 'No', isCloseAffordance: true },
		);
		if (result == null || result.title === 'No') return;
	}

	options = { preserveFocus: true, preview: false, ...options };

	if (!useChangesEditor) {
		for (const file of files) {
			await openChanges(file, refs, options);
		}
		return;
	}

	const { git } = Container.instance;

	const resources: Parameters<typeof openChangesEditor>[0] = [];
	for (const file of files) {
		const rhs =
			file.status === 'D' ? undefined : (await git.getBestRevisionUri(refs.repoPath, file.path, refs.rhs))!;
		const lhs =
			file.status === 'A'
				? undefined
				: (await git.getBestRevisionUri(refs.repoPath, file.originalPath ?? file.path, refs.lhs))!;
		const uri = (file.status === 'D' ? lhs : rhs) ?? GitUri.fromFile(file, refs.repoPath);
		resources.push({ uri: uri, lhs: lhs, rhs: rhs });
	}

	await openChangesEditor(resources, title, options);
}

export async function openAllChangesWithDiffTool(commit: GitCommit): Promise<void>;
export async function openAllChangesWithDiffTool(files: GitFile[], ref: Ref): Promise<void>;
export async function openAllChangesWithDiffTool(commitOrFiles: GitCommit | GitFile[], ref?: Ref) {
	let files;
	if (isCommit(commitOrFiles)) {
		if (commitOrFiles.files == null) {
			await commitOrFiles.ensureFullDetails();
		}

		files = commitOrFiles.files ?? [];
		ref = {
			repoPath: commitOrFiles.repoPath,
			ref: commitOrFiles.sha,
		};
	} else {
		files = commitOrFiles;
	}

	if (files.length > 10) {
		const result = await window.showWarningMessage(
			`Are you sure you want to open the changes for all ${files.length} files?`,
			{ title: 'Yes' },
			{ title: 'No', isCloseAffordance: true },
		);
		if (result == null || result.title === 'No') return;
	}

	for (const file of files) {
		void openChangesWithDiffTool(file, ref!);
	}
}

export async function openAllChangesWithWorking(commit: GitCommit, options?: TextDocumentShowOptions): Promise<void>;
export async function openAllChangesWithWorking(
	files: GitFile[],
	ref: Ref,
	options?: TextDocumentShowOptions,
): Promise<void>;
export async function openAllChangesWithWorking(
	commitOrFiles: GitCommit | GitFile[],
	refOrOptions: Ref | TextDocumentShowOptions | undefined,
	options?: TextDocumentShowOptions,
) {
	let files;
	let ref;
	if (isCommit(commitOrFiles)) {
		if (commitOrFiles.files == null) {
			await commitOrFiles.ensureFullDetails();
		}

		files = commitOrFiles.files ?? [];
		ref = {
			repoPath: commitOrFiles.repoPath,
			ref: commitOrFiles.sha,
		};

		options = refOrOptions as TextDocumentShowOptions | undefined;
	} else {
		files = commitOrFiles;
		ref = refOrOptions as Ref;
	}

	const useChangesEditor = configuration.get('experimental.openChangesInMultiDiffEditor');

	if (files.length > (useChangesEditor ? 50 : 10)) {
		const result = await window.showWarningMessage(
			`Are you sure you want to open the changes for all ${files.length} files?`,
			{ title: 'Yes' },
			{ title: 'No', isCloseAffordance: true },
		);
		if (result == null || result.title === 'No') return;
	}

	options = { preserveFocus: true, preview: false, ...options };

	if (!useChangesEditor) {
		for (const file of files) {
			await openChangesWithWorking(file, ref, options);
		}
		return;
	}

	const { git } = Container.instance;

	const resources: Parameters<typeof openChangesEditor>[0] = [];
	for (const file of files) {
		const rhs =
			file.status === 'D'
				? undefined
				: await git.getWorkingUri(
						ref.repoPath,
						(await git.getBestRevisionUri(ref.repoPath, file.path, ref.ref))!,
				  );
		const lhs =
			file.status === 'A'
				? undefined
				: (await git.getBestRevisionUri(ref.repoPath, file.originalPath ?? file.path, ref.ref))!;
		const uri = (file.status === 'D' ? lhs : rhs) ?? GitUri.fromFile(file, ref.repoPath);
		resources.push({ uri: uri, lhs: lhs, rhs: rhs });
	}

	await openChangesEditor(
		resources,
		`Changes between ${shortenRevision(ref.ref)} ${GlyphChars.ArrowLeftRightLong} Working Tree`,
		options,
	);
}

export async function openChanges(
	file: string | GitFile,
	commit: GitCommit,
	options?: TextDocumentShowOptions,
): Promise<void>;
export async function openChanges(
	file: GitFile,
	refs: RefRange,
	options?: TextDocumentShowOptions & { lhsTitle?: string; rhsTitle?: string },
): Promise<void>;
export async function openChanges(
	file: GitFile,
	commitOrRefs: GitCommit | RefRange,
	options?: TextDocumentShowOptions & { lhsTitle?: string; rhsTitle?: string },
): Promise<void>;
export async function openChanges(
	file: string | GitFile,
	commitOrRefs: GitCommit | RefRange,
	options?: TextDocumentShowOptions & { lhsTitle?: string; rhsTitle?: string },
) {
	const isArgCommit = isCommit(commitOrRefs);

	if (typeof file === 'string') {
		if (!isArgCommit) throw new Error('Invalid arguments');

		const f = await commitOrRefs.findFile(file);
		if (f == null) throw new Error('Invalid arguments');

		file = f;
	}

	options = { preserveFocus: true, preview: false, ...options };

	if (file.status === 'A' && isArgCommit) {
		const commit = await commitOrRefs.getCommitForFile(file);
		void executeCommand<DiffWithPreviousCommandArgs>(Commands.DiffWithPrevious, {
			commit: commit,
			showOptions: options,
		});

		return;
	}

	const refs: RefRange = isArgCommit
		? {
				repoPath: commitOrRefs.repoPath,
				rhs: commitOrRefs.sha,
				// Don't need to worry about verifying the previous sha, as the DiffWith command will
				lhs: commitOrRefs.unresolvedPreviousSha,
		  }
		: commitOrRefs;

	const rhsUri = GitUri.fromFile(file, refs.repoPath);
	const lhsUri =
		file.status === 'R' || file.status === 'C' ? GitUri.fromFile(file, refs.repoPath, refs.lhs, true) : rhsUri;

	void (await executeCommand<DiffWithCommandArgs>(Commands.DiffWith, {
		repoPath: refs.repoPath,
		lhs: { uri: lhsUri, sha: refs.lhs, title: options?.lhsTitle },
		rhs: { uri: rhsUri, sha: refs.rhs, title: options?.rhsTitle },
		showOptions: options,
	}));
}

export function openChangesWithDiffTool(file: string | GitFile, commit: GitCommit, tool?: string): Promise<void>;
export function openChangesWithDiffTool(file: GitFile, ref: Ref, tool?: string): Promise<void>;
export async function openChangesWithDiffTool(file: string | GitFile, commitOrRef: GitCommit | Ref, tool?: string) {
	if (typeof file === 'string') {
		if (!isCommit(commitOrRef)) throw new Error('Invalid arguments');

		const f = await commitOrRef.findFile(file);
		if (f == null) throw new Error('Invalid arguments');

		file = f;
	}

	return Container.instance.git.openDiffTool(
		commitOrRef.repoPath,
		GitUri.fromFile(file, file.repoPath ?? commitOrRef.repoPath),
		{
			ref1: isUncommitted(commitOrRef.ref) ? '' : `${commitOrRef.ref}^`,
			ref2: isUncommitted(commitOrRef.ref) ? '' : commitOrRef.ref,
			staged: isUncommittedStaged(commitOrRef.ref) || file.indexStatus != null,
			tool: tool,
		},
	);
}

export async function openChangesWithWorking(
	file: string | GitFile,
	commit: GitCommit,
	options?: TextDocumentShowOptions & { lhsTitle?: string },
): Promise<void>;
export async function openChangesWithWorking(
	file: GitFile,
	ref: Ref,
	options?: TextDocumentShowOptions & { lhsTitle?: string },
): Promise<void>;
export async function openChangesWithWorking(
	file: string | GitFile,
	commitOrRef: GitCommit | Ref,
	options?: TextDocumentShowOptions & { lhsTitle?: string },
) {
	if (typeof file === 'string') {
		if (!isCommit(commitOrRef)) throw new Error('Invalid arguments');

		const f = await commitOrRef.findFile(file);
		if (f == null) throw new Error('Invalid arguments');

		file = f;
	}

	if (file.status === 'D') return;

	let ref;
	if (isCommit(commitOrRef)) {
		ref = {
			repoPath: commitOrRef.repoPath,
			ref: commitOrRef.sha,
		};
	} else {
		ref = commitOrRef;
	}

	options = { preserveFocus: true, preview: false, ...options };

	void (await executeEditorCommand<DiffWithWorkingCommandArgs>(Commands.DiffWithWorking, undefined, {
		uri: GitUri.fromFile(file, ref.repoPath, ref.ref),
		showOptions: options,
		lhsTitle: options?.lhsTitle,
	}));
}

export async function openDirectoryCompare(
	repoPath: string,
	ref: string,
	ref2: string | undefined,
	tool?: string,
): Promise<void> {
	return Container.instance.git.openDirectoryCompare(repoPath, ref, ref2, tool);
}

export async function openDirectoryCompareWithPrevious(ref: Ref | GitCommit): Promise<void> {
	return openDirectoryCompare(ref.repoPath, ref.ref, `${ref.ref}^`);
}

export async function openDirectoryCompareWithWorking(ref: Ref | GitCommit): Promise<void> {
	return openDirectoryCompare(ref.repoPath, ref.ref, undefined);
}

export async function openFile(uri: Uri, options?: TextDocumentShowOptions): Promise<void>;
export async function openFile(
	file: string | GitFile,
	ref: GitRevisionReference,
	options?: TextDocumentShowOptions,
): Promise<void>;
export async function openFile(
	fileOrUri: string | GitFile | Uri,
	refOrOptions?: GitRevisionReference | TextDocumentShowOptions,
	options?: TextDocumentShowOptions,
) {
	let uri;
	if (fileOrUri instanceof Uri) {
		uri = fileOrUri;
		options = refOrOptions as TextDocumentShowOptions;
	} else {
		const ref = refOrOptions as GitRevisionReference;

		uri = GitUri.fromFile(fileOrUri, ref.repoPath, ref.ref);
		// If the file is `?` (untracked), then this must be an untracked file in a stash, so just return
		if (typeof fileOrUri !== 'string' && fileOrUri.status === '?') return;
	}

	options = { preserveFocus: true, preview: false, ...options };

	void (await executeEditorCommand<OpenWorkingFileCommandArgs>(Commands.OpenWorkingFile, undefined, {
		uri: uri,
		showOptions: options,
	}));
}

export async function openFileAtRevision(
	revisionUri: Uri,
	options?: TextDocumentShowOptions & { annotationType?: FileAnnotationType; line?: number },
): Promise<void>;
export async function openFileAtRevision(
	file: string | GitFile,
	commit: GitCommit,
	options?: TextDocumentShowOptions & { annotationType?: FileAnnotationType; line?: number },
): Promise<void>;
export async function openFileAtRevision(
	fileOrRevisionUri: string | GitFile | Uri,
	commitOrOptions?: GitCommit | TextDocumentShowOptions,
	options?: TextDocumentShowOptions & { annotationType?: FileAnnotationType; line?: number },
): Promise<void> {
	let uri: Uri;
	if (fileOrRevisionUri instanceof Uri) {
		if (isCommit(commitOrOptions)) throw new Error('Invalid arguments');

		uri = fileOrRevisionUri;
		options = commitOrOptions;
	} else {
		if (!isCommit(commitOrOptions)) throw new Error('Invalid arguments');

		const commit = commitOrOptions;

		let file;
		if (typeof fileOrRevisionUri === 'string') {
			const f = await commit.findFile(fileOrRevisionUri);
			if (f == null) throw new Error('Invalid arguments');

			file = f;
		} else {
			file = fileOrRevisionUri;
		}

		uri = Container.instance.git.getRevisionUri(
			file.status === 'D' ? (await commit.getPreviousSha()) ?? deletedOrMissing : commit.sha,
			file,
			commit.repoPath,
		);
	}

	const { annotationType, line, ...opts }: Exclude<typeof options, undefined> = {
		preserveFocus: true,
		preview: false,
		...options,
	};

	if (line != null && line !== 0) {
		opts.selection = new Range(line, 0, line, 0);
	}

	const gitUri = await GitUri.fromUri(uri);

	let editor: TextEditor | undefined;
	try {
		editor = await findOrOpenEditor(uri, { throwOnError: true, ...opts }).catch(error => {
			if (error?.message?.includes('Unable to resolve nonexistent file')) {
				return showRevisionPicker(gitUri, {
					title: 'File not found in revision - pick another file to open instead',
				}).then(pickedUri => {
					return pickedUri ? findOrOpenEditor(pickedUri, opts) : undefined;
				});
			}
			throw error;
		});

		if (annotationType != null && editor != null) {
			void (await Container.instance.fileAnnotations.show(editor, annotationType, {
				selection: { line: line },
			}));
		}
	} catch (error) {
		await window.showErrorMessage(
			`Unable to open '${gitUri.relativePath}' - file doesn't exist in selected revision`,
		);
	}
}

export async function openFileOnRemote(uri: Uri): Promise<void>;
export async function openFileOnRemote(file: string | GitFile, ref: GitRevisionReference): Promise<void>;
export async function openFileOnRemote(fileOrUri: string | GitFile | Uri, ref?: GitRevisionReference): Promise<void> {
	let uri;
	if (fileOrUri instanceof Uri) {
		uri = fileOrUri;
	} else {
		if (ref == null) throw new Error('Invalid arguments');

		uri = GitUri.fromFile(fileOrUri, ref.repoPath, ref.ref);
		// If the file is `?` (untracked), then this must be an untracked file in a stash, so just return
		if (typeof fileOrUri !== 'string' && fileOrUri.status === '?') return;
	}

	void (await executeCommand<[Uri, OpenFileOnRemoteCommandArgs]>(Commands.OpenFileOnRemote, uri, {
		sha: ref?.ref,
	}));
}

export async function openFiles(commit: GitCommit): Promise<void>;
export async function openFiles(files: GitFile[], repoPath: string, ref: string): Promise<void>;
export async function openFiles(commitOrFiles: GitCommit | GitFile[], repoPath?: string, ref?: string): Promise<void> {
	let files;
	if (isCommit(commitOrFiles)) {
		if (commitOrFiles.files == null) {
			await commitOrFiles.ensureFullDetails();
		}

		files = commitOrFiles.files ?? [];
		repoPath = commitOrFiles.repoPath;
		ref = commitOrFiles.sha;
	} else {
		files = commitOrFiles;
	}

	if (files.length > 10) {
		const result = await window.showWarningMessage(
			`Are you sure you want to open all ${files.length} files?`,
			{ title: 'Yes' },
			{ title: 'No', isCloseAffordance: true },
		);
		if (result == null || result.title === 'No') return;
	}

	const uris: Uri[] = (
		await Promise.all(
			files.map(file => Container.instance.git.getWorkingUri(repoPath!, GitUri.fromFile(file, repoPath!, ref))),
		)
	).filter(<T>(u?: T): u is T => Boolean(u));
	findOrOpenEditors(uris);
}

export async function openFilesAtRevision(commit: GitCommit): Promise<void>;
export async function openFilesAtRevision(
	files: GitFile[],
	repoPath: string,
	ref1: string,
	ref2: string,
): Promise<void>;
export async function openFilesAtRevision(
	commitOrFiles: GitCommit | GitFile[],
	repoPath?: string,
	ref1?: string,
	ref2?: string,
): Promise<void> {
	let files;
	if (isCommit(commitOrFiles)) {
		if (commitOrFiles.files == null) {
			await commitOrFiles.ensureFullDetails();
		}

		files = commitOrFiles.files ?? [];
		repoPath = commitOrFiles.repoPath;
		ref1 = commitOrFiles.sha;
		ref2 = await commitOrFiles.getPreviousSha();
	} else {
		files = commitOrFiles;
	}

	if (files.length > 10) {
		const result = await window.showWarningMessage(
			`Are you sure you want to open all ${files.length} file revisions?`,
			{ title: 'Yes' },
			{ title: 'No', isCloseAffordance: true },
		);
		if (result == null || result.title === 'No') return;
	}

	findOrOpenEditors(
		files.map(file => Container.instance.git.getRevisionUri(file.status === 'D' ? ref2! : ref1!, file, repoPath!)),
	);
}

export async function restoreFile(file: string | GitFile, revision: GitRevisionReference) {
	let path;
	let ref;
	if (typeof file === 'string') {
		path = file;
		ref = revision.ref;
	} else {
		path = file.path;
		if (file.status === 'D') {
			// If the file is deleted, check to see if it exists, if so, restore it from the previous commit, otherwise restore it from the current commit
			const uri = GitUri.fromFile(file, revision.repoPath);
			try {
				await workspace.fs.stat(uri);
				ref = `${revision.ref}^`;
			} catch {
				ref = revision.ref;
			}
		} else if (file.status === '?') {
			ref = `${revision.ref}^3`;
		} else {
			ref = revision.ref;
		}
	}

	await Container.instance.git.checkout(revision.repoPath, ref, { path: path });
}

export async function reveal(
	commit: GitRevisionReference,
	options?: {
		select?: boolean;
		focus?: boolean;
		expand?: boolean | number;
	},
) {
	const views = [Container.instance.commitsView, Container.instance.branchesView, Container.instance.remotesView];

	// TODO@eamodio stop duplicate notifications

	for (const view of views) {
		const node = view.canReveal
			? await view.revealCommit(commit, options)
			: await Container.instance.repositoriesView.revealCommit(commit, options);
		if (node != null) return node;
	}

	void views[0].show({ preserveFocus: !options?.focus });
	return undefined;
}

export async function showDetailsQuickPick(commit: GitCommit, uri?: Uri): Promise<void>;
export async function showDetailsQuickPick(commit: GitCommit, file?: string | GitFile): Promise<void>;
export async function showDetailsQuickPick(commit: GitCommit, fileOrUri?: string | GitFile | Uri): Promise<void> {
	if (fileOrUri == null) {
		void (await executeCommand<ShowQuickCommitCommandArgs>(Commands.ShowQuickCommit, { commit: commit }));
		return;
	}

	let uri;
	if (fileOrUri instanceof Uri) {
		uri = fileOrUri;
	} else {
		uri = GitUri.fromFile(fileOrUri, commit.repoPath, commit.ref);
	}

	void (await executeCommand<[Uri, ShowQuickCommitFileCommandArgs]>(Commands.ShowQuickCommitFile, uri, {
		sha: commit.sha,
	}));
}

export function showDetailsView(
	commit: GitRevisionReference | GitCommit,
	options?: { pin?: boolean; preserveFocus?: boolean; preserveVisibility?: boolean },
): Promise<void> {
	const { preserveFocus, ...opts } = { ...options, commit: commit };
	return Container.instance.commitDetailsView.show({ preserveFocus: preserveFocus }, opts);
}

export function showGraphDetailsView(
	commit: GitRevisionReference | GitCommit,
	options?: { pin?: boolean; preserveFocus?: boolean; preserveVisibility?: boolean },
): Promise<void> {
	const { preserveFocus, ...opts } = { ...options, commit: commit };
	return Container.instance.graphDetailsView.show({ preserveFocus: preserveFocus }, opts);
}

export async function showInCommitGraph(
	commit: GitRevisionReference | GitCommit,
	options?: { preserveFocus?: boolean },
): Promise<void> {
	void (await executeCommand<ShowInCommitGraphCommandArgs>(Commands.ShowInCommitGraph, {
		ref: getReferenceFromRevision(commit),
		preserveFocus: options?.preserveFocus,
	}));
}

export async function openOnlyChangedFiles(commit: GitCommit): Promise<void> {
	await commit.ensureFullDetails();

	const files = commit.files ?? [];

	if (files.length > 10) {
		const result = await window.showWarningMessage(
			`Are you sure you want to open all ${files.length} files?`,
			{ title: 'Yes' },
			{ title: 'No', isCloseAffordance: true },
		);
		if (result == null || result.title === 'No') return;
	}

	void (await executeCommand<OpenOnlyChangedFilesCommandArgs>(Commands.OpenOnlyChangedFiles, {
		uris: files.filter(f => f.status !== 'D').map(f => f.uri),
	}));
}
