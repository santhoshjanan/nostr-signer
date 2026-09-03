import type {
  ActionType,
  EventTemplate,
  Nip46Request,
  Nip46Response
} from "../shared/types.js";

export const NIP46_REQUEST_KIND = 24133;

const HEX_64 = /^[0-9a-f]{64}$/;

export interface ParsedRequestEvent {
  clientPubkey: string;
  request: Nip46Request;
}

export interface RequestEventLike {
  kind: number;
  pubkey: string;
  content: string;
  tags: string[][];
}

export function parseRequestEvent(
  event: RequestEventLike,
  signerPubkey: string
): ParsedRequestEvent | null {
  try {
    if (event.kind !== NIP46_REQUEST_KIND) {
      return null;
    }
    if (!HEX_64.test(event.pubkey)) {
      return null;
    }
    const tagged = event.tags.some(
      (t) => Array.isArray(t) && t[0] === "p" && t[1] === signerPubkey
    );
    if (!tagged) {
      return null;
    }
    const payload: unknown = JSON.parse(event.content);
    if (typeof payload !== "object" || payload === null) {
      return null;
    }
    const obj = payload as Record<string, unknown>;
    if (typeof obj.id !== "string" || obj.id.length === 0) {
      return null;
    }
    if (typeof obj.method !== "string" || obj.method.length === 0) {
      return null;
    }
    let params: string[] = [];
    if (obj.params !== undefined) {
      if (!Array.isArray(obj.params)) {
        return null;
      }
      if (!obj.params.every((p) => typeof p === "string")) {
        return null;
      }
      params = obj.params as string[];
    }
    return {
      clientPubkey: event.pubkey,
      request: { id: obj.id, method: obj.method, params }
    };
  } catch {
    return null;
  }
}

export function buildResponse(id: string, result: string): Nip46Response {
  return { id, result };
}

export function buildErrorResponse(id: string, error: string): Nip46Response {
  return { id, error };
}

function isEventTemplate(value: unknown): value is EventTemplate {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const e = value as Record<string, unknown>;
  return (
    typeof e.kind === "number" &&
    Number.isInteger(e.kind) &&
    typeof e.created_at === "number" &&
    Array.isArray(e.tags) &&
    typeof e.content === "string"
  );
}

export function parseUnsignedEvent(json: string): EventTemplate | null {
  try {
    const parsed: unknown = JSON.parse(json);
    return isEventTemplate(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function actionTypeOf(method: string, params: string[]): ActionType | null {
  switch (method) {
    case "connect":
    case "get_public_key":
    case "ping":
      return null;
    case "sign_event": {
      const raw = params[0];
      if (raw === undefined) {
        return null;
      }
      const event = parseUnsignedEvent(raw);
      if (event === null) {
        return null;
      }
      return `sign_event:kind-${event.kind}`;
    }
    case "nip04_encrypt":
      return "nip04_encrypt";
    case "nip04_decrypt":
      return "nip04_decrypt";
    case "nip44_encrypt":
      return "nip44_encrypt";
    case "nip44_decrypt":
      return "nip44_decrypt";
    default:
      return null;
  }
}
