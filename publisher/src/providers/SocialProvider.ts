import type {
  ConnectInput,
  ConnectResult,
  ConnectedAccount,
  CredentialRefresh,
  CredentialStatus,
  ImageContent,
  PublishAttempt,
  PublishJob,
  PublishStatus,
  ProviderPublishHandle,
  ReconcileResult,
  TextContent,
  VideoContent,
} from "./types.ts";
import type { ProviderName } from "./types.ts";

/**
 * The rest of the application (API, scheduler, worker) talks only to this
 * interface. Facebook Graph and TikTok Content Posting details stay inside
 * the adapters.
 */
export interface SocialProvider {
  readonly id: ProviderName;

  connectAccount(input: ConnectInput): Promise<ConnectResult>;
  refreshCredentials(account: ConnectedAccount): Promise<CredentialRefresh>;
  validateCredentials(account: ConnectedAccount): Promise<CredentialStatus>;
  publishText(job: PublishJob, account: ConnectedAccount, content: TextContent): Promise<PublishAttempt>;
  publishImage(job: PublishJob, account: ConnectedAccount, content: ImageContent): Promise<PublishAttempt>;
  publishVideo(job: PublishJob, account: ConnectedAccount, content: VideoContent): Promise<PublishAttempt>;
  getPublishStatus(account: ConnectedAccount, handle: ProviderPublishHandle): Promise<PublishStatus>;
  reconcilePublish(
    job: PublishJob,
    account: ConnectedAccount,
    handle: ProviderPublishHandle
  ): Promise<ReconcileResult>;
  disconnectAccount(account: ConnectedAccount): Promise<void>;
}

export function publishDispatch(
  provider: SocialProvider,
  job: PublishJob,
  account: ConnectedAccount,
  content: TextContent | ImageContent | VideoContent
): Promise<PublishAttempt> {
  switch (job.mediaKind) {
    case "text":
      return provider.publishText(job, account, content as TextContent);
    case "image":
      return provider.publishImage(job, account, content as ImageContent);
    case "video":
    case "reel":
      return provider.publishVideo(job, account, content as VideoContent);
    default: {
      const _exhaustive: never = job.mediaKind;
      throw new Error(`Unsupported media kind: ${_exhaustive}`);
    }
  }
}
