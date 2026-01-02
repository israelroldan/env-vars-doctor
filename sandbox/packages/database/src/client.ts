// Database client that uses shared env vars
const dbUrl = process.env.DATABASE_URL

export function createClient() {
  if (!dbUrl) {
    throw new Error('DATABASE_URL is required')
  }
  return { url: dbUrl }
}
