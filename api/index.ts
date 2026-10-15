// Vercel serverless entry — wraps the Express app.
// Vercel sets VERCEL=1, so server/src/index.ts exports app instead of listening.
import app from "../server/src/index";

export default app;
