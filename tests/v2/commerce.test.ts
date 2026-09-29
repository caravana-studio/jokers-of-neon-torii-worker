import { it, expect } from "bun:test";
import { CommerceWorker } from "../../src/v2/commerceWorker.js";
it("only fulfills durable verified receipts; pending/review results do not block other purchases", async () => {
  const calls: string[] = [];
  const db = {
    rpc: async (name: string, args?: { p_receipt: string }) => {
      calls.push(name + ":" + (args?.p_receipt ?? ""));
      return {
        error: null,
        data:
          name === "pending_commerce_payments"
            ? [
                { receipt_id: "retry" },
                { receipt_id: "review" },
                { receipt_id: "paid" },
              ]
            : {
                status:
                  args?.p_receipt === "paid"
                    ? "fulfilled"
                    : args?.p_receipt === "review"
                      ? "review"
                      : "pending",
              },
      };
    },
  };
  expect(await new CommerceWorker(db as any).replayPending()).toBe(1);
  expect(calls).toEqual([
    "pending_commerce_payments:",
    "process_commerce_payment:retry",
    "process_commerce_payment:review",
    "process_commerce_payment:paid",
  ]);
});
it("database outages fail without inventing delivery or sending a payment", async () => {
  const db = {
    rpc: async () => ({
      data: null,
      error: { message: "DATABASE_UNAVAILABLE" },
    }),
  };
  await expect(new CommerceWorker(db as any).replayPending()).rejects.toThrow(
    "DATABASE_UNAVAILABLE",
  );
});
