'use strict';
import { IBlameConfig } from './configuration';
import { GitCommit, IGitCommitLine } from './gitService';
import * as moment from 'moment';

export const defaultAbsoluteDateLength = 10;
export const defaultRelativeDateLength = 13;
export const defaultAuthorLength = 16;
export const defaultMessageLength = 32;

const defaultCssEllipse = '\u2026';
const defaultCssIndent = '\u2759';
const defaultCssPadding = '\u00a0';
const defaultCssSeparator = '\u2022';

export let cssEllipse = defaultCssEllipse;
export let cssIndent = defaultCssIndent;
export let cssPadding = defaultCssPadding;
export let cssSeparator = defaultCssSeparator;

export function configureCssCharacters(config: IBlameConfig) {
    cssEllipse = config.annotation.characters.ellipse || defaultCssEllipse;
    cssIndent = config.annotation.characters.indent || defaultCssIndent;
    cssPadding = config.annotation.characters.padding || defaultCssSeparator;
    cssSeparator = config.annotation.characters.separator || defaultCssSeparator;
}

export enum BlameAnnotationFormat {
    Constrained,
    Unconstrained
}

export class BlameAnnotationFormatter {

    static getAnnotation(config: IBlameConfig, commit: GitCommit, format: BlameAnnotationFormat) {
        const sha = commit.shortSha;
        let message = this.getMessage(config, commit, format === BlameAnnotationFormat.Unconstrained ? 0 : defaultMessageLength);

        if (format === BlameAnnotationFormat.Unconstrained) {
            const authorAndDate = this.getAuthorAndDate(config, commit, config.annotation.dateFormat || 'MMMM Do, YYYY h:MMa');
            if (config.annotation.sha) {
                message = `${sha}${(authorAndDate ? `${cssPadding}${cssSeparator}${cssPadding}${authorAndDate}` : '')}${(message ? `${cssPadding}${cssSeparator}${cssPadding}${message}` : '')}`;
            }
            else if (config.annotation.author || config.annotation.date) {
                message = `${authorAndDate}${(message ? `${cssPadding}${cssSeparator}${cssPadding}${message}` : '')}`;
            }

            return message;
        }

        const author = this.getAuthor(config, commit, defaultAuthorLength);
        const date = this.getDate(config, commit, config.annotation.dateFormat || 'MM/DD/YYYY', true);
        if (config.annotation.sha) {
            message = `${sha}${(author ? `${cssPadding}${cssSeparator}${cssPadding}${author}` : '')}${(date ? `${cssPadding}${cssSeparator}${cssPadding}${date}` : '')}${(message ? `${cssPadding}${cssSeparator}${cssPadding}${message}` : '')}`;
        }
        else if (config.annotation.author) {
            message = `${author}${(date ? `${cssPadding}${cssSeparator}${cssPadding}${date}` : '')}${(message ? `${cssPadding}${cssSeparator}${cssPadding}${message}` : '')}`;
        }
        else if (config.annotation.date) {
            message = `${date}${(message ? `${cssPadding}${cssSeparator}${cssPadding}${message}` : '')}`;
        }

        return message;
    }

    static getAnnotationHover(config: IBlameConfig, line: IGitCommitLine, commit: GitCommit): string | Array<string> {
        const message = `> \`${commit.message.replace(/\n/g, '\`\n>\n> \`')}\``;
        if (commit.isUncommitted) {
            return `\`${'0'.repeat(8)}\` &nbsp; __Uncommitted changes__`;
        }

        return `\`${commit.shortSha}\` &nbsp; __${commit.author}__, ${moment(commit.date).fromNow()} _(${moment(commit.date).format(config.annotation.dateFormat || 'MMMM Do, YYYY h:MMa')})_ \n\n${message}`;
    }

    static getAuthorAndDate(config: IBlameConfig, commit: GitCommit, format: string, force: boolean = false) {
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
        return author + cssPadding.repeat(truncateTo - author.length);
    }

    static getDate(config: IBlameConfig, commit: GitCommit, format: string, truncate: boolean = false, force: boolean = false) {
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
        return date + cssPadding.repeat(truncateTo - date.length);
    }

    static getMessage(config: IBlameConfig, commit: GitCommit, truncateTo: number = 0, force: boolean = false) {
        if (!force && !config.annotation.message) return '';

        let message = commit.isUncommitted ? 'Uncommitted change' : commit.message;
        if (truncateTo && message.length > truncateTo) {
            return `${message.substring(0, truncateTo - cssEllipse.length)}${cssEllipse}`;
        }

        return message;
    }
}