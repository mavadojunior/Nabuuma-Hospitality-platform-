import type {
  FastifyRequest,
} from "fastify";

const LOOPBACK_HOSTS = new Set([
  "127.0.0.1",
  "localhost",
  "[::1]",
]);

function hostnameFromAuthority(
  authority: string,
): string | null {
  try {
    return new URL(
      `http://${authority}`,
    ).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function hostnameFromOrigin(
  origin: string,
): string | null {
  try {
    const url = new URL(origin);

    if (
      url.protocol !== "http:" &&
      url.protocol !== "https:"
    ) {
      return null;
    }

    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isAllowedMcpRequestOrigin(
  request: FastifyRequest,
): boolean {
  const authority =
    request.headers.host?.trim();

  if (!authority) {
    return false;
  }

  const host =
    hostnameFromAuthority(authority);

  if (
    !host ||
    !LOOPBACK_HOSTS.has(host)
  ) {
    return false;
  }

  const originHeader =
    request.headers.origin;

  if (originHeader === undefined) {
    return true;
  }

  if (Array.isArray(originHeader)) {
    return false;
  }

  const originHost =
    hostnameFromOrigin(originHeader);

  return (
    originHost !== null &&
    LOOPBACK_HOSTS.has(originHost)
  );
}
