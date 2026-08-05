import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { sentryErrorHandler } from "./lib/sentry";

const app: Express = express();

app.set('trust proxy', 1);

const configuredOrigins = (process.env['CORS_ALLOWED_ORIGINS'] ?? '')
  .split(',').map((origin) => origin.trim()).filter(Boolean);
const allowedOrigins = new Set([
  ...configuredOrigins,
  'capacitor://localhost',
  'https://localhost',
  ...(process.env['NODE_ENV'] === 'production' ? [] : ['http://localhost:3000', 'http://localhost:5173']),
]);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) { callback(null, true); return; }
    callback(new Error('Origin is not allowed.'));
  },
}));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Sentry error handler — must be LAST, after all routes and other middleware
// Cast needed because Express 5 uses stricter error handler signatures than Sentry v10 provides
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use(sentryErrorHandler() as any);

export default app;
