import { describe, it, expect } from 'vitest';
import { isSecretSettingKey } from './onboarding-ipc';

describe('Credential & API Key Secret Classification (HUNTARA-SEC-004)', () => {
  it('correctly identifies API keys and provider secrets as sensitive', () => {
    expect(isSecretSettingKey('openai_api_key')).toBe(true);
    expect(isSecretSettingKey('anthropic_key')).toBe(true);
    expect(isSecretSettingKey('claude_api_key')).toBe(true);
    expect(isSecretSettingKey('gemini_api_key')).toBe(true);
    expect(isSecretSettingKey('openrouter_key')).toBe(true);
    expect(isSecretSettingKey('custom_api_key')).toBe(true);
    expect(isSecretSettingKey('api_key')).toBe(true);
    expect(isSecretSettingKey('apikey')).toBe(true);
  });

  it('correctly identifies passwords, tokens, and cookies as sensitive', () => {
    expect(isSecretSettingKey('smtp_password')).toBe(true);
    expect(isSecretSettingKey('imap_password')).toBe(true);
    expect(isSecretSettingKey('oauth_token')).toBe(true);
    expect(isSecretSettingKey('refresh_token')).toBe(true);
    expect(isSecretSettingKey('session_token')).toBe(true);
    expect(isSecretSettingKey('client_secret')).toBe(true);
    expect(isSecretSettingKey('linkedin_li_at')).toBe(true);
    expect(isSecretSettingKey('aws_credential')).toBe(true);
  });

  it('correctly identifies non-sensitive configuration keys as plain', () => {
    expect(isSecretSettingKey('theme')).toBe(false);
    expect(isSecretSettingKey('sidebar_collapsed')).toBe(false);
    expect(isSecretSettingKey('model_selection')).toBe(false);
    expect(isSecretSettingKey('telemetry_enabled')).toBe(false);
    expect(isSecretSettingKey('logging_level')).toBe(false);
    expect(isSecretSettingKey('company_name')).toBe(false);
  });

  it('handles empty or malformed inputs safely', () => {
    expect(isSecretSettingKey('')).toBe(false);
    expect(isSecretSettingKey(null as any)).toBe(false);
    expect(isSecretSettingKey(undefined as any)).toBe(false);
  });
});
