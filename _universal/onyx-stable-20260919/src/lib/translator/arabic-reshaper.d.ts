declare module "arabic-reshaper" {
  const reshaper: {
    /** Shape Arabic text into Unicode Presentation Forms (for LTR-only renderers). */
    convertArabic(text: string): string;
    /** Convert Presentation Forms back to the base Arabic block. */
    convertArabicBack(text: string): string;
  };
  export default reshaper;
}
