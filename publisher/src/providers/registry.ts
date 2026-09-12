import type { SocialProvider } from "./SocialProvider.ts";
import type { ProviderName } from "./types.ts";

export class ProviderRegistry {
  private readonly providers = new Map<ProviderName, SocialProvider>();

  register(provider: SocialProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(name: ProviderName): SocialProvider {
    const p = this.providers.get(name);
    if (!p) throw new Error(`No SocialProvider registered for ${name}`);
    return p;
  }

  has(name: ProviderName): boolean {
    return this.providers.has(name);
  }
}
