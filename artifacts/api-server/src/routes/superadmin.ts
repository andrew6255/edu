import { Router, type IRouter } from 'express';
import { getFirebaseAdmin } from '../lib/firebaseAdmin.js';

const router: IRouter = Router();

const SA_FIREBASE_EMAIL = 'superadmin.logiclords@internal.app';

router.post('/superadmin/token', async (req, res) => {
  const saUsername = process.env.SA_USERNAME;
  const saPassword = process.env.SA_PASSWORD;

  if (!saUsername || !saPassword) {
    res.status(503).json({ error: 'Super admin credentials not configured on server.' });
    return;
  }

  const { username, password } = req.body as { username?: string; password?: string };

  if (username !== saUsername || password !== saPassword) {
    res.status(401).json({ error: 'Invalid credentials.' });
    return;
  }

  try {
    const adminApp = getFirebaseAdmin();
    const auth = adminApp.auth();

    let uid: string;
    try {
      const userRecord = await auth.getUserByEmail(SA_FIREBASE_EMAIL);
      uid = userRecord.uid;
    } catch (err: unknown) {
      const fbErr = err as { code?: string };
      if (fbErr.code === 'auth/user-not-found') {
        const newUser = await auth.createUser({
          email: SA_FIREBASE_EMAIL,
          displayName: 'SuperAdmin',
          emailVerified: true,
        });
        uid = newUser.uid;
      } else {
        throw err;
      }
    }

    const customToken = await auth.createCustomToken(uid, { role: 'superadmin' });
    res.json({ customToken, uid });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Super admin token generation failed.';
    res.status(503).json({ error: message });
  }
});

export default router;
