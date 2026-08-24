import type { ReactiveController, ReactiveControllerHost } from 'lit';
import type { GlDragShiftOverlay } from '../../shared/components/overlays/drag-shift-overlay.js';

/**
 * Tracks a native drag crossing the webview's boundaries to show/hide the app-level "Hold Shift"
 * overlay.
 *
 * During a native drag, the drag leaving the webview iframe stops all events (VS Code blocks them
 * until Shift-re-entry/release). Two signals show the hint: the exit `dragleave` at the viewport
 * edge, and a watchdog for `dragover` going silent (in case VS Code suppresses even the exit
 * dragleave).
 */
export class DragShiftHintController implements ReactiveController {
	private _dragActive = false;
	private _dragHintActive = false;
	private _dragWatchdog?: ReturnType<typeof setTimeout>;

	private readonly _host: ReactiveControllerHost & HTMLElement;

	constructor(controllerHost: ReactiveControllerHost & HTMLElement) {
		this._host = controllerHost;
		controllerHost.addController(this);
	}

	hostConnected(): void {
		document.addEventListener('dragstart', this._onDocDragStart);
		document.addEventListener('dragend', this._onDocDragEnd);
		document.addEventListener('drop', this._onDocDragEnd);
	}

	hostDisconnected(): void {
		document.removeEventListener('dragstart', this._onDocDragStart);
		document.removeEventListener('dragend', this._onDocDragEnd);
		document.removeEventListener('drop', this._onDocDragEnd);
		this._disarmBoundaryTracking();
	}

	/** Toggle the app-level "Hold Shift" overlay (imperative — the overlay uses a reflected `active`
	 *  attribute; querySelector into this light-DOM host). */
	private _setDragHint(active: boolean): void {
		if (this._dragHintActive === active) return;

		this._dragHintActive = active;
		const overlay = this._host.querySelector<GlDragShiftOverlay>('gl-drag-shift-overlay');
		if (overlay != null) {
			overlay.active = active;
		}
	}

	private _armBoundaryTracking(): void {
		document.addEventListener('dragover', this._onDocDragOver);
		document.addEventListener('dragleave', this._onDocDragLeave);
		document.addEventListener('pointermove', this._onDocDragPointerMove);
		this._resetWatchdog();
	}

	private _disarmBoundaryTracking(): void {
		document.removeEventListener('dragover', this._onDocDragOver);
		document.removeEventListener('dragleave', this._onDocDragLeave);
		document.removeEventListener('pointermove', this._onDocDragPointerMove);
		if (this._dragWatchdog != null) {
			clearTimeout(this._dragWatchdog);
			this._dragWatchdog = undefined;
		}
	}

	private _resetWatchdog(): void {
		if (this._dragWatchdog != null) {
			clearTimeout(this._dragWatchdog);
		}
		// No dragover for this long while a drag is active ⇒ the drag left the webview (fallback for
		// when the exit dragleave itself is suppressed). 450ms > the ~350ms stationary-dragover
		// interval, so a still cursor inside doesn't false-trigger.
		this._dragWatchdog = setTimeout(() => {
			if (this._dragActive) {
				this._setDragHint(true);
			}
		}, 450);
	}

	private _onDocDragStart = (): void => {
		this._dragActive = true;
		this._armBoundaryTracking();
	};

	private _onDocDragEnd = (): void => {
		this._dragActive = false;
		this._disarmBoundaryTracking();
		this._setDragHint(false);
	};

	private _onDocDragOver = (): void => {
		this._setDragHint(false);
		this._resetWatchdog();
	};

	private _onDocDragLeave = (e: DragEvent): void => {
		const leftWebview =
			e.relatedTarget == null &&
			(e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight);
		if (leftWebview) {
			this._setDragHint(true);
		}
	};

	private _onDocDragPointerMove = (e: PointerEvent): void => {
		// A pointermove during a drag means the native drag ended (browser suppresses pointermoves
		// mid-drag); if it was released outside, no dragend fired inside — recover here.
		if (e.buttons !== 0) return;

		this._dragActive = false;
		this._disarmBoundaryTracking();
		this._setDragHint(false);
	};
}
