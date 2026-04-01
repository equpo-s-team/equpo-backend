import { auth } from '@/firebase';

const BASE_URL = (import.meta.env.VITE_BACKEND_URL || 'http://localhost:8080/api/v1').replace(/\/$/, '');

type HttpMethod = 'GET' | 'POST' | 'PATCH';

async function authHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('No authenticated user');
  }

  const token = await user.getIdToken();
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function request<T>(path: string, method: HttpMethod, body?: unknown): Promise<T> {
  const headers = await authHeaders();
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }

  return payload as T;
}

export interface CreateTeamPayload {
  name: string;
  virtualCurrency: number;
  description?: string | null;
}

export interface UpdateTeamPayload {
  name?: string;
  virtualCurrency?: number;
  description?: string | null;
}

export interface AddTeamMemberPayload {
  userUid: string;
  role?: 'collaborator' | 'spectator' | 'member';
}

export interface UpdateTeamMemberRolePayload {
  role: 'collaborator' | 'spectator' | 'member';
}

export interface CreateTeamRewardPayload {
  rewardId: string;
  dateObtained?: string;
}

export interface CreateAchievementPayload {
  userUid: string;
  name: string;
  description?: string | null;
  iconURL?: string | null;
  unlockedAt?: string;
}

export const backendApi = {
  createTeam: (payload: CreateTeamPayload) => request('/teams', 'POST', payload),
  updateTeam: (teamId: string, payload: UpdateTeamPayload) => request(`/teams/${teamId}`, 'PATCH', payload),
  addTeamMember: (teamId: string, payload: AddTeamMemberPayload) => request(`/teams/${teamId}/members`, 'POST', payload),
  updateTeamMemberRole: (teamId: string, userUid: string, payload: UpdateTeamMemberRolePayload) =>
    request(`/teams/${teamId}/members/${userUid}/role`, 'PATCH', payload),
  createTeamReward: (teamId: string, payload: CreateTeamRewardPayload) => request(`/teams/${teamId}/rewards`, 'POST', payload),
  createAchievement: (teamId: string, payload: CreateAchievementPayload) => request(`/teams/${teamId}/achievements`, 'POST', payload),
};
