// Example source file that uses env vars
const port = process.env.PORT || 3001
const jwtSecret = process.env.JWT_SECRET
const rateLimit = parseInt(process.env.RATE_LIMIT || '100', 10)
const debug = process.env.DEBUG === 'true'
const dbUrl = process.env.DATABASE_URL

export { port, jwtSecret, rateLimit, debug, dbUrl }
