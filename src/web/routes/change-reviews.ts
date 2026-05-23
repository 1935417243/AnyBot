import { Router } from "express";
import type { Request, Response } from "express";
import { approveChangeReview, revertChangeReview } from "../change-review.js";

export function createChangeReviewsRouter(): Router {
  const router = Router();

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
