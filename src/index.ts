import { app } from './app'

const port = Number(process.env.PORT ?? 3000)

app.listen(port, () => {
  console.log(`🦊 Merchant Dashboard API running at http://localhost:${port}`)
  console.log(`📚 Swagger docs at http://localhost:${port}/docs`)
})

export type { App } from './app'
