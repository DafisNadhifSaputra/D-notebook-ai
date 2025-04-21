import * as pdfjs from 'pdfjs-dist';

// Mengatur worker untuk PDF.js dengan cara yang benar
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

/**
 * Ekstrak teks dari file PDF dengan penanganan khusus untuk konten matematis
 * @param {File} file - File PDF yang akan diproses
 * @returns {Promise<{text: string, pages: number, containsEquations: boolean}>} - Hasil ekstraksi teks dengan metadata
 */
export const extractTextFromPdf = async (file) => {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    
    let fullText = '';
    let pageCount = pdf.numPages;
    let containsEquations = false;
    let mathConfidence = 0;
    
    // Add document metadata header to help with RAG context
    fullText += `# ${file.name}\n`;
    fullText += `Pages: ${pageCount}\n\n`;
    
    // Ekstrak teks dari setiap halaman PDF
    for (let i = 1; i <= pageCount; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      
      // Start each page with a clear marker for better context
      fullText += `## Page ${i}\n\n`;
      
      // Join text items while preserving some layout information
      let lastY;
      let textItems = [];
      let lineBuffer = [];
      
      textContent.items.forEach((item) => {
        // Check if we're starting a new line
        if (lastY !== undefined && Math.abs(lastY - item.transform[5]) > 5) {
          // Process the current line before adding a new line break
          if (lineBuffer.length > 0) {
            const line = lineBuffer.join(' ');
            
            // Special handling for math content - look for equation markers
            if (detectMathContent(line)) {
              textItems.push(`\n${line}\n`);
              mathConfidence += 1;
              containsEquations = true;
            } else {
              textItems.push(line);
            }
            lineBuffer = [];
          }
          textItems.push('\n');
        }
        
        lineBuffer.push(item.str);
        lastY = item.transform[5];
      });
      
      // Process any remaining text in the buffer
      if (lineBuffer.length > 0) {
        const line = lineBuffer.join(' ');
        if (detectMathContent(line)) {
          textItems.push(`\n${line}\n`);
          mathConfidence += 1;
          containsEquations = true;
        } else {
          textItems.push(line);
        }
      }
      
      const pageText = textItems.join(' ');
      fullText += pageText + '\n\n';
      
      // Look for potential mathematical notation patterns
      const hasMathPatterns = /(\$|\\\(|\\\[|\\begin\{equation\}|\\frac|\\sum|\\int|\\lim|\\nabla|\\partial)/.test(pageText);
      
      // Update the containsEquations flag if we find math patterns
      if (hasMathPatterns) {
        containsEquations = true;
        mathConfidence += 2;
        fullText += "Note: This page appears to contain mathematical equations.\n\n";
      }
      
      // Check for common physics/math terms that indicate equations
      const mathPhysicsTerms = /\b(equation|persamaan|differential|formula|theorem|lemma|gelombang|wave|poisson|laplace|newton|maxwell|euler|gauss|eigenvalue|eigenvector)\b/i;
      if (mathPhysicsTerms.test(pageText)) {
        containsEquations = true;
        mathConfidence += 1;
        fullText += `This page contains mathematical/physics terminology that may reference equations.\n\n`;
      }
    }
    
    return {
      text: fullText,
      pages: pageCount,
      containsEquations: containsEquations,
      mathConfidence: mathConfidence
    };
  } catch (error) {
    console.error('Error extracting text from PDF:', error);
    throw new Error('Failed to extract text from PDF');
  }
};

/**
 * Helper function to detect math content in a line of text
 * @param {string} line - The line to check for math content
 * @returns {boolean} - True if the line likely contains math content
 */
const detectMathContent = (line) => {
  // Check for LaTeX-like math markers
  if (/(\$|\\\(|\\\[|\\begin\{)/.test(line)) return true;

  // Check for mathematical symbols
  if (/[∫∬∭∮∯∰∇∆∂∏∑√∛∜≈≠≤≥±×÷]/.test(line)) return true;

  // Check for equation-like structure (multiple symbols with numbers)
  if (/[a-zA-Z][_^][0-9].*[=<>].*[a-zA-Z0-9+\-*/]/.test(line)) return true;
  
  // Check for fraction-like structure
  if (/\b[a-zA-Z0-9]+\/[a-zA-Z0-9]+\b/.test(line) && 
      /[+\-=]/.test(line)) return true;
  
  return false;
};

/**
 * Get text from PDF file - wrapper function used by RAG system
 * @param {File} file - The PDF file to process
 * @returns {Promise<{text: string, pageCount: number}>} - Text contents and metadata
 */
export const getPdfText = async (file) => {
  try {
    const { text, pages: pageCount, containsEquations, mathConfidence } = await extractTextFromPdf(file);
    return { 
      text, 
      pageCount, 
      containsEquations,
      mathConfidence: mathConfidence || 0
    };
  } catch (error) {
    console.error('Error in getPdfText:', error);
    throw new Error('Failed to extract text from PDF');
  }
};

/**
 * Memproses beberapa file PDF secara bersamaan dengan batasan jumlah dan optimasi untuk dokumen matematis
 * @param {File[]} files - Array file PDF
 * @param {number} maxFiles - Maksimum jumlah file yang akan diproses
 * @returns {Promise<Array<{name: string, text: string, pages: number, containsEquations: boolean}>>} - Array objek yang berisi nama file dan metadata
 */
export const processPdfFiles = async (files, maxFiles = 15) => {
  try {
    // Apply file limit
    const filesToProcess = files.slice(0, maxFiles);
    
    if (files.length > maxFiles) {
      console.warn(`Only processing first ${maxFiles} of ${files.length} files`);
    }
    
    // Process files sequentially to avoid memory issues
    const results = [];
    
    for (const file of filesToProcess) {
      console.log(`Processing PDF: ${file.name} (${Math.round(file.size / 1024)} KB)`);
      
      try {
        const { text, pages, containsEquations, mathConfidence } = await extractTextFromPdf(file);
        
        results.push({
          name: file.name,
          text,
          size: file.size,
          pages,
          containsEquations,
          mathConfidence: mathConfidence || 0,
          processingDate: new Date().toISOString()
        });
        
        // Add a small delay between processing files to prevent CPU overload
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (fileError) {
        console.error(`Error processing file ${file.name}:`, fileError);
        // Continue processing other files even if one fails
      }
    }
    
    console.log(`Successfully processed ${results.length} PDF files`);
    return results;
  } catch (error) {
    console.error('Error processing PDF files:', error);
    throw new Error('Failed to process PDF files');
  }
};