import { HttpClient } from '../http/client.js';
import type { LoginDto, RegisterDto, AuthResponse, ForgotPasswordDto } from '@huntara/schema';

export class AuthModule {
  constructor(private client: HttpClient) {}

  public async login(dto: LoginDto): Promise<AuthResponse> {
    return this.client.post<AuthResponse>('/auth/login', dto);
  }

  public async register(dto: RegisterDto): Promise<AuthResponse> {
    return this.client.post<AuthResponse>('/auth/signup', dto);
  }

  public async logout(): Promise<void> {
    return this.client.post<void>('/auth/logout');
  }

  public async session(): Promise<any> {
    return this.client.get<any>('/auth/session');
  }

  public async forgotPassword(dto: ForgotPasswordDto): Promise<void> {
    return this.client.post<void>('/auth/forgot-password', dto);
  }

  public async resendVerification(dto: { email: string }): Promise<void> {
    return this.client.post<void>('/auth/resend-verification', dto);
  }
}
