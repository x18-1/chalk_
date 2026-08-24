import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

type FetchInput = string | URL | Request;
type FetchLike = (input: FetchInput, init?: RequestInit) => Promise<Response>;

function parseIpv4(value: string) {
  const parts = value.split(".");
  if (parts.length !== 4) return undefined;
  const octets = parts.map((part) => Number(part));
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return undefined;
  }
  return octets;
}

function parseIpv6(value: string) {
  const sections = value.toLowerCase().split("::");
  if (sections.length > 2) return undefined;
  const expand = (section: string) => {
    if (!section) return [] as number[];
    const parts = section.split(":");
    const result: number[] = [];
    for (const part of parts) {
      if (part.includes(".")) {
        const ipv4 = parseIpv4(part);
        if (!ipv4) return undefined;
        result.push((ipv4[0]! << 8) | ipv4[1]!, (ipv4[2]! << 8) | ipv4[3]!);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(part)) return undefined;
      result.push(Number.parseInt(part, 16));
    }
    return result;
  };

  const left = expand(sections[0] ?? "");
  const right = expand(sections[1] ?? "");
  if (!left || !right) return undefined;
  const missing = sections.length === 2 ? 8 - left.length - right.length : 0;
  if (missing < 0 || (sections.length === 1 && left.length !== 8)) return undefined;
  return [...left, ...Array.from({ length: missing }, () => 0), ...right];
}

function ipv4IsPrivate(value: string) {
  const octets = parseIpv4(value);
  if (!octets) return false;
  const [first, second, third] = octets;
  return (
    first === 0
    || first === 10
    || first === 100 && second! >= 64 && second! <= 127
    || first === 127
    || first === 169 && second === 254
    || first === 172 && second! >= 16 && second! <= 31
    || first === 192 && second === 0 && third === 0
    || first === 192 && second === 0 && third === 2
    || first === 192 && second === 168
    || first === 198 && (second === 18 || second === 19)
    || first === 198 && second === 51 && third === 100
    || first === 203 && second === 0 && third === 113
    || first! >= 224
  );
}

function ipv6IsPrivate(value: string) {
  const sections = parseIpv6(value);
  if (!sections) return false;
  const first = sections[0]!;
  if (first === 0 || first === 1 || first >= 0xff00) return true;
  if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80) return true;

  const isMapped = sections.slice(0, 5).every((part) => part === 0)
    && sections[5] === 0xffff;
  if (isMapped) {
    const mapped = `${sections[6]! >> 8}.${sections[6]! & 0xff}.${sections[7]! >> 8}.${sections[7]! & 0xff}`;
    return ipv4IsPrivate(mapped);
  }
  return first === 0x2001 && sections[1] === 0x0db8;
}

function normalizeHostname(hostname: string) {
  return hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
}

/** Returns true for literal addresses and names that must never be MCP targets. */
export function isPrivateNetworkAddress(hostname: string) {
  const normalized = normalizeHostname(hostname);
  if (
    normalized === "localhost"
    || normalized.endsWith(".localhost")
    || normalized === "local"
    || normalized.endsWith(".local")
  ) return true;
  if (isIP(normalized) === 4) return ipv4IsPrivate(normalized);
  if (isIP(normalized) === 6) return ipv6IsPrivate(normalized);
  return false;
}

export async function assertSafeMcpHttpUrl(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("MCP URL must use HTTP or HTTPS");
  }
  const hostname = normalizeHostname(url.hostname);
  if (!hostname || isPrivateNetworkAddress(hostname)) {
    throw new Error("MCP URL targets a private or local network address");
  }
  if (isIP(hostname) === 0) {
    let addresses;
    try {
      addresses = await lookup(hostname, { all: true, verbatim: true });
    } catch {
      throw new Error("MCP URL host could not be resolved safely");
    }
    if (!addresses.length || addresses.some((address) => isPrivateNetworkAddress(address.address))) {
      throw new Error("MCP URL resolves to a private or local network address");
    }
  }
}

export function createSafeMcpFetch(): FetchLike {
  return async (input, init) => {
    const target = input instanceof Request
      ? new URL(input.url)
      : new URL(input instanceof URL ? input.href : input);
    await assertSafeMcpHttpUrl(target);
    return fetch(input, { ...init, redirect: "manual" });
  };
}
