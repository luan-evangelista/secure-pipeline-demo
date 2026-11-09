import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../src/app.js";

const validPayment = {
  amount: 4990,
  currency: "BRL",
  cardToken: "tok_4f9a2c7e1b3d5f80", // gitleaks:allow (fake token, test fixture)
  description: "Annual plan",
};

test("health check responds ok", async () => {
  const res = await request(createApp()).get("/health");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { status: "ok" });
});

test("creates a payment and never returns the card token", async () => {
  const app = createApp();
  const res = await request(app).post("/payments").send(validPayment);
  assert.equal(res.status, 201);
  assert.equal(res.body.status, "authorized");
  assert.equal(res.body.cardToken, undefined);

  const fetched = await request(app).get(`/payments/${res.body.id}`);
  assert.equal(fetched.status, 200);
  assert.equal(fetched.body.cardToken, undefined);
});

test("rejects raw card numbers instead of tokens", async () => {
  const res = await request(createApp())
    .post("/payments")
    .send({ ...validPayment, cardToken: "4111111111111111" });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body.fields, ["cardToken"]);
});

test("rejects negative and fractional amounts", async () => {
  const app = createApp();
  for (const amount of [-10, 10.5, 0]) {
    const res = await request(app).post("/payments").send({ ...validPayment, amount });
    assert.equal(res.status, 400);
  }
});

test("rejects oversized bodies without leaking internals", async () => {
  const res = await request(createApp())
    .post("/payments")
    .set("content-type", "application/json")
    .send(JSON.stringify({ ...validPayment, description: "x".repeat(20_000) }));
  assert.equal(res.status, 413);
  assert.deepEqual(res.body, { error: "request_failed" });
});

test("sets security headers and hides the framework", async () => {
  const res = await request(createApp()).get("/health");
  assert.equal(res.headers["x-powered-by"], undefined);
  assert.equal(res.headers["x-content-type-options"], "nosniff");
  assert.ok(res.headers["content-security-policy"]);
});
