import type { Command } from 'vscode';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import type { DiffWithPreviousCommandArgs } from '../../commands/diffWithPrevious.js';
import { StatusFileFormatter } from '../../git/formatters/statusFormatter.js';
import { GitUri } from '../../git/gitUri.js';
import type { GitFile } from '../../git/models/file.js';
import type { GitRevisionReference } from '../../git/models/reference.js';
import { uncommitted } from '../../git/models/revision.js';
import { getGitFileStatusIcon } from '../../git/utils/fileStatus.utils.js';
import { createReference } from '../../git/utils/reference.utils.js';
import { createCommand } from '../../system/-webview/command.js';
import { editorLineToDiffRange } from '../../system/-webview/vscode/editors.js';
import { memoize } from '../../system/decorators/memoize.js';
import { dirname, joinPaths } from '../../system/path.js';
import type { ViewsWithCommits } from '../viewBase.js';
import { getFileTooltipMarkdown } from './abstract/viewFileNode.js';
import type { ViewNode } from './abstract/viewNode.js';
import { ContextValues } from './abstract/viewNode.js';
import { ViewRefFileNode } from './abstract/viewRefNode.js';
import type { FileNode } from './folderNode.js';

export class UncommittedFileNode extends ViewRefFileNode<'uncommitted-file', ViewsWithCommits> implements FileNode {
	constructor(view: ViewsWithCommits, parent: ViewNode, repoPath: string, file: GitFile) {
		super('uncommitted-file', GitUri.fromFile(file, repoPath), view, parent, file);
	}

	override toClipboard(): string {
		return this.path;
	}

	private _description: string | undefined;
	get description(): string {
		this._description ??= StatusFileFormatter.fromTemplate(
			this.view.config.formats.files.description,
			{ ...this.file },
			{ relativePath: this.relativePath },
		);
		return this._description;
	}

	private _folderName: string | undefined;
	get folderName(): string {
		this._folderName ??= dirname(this.uri.relativePath);
		return this._folderName;
	}

	private _label: string | undefined;
	get label(): string {
		this._label ??= StatusFileFormatter.fromTemplate(
			`\${file}`,
			{ ...this.file },
			{ relativePath: this.relativePath },
		);
		return this._label;
	}

	get path(): string {
		return this.file.path;
	}

	get priority(): number {
		return 0;
	}

	@memoize()
	get ref(): GitRevisionReference {
		return createReference(uncommitted, this.uri.repoPath!, { refType: 'revision' });
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

	getChildren(): ViewNode[] {
		return [];
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem(this.label, TreeItemCollapsibleState.None);
		item.contextValue = `${ContextValues.File}${this.file.submodule != null ? '+submodule' : ''}`;
		item.description = this.description;
		// Use the file icon and decorations
		item.resourceUri = this.view.container.git.getAbsoluteUri(this.file.path, this.repoPath);

		const icon = getGitFileStatusIcon(this.file.status);
		item.iconPath = {
			dark: this.view.container.context.asAbsolutePath(joinPaths('images', 'dark', icon)),
			light: this.view.container.context.asAbsolutePath(joinPaths('images', 'light', icon)),
		};

		item.tooltip = getFileTooltipMarkdown(this.file);
		item.command = this.getCommand();

		// Only cache the label/description for a single refresh
		this._label = undefined;
		this._description = undefined;

		return item;
	}

	override getCommand(): Command | undefined {
		return createCommand<[undefined, DiffWithPreviousCommandArgs]>(
			'gitlens.diffWithPrevious:views',
			'Open Changes with Previous Revision',
			undefined,
			{
				uri: GitUri.fromFile(this.file, this.repoPath),
				range: editorLineToDiffRange(0),
				showOptions: {
					preserveFocus: true,
					preview: true,
				},
			},
		);
	}
}
