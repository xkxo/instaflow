import "server-only";
import {
  getFollowProfile,
  replyToComment,
  sendMessage,
  type FollowProfile,
  type MessageRecipient,
  type OutgoingMessage,
} from "../instagram";

/** Everything the flow engine needs from Instagram. Real and dry-run implementations. */
export interface Messenger {
  readonly dryRun: boolean;
  sendMessage(recipient: MessageRecipient, message: OutgoingMessage): Promise<{ messageId?: string }>;
  replyToComment(commentId: string, text: string): Promise<{ id?: string }>;
  getFollowProfile(igsid: string): Promise<FollowProfile>;
}

/** Real calls to graph.facebook.com with the stored system-user token. */
export class GraphMessenger implements Messenger {
  readonly dryRun = false;
  constructor(
    private readonly accessToken: string,
    private readonly igAccountId: string,
  ) {}

  sendMessage(recipient: MessageRecipient, message: OutgoingMessage) {
    return sendMessage(this.accessToken, this.igAccountId, recipient, message);
  }
  replyToComment(commentId: string, text: string) {
    return replyToComment(this.accessToken, commentId, text);
  }
  getFollowProfile(igsid: string) {
    return getFollowProfile(this.accessToken, igsid);
  }
}

export type DryRunCall = { method: "POST" | "GET"; path: string; body?: unknown; query?: Record<string, string> };

/**
 * No network: records the request that WOULD be made and returns fake IDs.
 * Follow checks return false until `followsAfterChecks` checks have happened (null = never follows).
 */
export class DryRunMessenger implements Messenger {
  readonly dryRun = true;
  readonly calls: DryRunCall[] = [];
  private followChecks = 0;
  private seq = 0;

  constructor(
    private readonly igAccountId: string,
    private readonly profile: { name: string; username: string; followsAfterChecks: number | null },
  ) {}

  async sendMessage(recipient: MessageRecipient, message: OutgoingMessage) {
    this.calls.push({ method: "POST", path: `/${this.igAccountId}/messages`, body: { recipient, message } });
    return { messageId: `dryrun-mid-${++this.seq}` };
  }
  async replyToComment(commentId: string, text: string) {
    this.calls.push({ method: "POST", path: `/${commentId}/replies`, query: { message: text } });
    return { id: `dryrun-comment-${++this.seq}` };
  }
  async getFollowProfile(igsid: string) {
    this.calls.push({ method: "GET", path: `/${igsid}`, query: { fields: "name,username,is_user_follow_business" } });
    const follows = this.profile.followsAfterChecks !== null && this.followChecks >= this.profile.followsAfterChecks;
    this.followChecks++;
    return { name: this.profile.name, username: this.profile.username, followsBusiness: follows };
  }
}
