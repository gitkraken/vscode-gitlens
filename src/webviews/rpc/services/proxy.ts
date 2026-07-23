/**
 * Service proxying and disposal for the webview RPC layer.
 *
 * Kept free of service-class imports so it can be unit-tested — the service
 * classes transitively reach `system/-webview/command.ts` (and through it the
 * whole extension), which cannot initialize in the test bundle.
 */

import { proxy } from '@eamodio/supertalk';
import type { Disposable } from 'vscode';

const servicesDisposables = Symbol('rpcServicesDisposables');

/**
 * Wraps object-valued properties with Supertalk's `proxy()` marker (functions/primitives pass through).
 * Services implementing `dispose()` are collected behind a non-enumerable symbol so the controller can
 * release them at teardown via {@link disposeServices} — the path for resources that must outlive
 * `SubscriptionTracker.reset()` (e.g. `SubscriptionService`'s eager listeners). Only top-level properties
 * are scanned; hoist nested disposables to the top level.
 */
export function proxyServices<T extends Record<string, unknown>>(services: T): T {
	const result: Record<string, unknown> = {};
	const disposables: Disposable[] = [];
	for (const [key, value] of Object.entries(services)) {
		if (value != null && typeof value === 'object') {
			if (typeof (value as Partial<Disposable>).dispose === 'function') {
				// NOTE: `proxy()` exposes every string-named method over RPC (Supertalk has no host-side
				// allowlist), so a collected service's `dispose()` is client-reachable — a stray call would
				// refreeze the signals (#5513). Only trusted webview code calls today; move to a symbol-keyed
				// disposal method if that ever changes.
				disposables.push(value as Disposable);
			}
			result[key] = proxy(value);
		} else {
			result[key] = value;
		}
	}
	Object.defineProperty(result, servicesDisposables, { value: disposables, enumerable: false });
	return result as T;
}

/**
 * Disposes the disposable services collected by {@link proxyServices}.
 * Safe to call with any object — a no-op when none were collected — and idempotent.
 */
export function disposeServices(services: object | undefined): void {
	if (services == null) return;

	const disposables = (services as { [servicesDisposables]?: Disposable[] })[servicesDisposables];
	if (disposables == null) return;

	for (const disposable of disposables.splice(0)) {
		disposable.dispose();
	}
}
