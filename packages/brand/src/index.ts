// Public API of @forgecy/brand. Other modules read the published version through
// read.ts (getPublishedBrandIdentity, loadBrandContext) and propose changes through
// proposeChange; they never write versions directly.
export * from "./document";
export * from "./tokens";
export * from "./fields";
export * from "./json-patch";
export * from "./proposals";
export * from "./checks";
export * from "./diff";
export * from "./context";
export * from "./read";
export * from "./completeness";
// Not here: reference-images.ts and import/images.ts load sharp (native); the worker side
// imports them by subpath, so this entry stays safe for the web app (like @forgecy/audit's).
// Explicit list: service.ts also holds transaction-level internals (openDraft, lockOpenDraft,
// acceptOne, publishDraft, restoreDraft, updateSourceStatus...) that stay inside this package.
export {
  acceptProposal,
  acceptProposals,
  addSource,
  approveAndPublish,
  CHANGELOG_MIN,
  conflictsFor,
  ensureDraft,
  findOrCreateSocialSource,
  findOrCreateWebsiteSource,
  isSelfApproval,
  normalizeHumanEdit,
  proposeChange,
  rejectProposals,
  removeSource,
  restoreAsDraft,
  returnToDraft,
  saveDraftSection,
  saveDraftTokens,
  SELF_APPROVAL_NOTE_MIN,
  submitForReview,
  type AcceptInput,
  type AcceptResult,
  type AddSourceInput,
  type ProposalRow,
  type ProposeInput,
  type PublishInput,
  type PublishResult,
  type SaveSectionInput,
  type SourceRow,
  type VersionRow,
} from "./service";
export {
  applyImport,
  isHandEdited,
  latestAutoImport,
  undoImport,
  type AutoImportInput,
  type AutoImportResult,
  type LatestAutoImport,
  type Provenance,
} from "./auto-import";
export * from "./jobs";
export { detectImportFile, type DetectResult, type ImportFileType } from "./import/detect";
export type { ImportResult } from "./import/run";
export { newItemId } from "./ids";
export { linkSourceReader } from "./social-url";
