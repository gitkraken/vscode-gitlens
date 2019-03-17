'use strict';
import * as paths from 'path';
import { GlyphChars } from '../../constants';
import { Strings } from '../../system';
import { GitFile, GitFileWithCommit } from '../models/file';
import { FormatOptions, Formatter } from './formatter';

export interface StatusFormatOptions extends FormatOptions {
    relativePath?: string;

    tokenOptions?: {
        directory?: Strings.TokenOptions;
        file?: Strings.TokenOptions;
        filePath?: Strings.TokenOptions;
        path?: Strings.TokenOptions;
        status?: Strings.TokenOptions;
        working?: Strings.TokenOptions;
    };
}

export class StatusFileFormatter extends Formatter<GitFile, StatusFormatOptions> {
    get directory() {
        const directory = GitFile.getFormattedDirectory(this._item, false, this._options.relativePath);
        return this._padOrTruncate(directory, this._options.tokenOptions.directory);
    }

    get file() {
        const file = paths.basename(this._item.fileName);
        return this._padOrTruncate(file, this._options.tokenOptions.file);
    }

    get filePath() {
        const filePath = GitFile.getFormattedPath(this._item, { relativeTo: this._options.relativePath });
        return this._padOrTruncate(filePath, this._options.tokenOptions.filePath);
    }

    get path() {
        const directory = GitFile.getRelativePath(this._item, this._options.relativePath);
        return this._padOrTruncate(directory, this._options.tokenOptions.path);
    }

    get status() {
        const status = GitFile.getStatusText(this._item.status);
        return this._padOrTruncate(status, this._options.tokenOptions.status);
    }

    get working() {
        const commit = (this._item as GitFileWithCommit).commit;
        const statusFile = commit === undefined ? this._item : commit.files[0];

        let icon;
        if (statusFile.workingTreeStatus !== undefined && statusFile.indexStatus !== undefined) {
            icon = `${GlyphChars.Pencil}${GlyphChars.Space}${GlyphChars.SpaceThinnest}${GlyphChars.Check}`;
        }
        else if (statusFile.workingTreeStatus !== undefined) {
            icon = `${GlyphChars.Pencil}${GlyphChars.SpaceThin}${GlyphChars.SpaceThinnest}${GlyphChars.EnDash}${
                GlyphChars.Space
            }`;
        }
        else if (statusFile.indexStatus !== undefined) {
            icon = `${GlyphChars.Space}${GlyphChars.EnDash}${GlyphChars.Space.repeat(2)}${GlyphChars.Check}`;
        }
        else {
            icon = '';
        }
        return this._padOrTruncate(icon, this._options.tokenOptions.working);
    }

    static fromTemplate(template: string, file: GitFile | GitFileWithCommit, dateFormat: string | null): string;
    static fromTemplate(template: string, file: GitFile | GitFileWithCommit, options?: StatusFormatOptions): string;
    static fromTemplate(
        template: string,
        file: GitFile,
        dateFormatOrOptions?: string | null | StatusFormatOptions
    ): string;
    static fromTemplate(
        template: string,
        file: GitFile,
        dateFormatOrOptions?: string | null | StatusFormatOptions
    ): string {
        return super.fromTemplateCore(this, template, file, dateFormatOrOptions);
    }
}
