'use strict';
import * as path from 'path';
import { GlyphChars } from '../../constants';
import { Strings } from '../../system';
import { GitFile, GitFileWithCommit } from '../models/file';
import { Formatter, IFormatOptions } from './formatter';

export interface IStatusFormatOptions extends IFormatOptions {
    relativePath?: string;

    tokenOptions?: {
        directory?: Strings.ITokenOptions;
        file?: Strings.ITokenOptions;
        filePath?: Strings.ITokenOptions;
        path?: Strings.ITokenOptions;
        status?: Strings.ITokenOptions;
        working?: Strings.ITokenOptions;
    };
}

export class StatusFileFormatter extends Formatter<GitFile, IStatusFormatOptions> {
    get directory() {
        const directory = GitFile.getFormattedDirectory(this._item, false, this._options.relativePath);
        return this._padOrTruncate(directory, this._options.tokenOptions!.directory);
    }

    get file() {
        const file = path.basename(this._item.fileName);
        return this._padOrTruncate(file, this._options.tokenOptions!.file);
    }

    get filePath() {
        const filePath = GitFile.getFormattedPath(this._item, { relativeTo: this._options.relativePath });
        return this._padOrTruncate(filePath, this._options.tokenOptions!.filePath);
    }

    get path() {
        const directory = GitFile.getRelativePath(this._item, this._options.relativePath);
        return this._padOrTruncate(directory, this._options.tokenOptions!.path);
    }

    get status() {
        const status = GitFile.getStatusText(this._item.status);
        return this._padOrTruncate(status, this._options.tokenOptions!.status);
    }

    get working() {
        const commit = (this._item as GitFileWithCommit).commit;
        const statusFile = commit === undefined ? this._item : commit.files[0];

        let icon = '';
        if (statusFile.workingTreeStatus !== undefined && statusFile.indexStatus !== undefined) {
            icon = `${GlyphChars.Pencil}${GlyphChars.Space}${GlyphChars.Check}`;
        }
        else {
            if (statusFile.workingTreeStatus !== undefined) {
                icon = `${GlyphChars.Pencil}${GlyphChars.Space.repeat(4)}`;
            }
            else if (statusFile.indexStatus !== undefined) {
                icon = `${GlyphChars.Space.repeat(5)}${GlyphChars.Check}`;
            }
        }
        return this._padOrTruncate(icon, this._options.tokenOptions!.working);
    }

    static fromTemplate(template: string, file: GitFile, dateFormat: string | null): string;
    static fromTemplate(template: string, file: GitFile, options?: IStatusFormatOptions): string;
    static fromTemplate(
        template: string,
        file: GitFile,
        dateFormatOrOptions?: string | null | IStatusFormatOptions
    ): string;
    static fromTemplate(
        template: string,
        file: GitFile,
        dateFormatOrOptions?: string | null | IStatusFormatOptions
    ): string {
        return super.fromTemplateCore(this, template, file, dateFormatOrOptions);
    }
}
