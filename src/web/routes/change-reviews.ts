import { Router } from "express";
import type { Request, Response } from "express";
import { approveChangeReview, getChangeReviewFileDiff, revertChangeReview } from "../change-review.js";

export function createChangeReviewsRouter(): Router {
  const router = Router();

  router.get("/change-reviews/:id/diff", async (req: Request, res: Response) => {
    const filePath = Array.isArray(req.query.path) ? req.query.path[0] : req.query.path;
    if (typeof filePath !== "string" || !filePath.trim()) {
      res.status(400).json({ error: "文件路径不能为空" });
      return;
    }

    try {
      const file = await getChangeReviewFileDiff(req.params.id as string, filePath);
      if (!file) {
        res.status(404).json({ error: "文件 diff 不存在" });
        return;
      }
      res.json({ ok: true, file });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "读取 diff 失败";
      res.status(404).json({ error: msg });
    }
  });

  router.post("/change-reviews/:id/approve", async (req: Request, res: Response) => {
    try {
      const review = await approveChangeReview(req.params.id as string);
      res.json({ ok: true, review });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "审核失败";
      res.status(404).json({ error: msg });
    }
  });

  router.post("/change-reviews/:id/revert", async (req: Request, res: Response) => {
    try {
      const review = await revertChangeReview(req.params.id as string);
      if (review.status !== "reverted") {
        res.status(409).json({ ok: false, review, error: review.error || "无法安全撤销" });
        return;
      }
      res.json({ ok: true, review });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "撤销失败";
      res.status(404).json({ error: msg });
    }
  });

  return router;
}
