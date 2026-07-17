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
 * Wraps all object-valued properties with Supertalk's `proxy()` marker.
 *
 * Call this on the final services object returned from `getRpcServices()`.
 * Sub-service objects and class instances become remote proxies;
 * functions and primitives pass through unchanged.
 *
 * Services that implement `dispose()` are collected behind a non-enumerable symbol
 * (invisible to the RPC layer) so the webview controller can release them at teardown
 * via {@link disposeServices}. This is the disposal path for service resources that
 * must outlive `SubscriptionTracker.reset()` (RPC reconnection), e.g. the eager
 * signal-freshness listeners in `SubscriptionService`.
 *
 * Only TOP-LEVEL properties are scanned — a disposable service nested inside a
 * sub-object won't be collected; hoist it to the top level instead.
 */
export function proxyServices<T extends Record<string, unknown>>(services: T): T {
	const result: Record<string, unknown> = {};
	const disposables: Disposable[] = [];
	for (const [key, value] of Object.entries(services)) {
		if (value != null && typeof value === 'object') {
			if (typeof (value as Partial<Disposable>).dispose === 'function') {
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
