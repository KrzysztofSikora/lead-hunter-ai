import { describe, expect, it } from 'vitest';
import {
  BlockedAddressError,
  checkTarget,
  createGuardedLookup,
  isAllowedAddress,
  type ResolvedAddress,
} from './address-guard.js';

describe('isAllowedAddress', () => {
  it.each([
    '1.1.1.1',
    '93.184.216.34',
    '100.63.255.255',
    '100.128.0.0',
    '172.15.255.255',
    '172.32.0.0',
    '9.255.255.255',
    '11.0.0.0',
    '126.255.255.255',
    '128.0.0.0',
    '169.253.255.255',
    '169.255.0.0',
    '192.167.255.255',
    '192.169.0.0',
    '198.17.255.255',
    '198.20.0.0',
    '223.255.255.255',
    '2606:4700:4700::1111',
    '::ffff:8.8.8.8',
  ])('allows %s', (ip) => {
    expect(isAllowedAddress(ip)).toBe(true);
  });

  it.each([
    '0.0.0.0',
    '0.255.255.255',
    '10.0.0.0',
    '10.255.255.255',
    '100.64.0.0',
    '100.127.255.255',
    '127.0.0.1',
    '127.255.255.255',
    '169.254.0.1',
    '169.254.169.254',
    '172.16.0.0',
    '172.31.255.255',
    '192.168.0.1',
    '192.168.255.255',
    '192.0.0.1',
    '192.0.2.1',
    '198.18.0.0',
    '198.19.255.255',
    '224.0.0.1',
    '239.255.255.255',
    '240.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fe80::1',
    'fc00::1',
    'fd00:ec2::254',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '::ffff:169.254.169.254',
    '::7f00:1',
    '::a00:1',
    '64:ff9b::a00:1',
    '2002:a00:1::',
    '2001:db8::1',
    '',
    'localhost',
    'not-an-ip',
    '999.1.1.1',
  ])('blocks %s', (ip) => {
    expect(isAllowedAddress(ip)).toBe(false);
  });
});

describe('checkTarget', () => {
  it.each([
    ['http://example.com/', null],
    ['https://example.com:8443/path?q=1', null],
    ['https://93.184.216.34/', null],
    ['https://[2606:4700:4700::1111]/', null],
    ['ftp://example.com/file', 'blocked_url'],
    ['file:///etc/passwd', 'blocked_url'],
    ['javascript:alert(1)', 'blocked_url'],
    ['http://user:secret@example.com/', 'blocked_url'],
    ['http://user@example.com/', 'blocked_url'],
    ['http://:secret@example.com/', 'blocked_url'],
    ['http://127.0.0.1/', 'blocked_address'],
    ['http://[::1]/', 'blocked_address'],
    ['http://[::ffff:10.0.0.1]/', 'blocked_address'],
    ['http://169.254.169.254/latest/meta-data', 'blocked_address'],
    ['http://2130706433/', 'blocked_address'],
    ['http://0x7f.1/', 'blocked_address'],
  ])('%s -> %s', (url, expected) => {
    expect(checkTarget(new URL(url))).toBe(expected);
  });

  it('uses the injected policy for literal hosts', () => {
    expect(checkTarget(new URL('http://127.0.0.1/'), () => true)).toBeNull();
    expect(checkTarget(new URL('http://1.1.1.1/'), () => false)).toBe('blocked_address');
  });

  it('does not judge hostnames (the connect lookup does)', () => {
    expect(checkTarget(new URL('http://localhost/'), () => false)).toBeNull();
  });
});

describe('createGuardedLookup', () => {
  const PUBLIC: ResolvedAddress[] = [
    { address: '93.184.216.34', family: 4 },
    { address: '2606:4700:4700::1111', family: 6 },
  ];

  function lookupWith(answers: ResolvedAddress[][] | Error) {
    const calls: Array<{ hostname: string; options: object }> = [];
    let i = 0;
    const lookup = createGuardedLookup({
      resolve: (hostname, options, callback) => {
        calls.push({ hostname, options });
        if (answers instanceof Error) return callback(answers as NodeJS.ErrnoException, []);
        callback(null, answers[Math.min(i++, answers.length - 1)] ?? []);
      },
    });
    const run = (options: object | number) =>
      new Promise<{ error: Error | null; address?: unknown; family?: number }>((resolve) =>
        lookup('example.test', options, (error, address, family) =>
          resolve({ error, address, family }),
        ),
      );
    return { run, calls };
  }

  it('returns the whole answer when the caller asks for all', async () => {
    const { run } = lookupWith([PUBLIC]);
    expect(await run({ all: true })).toEqual({ error: null, address: PUBLIC, family: undefined });
  });

  it('returns the first address and family otherwise', async () => {
    const { run } = lookupWith([PUBLIC]);
    expect(await run({})).toEqual({ error: null, address: '93.184.216.34', family: 4 });
    expect(await run(4)).toEqual({ error: null, address: '93.184.216.34', family: 4 });
  });

  it('turns a numeric family into the family option', async () => {
    const { run, calls } = lookupWith([PUBLIC]);
    await run(6);
    expect(calls[0]?.options).toEqual({ family: 6, all: true });
  });

  it('forces all and keeps the caller options', async () => {
    const { run, calls } = lookupWith([PUBLIC]);
    await run({ family: 6, hints: 1 });
    expect(calls[0]).toEqual({
      hostname: 'example.test',
      options: { family: 6, hints: 1, all: true },
    });
  });

  it('refuses a mixed answer', async () => {
    const { run } = lookupWith([[...PUBLIC, { address: '10.0.0.5', family: 4 }]]);
    const { error } = await run({ all: true });
    expect(error).toBeInstanceOf(BlockedAddressError);
    expect((error as BlockedAddressError).code).toBe('ERR_BLOCKED_ADDRESS');
  });

  it('refuses an empty answer', async () => {
    const { run } = lookupWith([[]]);
    expect((await run({})).error).toBeInstanceOf(BlockedAddressError);
  });

  it('passes a resolver error through', async () => {
    const failure = Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
    const { run } = lookupWith(failure);
    expect((await run({})).error).toBe(failure);
  });

  it('refuses a resolver that answers public first and private second (rebinding)', async () => {
    const { run } = lookupWith([PUBLIC, [{ address: '127.0.0.1', family: 4 }]]);
    expect((await run({ all: true })).error).toBeNull();
    expect((await run({ all: true })).error).toBeInstanceOf(BlockedAddressError);
  });

  it('applies the injected policy', async () => {
    const lookup = createGuardedLookup({
      resolve: (_h, _o, cb) => cb(null, [{ address: '127.0.0.1', family: 4 }]),
      isAllowed: () => true,
    });
    const result = await new Promise((resolve) =>
      lookup('x.test', {}, (error, address) => resolve({ error, address })),
    );
    expect(result).toEqual({ error: null, address: '127.0.0.1' });
  });
});
