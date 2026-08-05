import { createHash } from 'node:crypto';
import { Router, type IRouter, type Request, type Response } from 'express';
import { fetchServiceRows, signInWithPasswordServer } from '../../lib/supabaseServer';

const router: IRouter = Router();
const loginWindows = new Map<string, { startedAt: number; attempts: number }>();
let limiterCalls = 0;

function normalizedLogin(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const result = value.trim().toLowerCase();
  return result.length >= 3 && result.length <= 254 ? result : null;
}

function rateLimitKey(req: Request, loginId: string): string {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  return createHash('sha256').update(`${ip}:${loginId}`).digest('hex');
}

function consumeLoginAttempt(key: string): boolean {
  const now = Date.now();
  limiterCalls += 1;
  if (limiterCalls % 500 === 0) {
    for (const [storedKey, value] of loginWindows) {
      if (now-value.startedAt >= 15*60_000) loginWindows.delete(storedKey);
    }
  }
  const current = loginWindows.get(key);
  if (!current || now-current.startedAt >= 15*60_000) {
    loginWindows.set(key,{startedAt:now,attempts:1});
    return true;
  }
  if (current.attempts>=8) return false;
  current.attempts+=1;
  return true;
}

router.post('/auth/password-login', async (req: Request, res: Response) => {
  try {
    const body=(req.body??{}) as Record<string,unknown>;
    const loginId=normalizedLogin(body.loginId);
    const password=typeof body.password==='string'&&body.password.length<=200?body.password:null;
    if(!loginId||!password){res.status(400).json({error:'Email or username and password are required.'});return;}
    if(!consumeLoginAttempt(rateLimitKey(req,loginId))){res.setHeader('Retry-After','900');res.status(429).json({error:'Too many login attempts. Try again later.'});return;}

    let email=loginId;
    if(!loginId.includes('@')){
      if(!/^[a-z0-9_]+$/.test(loginId)){res.status(401).json({error:'Incorrect email/username or password.'});return;}
      const profiles=await fetchServiceRows<{email?:string}>('profiles',{select:'email',username:`eq.${loginId}`,limit:'1'});
      email=profiles[0]?.email??'';
    }
    if(!email){res.status(401).json({error:'Incorrect email/username or password.'});return;}
    const session=await signInWithPasswordServer(email,password);
    const accessToken=typeof session.access_token==='string'?session.access_token:null;
    const refreshToken=typeof session.refresh_token==='string'?session.refresh_token:null;
    if(!accessToken||!refreshToken)throw new Error('INVALID_LOGIN');
    res.json({accessToken,refreshToken});
  }catch(error){
    const message=error instanceof Error?error.message:'';
    res.status(message==='INVALID_LOGIN'?401:500).json({error:message==='INVALID_LOGIN'?'Incorrect email/username or password.':'Login failed.'});
  }
});

router.post('/auth/username-available',async(req:Request,res:Response)=>{
  try{
    const username=normalizedLogin((req.body as Record<string,unknown>|null)?.username);
    if(!username||!/^[a-z0-9_]+$/.test(username)||username.length>40){res.status(400).json({error:'Invalid username.'});return;}
    if(!consumeLoginAttempt(rateLimitKey(req,`availability:${username}`))){res.setHeader('Retry-After','900');res.status(429).json({error:'Too many checks. Try again later.'});return;}
    const profiles=await fetchServiceRows<{id:string}>('profiles',{select:'id',username:`eq.${username}`,limit:'1'});
    res.json({available:profiles.length===0});
  }catch{res.status(500).json({error:'Username availability check failed.'});}
});

export default router;
