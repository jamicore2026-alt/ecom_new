import { eq } from 'drizzle-orm'
import { inventoryLogs, productVariants } from '../database/schema'

type Tx = Parameters<Parameters<import('../database/client').db.transaction>[0]>[0]

/**
 * Concurrency-safe absolute inventory mutation, inside the caller's transaction.
 *
 * Locks the variant FOR UPDATE before writing so an absolute SET can never
 * clobber a concurrent checkout decrement (the sale path takes the same lock),
 * and writes the audit log from the freshly-read before-value so the logged
 * delta always matches reality.
 */
export const setVariantInventoryTx = async (
  tx: Tx,
  merchantId: string,
  variantId: string,
  absolute: number,
  opts: { reason: string; reference?: string }
): Promise<boolean> => {
  const [variant] = await tx
    .select()
    .from(productVariants)
    .where(eq(productVariants.id, variantId))
    .for('update')
  if (!variant) return false

  const afterValue = Math.max(0, Math.floor(absolute))
  if (afterValue === variant.inventory) return true

  await tx
    .update(productVariants)
    .set({ inventory: afterValue })
    .where(eq(productVariants.id, variantId))
  await tx.insert(inventoryLogs).values({
    merchantId,
    variantId,
    change: afterValue - variant.inventory,
    beforeValue: variant.inventory,
    afterValue,
    reason: opts.reason,
    reference: opts.reference ?? 'adjustment'
  })
  return true
}
