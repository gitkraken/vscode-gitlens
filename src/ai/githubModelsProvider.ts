import type { Response } from '@env/fetch';
import { fetch } from '@env/fetch';
import type { AIModel } from './aiProviderService';
import { getMaxCharacters } from './aiProviderService';
import { OpenAICompatibleProvider } from './openAICompatibleProvider';

const provider = { id: 'github', name: 'GitHub Models' } as const;

type GitHubModelsModel = AIModel<typeof provider.id>;

export class GitHubModelsProvider extends OpenAICompatibleProvider<typeof provider.id> {
	readonly id = provider.id;
	readonly name = provider.name;
	protected readonly config = {
		keyUrl: 'https://github.com/settings/tokens',
		keyValidator: /(?:ghp-)?[a-zA-Z0-9]{32,}/,
	};

	async getModels(): Promise<readonly AIModel<typeof provider.id>[]> {
		const rsp = await fetch('https://github.com/marketplace?category=All&task=chat-completion&type=models', {
			headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
		});

		interface ModelsResponseResult {
			type: 'model';
			task: 'chat-completion';

			id: string;
			name: string;
			friendly_name: string;
			publisher: string;
			model_family: string;
			max_input_tokens: number;
			max_output_tokens: number;
		}

		interface ModelsResponse {
			results: ModelsResponseResult[];
		}

		const result: ModelsResponse = await rsp.json();

		const models = result.results.map(
			r =>
				({
					id: r.name as any,
					name: r.friendly_name,
					maxTokens: { input: r.max_input_tokens, output: r.max_output_tokens },
					provider: provider,
					temperature: null,
				}) satisfies GitHubModelsModel,
		);

		return models;
	}

	protected getUrl(_model: AIModel<typeof provider.id>): string {
		return 'https://models.inference.ai.azure.com/chat/completions';
	}

	override async handleFetchFailure(
		rsp: Response,
		model: AIModel<typeof provider.id>,
		retries: number,
		maxCodeCharacters: number,
	): Promise<{ retry: boolean; maxCodeCharacters: number }> {
		if (rsp.status !== 404 && rsp.status !== 429) {
			let json;
			try {
				json = (await rsp.json()) as { error?: { code: string; message: string } } | undefined;
			} catch {}

			if (retries < 2 && json?.error?.code === 'tokens_limit_reached') {
				const match = /Max size: (\d+) tokens/.exec(json?.error?.message);
				if (match?.[1] != null) {
					maxCodeCharacters = getMaxCharacters(model, 2600, parseInt(match[1], 10));
					return { retry: true, maxCodeCharacters: maxCodeCharacters };
				}
			}
		}

		return super.handleFetchFailure(rsp, model, retries, maxCodeCharacters);
	}
}
