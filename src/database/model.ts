import { createInsertSchema, createSelectSchema } from 'drizzle-typebox'
import { table } from './schema'

const insert = {
  merchant: createInsertSchema(table.merchants),
  user: createInsertSchema(table.users),
  category: createInsertSchema(table.categories),
  product: createInsertSchema(table.products),
  variant: createInsertSchema(table.productVariants),
  inventoryLog: createInsertSchema(table.inventoryLogs),
  customer: createInsertSchema(table.customers),
  order: createInsertSchema(table.orders),
  orderItem: createInsertSchema(table.orderItems),
  coupon: createInsertSchema(table.coupons),
  promotion: createInsertSchema(table.promotions)
}

const select = {
  merchant: createSelectSchema(table.merchants),
  user: createSelectSchema(table.users),
  category: createSelectSchema(table.categories),
  product: createSelectSchema(table.products),
  variant: createSelectSchema(table.productVariants),
  inventoryLog: createSelectSchema(table.inventoryLogs),
  customer: createSelectSchema(table.customers),
  order: createSelectSchema(table.orders),
  orderItem: createSelectSchema(table.orderItems),
  coupon: createSelectSchema(table.coupons),
  promotion: createSelectSchema(table.promotions)
}

export const dbModels = { insert, select }
