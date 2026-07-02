import type { AIModel } from '../models/model.js';
import type { AIResponseFormat } from '../models/provider.js';

/**
 * `providerId:modelId:schemaName` keys whose native format was rejected. Module-scoped because the
 * service constructs a fresh provider instance per request, so instance state wouldn't survive to
 * skip the doomed probe. Keyed per schema: e.g. GitKraken-Gemini rejects the null-union review
 * schemas but happily enforces the commits schema on the same model.
 *
 * Lives in its own (dependency-free) module so the AI service can clear it without statically
 * importing a provider implementation — every provider is loaded lazily into the `ai` chunk.
 */
const rejectedResponseFormats = new Set<string>();

function getKey(providerId: string, model: AIModel, responseFormat: AIResponseFormat): string {
	return `${providerId}:${model.id}:${responseFormat.name}`;
}

export function isResponseFormatRejected(
	providerId: string,
	model: AIModel,
	responseFormat: AIResponseFormat,
): boolean {
	return rejectedResponseFormats.has(getKey(providerId, model, responseFormat));
}

export function rememberResponseFormatRejection(
	providerId: string,
	model: AIModel,
	responseFormat: AIResponseFormat,
): void {
	rejectedResponseFormats.add(getKey(providerId, model, responseFormat));
}

/** Drops the remembered rejections; shares the provider model-list cache's lifetime, so a
 *  misclassified rejection can't outlive the capability data it was inferred from */
export function clearResponseFormatRejections(): void {
	rejectedResponseFormats.clear();
}
