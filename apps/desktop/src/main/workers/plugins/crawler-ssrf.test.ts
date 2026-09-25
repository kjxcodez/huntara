import { describe, it, expect } from 'vitest';
import { isSafeCrawlerUrl } from './crawler';

describe('Crawler SSRF Protection (HUNTARA-SEC-006)', () => {
  describe('Legitimate public target validation', () => {
    it('accepts valid public HTTP and HTTPS URLs', () => {
      expect(isSafeCrawlerUrl('https://example.com')).toEqual({ safe: true });
      expect(isSafeCrawlerUrl('https://www.huntara.ai/about')).toEqual({ safe: true });
      expect(isSafeCrawlerUrl('http://subdomain.company.org/careers?id=123')).toEqual({ safe: true });
      expect(isSafeCrawlerUrl('acme-corp.io')).toEqual({ safe: true });
    });
  });

  describe('Non-HTTP/HTTPS protocol rejection', () => {
    it('rejects file, ftp, gopher, and javascript schemes', () => {
      expect(isSafeCrawlerUrl('file:///etc/passwd').safe).toBe(false);
      expect(isSafeCrawlerUrl('ftp://ftp.example.com').safe).toBe(false);
      expect(isSafeCrawlerUrl('gopher://127.0.0.1:70').safe).toBe(false);
      expect(isSafeCrawlerUrl('javascript:alert(1)').safe).toBe(false);
    });
  });

  describe('Localhost and local domain rejection', () => {
    it('rejects localhost and variations', () => {
      expect(isSafeCrawlerUrl('http://localhost').safe).toBe(false);
      expect(isSafeCrawlerUrl('http://localhost:8080').safe).toBe(false);
      expect(isSafeCrawlerUrl('http://app.localhost').safe).toBe(false);
      expect(isSafeCrawlerUrl('http://myservice.local').safe).toBe(false);
      expect(isSafeCrawlerUrl('http://api.internal').safe).toBe(false);
    });
  });

  describe('Loopback and private IPv4 address rejection', () => {
    it('rejects 127.0.0.0/8 loopback addresses', () => {
      expect(isSafeCrawlerUrl('http://127.0.0.1').safe).toBe(false);
      expect(isSafeCrawlerUrl('http://127.0.0.1:3000/api').safe).toBe(false);
      expect(isSafeCrawlerUrl('http://127.1.2.3').safe).toBe(false);
    });

    it('rejects 169.254.0.0/16 cloud metadata addresses (AWS/GCP/Azure)', () => {
      expect(isSafeCrawlerUrl('http://169.254.169.254/latest/meta-data/').safe).toBe(false);
      expect(isSafeCrawlerUrl('http://169.254.1.1').safe).toBe(false);
    });

    it('rejects RFC-1918 private network addresses (10.0.0.0/8)', () => {
      expect(isSafeCrawlerUrl('http://10.0.0.1').safe).toBe(false);
      expect(isSafeCrawlerUrl('http://10.254.100.5:8080').safe).toBe(false);
    });

    it('rejects RFC-1918 private network addresses (172.16.0.0/12)', () => {
      expect(isSafeCrawlerUrl('http://172.16.0.1').safe).toBe(false);
      expect(isSafeCrawlerUrl('http://172.24.1.50').safe).toBe(false);
      expect(isSafeCrawlerUrl('http://172.31.255.255').safe).toBe(false);
    });

    it('rejects RFC-1918 private network addresses (192.168.0.0/16)', () => {
      expect(isSafeCrawlerUrl('http://192.168.0.1').safe).toBe(false);
      expect(isSafeCrawlerUrl('http://192.168.1.100:8000').safe).toBe(false);
    });

    it('rejects 0.0.0.0/8 wildcard addresses', () => {
      expect(isSafeCrawlerUrl('http://0.0.0.0:3000').safe).toBe(false);
    });
  });

  describe('IPv6 loopback and private address rejection', () => {
    it('rejects IPv6 loopback addresses', () => {
      expect(isSafeCrawlerUrl('http://[::1]').safe).toBe(false);
      expect(isSafeCrawlerUrl('http://[::1]:8080').safe).toBe(false);
    });

    it('rejects IPv6 link-local and unique local addresses', () => {
      expect(isSafeCrawlerUrl('http://[fe80::1]').safe).toBe(false);
      expect(isSafeCrawlerUrl('http://[fc00::1]').safe).toBe(false);
    });
  });

  describe('Malformed or empty input', () => {
    it('rejects empty, null, or invalid strings', () => {
      expect(isSafeCrawlerUrl('').safe).toBe(false);
      expect(isSafeCrawlerUrl(null as any).safe).toBe(false);
      expect(isSafeCrawlerUrl(undefined as any).safe).toBe(false);
      expect(isSafeCrawlerUrl(':::not-a-url:::').safe).toBe(false);
    });
  });
});
