import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import programIngestionRouter from "../modules/program-ingestion/routes";
import freeformGradingRouter from "../modules/freeform-grading/routes";
import handwritingRecognitionRouter from "../modules/handwriting-recognition/routes";
import symbolRecognitionRouter from "../modules/symbol-recognition/routes";
import aiTutorRouter from "../modules/ai-tutor/routes";

const router: IRouter = Router();

router.use(healthRouter);
router.use(programIngestionRouter);
router.use(freeformGradingRouter);
router.use(handwritingRecognitionRouter);
router.use(symbolRecognitionRouter);
router.use(aiTutorRouter);

export default router;
