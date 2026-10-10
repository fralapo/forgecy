/**
 * Every endpoint, API version and field list the Graph API adapter uses.
 * These rotate (Meta retires Graph versions and changes fields without notice): this is the
 * ONLY file to update when the Graph source starts returning `api_drift`.
 */
export const endpoints = {
  /** Official Instagram Graph API (Business Discovery). */
  graphApiBase: "https://graph.facebook.com",
  graphApiVersion: "v21.0",
  /** Posts per Business Discovery page. */
  graphPageSize: 50,
  businessDiscoveryProfileFields: [
    "username",
    "name",
    "biography",
    "website",
    "followers_count",
    "follows_count",
    "media_count",
    "profile_picture_url",
  ],
  businessDiscoveryMediaFields: [
    "id",
    "caption",
    "timestamp",
    "media_type",
    "media_product_type",
    "like_count",
    "comments_count",
    "permalink",
    "children{media_type}",
  ],
} as const;
