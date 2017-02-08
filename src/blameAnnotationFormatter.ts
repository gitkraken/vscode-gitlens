'use strict';
import { IBlameConfig } from './configuration';
import { GitCommit, IGitCommitLine } from './gitProvider';
import * as moment from 'moment';

export const defaultShaLength = 8;
export const defaultAbsoluteDateLength = 10;
export const defaultRelativeDateLength = 13;
export const defaultAuthorLength = 16;
export const defaultMessageLength = 32;

export let cssEllipse = '\\2026';
export let cssIndent = '\\2759';
export let cssSeparator = '\\2022';
export let cssPadding = '\\00a0';

export function configureCssCharacters(config: IBlameConfig) {
    cssEllipse = config.annotation.characters.ellipse || cssEllipse;
    cssIndent = config.annotation.characters.indent || cssIndent;
    cssPadding = config.annotation.characters.padding || cssPadding;
    cssSeparator = config.annotation.characters.separator || cssSeparator;
}

export enum BlameAnnotationFormat {
    Constrained,
    Unconstrained
}

export default class BlameAnnotationFormatter {

    static getAnnotation(config: IBlameConfig, commit: GitCommit, format: BlameAnnotationFormat) {
        const sha = commit.sha.substring(0, defaultShaLength);
        let message = this.getMessage(config, commit, format === BlameAnnotationFormat.Unconstrained ? 0 : defaultMessageLength);

        if (format === BlameAnnotationFormat.Unconstrained) {
            const authorAndDate = this.getAuthorAndDate(config, commit, 'MMMM Do, YYYY h:MMa');
            if (config.annotation.sha) {
                message = `${sha}${(authorAndDate ? ` ${cssSeparator} ${authorAndDate}` : '')}${(message ? ` ${cssSeparator} ${message}` : '')}`;
            }
            else if (config.annotation.author || config.annotation.date) {
                message = `${authorAndDate}${(message ? ` ${cssSeparator} ${message}` : '')}`;
            }

            return message;
        }

        const author = this.getAuthor(config, commit, defaultAuthorLength);
        const date = this.getDate(config, commit, 'MM/DD/YYYY', true);
        if (config.annotation.sha) {
            message = `${sha}${(author ? ` ${cssSeparator} ${author}` : '')}${(date ? ` ${cssSeparator} ${date}` : '')}${(message ? ` ${cssSeparator} ${message}` : '')}`;
        }
        else if (config.annotation.author) {
            message = `${author}${(date ? ` ${cssSeparator} ${date}` : '')}${(message ? ` ${cssSeparator} ${message}` : '')}`;
        }
        else if (config.annotation.date) {
            message = `${date}${(message ? ` ${cssSeparator} ${message}` : '')}`;
        }

        return message;
    }

    static getAnnotationHover(config: IBlameConfig, line: IGitCommitLine, commit: GitCommit): string | Array<string> {
        const message = commit.message.replace(/\n/g, '\n\n');
        if (commit.isUncommitted) {
            return `\`${'0'.repeat(8)}\` &nbsp; __Uncommitted changes__ \n\n > ${message}`;
        }

        return `\`${commit.sha}\` &nbsp; __${commit.author}__, ${moment(commit.date).fromNow()} _(${moment(commit.date).format('MMMM Do, YYYY h:MMa')})_ \n\n > ${message}`;
    }

    static getAuthorAndDate(config: IBlameConfig, commit: GitCommit, format?: string, force: boolean = false) {
        if (!force && !config.annotation.author && (!config.annotation.date || config.annotation.date === 'off')) return '';

        if (!config.annotation.author) {
            return this.getDate(config, commit, format);
        }

        if (!config.annotation.date || config.annotation.date === 'off') {
            return this.getAuthor(config, commit);
        }

        return `${this.getAuthor(config, commit)}, ${this.getDate(config, commit, format)}`;
    }

    static getAuthor(config: IBlameConfig, commit: GitCommit, truncateTo: number = 0, force: boolean = false) {
        if (!force && !config.annotation.author) return '';

        const author = commit.isUncommitted ? 'Uncommitted' : commit.author;
        if (!truncateTo) return author;

        if (author.length > truncateTo) {
            return `${author.substring(0, truncateTo - cssEllipse.length)}${cssEllipse}`;
        }

        if (force) return author; // Don't pad when just asking for the value
        return author + `${cssPadding}`.repeat(truncateTo - author.length);
    }

    static getDate(config: IBlameConfig, commit: GitCommit, format?: string, truncate: boolean = false, force: boolean = false) {
        if (!force && (!config.annotation.date || config.annotation.date === 'off')) return '';

        const date = config.annotation.date === 'relative'
            ? moment(commit.date).fromNow()
            : moment(commit.date).format(format);
        if (!truncate) return date;

        const truncateTo = config.annotation.date === 'relative' ? defaultRelativeDateLength : defaultAbsoluteDateLength;
        if (date.length > truncateTo) {
            return `${date.substring(0, truncateTo - cssEllipse.length)}${cssEllipse}`;
        }

        if (force) return date; // Don't pad when just asking for the value
        return date + `${cssPadding}`.repeat(truncateTo - date.length);
    }

    static getMessage(config: IBlameConfig, commit: GitCommit, truncateTo: number = 0, force: boolean = false) {
        if (!force && !config.annotation.message) return '';

        let message = commit.message;
        if (truncateTo && message.length > truncateTo) {
            return `${message.substring(0, truncateTo - cssEllipse.length)}${cssEllipse}`;
        }

        return message;
    }
}