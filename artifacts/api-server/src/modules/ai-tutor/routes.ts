import { Router, type IRouter } from 'express';
import { chatWithTutor, evaluateWork, getTutorStatus } from './controller';

const router: IRouter = Router();

router.post('/ai-tutor/evaluate-work', evaluateWork);
router.post('/ai-tutor/chat', chatWithTutor);
router.get('/ai-tutor/status', getTutorStatus);

export default router;
