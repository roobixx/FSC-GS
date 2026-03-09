// Telemetry data processing and unpacking for TEMPEST Ground Station
// Handles binary packet parsing for all satellite telemetry data types

// ============================================================================
// Main Command Unpacker
// ============================================================================

/**
 * Main function to unpack and route binary telemetry packets
 * @param {Uint8Array} data - Binary packet data
 */
function unpackCommand(data) {
    if (!data || data.length < 4) return;

    try {
        // Extract 4-byte identifier
        const identifierBytes = data.slice(0, 4);
        const identifier = new TextDecoder().decode(identifierBytes).replace(/\0/g, '').trim();

        // Route to appropriate unpacking function based on identifier
        switch (identifier) {
            case 'GYRO':
            case 'ACCL':
            case 'MAGN':
            case 'GRAV':
            case 'EULR':
                unpackSensorData(identifier, data);
                break;
            case 'BME2':
                unpackBMEData(data);
                break;
            case 'TEMP':
                unpackTempData(data);
                break;
            case 'QUAT':
                unpackQuaternionData(data);
                break;
            case 'POLL':
                unpackPollData(data);
                break;
            case 'OBCR':
            case 'OBCD':
            case 'OBCC':
                unpackOBCSingleValue(identifier, data);
                break;
            case 'OBCL':
                unpackOBCFileListing(data);
                break;
            case 'OBCP':
                unpackOBCProcesses(data);
                break;
            case 'ADCS':
                unpackADCSData(data);
                break;
            case 'EPSS':
                unpackEPSStatus(data);
                break;
            case 'HOST':
                unpackHostname(data);
                break;
            case 'SOLR':
                unpackSolarData(data);
                break;
            case 'RETX':
                unpackRetransmitData(data);
                break;
            case 'XFRC':
                unpackTransferComplete(data);
                break;
            case 'BECN':
                unpackBeacon(data);
                break;
            case 'PHOT':
                unpackPhotoResponse(data);
                break;
            default:
                // Unknown identifier - log for debugging if needed
                console.debug(`Unknown telemetry identifier: ${identifier}`);
                break;
        }
    } catch (error) {
        logToTerminal(`Telemetry unpack error: ${error.message}`, 'error');
    }
}

// ============================================================================
// Sensor Data Unpackers (16-byte packets with 3 float values)
// ============================================================================

/**
 * Unpack 3-axis sensor data (gyro, accelerometer, magnetometer, etc.)
 * Packet format: [4-byte ID][4-byte X][4-byte Y][4-byte Z]
 * @param {string} identifier - Sensor type identifier
 * @param {Uint8Array} data - 16-byte sensor packet
 */
function unpackSensorData(identifier, data) {
    if (data.length < 16) {
        logToTerminal(`Invalid ${identifier} packet size: ${data.length} bytes`, 'warning');
        return;
    }

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const x = view.getFloat32(4, true);  // Little endian
    const y = view.getFloat32(8, true);
    const z = view.getFloat32(12, true);

    // Determine units based on sensor type
    let units = '';
    switch (identifier) {
        case 'GYRO':
            units = '°/s';
            break;
        case 'ACCL':
            units = 'm/s²';
            break;
        case 'MAGN':
            units = 'µT';
            break;
        case 'GRAV':
            units = 'm/s²';
            break;
        case 'EULR':
            units = '°';
            break;
    }

    logToTerminal(`${identifier} - X: ${x.toFixed(3)}${units}, Y: ${y.toFixed(3)}${units}, Z: ${z.toFixed(3)}${units}`, 'response');
}

// ============================================================================
// Environmental Sensor Data
// ============================================================================

/**
 * Unpack BME280 environmental sensor data
 * Packet format: [4-byte ID][4-byte temp][4-byte pressure][4-byte altitude]
 * @param {Uint8Array} data - 16-byte BME packet
 */
function unpackBMEData(data) {
    if (data.length < 16) {
        logToTerminal(`Invalid BME packet size: ${data.length} bytes`, 'warning');
        return;
    }

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const temp = view.getFloat32(4, true);
    const pressure = view.getFloat32(8, true);
    const altitude = view.getFloat32(12, true);

    logToTerminal(`BME280 - Temp: ${temp.toFixed(2)}°C, Pressure: ${pressure.toFixed(2)} hPa, Altitude: ${altitude.toFixed(2)} m`, 'response');
    
    // Update telemetry display
    const tempElement = document.getElementById('temperature');
    if (tempElement) {
        tempElement.textContent = `${temp.toFixed(1)}°C`;
    }
}

/**
 * Unpack temperature sensor data
 * Packet format: [4-byte ID][4-byte int temperature]
 * @param {Uint8Array} data - 8-byte TEMP packet
 */
function unpackTempData(data) {
    if (data.length < 8) {
        logToTerminal(`Invalid TEMP packet size: ${data.length} bytes`, 'warning');
        return;
    }

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const temp = view.getInt32(4, true);

    logToTerminal(`Temperature: ${temp}°C`, 'response');

    const tempElement = document.getElementById('temperature');
    if (tempElement) {
        tempElement.textContent = `${temp}°C`;
    }
}

/**
 * Unpack quaternion orientation data
 * Packet format: [4-byte ID][4 × 4-byte float (w, x, y, z)]
 * @param {Uint8Array} data - 20-byte QUAT packet
 */
function unpackQuaternionData(data) {
    if (data.length < 20) {
        logToTerminal(`Invalid QUAT packet size: ${data.length} bytes`, 'warning');
        return;
    }

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const w = view.getFloat32(4, true);
    const x = view.getFloat32(8, true);
    const y = view.getFloat32(12, true);
    const z = view.getFloat32(16, true);

    logToTerminal(`Quaternion - W: ${w.toFixed(4)}, X: ${x.toFixed(4)}, Y: ${y.toFixed(4)}, Z: ${z.toFixed(4)}`, 'response');
}

/**
 * Unpack environmental polling data (variable length)
 * Packet format: [4-byte ID][4-byte payload_length][payload data]
 * @param {Uint8Array} data - Variable length poll packet
 */
function unpackPollData(data) {
    if (data.length < 8) {
        logToTerminal(`Invalid POLL packet size: ${data.length} bytes`, 'warning');
        return;
    }

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const payloadLength = view.getUint32(4, true);
    
    if (data.length < 8 + payloadLength) {
        logToTerminal(`Incomplete POLL packet: expected ${8 + payloadLength}, got ${data.length} bytes`, 'warning');
        return;
    }

    // Append to global poll buffer (defined in main.js)
    if (typeof pollBuffer !== 'undefined') {
        const newBuffer = new Uint8Array(pollBuffer.length + payloadLength);
        newBuffer.set(pollBuffer);
        newBuffer.set(data.slice(8, 8 + payloadLength), pollBuffer.length);
        pollBuffer = newBuffer;

        // Process when we have 16 floats (64 bytes)
        if (pollBuffer.length >= 64) {
            const pollView = new DataView(pollBuffer.buffer, pollBuffer.byteOffset, 64);
            logToTerminal('Environmental Poll Data:', 'response');
            for (let i = 0; i < 16; i++) {
                const value = pollView.getFloat32(i * 4, true);
                logToTerminal(`  Sensor ${i + 1}: ${value.toFixed(3)}`, 'response');
            }
            pollBuffer = new Uint8Array(); // Clear buffer
        }
    }
}

// ============================================================================
// Onboard Computer (OBC) Data
// ============================================================================

/**
 * Unpack single value OBC data (RAM, disk, CPU usage)
 * Packet format: [4-byte ID][4-byte float value]
 * @param {string} identifier - OBC data type
 * @param {Uint8Array} data - 8-byte OBC packet
 */
function unpackOBCSingleValue(identifier, data) {
    if (data.length < 8) {
        logToTerminal(`Invalid ${identifier} packet size: ${data.length} bytes`, 'warning');
        return;
    }

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const value = view.getFloat32(4, true);

    const names = {
        'OBCR': 'RAM Usage',
        'OBCD': 'Disk Usage',
        'OBCC': 'CPU Usage'
    };
    
    const name = names[identifier] || identifier;
    logToTerminal(`Onboard Computer ${name}: ${value.toFixed(2)}%`, 'response');

    // Update telemetry display
    if (identifier === 'OBCR') {
        const ramElement = document.getElementById('ramUsage');
        if (ramElement) {
            ramElement.textContent = `${value.toFixed(0)}%`;
        }
    } else if (identifier === 'OBCD') {
        const diskElement = document.getElementById('diskUsage');
        if (diskElement) {
            diskElement.textContent = `${value.toFixed(0)}%`;
        }
    } else if (identifier === 'OBCC') {
        const cpuElement = document.getElementById('cpuUsage');
        if (cpuElement) {
            cpuElement.textContent = `${value.toFixed(0)}%`;
        }
    }
}

/**
 * Unpack OBC file listing data
 * Packet format: [4-byte ID][230-byte file data string]
 * @param {Uint8Array} data - 234-byte file listing packet
 */
let obclBuffer = [];
let obclTimer = null;

function flushOBCLBuffer() {
    if (obclBuffer.length === 0) return;
    const finalData = obclBuffer.join('');
    const cleaned = finalData.replace(/[\[\]']/g, '');
    const files = cleaned.split(',').map(f => f.trim()).filter(f => f);

    if (files.length > 0 && !files[0].startsWith('DNE')) {
        logToTerminal(`OBC File Listing (${files.length} files):`, 'response');
        files.forEach((file, i) => {
            logToTerminal(`  ${i + 1}: ${file}`, 'response');
        });
    } else {
        logToTerminal('No files found or directory does not exist', 'response');
    }
    obclBuffer = [];
}

function unpackOBCFileListing(data) {
    if (data.length < 5) return;

    const fileData = new TextDecoder().decode(data.slice(4)).replace(/\0/g, '');
    obclBuffer.push(fileData);

    if (obclTimer) clearTimeout(obclTimer);
    obclTimer = setTimeout(flushOBCLBuffer, 1000);
}

/**
 * Unpack OBC process listing data
 * Packet format: [4-byte ID][230-byte process data string]
 * @param {Uint8Array} data - 234-byte process listing packet
 */
// Accumulator for multi-packet OBC responses
let obcpBuffer = [];
let obcpTimer = null;

function flushOBCPBuffer() {
    if (obcpBuffer.length === 0) return;
    const finalData = obcpBuffer.join('');
    const cleaned = finalData.replace(/[\[\]']/g, '');
    const processes = cleaned.split(',').map(p => p.trim()).filter(p => p);

    logToTerminal(`OBC Process List (${processes.length} processes):`, 'response');
    processes.forEach((process, i) => {
        logToTerminal(`  ${i + 1}: ${process}`, 'response');
    });
    obcpBuffer = [];
}

function unpackOBCProcesses(data) {
    if (data.length < 5) return;

    const processData = new TextDecoder().decode(data.slice(4)).replace(/\0/g, '');
    obcpBuffer.push(processData);

    // Reset flush timer on each chunk — flush 1s after last chunk
    if (obcpTimer) clearTimeout(obcpTimer);
    obcpTimer = setTimeout(flushOBCPBuffer, 1000);
}

// ============================================================================
// Attitude Determination and Control System (ADCS)
// ============================================================================

/**
 * Unpack ADCS orientation data
 * Packet format: [4-byte ID][7 × 4-byte float values]
 * @param {Uint8Array} data - 32-byte ADCS packet
 */
function unpackADCSData(data) {
    if (data.length < 32) {
        logToTerminal(`Invalid ADCS packet size: ${data.length} bytes`, 'warning');
        return;
    }

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    // BNO055 orientation data: 3 Euler angles + 4 quaternion values
    const heading = view.getFloat32(4, true);
    const roll = view.getFloat32(8, true);
    const pitch = view.getFloat32(12, true);
    const quatW = view.getFloat32(16, true);
    const quatX = view.getFloat32(20, true);
    const quatY = view.getFloat32(24, true);
    const quatZ = view.getFloat32(28, true);

    logToTerminal('Satellite Orientation (ADCS):', 'response');
    logToTerminal(`  Heading: ${heading.toFixed(2)}°`, 'response');
    logToTerminal(`  Roll:    ${roll.toFixed(2)}°`, 'response');
    logToTerminal(`  Pitch:   ${pitch.toFixed(2)}°`, 'response');
    logToTerminal(`  Quat W:  ${quatW.toFixed(4)}`, 'response');
    logToTerminal(`  Quat X:  ${quatX.toFixed(4)}`, 'response');
    logToTerminal(`  Quat Y:  ${quatY.toFixed(4)}`, 'response');
    logToTerminal(`  Quat Z:  ${quatZ.toFixed(4)}`, 'response');

    // Update orientation display
    const rollEl = document.getElementById('rollValue');
    const pitchEl = document.getElementById('pitchValue');
    const yawEl = document.getElementById('yawValue');
    if (rollEl) rollEl.textContent = `${roll.toFixed(1)}°`;
    if (pitchEl) pitchEl.textContent = `${pitch.toFixed(1)}°`;
    if (yawEl) yawEl.textContent = `${heading.toFixed(1)}°`;

    // Update 3D visualization if available
    if (typeof updateSatelliteOrientation === 'function') {
        updateSatelliteOrientation(roll, pitch, heading);
    }
}

// ============================================================================
// Electrical Power System (EPS)
// ============================================================================

/**
 * Unpack EPS status data
 * Packet format: [4-byte ID][5 × 4-byte int values][4-byte float battery voltage]
 * @param {Uint8Array} data - 28-byte EPS packet
 */
function unpackEPSStatus(data) {
    if (data.length < 28) {
        logToTerminal(`Invalid EPS packet size: ${data.length} bytes`, 'warning');
        return;
    }

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const epsError = view.getInt32(4, true);
    const ch1State = view.getInt32(8, true);
    const ch2State = view.getInt32(12, true);
    const ch3State = view.getInt32(16, true);
    const ch4State = view.getInt32(20, true);
    const batteryVoltage = view.getFloat32(24, true);

    logToTerminal('Electrical Power System Status:', 'response');
    logToTerminal(`  EPS Error Code: ${epsError}`, 'response');
    logToTerminal(`  Channel 1 State: ${ch1State ? 'ON' : 'OFF'}`, 'response');
    logToTerminal(`  Channel 2 State: ${ch2State ? 'ON' : 'OFF'}`, 'response');
    logToTerminal(`  Channel 3 State: ${ch3State ? 'ON' : 'OFF'}`, 'response');
    logToTerminal(`  Channel 4 State: ${ch4State ? 'ON' : 'OFF'}`, 'response');
    logToTerminal(`  Battery Voltage: ${batteryVoltage.toFixed(2)}V`, 'response');

    // Update telemetry display
    const batteryElement = document.getElementById('batteryVoltage');
    if (batteryElement) batteryElement.textContent = `${batteryVoltage.toFixed(1)}V`;

    const epsStatusEl = document.getElementById('epsStatus');
    if (epsStatusEl) epsStatusEl.textContent = epsError === 0 ? 'OK' : `E${epsError}`;

    const ch1El = document.getElementById('epsCh1');
    if (ch1El) { ch1El.textContent = ch1State ? 'ON' : 'OFF'; ch1El.style.color = ch1State ? 'var(--accent-primary)' : 'var(--text-secondary)'; }
    const ch2El = document.getElementById('epsCh2');
    if (ch2El) { ch2El.textContent = ch2State ? 'ON' : 'OFF'; ch2El.style.color = ch2State ? 'var(--accent-primary)' : 'var(--text-secondary)'; }
    const ch3El = document.getElementById('epsCh3');
    if (ch3El) { ch3El.textContent = ch3State ? 'ON' : 'OFF'; ch3El.style.color = ch3State ? 'var(--accent-primary)' : 'var(--text-secondary)'; }
    const ch4El = document.getElementById('epsCh4');
    if (ch4El) { ch4El.textContent = ch4State ? 'ON' : 'OFF'; ch4El.style.color = ch4State ? 'var(--accent-primary)' : 'var(--text-secondary)'; }
}

// ============================================================================
// Solar Panel Data
// ============================================================================

/**
 * Unpack solar panel telemetry data
 * Packet format: [4-byte ID][4 × (4-byte voltage + 4-byte current)]
 * @param {Uint8Array} data - 36-byte solar packet
 */
function unpackSolarData(data) {
    if (data.length < 36) {
        logToTerminal(`Invalid SOLR packet size: ${data.length} bytes`, 'warning');
        return;
    }

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    logToTerminal('Solar Panel Telemetry:', 'response');
    
    const panels = ['X-', 'X+', 'Y+', 'Y-'];
    const panelIds = ['solarXn', 'solarXp', 'solarYp', 'solarYn'];
    let totalPower = 0;

    for (let i = 0; i < 4; i++) {
        const voltage = view.getFloat32(4 + i * 8, true);
        const current = view.getFloat32(8 + i * 8, true);
        const power = voltage * current / 1000; // Convert mA to A for power calc
        totalPower += power;

        logToTerminal(`  Panel ${panels[i]}: ${voltage.toFixed(2)}V, ${current.toFixed(2)}mA (${power.toFixed(3)}W)`, 'response');

        const panelEl = document.getElementById(panelIds[i]);
        if (panelEl) panelEl.textContent = `${voltage.toFixed(1)}V ${current.toFixed(0)}mA`;
    }

    logToTerminal(`  Total Power: ${totalPower.toFixed(3)}W`, 'response');

    const totalEl = document.getElementById('solarTotal');
    if (totalEl) totalEl.textContent = `${totalPower.toFixed(2)}W`;
}

// ============================================================================
// System Information
// ============================================================================

/**
 * Unpack hostname data
 * Packet format: [4-byte ID][11-byte hostname string]
 * @param {Uint8Array} data - 15-byte hostname packet
 */
function unpackHostname(data) {
    if (data.length < 15) {
        logToTerminal(`Invalid HOST packet size: ${data.length} bytes`, 'warning');
        return;
    }

    const hostname = new TextDecoder().decode(data.slice(4, 15)).replace(/\0/g, '').trim();
    logToTerminal(`Satellite Hostname: ${hostname}`, 'response');
}

/**
 * Unpack retransmission data
 * Packet format: [4-byte ID][variable length retransmitted data]
 * @param {Uint8Array} data - Variable length retransmit packet
 */
function unpackRetransmitData(data) {
    const retxData = new TextDecoder().decode(data.slice(4)).replace(/\0/g, '').trim();
    if (retxData) {
        logToTerminal(`Retransmitted Data: ${retxData}`, 'response');
    } else {
        logToTerminal('Empty retransmit packet received', 'info');
    }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get human-readable packet type name
 * @param {string} identifier - 4-character packet identifier
 * @returns {string} - Human readable name
 */
function getPacketTypeName(identifier) {
    const names = {
        'GYRO': 'Gyroscope',
        'ACCL': 'Accelerometer', 
        'MAGN': 'Magnetometer',
        'GRAV': 'Gravity Vector',
        'EULR': 'Euler Angles',
        'BME2': 'BME280 Environment',
        'TEMP': 'Temperature',
        'QUAT': 'Quaternion',
        'POLL': 'Environmental Poll',
        'OBCR': 'OBC RAM Usage',
        'OBCD': 'OBC Disk Usage', 
        'OBCC': 'OBC CPU Usage',
        'OBCL': 'OBC File Listing',
        'OBCP': 'OBC Process List',
        'ADCS': 'Attitude Control',
        'EPSS': 'Power System',
        'HOST': 'Hostname',
        'SOLR': 'Solar Panels',
        'RETX': 'Retransmission',
        'SEND': 'Image Data'
    };
    
    return names[identifier] || identifier;
}

/**
 * Validate packet structure before unpacking
 * @param {Uint8Array} data - Packet data
 * @param {number} expectedSize - Expected packet size in bytes
 * @returns {boolean} - True if packet is valid
 */
function validatePacket(data, expectedSize) {
    if (!data) {
        logToTerminal('Received null packet data', 'error');
        return false;
    }
    
    if (data.length < 4) {
        logToTerminal(`Packet too small: ${data.length} bytes (minimum 4)`, 'warning');
        return false;
    }
    
    if (expectedSize > 0 && data.length !== expectedSize) {
        logToTerminal(`Incorrect packet size: expected ${expectedSize}, got ${data.length} bytes`, 'warning');
        return false;
    }
    
    return true;
}

// ============================================================================
// Photo Response
// ============================================================================

/**
 * Unpack photo capture response
 * Packet format: [4-byte ID][4-byte length][filename string]
 * @param {Uint8Array} data - Variable length PHOT packet
 */
function unpackPhotoResponse(data) {
    if (data.length < 8) {
        logToTerminal(`Invalid PHOT packet size: ${data.length} bytes`, 'warning');
        return;
    }

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const filenameLength = view.getUint32(4, true);
    const filename = new TextDecoder().decode(data.slice(8, 8 + filenameLength)).replace(/\0/g, '').trim();

    logToTerminal(`Photo captured: ${filename}`, 'response');
}

// ============================================================================
// Transfer Complete
// ============================================================================

/**
 * Unpack XFRC (transfer complete) marker and check for missing packets
 * Packet format: [4-byte ID][4-byte total_packets]
 * @param {Uint8Array} data - 8-byte XFRC packet
 */
function unpackTransferComplete(data) {
    if (data.length < 8) {
        logToTerminal(`Invalid XFRC packet size: ${data.length} bytes`, 'warning');
        return;
    }

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const totalPkts = view.getUint32(4, true);

    logToTerminal(`Transfer complete signal: ${totalPkts} packets expected`, 'response');

    // Check all active image receptions for missing packets
    for (const [imageId, imageInfo] of imageReceptions.entries()) {
        if (imageInfo.totalChunks === totalPkts) {
            const received = imageInfo.receivedChunks.size;
            const missing = totalPkts - received;

            if (missing === 0) {
                logToTerminal(`Image ${imageId}: all ${totalPkts} packets received!`, 'response');
            } else {
                const pct = (received / totalPkts * 100).toFixed(1);
                logToTerminal(`Image ${imageId}: ${received}/${totalPkts} received (${pct}%), ${missing} missing`, 'warning');

                // Show missing packet numbers for retransmission
                const missingPkts = checkMissingPackets(imageId);
                if (missingPkts.length <= 30) {
                    logToTerminal(`Missing packets: ${missingPkts.join(', ')}`, 'info');
                } else {
                    logToTerminal(`Missing packets: ${missingPkts.slice(0, 30).join(', ')}... (+${missingPkts.length - 30} more)`, 'info');
                }

                const filename = imageInfo.filename || `image.jpg.gz.chunked`;
                logToTerminal(`Use: RETRANSMIT ${filename} ${missingPkts.slice(0, 5).join(' ')}`, 'info');
            }
            return;
        }
    }

    logToTerminal(`No matching image reception found for ${totalPkts} packets`, 'warning');
}

// ============================================================================
// Beacon Data
// ============================================================================

/**
 * Unpack health beacon packet
 * Packet format: [4-byte ID][4-byte uptime][4-byte cpu][4-byte ram][4-byte disk][4-byte temp]
 * @param {Uint8Array} data - 24-byte beacon packet
 */
function unpackBeacon(data) {
    if (data.length < 24) {
        logToTerminal(`Invalid BECN packet size: ${data.length} bytes`, 'warning');
        return;
    }

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const uptime = view.getUint32(4, true);
    const cpu = view.getFloat32(8, true);
    const ram = view.getFloat32(12, true);
    const disk = view.getFloat32(16, true);
    const temp = view.getFloat32(20, true);

    // Format uptime as HH:MM:SS
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = uptime % 60;
    const uptimeStr = `${hours}h ${minutes}m ${seconds}s`;

    logToTerminal(`BEACON | Uptime: ${uptimeStr} | CPU: ${cpu.toFixed(1)}% | RAM: ${ram.toFixed(1)}% | Disk: ${disk.toFixed(1)}% | Temp: ${temp.toFixed(1)}°C`, 'response');

    // Update telemetry display elements
    const cpuElement = document.getElementById('cpuUsage');
    if (cpuElement) cpuElement.textContent = `${cpu.toFixed(0)}%`;

    const tempElement = document.getElementById('temperature');
    if (tempElement) tempElement.textContent = `${temp.toFixed(1)}°C`;

    const ramElement = document.getElementById('ramUsage');
    if (ramElement) ramElement.textContent = `${ram.toFixed(0)}%`;

    const diskElement = document.getElementById('diskUsage');
    if (diskElement) diskElement.textContent = `${disk.toFixed(0)}%`;
}

// ============================================================================
// Export functions for debugging (development only)
// ============================================================================

window.telemetryDebug = {
    getPacketTypeName,
    validatePacket,
    // Add manual packet injection for testing
    injectTestPacket: (identifier, testData) => {
        const packet = new Uint8Array(testData.length + 4);
        const encoder = new TextEncoder();
        packet.set(encoder.encode(identifier.padEnd(4, '\0')));
        packet.set(testData, 4);
        unpackCommand(packet);
    }
};