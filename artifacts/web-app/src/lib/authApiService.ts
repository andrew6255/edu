import { requireSupabase } from './supabase';

function apiUrl(): string {
  return (import.meta.env.VITE_API_SERVER_URL as string | undefined)?.trim().replace(/\/$/, '') || '';
}

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const baseUrl = apiUrl();
  const endpoint = `${baseUrl}/api/auth/${path}`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(`Login service is unavailable at ${baseUrl || window.location.origin}. Start or deploy the API server, then try again.`);
  }

  const raw = await response.text();
  let result: (T & { error?: string }) | null = null;
  try {
    result = raw ? JSON.parse(raw) as T & { error?: string } : null;
  } catch {
    const returnedHtml = raw.trimStart().startsWith('<!DOCTYPE') || raw.trimStart().startsWith('<html');
    throw new Error(returnedHtml
      ? `Login API is misconfigured: ${baseUrl || window.location.origin} returned the website instead of the API. Check VITE_API_SERVER_URL and make sure the API server is running.`
      : 'Login service returned an invalid response.');
  }

  if (!response.ok) throw new Error(result?.error || `Authentication request failed (HTTP ${response.status}).`);
  if (!result) throw new Error('Login service returned an empty response.');
  return result;
}

export async function loginWithIdentifier(loginId:string,password:string):Promise<void>{
  const result=await post<{accessToken:string;refreshToken:string}>('password-login',{loginId,password});
  const {error}=await requireSupabase().auth.setSession({access_token:result.accessToken,refresh_token:result.refreshToken});
  if(error)throw error;
}

export async function checkUsernameAvailable(username:string):Promise<boolean>{
  const result=await post<{available:boolean}>('username-available',{username});
  return result.available===true;
}
