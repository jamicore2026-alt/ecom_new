declare module 'arabic-reshaper' {
  const ArabicReshaper: {
    /** Convert logical-order Arabic text to shaped presentation forms. */
    convertArabic(text: string): string
    /** Reverse of convertArabic (presentation forms → logical order). */
    convertArabicBack(text: string): string
  }
  export default ArabicReshaper
}
