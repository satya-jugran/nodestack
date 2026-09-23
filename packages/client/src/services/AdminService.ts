import { BaseService } from './BaseService';
import type { AdminAuthResponse, AdminModel } from '../types';

/**
 * Service for administrative and superuser actions.
 */
export class AdminService extends BaseService {
  /**
   * Checks whether at least one superuser / admin account exists in NodeStack.
   */
  public async hasAdmins(): Promise<boolean> {
    const res = await this.send<{ hasAdmins: boolean }>('/api/admins/has-admins', {
      method: 'GET',
    });
    return Boolean(res?.hasAdmins);
  }

  /**
   * Creates the initial superuser account during first-time setup.
   * Automatically persists the returned admin token and model to authStore.
   */
  public async createInitial(email: string, password: string): Promise<AdminAuthResponse> {
    const res = await this.send<AdminAuthResponse>('/api/admins/create-initial', {
      method: 'POST',
      body: { email, password },
    });

    if (res?.token) {
      this.client.authStore.save(res.token, res.admin);
    }

    return res;
  }

  /**
   * Authenticates a superuser / admin using email and password.
   * Automatically persists the returned admin token and model to authStore.
   */
  public async authWithPassword(identity: string, password: string): Promise<AdminAuthResponse> {
    const res = await this.send<AdminAuthResponse>('/api/admins/auth-with-password', {
      method: 'POST',
      body: { identity, password },
    });

    if (res?.token) {
      this.client.authStore.save(res.token, res.admin);
    }

    return res;
  }

  /**
   * Retrieves the currently authenticated superuser's profile.
   */
  public async getMe(): Promise<AdminModel> {
    return this.send<AdminModel>('/api/admins/me', {
      method: 'GET',
    });
  }
}
