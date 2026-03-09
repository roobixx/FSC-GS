// Serial communication and data processing for TEMPEST Ground Station
// Handles WebSerial connection, data parsing, and radio configuration messages

// Global variables for serial communication
let port = null;
let reader = null;
let writer = null;
let isConnected = false;
let readLoop = null;
let dataBuffer = new Uint8Array();
let configBuffer = [];
let collectingConfig = false;

// ============================================================================
// WebSerial Connection Management
// ============================================================================

/**
 * Toggle connection state (connect or disconnect)
 */
async function toggleConnection() {
    if (isConnected) {
        await disconnect();
    } else {
        await connect();
    }
}

/**
 * Establish WebSerial connection to ground station
 */
async function connect() {
    try {
        // Check for WebSerial support
        if (!('serial' in navigator)) {
            logToTerminal('WebSerial is not supported in this browser. Please use Chrome or Edge.', 'error');
            return;
        }

        // Get serial port options from settings
        const baudRate = parseInt(document.getElementById('baudRate').value);
        const dataBits = parseInt(document.getElementById('dataBits').value);
        const stopBits = parseInt(document.getElementById('stopBits').value);
        const parity = document.getElementById('parity').value;
        const flowControl = document.getElementById('flowControl').value;

        const options = {
            baudRate,
            dataBits,
            stopBits,
            parity,
            flowControl
        };

        // Request port access from user
        logToTerminal('Requesting serial port...', 'info');
        port = await navigator.serial.requestPort();
        await port.open(options);
        
        // Display port information
        const info = port.getInfo();
        document.getElementById('portInfo').textContent = 
            `VID: ${info.usbVendorId || 'N/A'}, PID: ${info.usbProductId || 'N/A'}`;
        logToTerminal(`Connected to Ground Station Port`, 'response');

        // Set up writer and reader
        writer = port.writable.getWriter();
        
        // Start reading loop
        readLoop = readFromPort();

        updateConnectionStatus(true);
        logToTerminal('Ground Station connected successfully!', 'response');

    } catch (error) {
        logToTerminal(`Connection error: ${error.message}`, 'error');
        updateConnectionStatus(false);
    }
}

/**
 * Disconnect from ground station
 */
async function disconnect() {
    try {
        // Cancel reading loop
        if (readLoop) {
            reader.cancel();
            await readLoop;
        }
        
        // Close writer
        if (writer) {
            await writer.close();
            writer = null;
        }
        
        // Close port
        if (port) {
            await port.close();
            port = null;
        }
        
        updateConnectionStatus(false);
        logToTerminal('Disconnected from Ground Station', 'info');
        
    } catch (error) {
        logToTerminal(`Disconnect error: ${error.message}`, 'error');
    }
}

/**
 * Main reading loop for incoming serial data
 */
async function readFromPort() {
    reader = port.readable.getReader();

    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            
            if (value && value.length > 0) {
                // Process received data
                processReceivedData(value);
            }
        }
    } catch (error) {
        if (error.name !== 'AbortError') {
            logToTerminal(`Read error: ${error.message}`, 'error');
        }
    } finally {
        reader.releaseLock();
    }
}

// ============================================================================
// Data Processing
// ============================================================================

/**
 * Process incoming data from serial port
 * Handles both binary packets and text messages
 * @param {Uint8Array} data - Raw data from serial port
 */
function processReceivedData(data) {
    // Append to buffer
    const newBuffer = new Uint8Array(dataBuffer.length + data.length);
    newBuffer.set(dataBuffer);
    newBuffer.set(data, dataBuffer.length);
    dataBuffer = newBuffer;

    // Process data
    while (dataBuffer.length > 0) {
        // Check for SEND packet (image data) - newline-delimited
        if (dataBuffer.length >= 5) { // Minimum: SEND(4) + 1 char
            const identifier = new TextDecoder().decode(dataBuffer.slice(0, 4)).replace(/\0/g, '').trim();

            // Handle both SEND and RETX packets (RETX are retransmitted chunks)
            if (identifier === 'SEND' || identifier === 'RETX' || identifier === 'OBCP' || identifier === 'OBCL') {
                // Find newline delimiter (all packets end with \n from radio.py)
                let newlinePos = -1;
                for (let i = 4; i < dataBuffer.length; i++) {
                    if (dataBuffer[i] === 0x0A || dataBuffer[i] === 0x0D) {
                        newlinePos = i;
                        break;
                    }
                }

                if (newlinePos > 4) {
                    // Complete packet found — process it
                    const packet = dataBuffer.slice(0, newlinePos);
                    if (identifier === 'OBCP' || identifier === 'OBCL') {
                        if (typeof unpackCommand === 'function') {
                            unpackCommand(packet);
                        }
                    } else if (typeof processImagePacket === 'function') {
                        processImagePacket(packet);
                    }

                    // Skip past newline(s)
                    dataBuffer = dataBuffer.slice(newlinePos + 1);
                    while (dataBuffer.length > 0 && (dataBuffer[0] === 0x0A || dataBuffer[0] === 0x0D)) {
                        dataBuffer = dataBuffer.slice(1);
                    }
                    blinkLED('rfm95RxLed');
                    continue;
                } else {
                    // No newline yet — wait for more data
                    break;
                }
            }
        }

        // Check for known binary packet identifiers
        if (dataBuffer.length >= 4) {
            const identifier = new TextDecoder().decode(dataBuffer.slice(0, 4)).replace(/\0/g, '').trim();
            
            // List of known binary packet identifiers
            const binaryIdentifiers = ['GYRO', 'ACCL', 'MAGN', 'GRAV', 'EULR', 'BME2', 'TEMP', 'POLL',
                                     'OBCR', 'OBCD', 'OBCC', 'ADCS', 'EPSS',
                                     'HOST', 'SOLR', 'XFRC', 'BECN', 'QUAT', 'PHOT'];
            
            if (binaryIdentifiers.includes(identifier)) {
                const packetSize = getPacketSize(identifier);
                
                if (packetSize > 0 && dataBuffer.length >= packetSize) {
                    // Process binary packet
                    const packet = dataBuffer.slice(0, packetSize);
                    if (typeof unpackCommand === 'function') {
                        unpackCommand(packet);
                    }
                    dataBuffer = dataBuffer.slice(packetSize);
                    blinkLED('rfm95RxLed');
                    continue;
                } else if (packetSize > 0) {
                    // Not enough data yet, wait for more
                    break;
                }
            }
        }

        // Process as text line
        let foundNewline = false;
        let newlineIndex = -1;
        
        // Look for newline characters
        for (let i = 0; i < dataBuffer.length; i++) {
            if (dataBuffer[i] === 0x0A || dataBuffer[i] === 0x0D) {
                foundNewline = true;
                newlineIndex = i;
                break;
            }
        }

        if (foundNewline) {
            // Extract line
            const lineBytes = dataBuffer.slice(0, newlineIndex);
            let line = '';
            
            try {
                line = new TextDecoder().decode(lineBytes).trim();
            } catch (e) {
                // Failed to decode as text, skip this line
                dataBuffer = dataBuffer.slice(newlineIndex + 1);
                continue;
            }
            
            // Process the line if not empty
            if (line) {
                processTextLine(line);
            }
            
            // Remove processed line and newline
            dataBuffer = dataBuffer.slice(newlineIndex + 1);
            
            // Skip any additional newlines
            while (dataBuffer.length > 0 && (dataBuffer[0] === 0x0A || dataBuffer[0] === 0x0D)) {
                dataBuffer = dataBuffer.slice(1);
            }
        } else {
            // No newline found
            // If buffer is getting large with no newlines or binary packets, there might be an issue
            if (dataBuffer.length > 1024) {
                // Clear buffer to prevent memory issues
                console.warn('Data buffer overflow, clearing buffer');
                dataBuffer = new Uint8Array();
            }
            break;
        }
    }
}

/**
 * Process individual text lines from serial data
 * @param {string} line - Text line to process
 */
function processTextLine(line) {
    // Handle configuration messages
    if (line === 'RADIO_CONFIG:') {
        collectingConfig = true;
        configBuffer = [line];
        logToTerminal(line, 'response');
    } else if (collectingConfig) {
        if (line === 'END_CONFIG') {
            parseRadioConfigFromBuffer(configBuffer);
            collectingConfig = false;
            configBuffer = [];
        } else {
            configBuffer.push(line);
            logToTerminal(line, 'response');
        }
    } else if (line.includes('Uplink:') || line.includes('Downlink:') || 
             line.includes('Received command:') || line.includes('Ground Station Ready') ||
             line.includes('radio configured') || line.includes('Error:') ||
             line.includes('Image') || line.includes('packet')) {
        // Known text responses
        logToTerminal(line, 'response');
        if (line.includes('Received packet:')) {
            blinkLED('rfm95RxLed');
        }
    } else {
        // Unknown line, could be debug output
        logToTerminal(line, 'info');
    }
}

/**
 * Parse radio configuration from collected buffer
 * @param {Array<string>} buffer - Configuration message buffer
 */
function parseRadioConfigFromBuffer(buffer) {
    for (let line of buffer) {
        if (line.startsWith('Uplink:')) {
            // Parse: "Uplink: RFM95 @ 915.0 MHz, Node 1" (satellite address)
            const match = line.match(/Uplink: (\w+) @ ([\d.]+) MHz, (?:Channel|Node) (\d+)/);
            if (match) {
                const [, type, freq, node] = match;
                
                // Update uplink UI
                const uplinkRadio = document.getElementById('uplinkRadio');
                const uplinkFreq = document.getElementById('uplinkFreq');
                const satelliteAddress = document.getElementById('satelliteAddress');
                const uplinkBand = document.getElementById('uplinkBand');
                
                if (uplinkRadio) uplinkRadio.value = type.toLowerCase();
                if (uplinkFreq) uplinkFreq.value = freq;
                if (satelliteAddress) satelliteAddress.value = node;
                
                // Update band selection based on frequency
                if (uplinkBand) {
                    const bandValue = freq < 450 ? '433' : freq < 880 ? '868' : '915';
                    uplinkBand.value = bandValue;
                    updateFrequencyRange('uplink');
                }
                
                logToTerminal('UI updated with uplink configuration', 'info');
            }
        } else if (line.startsWith('Downlink:')) {
            // Parse: "Downlink: RFM69 @ 915.0 MHz, Node 0" (ground node)
            const match = line.match(/Downlink: (\w+) @ ([\d.]+) MHz, (?:Channel|Node) (\d+)/);
            if (match) {
                const [, type, freq, node] = match;
                
                // Update downlink UI
                const downlinkRadio = document.getElementById('downlinkRadio');
                const downlinkFreq = document.getElementById('downlinkFreq');
                const downlinkNode = document.getElementById('downlinkNode');
                const downlinkBand = document.getElementById('downlinkBand');
                
                if (downlinkRadio) downlinkRadio.value = type.toLowerCase();
                if (downlinkFreq) downlinkFreq.value = freq;
                if (downlinkNode) downlinkNode.value = node;
                
                // Update band selection based on frequency
                if (downlinkBand) {
                    const bandValue = freq < 450 ? '433' : freq < 880 ? '868' : '915';
                    downlinkBand.value = bandValue;
                    updateFrequencyRange('downlink');
                }
                
                logToTerminal('UI updated with downlink configuration', 'info');
            }
        }
    }
}

/**
 * Get expected packet size for binary packet identifier
 * @param {string} identifier - Packet identifier
 * @returns {number} - Packet size in bytes, -1 for variable size
 */
function getPacketSize(identifier) {
    const packetSizes = {
        'GYRO': 16, 'ACCL': 16, 'MAGN': 16, 'GRAV': 16, 'EULR': 16,
        'BME2': 16, 'TEMP': 8, 'QUAT': 20, 'POLL': -1, // Variable size
        'OBCR': 8, 'OBCD': 8, 'OBCC': 8,
        'OBCL': 234, 'OBCP': 234,
        'ADCS': 32, 'EPSS': 28, 'HOST': 15, 'SOLR': 36,
        'RETX': -1, // Variable size
        'XFRC': 8,  // 4 + uint32 total_packets
        'BECN': 24  // 4 + uint32 uptime + 4*float (cpu, ram, disk, temp)
    };

    if (identifier === 'PHOT') {
        // Variable: 4-byte ID + 4-byte length + filename
        if (dataBuffer.length >= 8) {
            const view = new DataView(dataBuffer.buffer, dataBuffer.byteOffset, 8);
            const payloadLength = view.getUint32(4, true);
            return 8 + payloadLength;
        }
        return -1;
    } else if (identifier === 'POLL') {
        if (dataBuffer.length >= 8) {
            const view = new DataView(dataBuffer.buffer, dataBuffer.byteOffset, 8);
            const payloadLength = view.getUint32(4, true);
            return 8 + payloadLength;
        }
        return -1;
    } else if (identifier === 'RETX') {
        // For RETX, consume whatever is available up to max size
        return Math.min(dataBuffer.length, 256);
    }

    return packetSizes[identifier] || 0;
}

// ============================================================================
// Command Transmission
// ============================================================================

/**
 * Perform soft reset of ground station device
 */
async function softReset() {
    if (!writer) return;

    try {
        logToTerminal('Performing soft reset...', 'info');
        
        // Send CTRL-C then CTRL-D
        await writer.write(new Uint8Array([0x03])); // CTRL-C
        await new Promise(resolve => setTimeout(resolve, 100));
        await writer.write(new Uint8Array([0x04])); // CTRL-D
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        logToTerminal('Ground Station device reset complete', 'response');
    } catch (error) {
        logToTerminal(`Reset error: ${error.message}`, 'error');
    }
}

/**
 * Send command to ground station
 * @param {string|null} command - Command to send, or null to use input field
 */
async function sendCommand(command = null) {
    if (!writer) return;

    const cmd = command || document.getElementById('commandInput')?.value?.trim();
    if (!cmd) return;

    try {
        logToTerminal(`Sending command: ${cmd}`, 'command');
        blinkLED('rfm95TxLed');
        
        // Check if this is a SEND_IMAGE command and extract filename
        if (cmd.toUpperCase().startsWith('SEND_IMAGE')) {
            const parts = cmd.split(/\s+/);
            if (parts.length >= 2 && typeof setCurrentImageFilename === 'function') {
                const filename = parts[1];
                setCurrentImageFilename(filename);
            }
        }
        
        const encoder = new TextEncoder();
        await writer.write(encoder.encode(cmd + '\n'));
        
        // Clear input field if using UI input
        if (!command) {
            const commandInput = document.getElementById('commandInput');
            if (commandInput) {
                commandInput.value = '';
            }
        }
    } catch (error) {
        logToTerminal(`Send error: ${error.message}`, 'error');
    }
}

/**
 * Send preset command and optionally update input field
 * @param {string} command - Preset command to send
 */
function sendPresetCommand(command) {
    const commandInput = document.getElementById('commandInput');
    if (commandInput) {
        commandInput.value = command;
    }
    sendCommand(command);
}

// ============================================================================
// Connection Status and Error Handling
// ============================================================================

/**
 * Check if serial connection is active
 * @returns {boolean} - Connection status
 */
function isSerialConnected() {
    return isConnected && writer !== null && port !== null;
}

/**
 * Get connection status information
 * @returns {Object} - Connection status object
 */
function getConnectionInfo() {
    return {
        connected: isConnected,
        hasPort: port !== null,
        hasWriter: writer !== null,
        hasReader: reader !== null,
        bufferSize: dataBuffer.length
    };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Clear the data buffer (useful for debugging)
 */
function clearDataBuffer() {
    dataBuffer = new Uint8Array();
    logToTerminal('Serial data buffer cleared', 'info');
}

/**
 * Get current buffer statistics
 * @returns {Object} - Buffer statistics
 */
function getBufferStats() {
    return {
        dataBufferSize: dataBuffer.length,
        configBufferSize: configBuffer.length,
        collectingConfig: collectingConfig
    };
}

// ============================================================================
// Export functions for debugging (development only)
// ============================================================================

// Make some functions available globally for debugging
window.serialDebug = {
    getConnectionInfo,
    getBufferStats,
    clearDataBuffer,
    isSerialConnected: () => isSerialConnected()
};