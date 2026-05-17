/**
 * GitLens-side wrapper around supertalk's AbortSignalHandler that preserves
 * the abort `reason` across the wire.
 *
 * The upstream handler stores `signal.reason` directly in the wire payload.
 * When that reason is a DOMException (the default for `controller.abort()`),
 * JSON serialization strips its prototype (name/message/stack are non-enumerable)
 * and the receiver reconstructs an AbortSignal whose `reason` is `{}` — so
 * `signal.throwIfAborted()` throws an empty object literal that defeats every
 * downstream `instanceof Error` check and the RPC error logger flatten path.
 *
 * This subclass intercepts the `reason` field on every path:
 * - `toWire` (already-aborted at send time): wraps reason in an envelope.
 * - `fromWire`: unwraps the envelope back into a real DOMException/Error.
 * - `connect` (override `ctx.sendMessage`): wraps reason in the runtime
 *   `{ type: 'abort', id, reason }` message that the parent's listener emits
 *   when the signal aborts after being sent.
 * - `onMessage`: unwraps the envelope before delegating to the parent.
 *
 * Track for removal once the upstream supertalk fix ships.
 */
import type { HandlerConnectionContext, ToWireContext } from '@eamodio/supertalk';
import { AbortSignalHandler } from '@eamodio/supertalk-core/handlers/abort-signal.js';

/** Brand value distinguishing this envelope from supertalk's built-in markers. */
const stErrorBrand = 'st-error' as const;

interface WireStError {
	__st__: typeof stErrorBrand;
	name: string;
	message: string;
	stack?: string;
}

function isWireStError(v: unknown): v is WireStError {
	return v != null && typeof v === 'object' && (v as { __st__?: unknown }).__st__ === stErrorBrand;
}

function serializeReason(reason: unknown): unknown {
	if (reason == null || typeof reason !== 'object') return reason;
	if (
		reason instanceof Error ||
		(typeof (reason as { name?: unknown }).name === 'string' &&
			typeof (reason as { message?: unknown }).message === 'string')
	) {
		const e = reason as { name: string; message: string; stack?: string };
		const wire: WireStError = { __st__: stErrorBrand, name: e.name, message: e.message };
		if (typeof e.stack === 'string') {
			wire.stack = e.stack;
		}
		return wire;
	}
	return reason;
}

function deserializeReason(reason: unknown): unknown {
	if (!isWireStError(reason)) return reason;
	if (reason.name === 'AbortError' && typeof DOMException !== 'undefined') {
		return new DOMException(reason.message, 'AbortError');
	}

	const err = new Error(reason.message);
	err.name = reason.name;
	if (reason.stack !== undefined) {
		err.stack = reason.stack;
	}
	return err;
}

interface AbortMessageLike {
	type: string;
	id: number;
	reason?: unknown;
}

function isAbortMessage(payload: unknown): payload is AbortMessageLike {
	return payload != null && typeof payload === 'object' && (payload as { type?: unknown }).type === 'abort';
}

interface WireAbortSignalLike {
	__st__: 'abort-signal';
	id: number;
	aborted: boolean;
	reason?: unknown;
}

export class GlAbortSignalHandler extends AbortSignalHandler {
	override toWire(signal: AbortSignal, ctx: ToWireContext): WireAbortSignalLike {
		const wire: WireAbortSignalLike = super.toWire(signal, ctx);
		if (wire.aborted && wire.reason !== undefined) {
			wire.reason = serializeReason(wire.reason);
		}
		return wire;
	}

	override fromWire(wire: WireAbortSignalLike): AbortSignal {
		if (wire.aborted && isWireStError(wire.reason)) {
			wire = { ...wire, reason: deserializeReason(wire.reason) };
		}
		return super.fromWire(wire);
	}

	override connect(ctx: HandlerConnectionContext): void {
		super.connect({
			sendMessage: (payload: unknown) => {
				if (isAbortMessage(payload) && payload.reason !== undefined) {
					payload.reason = serializeReason(payload.reason);
				}
				ctx.sendMessage(payload);
			},
		});
	}

	override onMessage(payload: unknown): void {
		if (isAbortMessage(payload) && isWireStError(payload.reason)) {
			payload.reason = deserializeReason(payload.reason);
		}
		super.onMessage(payload);
	}
}
