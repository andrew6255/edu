import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import superadminRouter from "./superadmin.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(superadminRouter);

export default router;
