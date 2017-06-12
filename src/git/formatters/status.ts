'use strict';
import { Strings } from '../../system';
import { Formatter, IFormatOptions } from './formatter';
import { GitStatusFile } from '../models/status';
import * as path from 'path';

export interface IStatusFormatOptions extends IFormatOptions {
    tokenOptions?: {
        file?: Strings.ITokenOptions;
        directory?: Strings.ITokenOptions;
        // authorAgo?: Strings.ITokenOptions;
        // date?: Strings.ITokenOptions;
        // message?: Strings.ITokenOptions;
    };
}

export class StatusFileFormatter extends Formatter<GitStatusFile, IStatusFormatOptions> {

    get file() {
        const file = path.basename(this._item.fileName);
        return this._padOrTruncate(file, this._options.tokenOptions!.file);
    }

    get directory() {
        const directory = this._item.getFormattedDirectory(false);
        return this._padOrTruncate(directory, this._options.tokenOptions!.file);
    }

    static fromTemplate(template: string, status: GitStatusFile, dateFormat: string | null): string;
    static fromTemplate(template: string, status: GitStatusFile, options?: IStatusFormatOptions): string;
    static fromTemplate(template: string, status: GitStatusFile, dateFormatOrOptions?: string | null | IStatusFormatOptions): string;
    static fromTemplate(template: string, status: GitStatusFile, dateFormatOrOptions?: string | null | IStatusFormatOptions): string {
        return super.fromTemplateCore(this, template, status, dateFormatOrOptions);
    }
}