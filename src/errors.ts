'use strict';
import { Uri } from 'vscode';

export const enum AuthenticationErrorReason {
	UserDidNotConsent = 1,
	Unauthorized = 2,
	Forbidden = 3,
}

export class AuthenticationError extends Error {
	readonly id: string;
	readonly original?: Error;
	readonly reason: AuthenticationErrorReason | undefined;

	constructor(id: string, reason?: AuthenticationErrorReason, original?: Error);
	constructor(id: string, message?: string, original?: Error);
	constructor(id: string, messageOrReason: string | AuthenticationErrorReason | undefined, original?: Error) {
		let message;
		let reason: AuthenticationErrorReason | undefined;
		if (messageOrReason == null) {
			message = `Unable to get required authentication session for '${id}`;
		} else if (typeof messageOrReason === 'string') {
			message = messageOrReason;
			reason = undefined;
		} else {
			reason = messageOrReason;
			switch (reason) {
				case AuthenticationErrorReason.UserDidNotConsent:
					message = `'${id} authentication is required for this operation`;
					break;
				case AuthenticationErrorReason.Unauthorized:
					message = `The provided '${id}' credentials are either invalid or expired`;
					break;
				case AuthenticationErrorReason.Forbidden:
					message = `The provided '${id}' credentials do not have the required access`;
					break;
			}
		}
		super(message);

		this.id = id;
		this.original = original;
		this.reason = reason;
		Error.captureStackTrace?.(this, AuthenticationError);
	}
}

export class ProviderNotFoundError extends Error {
	constructor(pathOrUri: string | Uri | undefined) {
		super(
			`No provider registered for '${
				pathOrUri == null
					? String(pathOrUri)
					: typeof pathOrUri === 'string'
					? pathOrUri
					: pathOrUri.toString(true)
			}'`,
		);

		Error.captureStackTrace?.(this, ProviderNotFoundError);
	}
}

export class ProviderRequestClientError extends Error {
	constructor(public readonly original: Error) {
		super(original.message);

		Error.captureStackTrace?.(this, ProviderRequestClientError);
	}
}

export class ProviderRequestNotFoundError extends Error {
	constructor(public readonly original: Error) {
		super(original.message);

		Error.captureStackTrace?.(this, ProviderRequestNotFoundError);
	}
}
