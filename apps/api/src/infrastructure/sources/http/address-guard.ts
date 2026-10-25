import dns from 'node:dns';
import net from 'node:net';
import ipaddr from 'ipaddr.js';

export type IsAllowed = (ip: string) => boolean;
export type GuardFailure = 'blocked_url' | 'blocked_address';

export class BlockedAddressError extends Error {
  readonly code = 'ERR_BLOCKED_ADDRESS';

  constructor(hostname: string) {
    super(`${hostname} does not resolve to a public address`);
    this.name = 'BlockedAddressError';
  }
}

const GLOBAL_UNICAST_V6 = ipaddr.IPv6.parseCIDR('2000::/3');

/** Only globally routable unicast addresses pass; every other range is blocked (D-4). */
export function isAllowedAddress(ip: string): boolean {
  if (!ipaddr.isValid(ip)) return false;
  try {
    const address = ipaddr.process(ip);
    if (address.range() !== 'unicast') return false;
    // ipaddr.js calls every IPv6 block it has no name for `unicast`, e.g. ::/96.
    return address.kind() === 'ipv4' || address.match(GLOBAL_UNICAST_V6);
  } catch {
    return false;
  }
}

/** Scheme, user info and IP-literal hosts. Node does not call `lookup` for a literal host. */
export function checkTarget(
  url: URL,
  isAllowed: IsAllowed = isAllowedAddress,
): GuardFailure | null {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'blocked_url';
  if (url.username !== '' || url.password !== '') return 'blocked_url';
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) !== 0 && !isAllowed(host)) return 'blocked_address';
  return null;
}

export interface ResolvedAddress {
  address: string;
  family: number;
}

type Resolve = (
  hostname: string,
  options: dns.LookupAllOptions,
  callback: (error: NodeJS.ErrnoException | null, addresses: ResolvedAddress[]) => void,
) => void;

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address?: string | ResolvedAddress[],
  family?: number,
) => void;

export interface GuardedLookupOptions {
  resolve?: Resolve;
  isAllowed?: IsAllowed;
}

/**
 * A `net.connect` lookup that refuses a host when any of its addresses is blocked. The socket
 * connects to the addresses returned here, so the checked answer is the used answer (no rebinding).
 */
export function createGuardedLookup({
  resolve = dns.lookup as unknown as Resolve,
  isAllowed = isAllowedAddress,
}: GuardedLookupOptions = {}) {
  return (
    hostname: string,
    options: dns.LookupOptions | number,
    callback: LookupCallback,
  ): void => {
    const base: dns.LookupOptions = typeof options === 'number' ? { family: options } : options;
    const wantsAll = base.all === true;
    resolve(hostname, { ...base, all: true }, (error, addresses) => {
      if (error) return callback(error);
      if (addresses.length === 0 || !addresses.every((a) => isAllowed(a.address))) {
        return callback(new BlockedAddressError(hostname));
      }
      if (wantsAll) return callback(null, addresses);
      const [first] = addresses as [ResolvedAddress];
      callback(null, first.address, first.family);
    });
  };
}
