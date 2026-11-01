/** A name safe for a downloaded file: letters, digits, dot and dash; other runs become '_'. */
export const safeFileName = (s: string) =>
  s
    .trim()
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '');
