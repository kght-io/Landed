// What a person may attach to a company's prep chat.
//
// One list, two consumers: the server ENFORCES it (backend/src/prep/uploads.ts) and the file picker
// OFFERS it (frontend/components/prep/PrepChat.tsx). Kept here rather than mirrored on both sides so
// the picker can't drift into offering a type the upload then rejects — the same reason
// TRANSCRIPT_ACCEPT lives beside its importer in ./transcript-import.
//
// The set is bounded by what the agent's Read tool can actually make sense of: images, PDFs, and
// plain text. Anything else would be dead weight in the folder — accepting it would only teach the
// user it works.
export const UPLOAD_IMAGE_EXT = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic"] as const;
export const UPLOAD_ACCEPT = [...UPLOAD_IMAGE_EXT, ".pdf", ".md", ".txt", ".csv", ".json"] as const;

// Whether a stored attachment is an image — drives which icon its chip gets. Reads the same list, so
// adding a format in one place is enough.
export const isImageAttachment = (name: string): boolean => {
  const lower = name.toLowerCase();
  return UPLOAD_IMAGE_EXT.some((ext) => lower.endsWith(ext));
};
