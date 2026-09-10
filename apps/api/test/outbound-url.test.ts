import { describe, expect, test } from 'bun:test'
import { buildOutboundUrl, isReservedOrPrivateHost } from '../src/shared/outbound-url'

describe('isReservedOrPrivateHost', () => {
  test('blocks private, loopback, link-local and reserved hosts', () => {
    for (const host of [
      '127.0.0.1',
      '127.8.8.8',
      '10.0.0.1',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '0.0.0.0',
      '100.64.0.1',
      'localhost',
      'LocalHost',
      'localhost.',
      '::1',
      '[::1]',
      '::',
      'fc00::1',
      'fd12::1',
      'fe80::1'
    ]) {
      expect(isReservedOrPrivateHost(host), host).toBe(true)
    }
  })

  test('allows public hosts', () => {
    for (const host of ['example.com', 'api.myfatoorah.com', '8.8.8.8', '203.0.113.4']) {
      expect(isReservedOrPrivateHost(host), host).toBe(false)
    }
  })
})

describe('buildOutboundUrl', () => {
  test('accepts a public https URL', () => {
    const url = buildOutboundUrl('https://example.com/v2/SendPayment')
    expect(url.hostname).toBe('example.com')
  })

  test('rejects non-http(s) schemes', () => {
    for (const value of ['file:///etc/passwd', 'gopher://example.com', 'ftp://example.com']) {
      expect(() => buildOutboundUrl(value, { allowHttp: true })).toThrow()
    }
  })

  test('only allows http when explicitly permitted', () => {
    expect(() => buildOutboundUrl('http://example.com')).toThrow()
    expect(buildOutboundUrl('http://example.com', { allowHttp: true }).protocol).toBe('http:')
  })

  test('blocks private/reserved hosts even with https', () => {
    for (const value of [
      'https://127.0.0.1/admin',
      'https://localhost/ping',
      'https://169.254.169.254/latest/meta-data',
      'https://10.0.0.1/internal'
    ]) {
      expect(() => buildOutboundUrl(value, { allowHttp: true }), value).toThrow()
    }
  })

  test('enforces the host allowlist including subdomains', () => {
    const build = (value: string) => buildOutboundUrl(value, { allowHostnames: ['myfatoorah.com'] })
    expect(build('https://api.myfatoorah.com/v2').hostname).toBe('api.myfatoorah.com')
    expect(build('https://api-sa.myfatoorah.com/v2').hostname).toBe('api-sa.myfatoorah.com')
    expect(build('https://apitest.myfatoorah.com/ping').hostname).toBe('apitest.myfatoorah.com')
    expect(() => build('https://evil.com/ping')).toThrow()
    expect(() => build('https://myfatoorah.com.evil.com/ping')).toThrow()
  })

  test('a bare hostname is not swept in by a short allowlist entry', () => {
    const build = (value: string) => buildOutboundUrl(value, { allowHostnames: ['tamara.co'] })
    expect(build('https://api.tamara.co/checkout').hostname).toBe('api.tamara.co')
    expect(build('https://tamara.co').hostname).toBe('tamara.co')
    expect(() => build('https://attamara.co/checkout')).toThrow()
    expect(() => build('https://attamara.com/checkout')).toThrow()
  })

  test('rejects a malformed URL', () => {
    expect(() => buildOutboundUrl('not a url', { allowHttp: true })).toThrow()
  })
})