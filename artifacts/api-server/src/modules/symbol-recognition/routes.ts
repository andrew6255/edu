import { Router, type IRouter } from 'express';
import { recognizeSymbol } from './controller';

const router: IRouter = Router();

router.post('/symbol-recognition/recognize', recognizeSymbol);

export default router;
