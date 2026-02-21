---
name: add-ai-provider
description: Add a new AI provider integration to GitLens
---

# /add-ai-provider - Add AI Provider

Add a new AI provider to GitLens with all required boilerplate.

## Usage

```
/add-ai-provider [provider-name]
```

## Information Needed

1. **Provider ID** — camelCase (e.g., `myProvider`), becomes part of `AIProviders` union type
2. **Display name** — e.g., "My Provider"
3. **OpenAI-compatible?** — Yes (extend base class) or No (implement interface directly)
4. **Requires account?** — Whether GitKraken account is needed vs user-provided API key

## Files to Create/Modify

### 1. Provider Constants: `src/constants.ai.ts`

Add to `AIProviders` union type:

```typescript
export type AIProviders = 'anthropic' | 'openai' | ... | '{providerId}';
```

Add descriptor to the descriptors object:

```typescript
export const aiProviderDescriptors = {
    // ... existing providers
    {providerId}: {
        id: '{providerId}',
        name: '{Display Name}',
        primary: false,
        requiresAccount: false,
        requiresUserKey: true,
    } satisfies AIProviderDescriptor<'{providerId}'>,
} as const;
```

### 2. Provider Implementation: `src/plus/ai/{providerId}Provider.ts`

For OpenAI-compatible providers (most common):

```typescript
import type { AIProviderDescriptor } from '../../constants.ai.js';
import { aiProviderDescriptors } from '../../constants.ai.js';
import type { AIActionType, AIModel } from './models/model.js';
import { OpenAICompatibleProviderBase } from './openAICompatibleProviderBase.js';

export class {ProviderName}Provider extends OpenAICompatibleProviderBase<'{providerId}'> {
    override get id(): '{providerId}' {
        return '{providerId}';
    }

    override get name(): string {
        return '{Display Name}';
    }

    override get descriptor(): AIProviderDescriptor<'{providerId}'> {
        return aiProviderDescriptors.{providerId};
    }

    override get config() {
        return {
            keyUrl: 'https://provider.com/api-keys',
            keyValidator: /^[a-z]{2}-[A-Za-z0-9-]+$/,
            keyDescription: '{Provider} API Key',
        };
    }

    override getModels(type: AIActionType): AIModel<'{providerId}'>[] {
        return [
            { id: 'model-name', name: 'Model Name', maxTokens: { input: 128000, output: 4096 } },
        ];
    }

    protected override getUrl(_model: AIModel<'{providerId}'>): string {
        return 'https://api.provider.com/v1/chat/completions';
    }
}
```

For non-OpenAI-compatible providers, implement `AIProvider<T>` interface directly.
See `src/plus/ai/models/provider.ts` for the interface definition.

### 3. Register Provider: `src/plus/ai/aiProviderService.ts`

Add to the `supportedAIProviders` Map (in alphabetical order):

```typescript
[
    '{providerId}',
    {
        provider: async () =>
            new (
                await import(/* webpackChunkName: "ai" */ './{providerId}Provider.js')
            ).{ProviderName}Provider(this.container),
    },
],
```

### 4. Configuration: `package.json`

Add settings for the provider's API key and default model:

```json
"gitlens.ai.{providerId}.key": {
    "type": "string",
    "description": "API key for {Display Name}"
},
"gitlens.ai.{providerId}.model": {
    "type": "string",
    "description": "Default model for {Display Name}"
}
```

## Canonical Example

`src/plus/ai/anthropicProvider.ts` — Clean example of an OpenAI-compatible provider.

## Key Interfaces

- `AIProvider<T>` — `src/plus/ai/models/provider.ts` — Core provider interface
- `AIModel<Provider, Model>` — `src/plus/ai/models/model.ts` — Model definition
- `AIProviderDescriptor<T>` — `src/constants.ai.ts` — Provider metadata
- `OpenAICompatibleProviderBase<T>` — `src/plus/ai/openAICompatibleProviderBase.ts` — Base class for OpenAI-compatible APIs

## Build & Test

```bash
pnpm run build:extension    # Build to verify compilation
```
