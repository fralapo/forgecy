# Instagram snapshots in Forgecy

Forgecy does not log in to Instagram, scrape its pages, use private mobile endpoints, or impersonate a browser/app to get around rate limits. The Results view works with snapshots supplied by the workspace owner. This keeps collection under the user's control and makes the data source explicit.

## Workflow

1. In Results, add the account username as a local label.
2. Prepare a JSON snapshot with the structure below from data you are authorized to use.
3. Select **Importa rilevazione** and choose the JSON file.
4. Import a later snapshot to compare follower counts and content metrics over time.
5. Export the current account history as CSV when needed.

An Instagram account data download can contain account-owned follower/following information, but it does not automatically provide the post performance fields shown in Forgecy's Results dashboard. Those fields must be present in the imported snapshot. Counts absent from the source must be omitted or set to \`null\`, never guessed or represented as zero.

## JSON format

\`\`\`json
{
  "account": {
    "username": "nomeaccount",
    "followers_count": 1200,
    "media_count": 80
  },
  "media": [
    {
      "id": "post-1",
      "caption": "Testo del contenuto",
      "permalink": "https://www.instagram.com/p/ABC/",
      "media_type": "IMAGE",
      "timestamp": "2026-10-14T12:00:00.000Z",
      "like_count": 42,
      "comments_count": 3
    }
  ],
  "account_insights": {
    "reach": 1800
  }
}
\`\`\`

\`account\` and \`media\` are optional, but at least one value is needed for useful analytics. A snapshot can also be wrapped in \`{"snapshot": { ... }}\`. Each media item needs a stable \`id\`; \`permalink\` must be an HTTP(S) URL. A supplied username must match the local account label.

Data stays in the local workspace database. Removing the local account also deletes its snapshots.
