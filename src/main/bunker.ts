import { randomUUID } from "node:crypto";
import { finalizeEvent } from "nostr-tools/pure";
import * as nip04 from "nostr-tools/nip04";
import * as nip44 from "nostr-tools/nip44";
import {
  actionTypeOf,
  buildErrorResponse,
  buildResponse,
  parseRequestEvent,
  parseUnsignedEvent,
  NIP46_REQUEST_KIND
} from "./nip46.js";
import { actionTypeForSignEventKind } from "../shared/types.js";
import type {
  ActionType,
  ApprovalChoice,
  LogEntry,
  LogEntryType,
  Nip46Request,
  EventTemplate,
  Nip46Response,
  PendingApproval,
  PolicyDecision,
  RelayTransport,
  SignedEvent
} from "../shared/types.js";

export interface BunkerDeps {
  signerPubkey: string;
  getSecretKey(): Uint8Array;
  transport: RelayTransport;
  isClient(pubkey: string): boolean;
  addClient(pubkey: string): void;
  clientName(pubkey: string): string;
  policyDecide(clientPubkey: string, actionType: ActionType): PolicyDecision;
  addRule(clientPubkey: string, actionType: ActionType): void;
  askApproval(approval: PendingApproval): Promise<ApprovalChoice>;
  log(entry: LogEntry): void;
}

export const ERR_UNSUPPORTED = "unsupported method";
export const ERR_DENIED = "denied by user";

function conversationKey(secretKey: Uint8Array, pubkey: string): Uint8Array {
  const key = nip44.v2.utils.getConversationKey(secretKey, pubkey);
  return key instanceof Uint8Array ? key : new Uint8Array(key);
}

const SUPPORTED = new Set([
  "connect",
  "sign_event",
  "get_public_key",
  "ping",
  "nip04_encrypt",
  "nip04_decrypt",
  "nip44_encrypt",
  "nip44_decrypt"
]);

export class BunkerCore {
  constructor(private deps: BunkerDeps) {}

  async start(): Promise<void> {
    await this.deps.transport.connect();
    this.deps.transport.subscribe({
      filters: [{ kinds: [NIP46_REQUEST_KIND], "#p": [this.deps.signerPubkey] }],
      onEvent: (event) => {
        void this.handleEvent(event.pubkey, event.content);
      }
    });
  }

  private appendLog(type: LogEntryType, message: string, extra?: Partial<LogEntry>): void {
    this.deps.log({ timestamp: Date.now(), type, message, ...extra });
  }

  private async handleEvent(eventPubkey: string, content: string): Promise<void> {
    try {
      let plaintext: string;
      let scheme: "nip44" | "nip04";
      const secretKey = this.deps.getSecretKey();
      try {
        plaintext = nip44.v2.decrypt(content, conversationKey(secretKey, eventPubkey));
        scheme = "nip44";
      } catch {
        try {
          plaintext = await nip04.decrypt(secretKey, eventPubkey, content);
          scheme = "nip04";
        } catch {
          this.appendLog("request-dropped", "Undecryptable request dropped", {
            clientPubkey: eventPubkey
          });
          return;
        }
      }

      const parsed = parseRequestEvent(
        {
          kind: NIP46_REQUEST_KIND,
          pubkey: eventPubkey,
          content: plaintext,
          tags: [["p", this.deps.signerPubkey]]
        },
        this.deps.signerPubkey
      );
      if (parsed === null) {
        this.appendLog("request-dropped", "Malformed request payload dropped", {
          clientPubkey: eventPubkey
        });
        return;
      }

      let response: Nip46Response;
      try {
        response = await this.dispatch(parsed.clientPubkey, parsed.request);
      } catch {
        response = buildErrorResponse(parsed.request.id, "internal error");
      }
      try {
        await this.publishResponse(parsed.clientPubkey, response, scheme);
      } catch {
        this.appendLog("protocol-error", "Failed to publish response (relays unreachable)", {
          clientPubkey: parsed.clientPubkey
        });
      }
    } catch {
      this.appendLog("request-dropped", "Unexpected error handling request", {
        clientPubkey: eventPubkey
      });
    }
  }

  private async publishResponse(
    clientPubkey: string,
    response: Nip46Response,
    scheme: "nip44" | "nip04"
  ): Promise<void> {
    const secretKey = this.deps.getSecretKey();
    const serialized = JSON.stringify(response);
    const content =
      scheme === "nip44"
        ? nip44.v2.encrypt(serialized, conversationKey(secretKey, clientPubkey))
        : await nip04.encrypt(secretKey, clientPubkey, serialized);
    const event: EventTemplate = {
      kind: NIP46_REQUEST_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["p", clientPubkey]],
      content
    };
    const signed = finalizeEvent(event, secretKey) as SignedEvent;
    await this.deps.transport.publish(signed);
  }

  private async dispatch(clientPubkey: string, request: Nip46Request): Promise<Nip46Response> {
    if (!SUPPORTED.has(request.method)) {
      this.appendLog("protocol-error", `Unsupported method: ${request.method}`, {
        clientPubkey
      });
      return buildErrorResponse(request.id, ERR_UNSUPPORTED);
    }

    switch (request.method) {
      case "connect":
        return this.handleConnect(clientPubkey, request);
      case "get_public_key":
        if (!this.deps.isClient(clientPubkey)) {
          return buildErrorResponse(request.id, ERR_DENIED);
        }
        return buildResponse(request.id, this.deps.signerPubkey);
      case "ping":
        if (!this.deps.isClient(clientPubkey)) {
          return buildErrorResponse(request.id, ERR_DENIED);
        }
        return buildResponse(request.id, "pong");
      case "sign_event":
        return this.handleSignEvent(clientPubkey, request);
      case "nip04_encrypt":
      case "nip04_decrypt":
      case "nip44_encrypt":
      case "nip44_decrypt":
        return this.handleEncryption(clientPubkey, request);
      default:
        return buildErrorResponse(request.id, ERR_UNSUPPORTED);
    }
  }

  private async handleConnect(clientPubkey: string, request: Nip46Request): Promise<Nip46Response> {
    if (this.deps.isClient(clientPubkey)) {
      return buildResponse(request.id, "ack");
    }
    // The client-supplied secret (NIP-46 connect params: [remotePubkey, secret, ...])
    // is untrusted and does not gate anything here. It is surfaced to the human
    // approving the request so they can compare it against the expected value;
    // the approval popup itself remains the actual consent moment.
    const presentedSecret = request.params[1];
    const choice = await this.deps.askApproval({
      // The correlation id used to match the eventual renderer response must be
      // generated here, NOT taken from request.id: request.id is chosen by the
      // remote client and is only unique within that one client's own request
      // stream, so two different clients can legitimately send the same id and
      // collide in the ApprovalQueue's pending map.
      id: randomUUID(),
      clientPubkey,
      clientName: this.deps.clientName(clientPubkey),
      actionType: "connect",
      description: "New client wants to connect",
      ...(presentedSecret !== undefined ? { presentedSecret } : {})
    });
    // Fail closed: only the exact literal "allow-once" or "always-allow" may
    // permit the connection. Anything else (deny, undefined, malformed values
    // from a compromised renderer) is treated as a denial.
    if (choice !== "allow-once" && choice !== "always-allow") {
      if (choice === "deny") {
        this.appendLog("client-denied", "Connection denied", { clientPubkey });
      } else {
        this.appendLog("protocol-error", "Connection denied: malformed approval choice", {
          clientPubkey
        });
      }
      return buildErrorResponse(request.id, ERR_DENIED);
    }
    this.deps.addClient(clientPubkey);
    this.appendLog("client-connected", "Client connected", { clientPubkey });
    return buildResponse(request.id, "ack");
  }

  private async checkPolicy(
    clientPubkey: string,
    actionType: ActionType,
    description: string,
    eventPreview?: string
  ): Promise<boolean> {
    const decision = this.deps.policyDecide(clientPubkey, actionType);
    if (decision === "allow") {
      return true;
    }
    if (decision === "deny") {
      return false;
    }
    const choice = await this.deps.askApproval({
      // See handleConnect: this must be a fresh, signer-generated id, never
      // the client-controlled NIP-46 requestId, or concurrent requests with
      // colliding client-chosen ids would clobber each other's pending entry.
      id: randomUUID(),
      clientPubkey,
      clientName: this.deps.clientName(clientPubkey),
      actionType,
      description,
      eventPreview,
      isPairedClient: this.deps.isClient(clientPubkey)
    });
    // Fail closed: only "allow-once" and "always-allow" may permit the
    // action. Every other value -- "deny", undefined, a typo, or an object
    // injected via a direct ipcRenderer.invoke that bypasses the preload
    // wrapper -- must deny.
    if (choice !== "allow-once" && choice !== "always-allow") {
      if (choice === "deny") {
        this.appendLog("request-denied", description, { clientPubkey, actionType });
      } else {
        this.appendLog("protocol-error", `Malformed approval choice, denying: ${description}`, {
          clientPubkey,
          actionType
        });
      }
      return false;
    }
    if (choice === "always-allow") {
      this.deps.addRule(clientPubkey, actionType);
    }
    this.appendLog("request-approved", description, { clientPubkey, actionType });
    return true;
  }

  private async handleSignEvent(clientPubkey: string, request: Nip46Request): Promise<Nip46Response> {
    const raw = request.params[0];
    if (raw === undefined) {
      return buildErrorResponse(request.id, "missing event parameter");
    }
    const unsigned = parseUnsignedEvent(raw);
    if (unsigned === null) {
      return buildErrorResponse(request.id, "invalid event");
    }
    const actionType = actionTypeForSignEventKind(unsigned.kind);
    const allowed = await this.checkPolicy(
      clientPubkey,
      actionType,
      `Sign kind ${unsigned.kind} event`,
      unsigned.content.slice(0, 280)
    );
    if (!allowed) {
      return buildErrorResponse(request.id, ERR_DENIED);
    }
    const signed = finalizeEvent(unsigned, this.deps.getSecretKey()) as SignedEvent;
    this.appendLog("event-signed", `Signed kind ${unsigned.kind} event`, {
      clientPubkey,
      actionType,
      eventId: signed.id
    });
    return buildResponse(request.id, JSON.stringify(signed));
  }

  private async handleEncryption(clientPubkey: string, request: Nip46Request): Promise<Nip46Response> {
    const actionType = actionTypeOf(request.method, request.params);
    if (actionType === null) {
      return buildErrorResponse(request.id, ERR_UNSUPPORTED);
    }
    const [thirdParty, payload] = request.params;
    if (thirdParty === undefined || payload === undefined) {
      return buildErrorResponse(request.id, "missing parameters");
    }
    const allowed = await this.checkPolicy(
      clientPubkey,
      actionType,
      `${request.method} for ${thirdParty.slice(0, 12)}...`
    );
    if (!allowed) {
      return buildErrorResponse(request.id, ERR_DENIED);
    }
    const secretKey = this.deps.getSecretKey();
    try {
      switch (request.method) {
        case "nip04_encrypt":
          return buildResponse(request.id, await nip04.encrypt(secretKey, thirdParty, payload));
        case "nip04_decrypt":
          return buildResponse(request.id, await nip04.decrypt(secretKey, thirdParty, payload));
        case "nip44_encrypt":
          return buildResponse(
            request.id,
            nip44.v2.encrypt(payload, conversationKey(secretKey, thirdParty))
          );
        case "nip44_decrypt":
          return buildResponse(
            request.id,
            nip44.v2.decrypt(payload, conversationKey(secretKey, thirdParty))
          );
        default:
          return buildErrorResponse(request.id, ERR_UNSUPPORTED);
      }
    } catch {
      return buildErrorResponse(request.id, "encryption operation failed");
    }
  }
}
