import { Router, type IRouter } from 'express';
import { runAiFeature } from './controller';

const router: IRouter = Router();

router.post('/ai-features/complete', runAiFeature);

export default router;
