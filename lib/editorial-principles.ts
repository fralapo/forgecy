/** Practical static-content guidance based on the provided training materials. */
export const EDITORIAL_PLAYBOOK=[
 "Begin with audience questions, concerns and feedback before choosing topics.",
 "A single observation is a hypothesis. A repeated theme must be traced to multiple contexts.",
 "Combine the audience's emotional motivation with a verifiable practical benefit.",
 "Use a clear relevant opening; fulfil its promise in the body. Avoid claims without evidence.",
 "Develop a few strong ideas and choose a conclusion or one appropriate call to action.",
 "Use a recurring format only when audience signals and brand identity support it.",
 "Adapt Instagram concepts for LinkedIn's professional context rather than copying unchanged.",
 "Do not propose videos or reels."
].join("\n");
export const STATIC_FORMATS={
 instagram:{width:1080,height:1350,ratio:"4:5",previewCrop:"3:4",safePadding:0.075},
 linkedin:{width:1920,height:1080,ratio:"16:9",previewCrop:"16:9",safePadding:0.065}
} as const;
