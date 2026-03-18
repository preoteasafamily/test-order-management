/**
 * PDF Font Loader – ensures DejaVu Sans (Unicode-capable) is registered with jsPDF.
 *
 * DejaVu Sans supports all Romanian diacritics (ț, ș, ă, â, î) unlike the built-in
 * Helvetica/WinAnsiEncoding fonts that drop or mangle characters above U+00FF.
 *
 * Usage:
 *   import { initPdfFonts, registerFontsOnDoc } from '../utils/pdfFonts';
 *   // Call once at app or component mount:
 *   initPdfFonts();
 *   // Before generating a PDF:
 *   const doc = new jsPDF(...);
 *   registerFontsOnDoc(doc);  // sync – uses cached data if already loaded
 *   doc.setFont('DejaVuSans', 'normal');
 */

// Module-level cache – loaded once, reused for every PDF
let fontCache = null;       // { regular: base64string, bold: base64string }
let loadPromise = null;     // shared promise to avoid parallel fetches

/**
 * Fetch a font file and return its content as a base64 string.
 * @param {string} url
 * @returns {Promise<string>}
 */
const fetchAsBase64 = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch font: ${url} (${response.status})`);
  const buffer = await response.arrayBuffer();
  // Convert ArrayBuffer → binary string → base64
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

/**
 * Pre-fetch both font variants and store them in the module cache.
 * Safe to call multiple times – subsequent calls reuse the same promise.
 * @returns {Promise<void>}
 */
export const initPdfFonts = () => {
  if (fontCache || loadPromise) return loadPromise || Promise.resolve();
  loadPromise = Promise.all([
    fetchAsBase64('/fonts/DejaVuSans.ttf'),
    fetchAsBase64('/fonts/DejaVuSans-Bold.ttf'),
  ])
    .then(([regular, bold]) => {
      fontCache = { regular, bold };
    })
    .catch((err) => {
      // Non-fatal: PDF will fall back to built-in Helvetica
      console.warn('pdfFonts: could not load DejaVu fonts –', err.message);
      loadPromise = null;
    });
  return loadPromise;
};

/**
 * Register DejaVu fonts on an existing jsPDF document instance (synchronous).
 * Must be called AFTER initPdfFonts() has resolved.
 * If fonts are not yet loaded, this is a no-op (Helvetica will be used as fallback).
 *
 * @param {import('jspdf').jsPDF} doc
 */
export const registerFontsOnDoc = (doc) => {
  if (!fontCache) return;
  try {
    doc.addFileToVFS('DejaVuSans.ttf',      fontCache.regular);
    doc.addFileToVFS('DejaVuSans-Bold.ttf', fontCache.bold);
    doc.addFont('DejaVuSans.ttf',      'DejaVuSans', 'normal');
    doc.addFont('DejaVuSans-Bold.ttf', 'DejaVuSans', 'bold');
  } catch {
    // Fonts may already be registered on this doc instance – ignore duplicate errors
  }
};

/**
 * The font family name to use with doc.setFont() / autoTable styles.
 * Falls back to 'helvetica' when DejaVu is not loaded.
 */
export const PDF_FONT = () => (fontCache ? 'DejaVuSans' : 'helvetica');
