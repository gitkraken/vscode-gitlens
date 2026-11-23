/** @internal */

import * as vscodeL10n from '@vscode/l10n';

type Replacement = string | number | boolean;

/** Positional for `{0}` placeholders, named for `{name}`; empty for no placeholders and for an ICU plural template. */
export type GraphMessageArgs = readonly unknown[] | Readonly<Record<string, unknown>>;

export interface GraphMessage {
	/** `message`, or `message/comment` when the call carries a translator comment; matches `@vscode/l10n` bundle keys.
	 *   */
	readonly key: string;
	/** The English source text, placeholders and plural blocks intact. */
	readonly message: string;
	/** Always empty when handed to a {@link GraphLocalizer}, which substitutes the arguments itself. */
	readonly args: GraphMessageArgs;
	readonly comment?: readonly string[];
}

/** Returns the translated template with placeholders and plural blocks intact; asked once per key until the localizer
 *  changes. */
export type GraphLocalizer = (message: GraphMessage) => string;

let localizer: GraphLocalizer | undefined;
let generation = 0;
const translatedTemplates = new Map<string, string>();
const noPositionalArgs: readonly unknown[] = [];
const noNamedArgs: Readonly<Record<string, unknown>> = {};

/** `undefined` restores `@vscode/l10n`. */
export function setMessageLocalizer(fn: GraphLocalizer | undefined): void {
	localizer = fn;
	generation++;
	translatedTemplates.clear();
}

export function localizerGeneration(): number {
	return generation;
}

// KEEP: held apart so the message extractor, which reads every `l10n.t(...)` literal, never sees this pass-through.
const vscodeT: (...args: unknown[]) => string = vscodeL10n.t as (...args: unknown[]) => string;

export function t(message: string, ...args: Replacement[]): string;
export function t(message: string, args: Record<string, Replacement>): string;
export function t(strings: TemplateStringsArray, ...replacements: Replacement[]): string;
export function t(options: {
	message: string;
	args?: readonly Replacement[] | Record<string, unknown>;
	comment: string | string[];
}): string;
export function t(...args: unknown[]): string {
	if (localizer == null) return vscodeT(...args);

	const first = args[0];
	if (typeof first === 'string') {
		const template = translatedTemplates.get(first) ?? translateTemplate(localizer, toGraphMessage(args));
		const named = args[1];
		return named != null && typeof named === 'object'
			? formatMessage(template, named as Readonly<Record<string, unknown>>)
			: formatPositional(template, args, 1);
	}

	const message = toGraphMessage(args);
	const template = translatedTemplates.get(message.key) ?? translateTemplate(localizer, message);
	return formatMessage(template, message.args);
}

function translateTemplate(fn: GraphLocalizer, message: GraphMessage): string {
	const template = fn({ ...message, args: Array.isArray(message.args) ? noPositionalArgs : noNamedArgs });
	translatedTemplates.set(message.key, template);
	return template;
}

const placeholder = /\{([^}]+)\}/g;

export function formatMessage(template: string, args: GraphMessageArgs): string {
	const values = args as Readonly<Record<string, unknown>>;
	if (Object.keys(values).length === 0) return template;

	return template.replace(placeholder, (match, name: string) => replacementFor(values[name], match));
}

function formatPositional(template: string, args: readonly unknown[], offset: number): string {
	if (args.length <= offset || !template.includes('{')) return template;

	return template.replace(placeholder, (match, name: string) => {
		const index = Number(name);
		return Number.isInteger(index) && index >= 0 && String(index) === name
			? replacementFor(args[index + offset], match)
			: match;
	});
}

function replacementFor(value: unknown, match: string): string {
	return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : match;
}

function toGraphMessage(args: readonly unknown[]): GraphMessage {
	const [first, ...rest] = args;
	if (typeof first === 'string') {
		const named = rest[0];
		return {
			key: first,
			message: first,
			args: named != null && typeof named === 'object' ? (named as Readonly<Record<string, unknown>>) : rest,
		};
	}

	if (Array.isArray(first)) {
		let message = String(first[0]);
		for (let i = 1; i < first.length; i++) {
			message += `{${i - 1}}${String(first[i])}`;
		}
		return { key: message, message: message, args: rest };
	}

	const options = first as { message: string; args?: GraphMessageArgs; comment?: string | string[] };
	const comment =
		options.comment == null || options.comment.length === 0
			? undefined
			: Array.isArray(options.comment)
				? options.comment
				: [options.comment];
	return {
		key: comment != null ? `${options.message}/${comment.join('')}` : options.message,
		message: options.message,
		args: options.args ?? {},
		comment: comment,
	};
}
