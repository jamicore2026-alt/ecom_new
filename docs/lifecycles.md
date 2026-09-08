# JamiCore Lifecycles & State Machines

## Order (ecommerce, `orders.status`)

```
pending → processing → shipped → delivered   (terminal)
pending -> cancelled                           (terminal)
processing -> cancelled                        (terminal)
```

- `delivered`, `cancelled`, `refunded` are terminal.
- `refunded` is reached via the refund flow (not a manual flip).
- Entirely `refunded`/`cancelled` orders cannot flip fulfillment.
- Cancellation is the authoritative restock path: it conditionally claims a
  `pending` + `unpaid` order, restocks minus approved returns, restores coupon
  usage, and marks payment failed.
- Paid or partially-refunded orders must be refunded, not cancelled.
- Enforcement: `apps/api/src/shared/order-state.ts`, `orders/service.ts`,
  `shared/order-cancel.ts`.

## Payment (`payment_transactions.status`)

```
pending → authorized → paid → refunded
pending → failed
```

- Adapters: MyFatoorah (hosted invoice `SendPayment`, reverified via
  `GetPaymentStatus`), Tamara (`/checkout` + status lookup, authorize-is-
  captured), COD via `cod_rules`, and a legacy manual `'card'` path.
- Provider webhooks are deduped via unique `(provider, event_id)`.
- Refunds: balance-capped at `order.total` under a `FOR UPDATE` row lock;
  only `paid`/`partially_refunded` orders are refundable; idempotent via
  unique `(merchant_id, idempotency_key)`.
- Enforcement: `shared/order-payments.ts`, `orders/service.ts`,
  `payments/*`, `modules/webhooks/index.ts`.

## Fulfillment (`orders.fulfillmentStatus`)

```
unfulfilled → processing → packed → shipped → delivered
shipped → failed | returned | cancelled
```

- One fulfillment per order (no partial fulfillment yet).
- Stock is decremented at checkout, not at shipment.

## Refund / Return

- Return request → approval (with restock decision in future) → locked
  relative restock + cumulative-quantity guard + inventory_log `return`.
- Refund → `paymentTransactions.status = refunded` + analytics correction.
- Refund pathways must not double-apply (idempotency key).

## Food order (restaurant / POS / QR)

```
CREATED → CONFIRMED → PREPARING → READY → COMPLETED
```

- Dine-in / takeaway / delivery / POS order types.
- Idempotent create via `(merchant, idempotencyKey)`.
- Atomic `pay` flips `unpaid → paid` only if still unpaid.
- Automatic KOT generation is planned (manual today).
- Enforcement: `shared/order-state.ts`, `food-orders/service.ts`,
  `kitchen/service.ts` (`generateForOrder`).

## Kitchen ticket / KOT

```
open → preparing → ready → served   (+ cancelled)
```

- Per-station, idempotent per `(orderId, stationId)`, item auto-bump when all
  lines done, `prepSlaMin` delay calculation.
- Enforcement: `shared/kitchen-state.ts`, `kitchen/service.ts`.

## Table session

```
open → (merge/split/move) → closed → (cancelled)
```

- Sessions hold guests, status, orders; merge/split/move reassign
  `orders.tableSessionId`/`orders.outletId`.
- Enforcement: `shared/table-state.ts`, `tables/service.ts`.

## Delivery

```
created → assigned → picked_up → arrived → delivered  (+ failed/cancelled)
```

- Fee from zone; assignment ledger; driver freed on terminal status.
- Enforcement: `shared/delivery-state.ts`, `delivery/service.ts`.

## Stock transfer

- Intended: `draft → requested → approved → in_transit → partially_received
  → received → cancelled`.
- Today transfers are written atomically as `completed` (single tx, locked
  source row, destination relative update).

## Inventory

- Every stock change is an `inventory_logs` row with a `reason`.
- Sale decrement, cancel restore, return restock, manual adjustment, and bulk
  set all go through locked, transactional helpers (`shared/inventory.ts`).

## Purchase order (`purchase_orders.status`)

- `draft → pending → approved → (partial →)* received | cancelled`.
- `draft` items are editable; `submit` (`pending`) and `approve` (`approved`,
  stamps `approvedAt`/`approvedBy`) lock the line set.
- Receiving is partial by default: each `goods_receipt` moves stock into a
  warehouse while the global variant ledger is incremented in the same
  transaction (`reason: purchase`, `reference: <receiptNumber>`). The PO is
  `partial` while lines remain and `received` once all `quantity` is met.
- A PO can be cancelled until its first receipt; terminal `received`/`cancelled`
  POs cannot transition.