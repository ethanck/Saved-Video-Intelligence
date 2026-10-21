/** Provider-neutral metadata extraction contracts for the processing pipeline. */
import { isIP } from "node:net";
import type { SourceMetadata } from "@svi/shared-types";

export type MetadataExtractionInput = {
  url: string;
  platform: string;
};

/** Provider boundary for the first processing stage. Implementations must obey source access rules. */
export interface MetadataExtractor {
  extract(input: MetadataExtractionInput): Promise<SourceMetadata>;
}

/** Explicit no-op provider used until a permitted metadata adapter is configured. */
export class UnconfiguredMetadataExtractor implements MetadataExtractor {
  async extract(): Promise<SourceMetadata> {
    return {};
  }
}

export type PublicMetadataExtractorOptions = {
  fetchImpl?: typeof fetch;
  maxBytes?: number;
  timeoutMs?: number;
};

/**
 * Extracts lightweight metadata from a public HTML page only.
 *
 * This adapter never downloads media, sends cookies, follows redirects, or
 * crosses private-network boundaries. Sites that block public metadata remain
 * eligible for later processing or manual review.
 */
export class PublicMetadataExtractor implements MetadataExtractor {
  private readonly fetchImpl: typeof fetch;
  private readonly maxBytes: number;
  private readonly timeoutMs: number;

  constructor(options: PublicMetadataExtractorOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxBytes = options.maxBytes ?? 262_144;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async extract(input: MetadataExtractionInput): Promise<SourceMetadata> {
    const url = assertPublicHttpUrl(input.url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          accept: "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.5",
          "user-agent": "SavedVideoIntelligenceMetadata/0.1",
        },
        redirect: "manual",
        signal: controller.signal,
      });

      if (response.status >= 300 && response.status < 400) {
        throw new Error("Public metadata source returned a redirect; follow the canonical link instead.");
      }
      if (!response.ok) throw new Error(`Public metadata source returned HTTP ${response.status}.`);

      const metadata: SourceMetadata = { canonicalUrl: response.url || url };
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (!contentType.includes("html") && !contentType.includes("text/plain")) return metadata;

      const html = await readLimitedText(response, this.maxBytes);
      return {
        ...metadata,
        ...parseHtmlMetadata(html, response.url || url),
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error(`Public metadata request timed out after ${this.timeoutMs}ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function assertPublicHttpUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Metadata source must be a valid URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Metadata source must use HTTP or HTTPS.");
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const privateHostname = hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
    || hostname === "0.0.0.0"
    || hostname === "127.0.0.1"
    || hostname === "::1"
    || hostname.startsWith("10.")
    || hostname.startsWith("192.168.")
    || isPrivate172(hostname)
    || hostname.startsWith("169.254.")
    || hostname.startsWith("fe80:")
    || hostname.startsWith("fc")
    || hostname.startsWith("fd");
  if (privateHostname || (isIP(hostname) !== 0 && isPrivateIpv4(hostname))) {
    throw new Error("Metadata source must be publicly reachable.");
  }
  return parsed.toString();
}

function isPrivate172(hostname: string): boolean {
  const match = hostname.match(/^172\.(\d{1,3})\./);
  if (!match) return false;
  const secondOctet = Number(match[1]);
  return secondOctet >= 16 && secondOctet <= 31;
}

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return true;
  const first = octets[0] ?? -1;
  const second = octets[1] ?? -1;
  return first === 10
    || first === 127
    || (first === 169 && second === 254)
    || (first === 192 && second === 168)
    || (first === 172 && second >= 16 && second <= 31);
}

async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > maxBytes) throw new Error(`Metadata response exceeds the ${maxBytes}-byte limit.`);
  if (!response.body) return response.text();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) throw new Error(`Metadata response exceeds the ${maxBytes}-byte limit.`);
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function parseHtmlMetadata(html: string, baseUrl: string): SourceMetadata {
  const meta = new Map<string, string>();
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0]);
    const key = (attributes.property ?? attributes.name)?.toLowerCase();
    const content = attributes.content;
    if (key && content) meta.set(key, decodeHtml(content));
  }

  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const canonicalMatch = [...html.matchAll(/<link\b[^>]*>/gi)]
    .map((match) => parseAttributes(match[0]))
    .find((attributes) => attributes.rel?.toLowerCase().split(/\s+/).includes("canonical"));
  const captionsTrack = [...html.matchAll(/<track\b[^>]*>/gi)]
    .map((match) => parseAttributes(match[0]))
    .find((attributes) => {
      const kind = attributes.kind?.toLowerCase();
      return (kind === "captions" || kind === "subtitles") && Boolean(attributes.src);
    });

  return compactMetadata({
    title: meta.get("og:title") ?? (titleMatch ? decodeHtml(titleMatch[1]!) : undefined),
    description: meta.get("og:description") ?? meta.get("description"),
    author: meta.get("article:author") ?? meta.get("author"),
    thumbnailUrl: meta.get("og:image"),
    publishedAt: meta.get("article:published_time"),
    canonicalUrl: canonicalMatch?.href,
    captionsUrl: resolveUrl(captionsTrack?.src, baseUrl),
  });
}

function resolveUrl(value: string | undefined, baseUrl: string): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function parseAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of tag.matchAll(/([:\w-]+)\s*=\s*(["'])(.*?)\2/gs)) {
    attributes[match[1]!.toLowerCase()] = match[3]!;
  }
  return attributes;
}

function compactMetadata(metadata: Record<string, string | undefined>): SourceMetadata {
  return Object.fromEntries(Object.entries(metadata).filter(([, value]) => typeof value === "string" && value.trim())) as SourceMetadata;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
