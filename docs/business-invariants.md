# JamiCore Business Invariants

Rules that must never be violated. Changes to these require a doc update and
phase-gated tests.

## Pricing & money

1. **The server is the source of truth for money.** Checkout, POS, food
   orders recompute item prices, modifier prices, shipping, and tax
   server-side from the database. Cart-stored prices are never final.
2. **Order totals are snapshotted** at order creation (`order_items.price/total`,
   `orders.total`) and never mutate on later price changes.
3. **Refunds are balance-capped** at the paid total, enforced under a row lock.
4. **Revenue metrics count only collected money**: an order counts as revenue
   only when `paymentStatus = 'paid'`; refunds reduce revenue by the refunded
   amount. Unpaid pending orders must not appear as revenue.
5. **Payment state is backend state.** A UI click cannot mark an order paid;
   payment must transition through `paymentTransactions` and verified
   provider/webhook or manual-capture flows.
6. **Refunds are idempotent** (unique `(merchant_id, idempotency_key)`); a
   retry returns the prior result instead of double-refunding.

## Inventory

7. **Every stock change is a recorded inventory movement.** All mutations go
   through transactional helpers (`shared/inventory.ts`) that lock the
   variant row, validate availability, write `inventory_logs(reason)`, and
   update the ledger — never silent raw quantity flips.
8. **Stock can never go negative.**
9. **Checkout decrements stock at order creation** (not at shipment) and
   restores it on expiry/cancel, minus approved returns.
10. **Restock on return is relative and locked**, guarded against
    over-restocking beyond the ordered quantity.
11. **Transfers move stock atomically**: source decrements and destination
    increments in the same transaction with the source row locked.

## Order lifecycle

12. **Only valid state transitions are allowed** (see `docs/lifecycles.md`);
    every write validates the previous state.
13. **Cancelling a pending/unpaid order restores stock and coupon usage**;
    paid orders require the refund path.
14. **Food orders are idempotent** via `(merchant, idempotencyKey)`; POS sales
    reuse the same mechanism with a per-sale UUID.

## Idempotency

15. All money- and stock-changing operations (checkout, POS sale, payment
    capture, refund, stock adjust/transfer, goods receipt when introduced,
    production, loyalty award) must be repeatable without duplicating
    business effects — generally via a unique `(merchant, key)` constraint.

## Loyalty

16. **Points change only through the ledger** — always a `loyalty_ledger`
    row; balance can never go negative; earn/redeem/reversal are atomic.

## Multi-tenancy & authorization

17. **Every request is merchant-scoped**; out-of-tenant records are
    unreachable. IDOR is rejected server-side.
18. **Outlet-sensitive operations validate the user → merchant → outlet
    chain**; browser-supplied `outletId` is never trusted.
19. Frontend hiding is not authorization — server guards are mandatory.

## Integrity

20. Financial numbers (overview, analytics, profit) are derived from
    transaction tables, not cached/estimated figures.
21. Destructive actions require permission + server validation + transaction
    + audit event + UI refresh.
22. Important business actions are audited (`audit_logs`): actor, action,
    resource, resource ID, timestamp, metadata.