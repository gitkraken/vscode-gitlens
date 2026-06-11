import type { GraphAvatars } from '../../../plus/graph/protocol.js';

export type AvatarCorsFailureCallback = (failed: Record<string, string>) => void;

export class AvatarCorsProbe {
	private _probedUrls = new Set<string>();
	private _pending = new Map<string, string>();
	private _timer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		private _onFailure: AvatarCorsFailureCallback,
		private _debounceMs = 250,
	) {}

	probe(avatars: GraphAvatars): void {
		for (const [email, url] of Object.entries(avatars)) {
			if (this.shouldSkip(url)) continue;

			this._probedUrls.add(url);
			this.probeUrl(email, url);
		}
	}

	reset(): void {
		this._probedUrls.clear();
		this._pending.clear();
		if (this._timer != null) {
			clearTimeout(this._timer);
			this._timer = undefined;
		}
	}

	private shouldSkip(url: string): boolean {
		if (this._probedUrls.has(url)) return true;
		if (url.startsWith('data:')) return true;
		if (url.includes('gravatar.com/')) return true;
		if (url.includes('githubusercontent.com/')) return true;
		if (!url.startsWith('http')) return true;
		return false;
	}

	private probeUrl(email: string, url: string): void {
		const img = new Image();
		img.crossOrigin = 'anonymous';
		img.onload = () => {
			img.onload = null;
			img.onerror = null;
		};
		img.onerror = () => {
			img.onload = null;
			img.onerror = null;
			this._pending.set(email, url);
			this.scheduleFlush();
		};
		img.src = url;
	}

	private scheduleFlush(): void {
		if (this._timer != null) return;

		this._timer = setTimeout(() => {
			this._timer = undefined;
			if (this._pending.size === 0) return;

			const failed = Object.fromEntries(this._pending);
			this._pending.clear();
			this._onFailure(failed);
		}, this._debounceMs);
	}
}
