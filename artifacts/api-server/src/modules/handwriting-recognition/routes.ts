import { Router, type IRouter } from 'express';
import { recognizeHandwriting, recognizeMyScriptHandwriting } from './controller';

const router: IRouter = Router();

router.post('/handwriting-recognition/recognize', recognizeHandwriting);
router.post('/handwriting-recognition/myscript', recognizeMyScriptHandwriting);

export default router;
