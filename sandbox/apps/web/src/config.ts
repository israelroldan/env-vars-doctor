// Example source file that uses env vars
export const config = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL,
  analyticsEnabled: process.env.NEXT_PUBLIC_ANALYTICS_ENABLED === 'true',
  debug: process.env.DEBUG === 'true',
  // This one is not in the schema - should be flagged by diagnose
  secretFeature: process.env.SECRET_FEATURE_FLAG,
}
