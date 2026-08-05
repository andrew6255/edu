import { requireSupabase } from './supabase';

function apiUrl(): string {
  return (import.meta.env.VITE_API_SERVER_URL as string | undefined)?.trim().replace(/\/$/, '') || '';
}

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response=await fetch(`${apiUrl()}/api/auth/${path}`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),
  });
  const result=await response.json() as T&{error?:string};
  if(!response.ok)throw new Error(result.error||'Authentication request failed.');
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
