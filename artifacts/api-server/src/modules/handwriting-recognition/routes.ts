import { Router, type IRouter } from 'express';
import { recognizeHandwriting } from './controller';

const router: IRouter = Router();

router.post('/handwriting-recognition/recognize', recognizeHandwriting);

export default router;
