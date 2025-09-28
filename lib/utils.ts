/**
 * Splits a large text into smaller chunks of a specified size, with overlap.
 * This is crucial for ensuring the text fits into the embedding model's context window.
 * @param text The text to split.
 * @param chunkSize The maximum size of each chunk.
 * @param chunkOverlap The number of characters to overlap between chunks.
 * @returns An array of text chunks.
 */
export function chunkText(text: string, chunkSize = 1000, chunkOverlap = 200): string[] {
    const chunks: string[] = [];
    let i = 0;
    while (i < text.length) {
        chunks.push(text.slice(i, i + chunkSize));
        i += chunkSize - chunkOverlap;
    }
    return chunks;
}