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
            case 'BMED':
                unpackBMEData(data);
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
    }
}

/**
 * Unpack OBC file listing data
 * Packet format: [4-byte ID][230-byte file data string]
 * @param {Uint8Array} data - 234-byte file listing packet
 */
function unpackOBCFileListing(data) {
    if (data.length < 234) {
        logToTerminal(`Invalid OBCL packet size: ${data.length} bytes`, 'warning');
        return;
    }

    const fileData = new TextDecoder().decode(data.slice(4, 234)).replace(/\0/g, '').trim();
    
    if (fileData && !fileData.startsWith('DNE')) {
        logToTerminal('Onboard Computer File Listing:', 'response');
        fileData.split('\n').forEach(line => {
            if (line.trim()) {
                logToTerminal(`  ${line.trim()}`, 'response');
            }
        });
    } else {
        logToTerminal('No files found or directory does not exist', 'response');
    }
}

/**
 * Unpack OBC process listing data
 * Packet format: [4-byte ID][230-byte process data string]
 * @param {Uint8Array} data - 234-byte process listing packet
 */
function unpackOBCProcesses(data) {
    if (data.length < 234) {
        logToTerminal(`Invalid OBCP packet size: ${data.length} bytes`, 'warning');
        return;
    }

    const processData = new TextDecoder().decode(data.slice(4, 234)).replace(/\0/g, '').trim();
    
    // Use global array to accumulate process data (defined in main.js)
    if (typeof obclDataArray !== 'undefined') {
        obclDataArray.push(processData);

        if (processData.includes('END') || processData.length === 0) {
            const finalData = obclDataArray.join('');
            const processes = finalData.split(',').filter(p => p.trim());
            
            logToTerminal('OBC Process List:', 'response');
            processes.forEach((process, i) => {
                if (process.trim() && !process.includes('END')) {
                    logToTerminal(`  ${i + 1}: ${process.trim()}`, 'response');
                }
            });
            
            obclDataArray = []; // Clear array
        }
    }
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
    logToTerminal('Satellite Orientation (ADCS):', 'response');
    
    let orientationValues = [];
    for (let i = 0; i < 7; i++) {
        const value = view.getFloat32(4 + i * 4, true);
        orientationValues.push(value);
        logToTerminal(`  Value ${i + 1}: ${value.toFixed(6)}`, 'response');
    }

    // Assuming the first 3 values are Euler angles (roll, pitch, yaw) in degrees
    if (orientationValues.length >= 3) {
        const roll = orientationValues[0];
        const pitch = orientationValues[1];
        const yaw = orientationValues[2];
        
        // Update 3D visualization if available
        if (typeof updateSatelliteOrientation === 'function') {
            updateSatelliteOrientation(roll, pitch, yaw);
        }
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
    if (batteryElement) {
        batteryElement.textContent = `${batteryVoltage.toFixed(1)}V`;
    }
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
    
    const panels = ['X-', 'X+', 'Y-', 'Y+'];
    let totalPower = 0;
    
    for (let i = 0; i < 4; i++) {
        const voltage = view.getFloat32(4 + i * 8, true);
        const current = view.getFloat32(8 + i * 8, true);
        const power = voltage * current / 1000; // Convert mA to A for power calc
        totalPower += power;
        
        logToTerminal(`  Panel ${panels[i]}: ${voltage.toFixed(2)}V, ${current.toFixed(2)}mA (${power.toFixed(3)}W)`, 'response');
    }
    
    logToTerminal(`  Total Power: ${totalPower.toFixed(3)}W`, 'response');
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
        'BMED': 'BME280 Environment',
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