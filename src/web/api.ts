import { Router } from "express";
import { createAutomationsRouter } from "./routes/automations.js";
import { createChangeReviewsRouter } from "./routes/change-reviews.js";
import { createChannelsRouter } from "./routes/channels.js";
import { createCodexOpenAIRouter } from "./routes/codex-openai.js";
import { createDataRouter } from "./routes/data.js";
import { createDesktopUpdateRouter } from "./routes/desktop-update.js";
import { createEventsRouter } from "./routes/events.js";
import { createFilesRouter } from "./routes/files.js";
import { createMessagesRouter } from "./routes/messages.js";
import { createProjectsRouter } from "./routes/projects.js";
import { createProvidersRouter } from "./routes/providers.js";
import { createProxyRouter } from "./routes/proxy.js";
import { createSendRouter } from "./routes/send.js";
import { createSessionsRouter } from "./routes/sessions.js";
import { createSettingsRouter } from "./routes/settings.js";
import { createSkillsRouter } from "./routes/skills.js";
import { checkDesktopUpdateOnStartup } from "./services/desktop-update.js";

export { checkDesktopUpdateOnStartup };

export function createApiRouter(): Router {
  const router = Router();

  router.use(createEventsRouter());
  router.use(createAutomationsRouter());
  router.use(createProjectsRouter());
  router.use(createSessionsRouter());
  router.use(createSettingsRouter());
  router.use(createDesktopUpdateRouter());
  router.use(createProvidersRouter());
  router.use(createCodexOpenAIRouter());
  router.use(createChannelsRouter());
  router.use(createSkillsRouter());
  router.use(createProxyRouter());
  router.use(createDataRouter());
  router.use(createChangeReviewsRouter());
  router.use(createSendRouter());
  router.use(createFilesRouter());
  router.use(createMessagesRouter());

  return router;
}

export function chatRouter(): Router {
  return createApiRouter();
}
