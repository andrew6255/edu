import { Router, type IRouter } from "express";
import { gradeFreeformAnswer } from "./controller";

const router: IRouter = Router();

router.post("/freeform-grading/grade", gradeFreeformAnswer);

export default router;
