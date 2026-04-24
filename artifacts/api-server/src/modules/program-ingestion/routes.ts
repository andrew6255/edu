import { Router, type IRouter } from "express";
import {
  attachProgramIngestionSourceFile,
  createProgramIngestionJob,
  getProgramIngestionJob,
  listProgramIngestionJobs,
  runProgramIngestionStage,
} from "./controller";

const router: IRouter = Router();

router.get("/program-ingestion", listProgramIngestionJobs);
router.post("/program-ingestion", createProgramIngestionJob);
router.get("/program-ingestion/:jobId", getProgramIngestionJob);
router.post("/program-ingestion/:jobId/source", attachProgramIngestionSourceFile);
router.post("/program-ingestion/:jobId/run", runProgramIngestionStage);

export default router;
