import { Router, type IRouter } from "express";
import {
  attachProgramIngestionSourceFile,
  createProgramIngestionJob,
  getProgramIngestionJob,
  listProgramIngestionJobs,
  runProgramIngestionStage,
  updateProgramIngestionQuestion,
  publishProgramIngestionJob,
} from "./controller";

const router: IRouter = Router();

router.get("/program-ingestion", listProgramIngestionJobs);
router.post("/program-ingestion", createProgramIngestionJob);
router.get("/program-ingestion/:jobId", getProgramIngestionJob);
router.post("/program-ingestion/:jobId/source", attachProgramIngestionSourceFile);
router.post("/program-ingestion/:jobId/run", runProgramIngestionStage);
router.patch("/program-ingestion/:jobId/questions/:questionId", updateProgramIngestionQuestion);
router.post("/program-ingestion/:jobId/publish", publishProgramIngestionJob);

export default router;
