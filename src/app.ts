import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { z } from "zod";

// Card data never reaches this API: clients send a token issued by the payment
// provider, which keeps the service out of PCI DSS cardholder-data scope.
const paymentSchema = z.object({
  amount: z.number().int().positive().max(1_000_000),
  currency: z.enum(["BRL", "USD", "EUR"]),
  cardToken: z.string().regex(/^tok_[A-Za-z0-9]{16,64}$/),
  description: z.string().max(140).optional(),
});

export type Payment = z.infer<typeof paymentSchema> & {
  id: string;
  status: "authorized";
  createdAt: string;
};

export function createApp() {
  const app = express();
  const payments = new Map<string, Payment>();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(express.json({ limit: "10kb" }));
  app.use(
    rateLimit({ windowMs: 60_000, limit: 100, standardHeaders: "draft-8", legacyHeaders: false }),
  );

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/payments", (req, res) => {
    const parsed = paymentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "invalid_request",
        fields: parsed.error.issues.map((issue) => issue.path.join(".")),
      });
      return;
    }
    const payment: Payment = {
      ...parsed.data,
      id: randomUUID(),
      status: "authorized",
      createdAt: new Date().toISOString(),
    };
    payments.set(payment.id, payment);
    // The token is never echoed back or logged.
    const { cardToken: _omit, ...publicView } = payment;
    res.status(201).json(publicView);
  });

  app.get("/payments/:id", (req, res) => {
    const payment = payments.get(req.params.id);
    if (!payment) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const { cardToken: _omit, ...publicView } = payment;
    res.json(publicView);
  });

  // Generic error handler: no stack traces or internals in responses.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = typeof err === "object" && err !== null && "status" in err ? Number(err.status) : 500;
    res.status(status >= 400 && status < 600 ? status : 500).json({ error: "request_failed" });
  });

  return app;
}
