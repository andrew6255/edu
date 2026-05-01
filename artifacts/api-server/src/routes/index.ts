import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import programIngestionRouter from "../modules/program-ingestion/routes";
import freeformGradingRouter from "../modules/freeform-grading/routes";

const router: IRouter = Router();

router.use(healthRouter);
router.use(programIngestionRouter);
router.use(freeformGradingRouter);

export default router;
