import type { ProviderError } from '../provider-error';
import type { ProviderModel } from '../model';

export type AsrProviderId = 'openai' | 'qwen' | 'azure' | 'lemonade';
export type AsrProviderConfig = { id: AsrProviderId; name: string; defaultBaseUrl: string; models: readonly ProviderModel[]; defaultModel: string; formats: readonly string[]; requiresApiKey: boolean };
export type AsrInput = { bytes: Uint8Array; contentType: string; filename: string; model?: string; language?: string; signal?: AbortSignal };
export type AsrOutput = { text: string; language?: string };
export type AsrAdapter = { transcribe(input: AsrInput): Promise<AsrOutput>; testConnection(model?: string): Promise<void> };
export type AsrFailure = ProviderError;
