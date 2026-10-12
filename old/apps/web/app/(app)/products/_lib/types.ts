/** Result of a catalog server action, shown with aria-live. */
export type ActionResult = {
  ok?: boolean;
  error?: string;
  message?: string;
  /** A field of the product was saved (shows the “edited an approved product” banner). */
  edited?: boolean;
};
