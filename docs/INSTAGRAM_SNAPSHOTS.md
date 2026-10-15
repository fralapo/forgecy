# Instagram snapshots in Forgecy

Forgecy does not log in to Instagram, use private mobile endpoints, or impersonate a browser/app to get around rate limits. In Results, **Aggiorna dati pubblici** makes one explicit anonymous request to the selected public profile page and saves only follower/post totals when the page exposes them. It does not run in the background. If Instagram redirects to login, returns a challenge, denies the request, or limits it, Forgecy stops and does not retry or work around the restriction. Instagram can change or limit this public page at any time; availability is not guaranteed. The feature does not retrieve post-level engagement or private insights.

Instagram abbreviates larger counts (for example, `24K`). Forgecy stores the displayed value as an approximate number and labels it accordingly; small changes can be hidden or rounded between snapshots.

## Workflow

1. In Results, add the account username. For a public profile, choose **Aggiorna dati pubblici** to request the counts once. The profile-page collector is limited to one request per profile every ten minutes.
2. For your own account, request a JSON download from Instagram's Accounts Center. Meta documents that Download Your Information is available there ([Meta announcement](https://about.fb.com/news/2023/10/manage-your-information-across-apps/)).
3. Unzip the download locally, open its `connections/followers_and_following` folder (the path can vary), and select every `followers*.json` file with **Importa archivio Instagram**. Forgecy parses the files in the browser and submits only the unique follower count to the local workspace; follower names and the archive itself are not sent or saved.
4. For post metrics or additional fields, select **Importa rilevazione** and provide a JSON snapshot in Forgecy's format below. The public page reader does not retrieve post-level likes/comments, reach, saves or shares; the official account download does not supply a reliable substitute for these insights.
5. Import a fresh count or snapshot later to compare observations. The archive count is dated when imported, not when Instagram generated the archive, so use a current download for meaningful history. Export the current account history as CSV when needed.

The archive importer accepts `followers.json` and numbered parts such as `followers_1.json`, `followers_2.json`. It deduplicates usernames across selected files, understands the common `string_list_data` format, and stops with an error if it finds unrecognized entries rather than reporting a potentially incomplete count. It does not import the following list or infer unfollowers. It is intended for an account whose archive you are authorized to download; it is not a way to collect data from other accounts.

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
