import { describe, it, expect } from 'vitest';
import { parseArtifact, groupPlatforms } from '../../../scripts/generate-releases.mjs';
import {
  getReleaseByVersion,
  getReleasePlatform,
  getLatestRelease
} from './generated-releases';

describe('HUNTARA Release Information Architecture & Platform Routing', () => {
  // CASE 1: Release with Windows only
  it('CASE 1: Release with Windows only creates a platform list containing only Windows', () => {
    const rawAssets = [
      { name: 'HUNTARA-1.2.0-beta-win-x64.exe', size: 100000000, browser_download_url: 'https://example.com/win.exe' }
    ];
    const platforms = groupPlatforms(rawAssets);
    expect(platforms).toHaveLength(1);
    expect(platforms[0].id).toBe('windows');
    expect(platforms[0].label).toBe('Windows');
    expect(platforms[0].artifacts).toHaveLength(1);
    expect(platforms[0].artifacts[0].architecture).toBe('x64');
  });

  // CASE 2: Release with Windows + macOS
  it('CASE 2: Release with Windows and macOS includes only Windows and macOS', () => {
    const rawAssets = [
      { name: 'HUNTARA-1.1.0-win-x64.exe', size: 100000000, browser_download_url: 'https://example.com/win.exe' },
      { name: 'HUNTARA-1.1.0-mac-arm64.dmg', size: 90000000, browser_download_url: 'https://example.com/mac.dmg' }
    ];
    const platforms = groupPlatforms(rawAssets);
    expect(platforms).toHaveLength(2);
    expect(platforms.map(p => p.id)).toEqual(['windows', 'macos']);
  });

  // CASE 3: Release with Windows + macOS + Linux
  it('CASE 3: Release with Windows + macOS + Linux includes all three platforms', () => {
    const rawAssets = [
      { name: 'HUNTARA-1.1.0-win-x64.exe', size: 100000000, browser_download_url: 'https://example.com/win.exe' },
      { name: 'HUNTARA-1.1.0-mac-arm64.dmg', size: 90000000, browser_download_url: 'https://example.com/mac.dmg' },
      { name: 'HUNTARA-1.1.0-linux-x86_64.AppImage', size: 95000000, browser_download_url: 'https://example.com/linux.AppImage' }
    ];
    const platforms = groupPlatforms(rawAssets);
    expect(platforms).toHaveLength(3);
    expect(platforms.map(p => p.id)).toEqual(['windows', 'macos', 'linux']);
  });

  // CASE 4: macOS absent for a release
  it('CASE 4: macOS absent for v1.2.0-beta resolves to null (triggers 404)', () => {
    const match = getReleasePlatform('v1.2.0-beta', 'macos');
    expect(match).toBeNull();
  });

  // CASE 5: Linux absent for a release
  it('CASE 5: Linux absent for v1.2.0-beta resolves to null (triggers 404)', () => {
    const match = getReleasePlatform('v1.2.0-beta', 'linux');
    expect(match).toBeNull();
  });

  // CASE 6: Internal files only (.blockmap, .sha256, .yml) are ignored and NOT platforms
  it('CASE 6: Internal metadata files (.blockmap, .sha256, .yml) produce no platforms', () => {
    const rawAssets = [
      { name: 'HUNTARA-1.2.0-beta-win-x64.exe.blockmap', size: 1200 },
      { name: 'HUNTARA-1.2.0-beta-win-x64.exe.sha256', size: 64 },
      { name: 'latest.yml', size: 400 },
      { name: 'latest-mac.yml', size: 400 }
    ];
    for (const asset of rawAssets) {
      expect(parseArtifact(asset)).toBeNull();
    }
    const platforms = groupPlatforms(rawAssets);
    expect(platforms).toHaveLength(0);
  });

  // CASE 7: Multiple macOS architectures on the same release
  it('CASE 7: Multiple macOS architectures are grouped on /releases/<version>/macos', () => {
    const rawAssets = [
      { name: 'HUNTARA-1.1.0-mac-arm64.dmg', size: 90000000, browser_download_url: 'https://example.com/mac-arm.dmg' },
      { name: 'HUNTARA-1.1.0-mac-x64.dmg', size: 92000000, browser_download_url: 'https://example.com/mac-intel.dmg' }
    ];
    const platforms = groupPlatforms(rawAssets);
    expect(platforms).toHaveLength(1);
    expect(platforms[0].id).toBe('macos');
    expect(platforms[0].artifacts).toHaveLength(2);
    expect(platforms[0].artifacts[0].architectureLabel).toBe('Apple Silicon');
    expect(platforms[0].artifacts[1].architectureLabel).toBe('Intel');
  });

  // CASE 8: Unknown version resolves to 404
  it('CASE 8: Unknown version returns undefined or null (triggers 404)', () => {
    const release = getReleaseByVersion('v99.99.99-nonexistent');
    expect(release).toBeUndefined();

    const platform = getReleasePlatform('v99.99.99-nonexistent', 'windows');
    expect(platform).toBeNull();
  });

  // Real data verification
  it('verifies that current latest release has valid Windows platform and non-empty download URL', () => {
    const latest = getLatestRelease();
    expect(latest).toBeDefined();
    expect(latest.platforms.length).toBeGreaterThan(0);
    const win = latest.platforms.find(p => p.id === 'windows');
    expect(win).toBeDefined();
    expect(win?.artifacts[0].downloadUrl).toBeTruthy();
    expect(win?.artifacts[0].checksum).toHaveLength(64);
  });
});
