import { Router, type IRouter } from "express";
import multer from "multer";
import path from "node:path";
import os from "node:os";

const upload = multer({ dest: path.join(os.tmpdir(), "iq-games-uploads") });
import {
  attachProgramIngestionSourceFile,
  createProgramIngestionJob,
  getProgramIngestionJob,
  listProgramIngestionJobs,
  runProgramIngestionStage,
  updateProgramIngestionQuestion,
  publishProgramIngestionJob,
  createPersonalProgramJob,
  getPersonalProgramStatus,
  getPersonalProgramDebug,
  extractMcqFromText,
  extractIqPdf,
} from "./controller";

const router: IRouter = Router();

router.get("/program-ingestion", listProgramIngestionJobs);
router.post("/program-ingestion", createProgramIngestionJob);
router.get("/program-ingestion/:jobId", getProgramIngestionJob);
router.post("/program-ingestion/:jobId/source", attachProgramIngestionSourceFile);
router.post("/program-ingestion/:jobId/run", runProgramIngestionStage);
router.patch("/program-ingestion/:jobId/questions/:questionId", updateProgramIngestionQuestion);
router.post("/program-ingestion/:jobId/publish", publishProgramIngestionJob);

// Personal API endpoints
router.post("/program-ingestion/personal", createPersonalProgramJob);
router.get("/program-ingestion/personal/:jobId/status", getPersonalProgramStatus);
router.get("/program-ingestion/personal/:jobId/debug", getPersonalProgramDebug);

// IQ Games API endpoints
router.post("/program-ingestion/extract-mcq", extractMcqFromText);
router.post("/program-ingestion/extract-iq-pdf", upload.single("file"), extractIqPdf);

export default router;
