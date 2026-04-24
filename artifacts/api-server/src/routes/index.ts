import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import programIngestionRouter from "../modules/program-ingestion/routes";

const router: IRouter = Router();

router.use(healthRouter);
router.use(programIngestionRouter);

export default router;
