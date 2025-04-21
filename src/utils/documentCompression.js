/**
 * Utilitas untuk kompresi dan optimasi dokumen
 * Digunakan untuk mengurangi ukuran penyimpanan dan meningkatkan performa RAG
 */

/**
 * Kompresi sederhana untuk teks dokumen dengan menghapus whitespace berlebih
 * @param {string} text - Teks yang akan dikompresi
 * @returns {string} - Teks yang sudah dikompresi
 */
export const compressDocumentText = (text) => {
  if (!text) return '';
  
  // Replace multiple newlines with just two newlines
  let compressed = text.replace(/\n{3,}/g, '\n\n');
  
  // Replace multiple spaces with a single space
  compressed = compressed.replace(/ {2,}/g, ' ');
  
  // Preserve LaTeX notation
  const preserveLatex = (text) => {
    // Identify and preserve LaTeX blocks
    const latexBlocks = [];
    let result = text.replace(/(\$\$[\s\S]*?\$\$|\$[\s\S]*?\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\])/g, (match) => {
      const placeholder = `__LATEX_BLOCK_${latexBlocks.length}__`;
      latexBlocks.push(match);
      return placeholder;
    });
    
    // Process the rest of the text
    result = result.trim();
    
    // Restore LaTeX blocks
    latexBlocks.forEach((block, i) => {
      result = result.replace(`__LATEX_BLOCK_${i}__`, block);
    });
    
    return result;
  };
  
  return preserveLatex(compressed);
};

/**
 * Mendapatkan metrik kompresi dokumen
 * @param {string} originalText - Teks asli sebelum kompresi
 * @param {string} compressedText - Teks yang sudah dikompresi
 * @returns {Object} - Objek yang berisi metrik kompresi
 */
export const getCompressionMetrics = (originalText, compressedText) => {
  const originalSize = originalText.length;
  const compressedSize = compressedText.length;
  const compressionRatio = originalSize > 0 ? compressedSize / originalSize : 1;
  const bytesSaved = originalSize - compressedSize;
  
  return {
    originalSize,
    compressedSize,
    compressionRatio,
    bytesSaved,
    percentSaved: bytesSaved > 0 ? (bytesSaved / originalSize) * 100 : 0
  };
};

/**
 * Menentukan parameter chunking yang optimal berdasarkan konten dokumen
 * @param {string} text - Teks dokumen yang akan diproses
 * @param {boolean} containsEquations - Boolean yang menunjukkan apakah dokumen berisi persamaan matematika
 * @returns {Object} - Parameter chunking yang optimal
 */
export const getOptimalChunkParameters = (text, containsEquations) => {
  // Base values
  let chunkSize = 1000;
  let chunkOverlap = 200;
  
  // Adjust based on document length
  if (text.length > 100000) {
    chunkSize = 1500; // Larger chunks for long documents
    chunkOverlap = 300; // More overlap for better context
  } else if (text.length < 10000) {
    chunkSize = 800; // Smaller chunks for short documents
    chunkOverlap = 150; // Less overlap needed
  }
  
  // Adjust for documents with equations
  if (containsEquations) {
    chunkSize = Math.max(chunkSize, 1800); // Larger chunks to keep equations intact
    chunkOverlap = Math.max(chunkOverlap, 400); // More overlap to maintain mathematical context
  }
  
  // Check for complex technical content based on keyword density
  const techTerms = /\b(algorithm|implementation|code|function|method|theory|definition|theorem|proof|derivation|formula)\b/gi;
  const techMatches = text.match(techTerms) || [];
  const techDensity = techMatches.length / (text.length / 1000);
  
  if (techDensity > 1) {
    // More technical content requires larger chunks
    chunkSize = Math.max(chunkSize, 1400);
    chunkOverlap = Math.max(chunkOverlap, 350);
  }
  
  // Check for mathematical notation
  const mathNotation = /(\$|\\\(|\\\[|\\begin\{equation\}|\b\dx\b|\bdf\b|\bpartial\b|\bint\b|\bsum\b|\bprod\b|\blim\b|\bexp\b)/g;
  const mathMatches = text.match(mathNotation) || [];
  const mathDensity = mathMatches.length / (text.length / 1000);
  
  if (mathDensity > 0.5) {
    // Documents with math notation need special handling
    chunkSize = Math.max(chunkSize, 2000); // Even larger chunks for math
    chunkOverlap = Math.max(chunkOverlap, 600); // Much more overlap for math context
  }
  
  // Cap values to reasonable limits
  chunkSize = Math.min(chunkSize, 2500);
  chunkOverlap = Math.min(chunkOverlap, 800);
  
  return {
    chunkSize,
    chunkOverlap,
    containsEquations,
    techDensity,
    mathDensity
  };
};

/**
 * Optimize storage by calculating proper chunk sizes for better embedding
 * @param {string} text - Text content to analyze
 * @returns {Object} - Optimal token counts and chunk parameters
 */
export const optimizeForTokenLimits = (text) => {
  const avgCharPerToken = 3.5; // Average characters per token for English text
  const estimatedTokens = Math.ceil(text.length / avgCharPerToken);
  
  const recommendedChunkTokens = estimatedTokens > 10000 ? 1000 : 500;
  const recommendedChunkSize = Math.floor(recommendedChunkTokens * avgCharPerToken);
  const recommendedOverlap = Math.floor(recommendedChunkTokens * 0.1 * avgCharPerToken);
  
  return {
    estimatedTotalTokens: estimatedTokens,
    recommendedChunkTokens,
    recommendedChunkSize,
    recommendedOverlap
  };
};

/**
 * Analyze text for mathematical content and recommend format settings
 * @param {string} text - Text to analyze
 * @returns {Object} Information about mathematical content
 */
export const analyzeMathematicalContent = (text) => {
  // Check for LaTex notation
  const latexPattern = /(\$\$[\s\S]*?\$\$|\$[\s\S]*?\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\\begin\{equation\}[\s\S]*?\\end\{equation\})/g;
  const latexMatches = text.match(latexPattern) || [];
  
  // Check for common mathematical symbols and terms
  const mathSymbolPattern = /(\b\dx\b|\bdf\b|\bpartial\b|\bint\b|\bsum\b|\bprod\b|\blim\b|\bexp\b|\bln\b|\blog\b|\bsin\b|\bcos\b|\btan\b)/g;
  const mathSymbolMatches = text.match(mathSymbolPattern) || [];
  
  // Check for specific equation types
  const equationTypes = {
    differential: /\b(derivative|turunan|differential|ODE|PDE|diff eq)\b/i.test(text),
    algebra: /\b(polynomial|matrix|vector|linear algebra|eigen)\b/i.test(text),
    calculus: /\b(integral|integration|differentiation|limit|turunan|integral)\b/i.test(text),
    wave: /\b(wave equation|gelombang|persamaan gelombang)\b/i.test(text),
    poisson: /\b(poisson|laplace|laplacian)\b/i.test(text)
  };
  
  return {
    hasLatex: latexMatches.length > 0,
    latexCount: latexMatches.length,
    mathSymbolCount: mathSymbolMatches.length,
    equationTypes,
    isMathematical: (
      latexMatches.length > 0 ||
      mathSymbolMatches.length > 5 ||
      Object.values(equationTypes).some(type => type)
    ),
    recommendedFormatting: latexMatches.length > 0 ? 'preserve_latex' : 'standard',
    preserveWhitespace: latexMatches.length > 0 || mathSymbolMatches.length > 10
  };
};