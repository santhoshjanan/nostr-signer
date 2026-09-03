export interface ParsedBunkerUri {
  pubkey: string;
  relays: string[];
  secret: string | null;
}

export function buildBunkerUri(pubkey: string, relays: string[], secret: string): string {
  const params = new URLSearchParams();
  for (const relay of relays) {
    params.append("relay", relay);
  }
  params.append("secret", secret);
  return `bunker://${pubkey}?${params.toString()}`;
}

export function parseBunkerUri(uri: string): ParsedBunkerUri {
  if (!uri.startsWith("bunker://")) {
    throw new Error("not a bunker:// uri");
  }
  const rest = uri.slice("bunker://".length);
  const [pubkey, query = ""] = rest.split("?", 2);
  if (!pubkey || !/^[0-9a-f]{64}$/.test(pubkey)) {
    throw new Error("bunker uri has invalid pubkey");
  }
  const params = new URLSearchParams(query);
  return {
    pubkey,
    relays: params.getAll("relay"),
    secret: params.get("secret")
  };
}