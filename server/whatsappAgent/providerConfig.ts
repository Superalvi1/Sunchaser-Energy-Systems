export const SALES_AI_PROVIDERS = ["gemini", "openai", "grok", "claude"] as const;
export type SalesAiProvider = typeof SALES_AI_PROVIDERS[number];
export type SalesProviderSelection = { provider?: SalesAiProvider; model?: string };
export const PROVIDER_KEYS: Record<SalesAiProvider,string> = {gemini:"GEMINI_API_KEY",openai:"OPENAI_API_KEY",grok:"XAI_API_KEY",claude:"ANTHROPIC_API_KEY"};
export function resolveSalesProvider(env:NodeJS.ProcessEnv=process.env,selection:SalesProviderSelection={}) {
  const provider=selection.provider || env.WHATSAPP_SALES_AI_PROVIDER || "gemini";
  if(!SALES_AI_PROVIDERS.includes(provider as SalesAiProvider)) throw new Error("Unsupported AI provider.");
  const model=(selection.model ?? env.WHATSAPP_SALES_AI_MODEL ?? "").trim();
  if(model && !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/.test(model)) throw new Error("Invalid AI model ID.");
  const keyName=PROVIDER_KEYS[provider as SalesAiProvider];
  return {provider:provider as SalesAiProvider,model,keyName,apiKey:env[keyName]?.trim() || ""};
}
export function providerStatuses(env:NodeJS.ProcessEnv=process.env) {
  return SALES_AI_PROVIDERS.map(id=>({id,keyName:PROVIDER_KEYS[id],configured:Boolean(env[PROVIDER_KEYS[id]]?.trim()),authentication:"api_key" as const}));
}
export function hasSalesProviderKey(env:NodeJS.ProcessEnv=process.env) {return providerStatuses(env).some(p=>p.configured);}
