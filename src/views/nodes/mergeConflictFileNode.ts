import type { Command, Uri } from 'vscode';
import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { StatusFileFormatter } from '../../git/formatters/statusFormatter.js';
import { GitUri } from '../../git/gitUri.js';
import type { GitFile } from '../../git/models/file.js';
import type { GitPausedOperationStatus } from '../../git/models/pausedOperationStatus.js';
import { getConflictIncomingRef, resolveConflictFilePaths } from '../../git/utils/pausedOperationStatus.utils.js';
import { createCoreCommand } from '../../system/-webview/command.js';
import { relativeDir } from '../../system/-webview/path.js';
import { getSettledValue } from '../../system/promise.js';
import type { ViewsWithCommits } from '../viewBase.js';
import { getFileTooltipMarkdown, ViewFileNode } from './abstract/viewFileNode.js';
import type { ViewNode } from './abstract/viewNode.js';
import { ContextValues } from './abstract/viewNode.js';
import type { FileNode } from './folderNode.js';
import { MergeConflictChangesNode } from './mergeConflictChangesNode.js';

export class MergeConflictFileNode extends ViewFileNode<'conflict-file', ViewsWithCommits> implements FileNode {
	constructor(
		view: ViewsWithCommits,
		parent: ViewNode,
		file: GitFile,
		public readonly status: GitPausedOperationStatus,
	) {
		super('conflict-file', GitUri.fromFile(file, status.repoPath, status.HEAD.ref), view, parent, file);
	}

	override toClipboard(): string {
		return this.fileName;
	}

	get baseUri(): Uri {
		return GitUri.fromFile(this.file, this.status.repoPath, this.status.mergeBase ?? 'HEAD');
	}

	get fileName(): string {
		return this.file.path;
	}

	async getChildren(): Promise<ViewNode[]> {
		const incomingRef = getConflictIncomingRef(this.status);

		let currentPaths: { lhsPath: string; rhsPath: string } | undefined;
		let incomingPaths: { lhsPath: string; rhsPath: string } | undefined;

		if (this.status.mergeBase != null) {
			const svc = this.view.container.git.getRepositoryService(this.status.repoPath);

			const [currentFilesResult, incomingFilesResult] = await Promise.allSettled([
				svc.diff.getDiffStatus(this.status.mergeBase, 'HEAD', { renameLimit: 0 }),
				incomingRef != null
					? svc.diff.getDiffStatus(this.status.mergeBase, incomingRef, { renameLimit: 0 })
					: undefined,
			]);

			const currentFiles = getSettledValue(currentFilesResult);
			const incomingFiles = getSettledValue(incomingFilesResult);

			currentPaths = resolveConflictFilePaths(currentFiles, incomingFiles, this.file.path);
			incomingPaths =
				incomingRef != null ? resolveConflictFilePaths(incomingFiles, currentFiles, this.file.path) : undefined;
		}

		// Create side-specific file objects with the correct path for each side's ref
		const currentFile = this.createResolvedFile(currentPaths);
		const incomingFile = this.createResolvedFile(incomingPaths);

		return [
			new MergeConflictChangesNode(
				this.view,
				this,
				this.status,
				currentFile,
				'current',
				currentPaths?.lhsPath,
				this.file.path,
			),
			new MergeConflictChangesNode(
				this.view,
				this,
				this.status,
				incomingFile,
				'incoming',
				incomingPaths?.lhsPath,
				this.file.path,
			),
		];
	}

	private createResolvedFile(paths: { lhsPath: string; rhsPath: string } | undefined): GitFile {
		if (paths == null || paths.rhsPath === this.file.path) return this.file;

		return { ...this.file, path: paths.rhsPath, originalPath: paths.lhsPath };
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem(this.label, TreeItemCollapsibleState.Collapsed);
		item.description = this.description;
		item.contextValue = `${ContextValues.File}+conflicted`;

		item.tooltip = getFileTooltipMarkdown(this.file, 'in ```Index```');

		// Use the file icon and decorations
		item.resourceUri = this.view.container.git.getAbsoluteUri(this.file.path, this.repoPath);
		item.iconPath = ThemeIcon.File;
		item.command = this.getCommand();

		// Only cache the label/description for a single refresh
		this._label = undefined;
		this._description = undefined;

		return item;
	}

	private _description: string | undefined;
	get description(): string {
		this._description ??= StatusFileFormatter.fromTemplate(this.view.config.formats.files.description, this.file, {
			relativePath: this.relativePath,
		});
		return this._description;
	}

	private _folderName: string | undefined;
	get folderName(): string {
		this._folderName ??= relativeDir(this.uri.relativePath);
		return this._folderName;
	}

	private _label: string | undefined;
	get label(): string {
		this._label ??= StatusFileFormatter.fromTemplate(this.view.config.formats.files.label, this.file, {
			relativePath: this.relativePath,
		});
		return this._label;
	}

	get priority(): number {
		return 0;
	}

	private _relativePath: string | undefined;
	get relativePath(): string | undefined {
		return this._relativePath;
	}
	set relativePath(value: string | undefined) {
		this._relativePath = value;
		this._label = undefined;
		this._description = undefined;
	}

	override getCommand(): Command {
		return createCoreCommand(
			'vscode.open',
			'Open File',
			this.view.container.git.getAbsoluteUri(this.file.path, this.repoPath),
			{
				preserveFocus: true,
				preview: true,
			},
		);
	}
}
