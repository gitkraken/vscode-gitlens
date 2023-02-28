import { GlyphChars } from '../../constants';
import { basename } from '../../system/path';
import type { TokenOptions } from '../../system/string';
import type { GitFile, GitFileWithCommit } from '../models/file';
import {
	getGitFileFormattedDirectory,
	getGitFileFormattedPath,
	getGitFileOriginalRelativePath,
	getGitFileRelativePath,
	getGitFileStatusText,
	GitFileChange,
} from '../models/file';
import type { FormatOptions } from './formatter';
import { Formatter } from './formatter';

export interface StatusFormatOptions extends FormatOptions {
	relativePath?: string;

	tokenOptions?: {
		directory?: TokenOptions;
		file?: TokenOptions;
		filePath?: TokenOptions;
		originalPath?: TokenOptions;
		path?: TokenOptions;
		status?: TokenOptions;
		working?: TokenOptions;
		changes?: TokenOptions;
		changesDetail?: TokenOptions;
		changesShort?: TokenOptions;
	};
}

export class StatusFileFormatter extends Formatter<GitFile, StatusFormatOptions> {
	get directory() {
		const directory = getGitFileFormattedDirectory(this._item, false, this._options.relativePath);
		return this._padOrTruncate(directory, this._options.tokenOptions.directory);
	}

	get file() {
		const file = basename(this._item.path);
		return this._padOrTruncate(file, this._options.tokenOptions.file);
	}

	get filePath() {
		const filePath = getGitFileFormattedPath(this._item, {
			relativeTo: this._options.relativePath,
			truncateTo: this._options.tokenOptions.filePath?.truncateTo,
		});
		return this._padOrTruncate(filePath, this._options.tokenOptions.filePath);
	}

	get originalPath() {
		// if (
		//     // this._item.status !== 'R' ||
		//     this._item.originalFileName == null ||
		//     this._item.originalFileName.length === 0
		// ) {
		//     return '';
		// }

		const originalPath = getGitFileOriginalRelativePath(this._item, this._options.relativePath);
		return this._padOrTruncate(originalPath, this._options.tokenOptions.originalPath);
	}

	get path() {
		const directory = getGitFileRelativePath(this._item, this._options.relativePath);
		return this._padOrTruncate(directory, this._options.tokenOptions.path);
	}

	get status() {
		const status = getGitFileStatusText(this._item.status);
		return this._padOrTruncate(status, this._options.tokenOptions.status);
	}

	get working() {
		let icon = '';
		if (this._item.workingTreeStatus != null && this._item.indexStatus != null) {
			icon = `${GlyphChars.Pencil}${GlyphChars.Space}${GlyphChars.SpaceThinnest}${GlyphChars.Check}`;
		} else if (this._item.workingTreeStatus != null) {
			icon = `${GlyphChars.Pencil}${GlyphChars.SpaceThin}${GlyphChars.SpaceThinnest}${GlyphChars.EnDash}${GlyphChars.Space}`;
		} else if (this._item.indexStatus != null) {
			icon = `${GlyphChars.Space}${GlyphChars.EnDash}${GlyphChars.Space.repeat(2)}${GlyphChars.Check}`;
		} else {
			icon = '';
		}
		return this._padOrTruncate(icon, this._options.tokenOptions.working);
	}

	get changes(): string {
		return this._padOrTruncate(
			GitFileChange.is(this._item) ? this._item.formatStats() : '',
			this._options.tokenOptions.changes,
		);
	}

	get changesDetail(): string {
		return this._padOrTruncate(
			GitFileChange.is(this._item) ? this._item.formatStats({ expand: true, separator: ', ' }) : '',
			this._options.tokenOptions.changesDetail,
		);
	}

	get changesShort(): string {
		return this._padOrTruncate(
			GitFileChange.is(this._item) ? this._item.formatStats({ compact: true, separator: '' }) : '',
			this._options.tokenOptions.changesShort,
		);
	}

	static fromTemplate(template: string, file: GitFile | GitFileWithCommit, dateFormat: string | null): string;
	static fromTemplate(template: string, file: GitFile | GitFileWithCommit, options?: StatusFormatOptions): string;
	static fromTemplate(
		template: string,
		file: GitFile,
		dateFormatOrOptions?: string | null | StatusFormatOptions,
	): string;
	static fromTemplate(
		template: string,
		file: GitFile,
		dateFormatOrOptions?: string | null | StatusFormatOptions,
	): string {
		return super.fromTemplateCore(this, template, file, dateFormatOrOptions);
	}
}
