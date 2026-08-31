import { noChange } from 'lit';
import type { DirectiveParameters, ElementPart, PartInfo } from 'lit/directive.js';
import { Directive, directive, PartType } from 'lit/directive.js';

/**
 * Applies serialized context-menu data under the attribute selected by the host profile. An omitted
 * attribute makes this a no-op, while a host such as GitLens can opt into its native menu protocol.
 */
class HostContextDirective extends Directive {
	private attributeName: string | undefined;
	private value: string | undefined;

	constructor(partInfo: PartInfo) {
		super(partInfo);
		if (partInfo.type !== PartType.ELEMENT) {
			throw new Error('The `hostContext` directive must be used in an element expression');
		}
	}

	render(_attributeName: string | undefined, _value: string | undefined): typeof noChange {
		return noChange;
	}

	override update(part: ElementPart, [attributeName, value]: DirectiveParameters<this>): typeof noChange {
		if (this.attributeName != null && this.attributeName !== attributeName) {
			part.element.removeAttribute(this.attributeName);
		}

		if (attributeName == null || value == null) {
			if (this.attributeName != null) {
				part.element.removeAttribute(this.attributeName);
			}
		} else if (this.attributeName !== attributeName || this.value !== value) {
			part.element.setAttribute(attributeName, value);
		}

		this.attributeName = attributeName;
		this.value = value;
		return noChange;
	}
}

export const hostContext = directive(HostContextDirective);
