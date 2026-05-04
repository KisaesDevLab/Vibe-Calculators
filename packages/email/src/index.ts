export const EMAIL_PACKAGE = "@vibe-calc/email" as const;

export * from "./types.js";
export * from "./factory.js";
export { SmtpProvider, type SmtpConfig } from "./smtp.js";
export { PostmarkProvider, type PostmarkConfig } from "./postmark.js";
export { EmailItProvider, type EmailItConfig } from "./emailit.js";
