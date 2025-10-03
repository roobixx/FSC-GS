// Image reception and processing for TEMPEST Ground Station
// Handles SEND packet image data, reconstruction, and retransmission requests

// Global variables for image processing
let imageReceptions = new Map(); // Track ongoing image receptions
let imagePacketBuffer = new Map(); // Store received packets per image
let imageMetadata = new Map(); // Store image metadata
let currentImageFilename = null; // Track the current image filename being sent

// Configuration
const IMAGE_TIMEOUT = 30000; // 30 seconds timeout for incomplete images
const MAX_RETRANSMIT_ATTEMPTS = 3; // Maximum automatic retransmission attempts
const MAX_RETRANSMIT_PACKETS_PER_REQUEST = 30; // Maximum packets to request in one command
const MAX_COMMAND_SIZE = 60; // Maximum command size in bytes

// ============================================================================
// Image Packet Processing
// ============================================================================

/**
 * Process incoming SEND packet containing image data
 * Packet format: SEND[base64_data][4-digit total][4-digit current]
 * @param {Uint8Array} packet - SEND packet of variable length
 */
function processImagePacket(packet) {
    try {
        // Convert packet to string
        let packetStr = new TextDecoder().decode(packet);
        
        // Validate SEND/RETX header
        const identifier = packetStr.substring(0, 4);
        if (identifier !== 'SEND' && identifier !== 'RETX') {
            logToTerminal('Packet does not start with SEND/RETX identifier', 'warning');
            return;
        }
        
        // Find the position where digits end (after the 8-digit metadata)
        // Find the last position that could be valid packet data
        let validEnd = packetStr.length;
        for (let i = packetStr.length - 1; i >= 4; i--) {
            const char = packetStr[i];
            if (!/[A-Za-z0-9\/+=]/.test(char)) {
                validEnd = i;
            } else {
                // Found a valid character, stop here
                break;
            }
        }
        
        // Check if this looks like a command response (no valid base64 + metadata structure)
        // Command responses are short and don't have the 8-digit metadata pattern
        
        // First, check if packet is too short to even contain metadata
        if (validEnd <= 12) {
            // Definitely a command response - too short for base64 + metadata
            const response = packetStr.slice(4, validEnd).trim();
            if (response.length > 0) {
                logToTerminal(response, 'response');
            }
            return;
        }
        
        const potentialMetadata = packetStr.slice(validEnd - 8, validEnd);
        const hasValidMetadata = /^\d{8}$/.test(potentialMetadata);
        
        if (!hasValidMetadata) {
            // No valid metadata - this is a command response
            const response = packetStr.slice(4, validEnd).trim();
            if (response.length > 0) {
                logToTerminal(response, 'response');
            }
            return;
        }
        
        // Now extract 8 digits from the end of the valid portion
        // The metadata should be the last 8 characters of valid data
        if (validEnd < 13) {
            logToTerminal('SEND packet too short for valid data', 'warning');
            return;
        }
        
        // Extract just the metadata (last 8 chars of valid packet)
        const metadataStart = validEnd - 8;
        const totalChunksStr = packetStr.slice(metadataStart, metadataStart + 4);
        const currentChunkStr = packetStr.slice(metadataStart + 4, metadataStart + 8);
        
        const totalChunks = parseInt(totalChunksStr, 10);
        const currentChunk = parseInt(currentChunkStr, 10);
        
        // Validate metadata
        if (isNaN(totalChunks) || isNaN(currentChunk) || totalChunks <= 0 || currentChunk < 0) {
            // Invalid metadata - display as unknown/malformed packet
            const content = packetStr.slice(4, validEnd).trim();
            if (content.length > 0) {
                logToTerminal(content, 'response');
            }
            return;
        }
        
        if (currentChunk >= totalChunks) {
            // Invalid chunk number - display as unknown/malformed packet
            const content = packetStr.slice(4, validEnd).trim();
            if (content.length > 0) {
                logToTerminal(content, 'response');
            }
            return;
        }
        
        // Extract base64 data (between SEND header and metadata)
        const chunkData = packetStr.slice(4, metadataStart);
        
        if (chunkData.length === 0) {
            logToTerminal('Empty chunk data in SEND packet', 'warning');
            return;
        }
        
        // Generate image ID based on total chunks
        const imageId = `img_${totalChunks}`;
        
        // Initialize image reception if first packet or find existing reception
        let actualImageId = findOrCreateImageReception(imageId, totalChunks, currentChunk);
        
        const imageInfo = imageReceptions.get(actualImageId);
        const packetBuffer = imagePacketBuffer.get(actualImageId);
        
        // Check for duplicate packets
        if (imageInfo.receivedChunks.has(currentChunk)) {
            return; // Silent duplicate, don't log
        }
        
        // Store the packet
        packetBuffer.set(currentChunk, chunkData);
        imageInfo.receivedChunks.add(currentChunk);
        imageInfo.lastPacketTime = Date.now();
        
        // Update progress every 50 chunks or on first/last chunk
        if (currentChunk % 50 === 0 || currentChunk === 0 || currentChunk === totalChunks - 1) {
            const progress = (imageInfo.receivedChunks.size / imageInfo.totalChunks * 100).toFixed(1);
            logToTerminal(`Image ${actualImageId}: ${progress}% (${imageInfo.receivedChunks.size}/${totalChunks})`, 'response');
        }
        
        // Check if image is complete
        if (imageInfo.receivedChunks.size === imageInfo.totalChunks) {
            completeImageReception(actualImageId);
        }
        
    } catch (error) {
        logToTerminal(`Error processing image packet: ${error.message}`, 'error');
    }
}

/**
 * Find existing image reception or create new one
 * @param {string} imageId - Proposed image ID
 * @param {number} totalChunks - Total number of chunks
 * @param {number} currentChunk - Current chunk number
 * @returns {string} - Actual image ID to use
 */
function findOrCreateImageReception(imageId, totalChunks, currentChunk) {
    // Look for existing reception with same total chunks
    for (const [existingId, imageInfo] of imageReceptions.entries()) {
        if (imageInfo.totalChunks === totalChunks) {
            return existingId;
        }
    }
    
    // Create new reception
    const actualImageId = currentChunk === 0 ? imageId : `img_${totalChunks}_${Date.now()}`;
    
    imageReceptions.set(actualImageId, {
        totalChunks: totalChunks,
        receivedChunks: new Set(),
        startTime: Date.now(),
        lastPacketTime: Date.now(),
        retransmitAttempts: 0,
        filename: currentImageFilename || `image_${totalChunks}.jpg.gz` // Store filename
    });
    
    imagePacketBuffer.set(actualImageId, new Map());
    
    logToTerminal(`Starting image reception: ${actualImageId} (${totalChunks} chunks expected)`, 'info');
    
    return actualImageId;
}

/**
 * Set the current image filename being transmitted
 * Should be called when SEND_IMAGE command is issued
 * @param {string} filename - Image filename
 */
function setCurrentImageFilename(filename) {
    // Append .chunked to the filename for retransmission
    currentImageFilename = filename + '.chunked';
    logToTerminal(`Expecting image: ${filename}`, 'info');
}

// ============================================================================
// Image Reconstruction and Download
// ============================================================================

/**
 * Complete image reception and create downloadable file
 * @param {string} imageId - Image identifier
 */
function completeImageReception(imageId) {
    try {
        const imageInfo = imageReceptions.get(imageId);
        const packetBuffer = imagePacketBuffer.get(imageId);
        
        if (!imageInfo || !packetBuffer) {
            logToTerminal(`Missing data for image ${imageId}`, 'error');
            return;
        }
        
        // Reconstruct the image data in correct order
        let reconstructedData = '';
        for (let i = 0; i < imageInfo.totalChunks; i++) {
            if (packetBuffer.has(i)) {
                let chunk = packetBuffer.get(i);
                
                // Remove padding (==) from all chunks except the last one
                // Base64 padding should only be at the very end of the complete string
                if (i < imageInfo.totalChunks - 1) {
                    chunk = chunk.replace(/=+$/, ''); // Remove trailing = signs
                }
                
                reconstructedData += chunk;
            } else {
                logToTerminal(`Missing chunk ${i} during reconstruction of ${imageId}`, 'error');
                return;
            }
        }
        
        // Debug: Check reconstructed data
        console.log('Reconstructed data length:', reconstructedData.length);
        console.log('First 100 chars:', reconstructedData.substring(0, 100));
        console.log('Last 100 chars:', reconstructedData.substring(reconstructedData.length - 100));
        
        // Validate base64 format
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(reconstructedData)) {
            logToTerminal(`Invalid base64 characters detected in ${imageId}`, 'error');
            console.log('Invalid characters found in reconstructed data');
            
            // Find and log invalid characters
            for (let i = 0; i < reconstructedData.length; i++) {
                const char = reconstructedData[i];
                if (!/[A-Za-z0-9+/=]/.test(char)) {
                    console.log(`Invalid char at position ${i}: '${char}' (code: ${char.charCodeAt(0)})`);
                    if (i > 50) break; // Only show first 50 invalid chars
                }
            }
            return;
        }
        
        // Decode base64 data
        try {
            const binaryData = atob(reconstructedData);
            const bytes = new Uint8Array(binaryData.length);
            for (let i = 0; i < binaryData.length; i++) {
                bytes[i] = binaryData.charCodeAt(i);
            }
            
            // Debug: Check gzip header (first 10 bytes)
            console.log('Binary data length:', bytes.length);
            console.log('First 20 bytes:', Array.from(bytes.slice(0, 20)).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '));
            console.log('Expected gzip header: 0x1f 0x8b 0x08...');
            
            // Validate gzip magic number
            if (bytes.length < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
                logToTerminal(`Warning: File doesn't start with gzip magic number (0x1f 0x8b)`, 'warning');
                console.log('Actual start:', bytes[0].toString(16), bytes[1].toString(16));
            }
            
            // Decompress gzip and create both compressed and decompressed download links
            try {
                // Use browser's DecompressionStream API to decompress gzip
                const decompressedStream = new Response(
                    new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
                );
                
                decompressedStream.arrayBuffer().then(decompressedData => {
                    const decompressedBytes = new Uint8Array(decompressedData);
                    
                    // Create download link for decompressed JPG
                    const jpgBlob = new Blob([decompressedBytes], { type: 'image/jpeg' });
                    const jpgUrl = URL.createObjectURL(jpgBlob);
                    
                    const jpgLink = document.createElement('a');
                    jpgLink.href = jpgUrl;
                    jpgLink.download = `received_${imageId}_${Date.now()}.jpg`;
                    jpgLink.textContent = `Download JPG`;
                    jpgLink.className = 'btn btn-primary';
                    jpgLink.style.margin = '5px';
                    jpgLink.style.fontSize = '12px';
                    jpgLink.style.padding = '6px 12px';
                    
                    // Also create link for original .gz file
                    const gzBlob = new Blob([bytes], { type: 'application/gzip' });
                    const gzUrl = URL.createObjectURL(gzBlob);
                    
                    const gzLink = document.createElement('a');
                    gzLink.href = gzUrl;
                    gzLink.download = `received_${imageId}_${Date.now()}.jpg.gz`;
                    gzLink.textContent = `Download GZ`;
                    gzLink.className = 'btn btn-secondary';
                    gzLink.style.margin = '5px';
                    gzLink.style.fontSize = '12px';
                    gzLink.style.padding = '6px 12px';
                    
                    const duration = ((Date.now() - imageInfo.startTime) / 1000).toFixed(1);
                    const gzSizeKB = (bytes.length / 1024).toFixed(1);
                    const jpgSizeKB = (decompressedBytes.length / 1024).toFixed(1);
                    
                    logToTerminal(`Image ${imageId} completed! (${duration}s, ${jpgSizeKB} KB decompressed, ${gzSizeKB} KB compressed)`, 'response');
                    
                    // Add download links to terminal
                    const terminal = document.getElementById('terminal');
                    if (terminal) {
                        const downloadDiv = document.createElement('div');
                        downloadDiv.className = 'terminal-line response';
                        downloadDiv.appendChild(jpgLink);
                        downloadDiv.appendChild(gzLink);
                        terminal.appendChild(downloadDiv);
                        terminal.scrollTop = terminal.scrollHeight;
                    }
                    
                    // Clean up
                    imageReceptions.delete(imageId);
                    imagePacketBuffer.delete(imageId);
                    
                    logToTerminal(`Image reception cleanup completed for ${imageId}`, 'info');
                });
                
            } catch (decompressError) {
                logToTerminal(`Failed to decompress gzip: ${decompressError.message}`, 'warning');
                
                // Fallback: just provide the .gz file
                const blob = new Blob([bytes], { type: 'application/gzip' });
                const url = URL.createObjectURL(blob);
                
                const downloadLink = document.createElement('a');
                downloadLink.href = url;
                downloadLink.download = `received_${imageId}_${Date.now()}.jpg.gz`;
                downloadLink.textContent = `Download GZ (decompression failed)`;
                downloadLink.className = 'btn btn-secondary';
                downloadLink.style.margin = '5px';
                downloadLink.style.fontSize = '12px';
                downloadLink.style.padding = '6px 12px';
                
                const duration = ((Date.now() - imageInfo.startTime) / 1000).toFixed(1);
                const sizeKB = (bytes.length / 1024).toFixed(1);
                
                logToTerminal(`Image ${imageId} completed! (${duration}s, ${sizeKB} KB)`, 'response');
                
                const terminal = document.getElementById('terminal');
                if (terminal) {
                    const downloadDiv = document.createElement('div');
                    downloadDiv.className = 'terminal-line response';
                    downloadDiv.appendChild(downloadLink);
                    terminal.appendChild(downloadDiv);
                    terminal.scrollTop = terminal.scrollHeight;
                }
            }
            
        } catch (decodeError) {
            logToTerminal(`Failed to decode image ${imageId}: ${decodeError.message}`, 'error');
            console.error('Base64 decode error:', decodeError);
            console.log('Problematic data sample:', reconstructedData.substring(0, 200));
        }
        
    } catch (error) {
        logToTerminal(`Error completing image reception: ${error.message}`, 'error');
        console.error('Completion error:', error);
    }
}

// ============================================================================
// Missing Packet Detection and Retransmission
// ============================================================================

/**
 * Check for missing packets in an image reception
 * @param {string} imageId - Image identifier
 * @returns {number[]} - Array of missing packet numbers
 */
function checkMissingPackets(imageId) {
    const imageInfo = imageReceptions.get(imageId);
    if (!imageInfo) {
        logToTerminal(`No image reception found for ${imageId}`, 'warning');
        return [];
    }
    
    const missing = [];
    for (let i = 0; i < imageInfo.totalChunks; i++) {
        if (!imageInfo.receivedChunks.has(i)) {
            missing.push(i);
        }
    }
    
    if (missing.length > 0) {
        logToTerminal(`Missing ${missing.length} packets for ${imageId}: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? '...' : ''}`, 'warning');
    }
    
    return missing;
}

/**
 * Request retransmission of missing packets
 * @param {string} imageId - Image identifier
 * @param {number[]|null} missingPackets - Specific packets to retransmit, or null for auto-detect
 */
async function requestRetransmission(imageId, missingPackets = null) {
    if (!writer) {
        logToTerminal('Not connected to satellite', 'error');
        return;
    }
    
    try {
        let missing = missingPackets;
        if (!missing) {
            missing = checkMissingPackets(imageId);
        }
        
        if (missing.length === 0) {
            logToTerminal(`No missing packets for ${imageId}`, 'info');
            return;
        }
        
        const imageInfo = imageReceptions.get(imageId);
        if (imageInfo) {
            imageInfo.retransmitAttempts++;
            
            if (imageInfo.retransmitAttempts > MAX_RETRANSMIT_ATTEMPTS) {
                logToTerminal(`Maximum retransmit attempts reached for ${imageId}`, 'warning');
                return;
            }
        }
        
        // Get the actual filename from image info (already has .chunked appended)
        const filename = imageInfo?.filename || `image_${imageId.replace('img_', '')}.jpg.gz.chunked`;
        
        // Split missing packets into chunks if there are too many
        // Calculate how many packets we can safely fit in one command (60 byte limit)
        const baseCommand = `RETRANSMIT ${filename} `;
        const bytesAvailable = MAX_COMMAND_SIZE - baseCommand.length - 1; // -1 for newline
        
        // Calculate max packets that fit in available bytes
        // Worst case: 4 digits + space = 5 bytes per packet
        const avgBytesPerPacket = 5;
        const maxPacketsPerCommand = Math.max(1, Math.floor(bytesAvailable / avgBytesPerPacket));
        
        if (maxPacketsPerCommand < 1) {
            logToTerminal(`ERROR: Filename too long for retransmit command (${filename.length} bytes)`, 'error');
            return;
        }
        
        logToTerminal(`Requesting ${missing.length} packets in batches of ${maxPacketsPerCommand} (${MAX_COMMAND_SIZE}B limit)`, 'info');
        
        for (let i = 0; i < missing.length; i += maxPacketsPerCommand) {
            const chunk = missing.slice(i, Math.min(i + maxPacketsPerCommand, missing.length));
            const command = `RETRANSMIT ${filename} ${chunk.join(' ')}`; // Use space separator
            
            // Safety check: verify command isn't too long
            if (command.length > MAX_COMMAND_SIZE - 1) {
                // Try with fewer packets
                const safePacketCount = Math.max(1, Math.floor(chunk.length / 2));
                const safeChunk = chunk.slice(0, safePacketCount);
                const safeCommand = `RETRANSMIT ${filename} ${safeChunk.join(' ')}`;
                
                logToTerminal(`Command too long (${command.length}B), reduced to ${safePacketCount} packets`, 'warning');
                
                if (safeCommand.length > MAX_COMMAND_SIZE - 1) {
                    logToTerminal(`ERROR: Cannot fit retransmit command in ${MAX_COMMAND_SIZE}B limit`, 'error');
                    continue;
                }
                
                const encoder = new TextEncoder();
                await writer.write(encoder.encode(safeCommand + '\n'));
                blinkLED('rfm95TxLed');
                
                // Add remaining packets back to queue for next iteration
                i -= maxPacketsPerCommand; // Reset position
                i += safePacketCount; // Advance by what we sent
                
                await new Promise(resolve => setTimeout(resolve, 2000));
                continue;
            }
            
            const isLastChunk = (i + maxPacketsPerCommand >= missing.length);
            const totalBatches = Math.ceil(missing.length / maxPacketsPerCommand);
            const currentBatch = Math.floor(i / maxPacketsPerCommand) + 1;
            const chunkInfo = totalBatches > 1 ? ` (batch ${currentBatch}/${totalBatches})` : '';
            
            logToTerminal(`Retransmit${chunkInfo}: ${chunk.length} packets [${command.length}B]`, 'command');
            blinkLED('rfm95TxLed');
            
            const encoder = new TextEncoder();
            await writer.write(encoder.encode(command + '\n'));
            
            // Wait between batch requests to avoid overwhelming the system
            if (!isLastChunk) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        
        logToTerminal(`Retransmission request complete (attempt ${imageInfo?.retransmitAttempts || 1})`, 'info');
        
    } catch (error) {
        logToTerminal(`Retransmission request error: ${error.message}`, 'error');
    }
}

// ============================================================================
// Image Management Functions
// ============================================================================

/**
 * Show active image receptions and their status
 */
function showActiveImages() {
    if (imageReceptions.size === 0) {
        logToTerminal('No active image receptions', 'info');
        return;
    }
    
    logToTerminal('Active Image Receptions:', 'info');
    for (const [imageId, imageInfo] of imageReceptions.entries()) {
        const progress = (imageInfo.receivedChunks.size / imageInfo.totalChunks * 100).toFixed(1);
        const missing = checkMissingPackets(imageId);
        const elapsed = ((Date.now() - imageInfo.startTime) / 1000).toFixed(1);
        
        logToTerminal(`  ${imageId}: ${progress}% complete, ${missing.length} missing, ${elapsed}s elapsed`, 'info');
        
        if (missing.length > 0 && missing.length <= 20) {
            logToTerminal(`    Missing: ${missing.join(', ')}`, 'info');
        } else if (missing.length > 20) {
            logToTerminal(`    Missing: ${missing.slice(0, 20).join(', ')}... (+${missing.length - 20} more)`, 'info');
        }
    }
}

/**
 * Clear all image reception buffers
 */
function clearImageBuffers() {
    const count = imageReceptions.size;
    
    // Clean up any blob URLs to prevent memory leaks
    imageReceptions.clear();
    imagePacketBuffer.clear();
    imageMetadata.clear();
    
    logToTerminal(`Cleared ${count} image reception buffers`, 'info');
}

/**
 * Manual retransmit request from UI input
 */
function manualRetransmit() {
    const input = document.getElementById('retransmitInput');
    if (!input) {
        logToTerminal('Retransmit input field not found', 'error');
        return;
    }
    
    const value = input.value.trim();
    if (!value) {
        logToTerminal('Please enter retransmit command (e.g., image.jpg.gz 1,5,10)', 'warning');
        return;
    }
    
    // Send raw retransmit command
    sendCommand(`RETRANSMIT ${value}`);
    input.value = '';
}

// ============================================================================
// Timeout and Cleanup Management
// ============================================================================

/**
 * Start periodic checker for image timeouts and automatic retransmissions
 */
function startImageTimeoutChecker() {
    setInterval(() => {
        const now = Date.now();
        
        for (const [imageId, imageInfo] of imageReceptions.entries()) {
            const timeSinceLastPacket = now - imageInfo.lastPacketTime;
            
            if (timeSinceLastPacket > IMAGE_TIMEOUT) {
                const missing = checkMissingPackets(imageId);
                
                if (missing.length > 0) {
                    const progress = (imageInfo.receivedChunks.size / imageInfo.totalChunks * 100).toFixed(1);
                    logToTerminal(`Image ${imageId} timeout: ${progress}% complete, ${missing.length} packets missing`, 'warning');
                    
                    // Show missing packet numbers
                    if (missing.length <= 50) {
                        logToTerminal(`  Missing packets: ${missing.join(', ')}`, 'info');
                    } else {
                        logToTerminal(`  Missing packets: ${missing.slice(0, 50).join(', ')}... (+${missing.length - 50} more)`, 'info');
                    }
                    
                    // Show retransmit command example
                    const filename = imageInfo.filename || `image_${imageId.replace('img_', '')}.jpg.gz.chunked`;
                    const examplePackets = missing.slice(0, 4).join(' ');
                    logToTerminal(`  Use manual retransmit: RETRANSMIT ${filename} ${examplePackets}`, 'info');
                    
                    // Reset timeout so we don't spam the log
                    imageInfo.lastPacketTime = now;
                }
            }
        }
    }, 10000); // Check every 10 seconds
}

// ============================================================================
// Statistics and Monitoring
// ============================================================================

/**
 * Get image reception statistics
 * @returns {Object} - Statistics object
 */
function getImageStats() {
    let totalReceptions = 0;
    let totalPackets = 0;
    let receivedPackets = 0;
    let completedImages = 0;
    
    for (const [imageId, imageInfo] of imageReceptions.entries()) {
        totalReceptions++;
        totalPackets += imageInfo.totalChunks;
        receivedPackets += imageInfo.receivedChunks.size;
        
        if (imageInfo.receivedChunks.size === imageInfo.totalChunks) {
            completedImages++;
        }
    }
    
    return {
        activeReceptions: totalReceptions,
        completedImages,
        totalPacketsExpected: totalPackets,
        totalPacketsReceived: receivedPackets,
        completionRate: totalPackets > 0 ? ((receivedPackets / totalPackets) * 100).toFixed(1) + '%' : 'N/A'
    };
}

/**
 * Update image progress display (if UI elements exist)
 * @param {string} imageId - Image identifier
 * @param {number} progress - Progress percentage
 */
function updateImageProgress(imageId, progress) {
    const statusDiv = document.getElementById(`${imageId}_status`);
    if (statusDiv) {
        statusDiv.textContent = `${progress}% complete`;
    }
}

// ============================================================================
// Error Recovery and Validation
// ============================================================================

/**
 * Validate image reception data integrity
 * @param {string} imageId - Image identifier
 * @returns {boolean} - True if data appears valid
 */
function validateImageData(imageId) {
    const imageInfo = imageReceptions.get(imageId);
    const packetBuffer = imagePacketBuffer.get(imageId);
    
    if (!imageInfo || !packetBuffer) {
        return false;
    }
    
    // Check if all expected packets are present
    for (let i = 0; i < imageInfo.totalChunks; i++) {
        if (!packetBuffer.has(i)) {
            logToTerminal(`Missing chunk ${i} in ${imageId}`, 'warning');
            return false;
        }
    }
    
    // Basic base64 validation on first chunk
    const firstChunk = packetBuffer.get(0);
    if (firstChunk && !isValidBase64(firstChunk.substring(0, Math.min(100, firstChunk.length)))) {
        logToTerminal(`Invalid base64 data detected in ${imageId}`, 'warning');
        return false;
    }
    
    return true;
}

/**
 * Check if string contains valid base64 data
 * @param {string} str - String to validate
 * @returns {boolean} - True if valid base64
 */
function isValidBase64(str) {
    try {
        return btoa(atob(str)) === str;
    } catch (err) {
        return false;
    }
}

// ============================================================================
// Export functions for debugging (development only)
// ============================================================================

window.imageDebug = {
    getImageStats,
    showActiveImages,
    clearImageBuffers,
    validateImageData,
    getCurrentReceptions: () => Array.from(imageReceptions.keys()),
    getReceptionInfo: (imageId) => imageReceptions.get(imageId),
    forceComplete: (imageId) => completeImageReception(imageId)
};