import { Router, type IRouter } from 'express';
import { chatWithTutor, evaluateWork, findTutorAnswer, generateTutorAnswer, getPaperHelp, getTutorStatus, gradeTutorPaper } from './controller';

const router: IRouter = Router();

router.post('/ai-tutor/evaluate-work', evaluateWork);
router.post('/ai-tutor/chat', chatWithTutor);
router.post('/ai-tutor/generate-answer', generateTutorAnswer);
router.post('/ai-tutor/find-answer', findTutorAnswer);
router.post('/ai-tutor/paper-help', getPaperHelp);
router.post('/ai-tutor/grade-paper', gradeTutorPaper);
router.get('/ai-tutor/status', getTutorStatus);

export default router;
