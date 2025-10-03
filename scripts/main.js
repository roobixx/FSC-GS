// Main initialization and UI functions for TEMPEST Ground Station
// This file handles UI interactions, radio configuration, and application initialization

// Global variables for UI state
let pollBuffer = new Uint8Array();
let obclDataArray = [];

// ISM Band frequency ranges
const ISM_BANDS = {
    '433': { min: 433.05, max: 434.79, name: '433 MHz' },
    '868': { min: 863.0, max: 870.0, name: '868 MHz (EU)' },
    '915': { min: 902.0, max: 928.0, name: '915 MHz (US)' }
};

// ============================================================================
// UI Helper Functions
// ============================================================================

/**
 * Toggle mobile panel collapse/expand
 * @param {HTMLElement} header - The panel header element
 */
function togglePanelMobile(header) {
    if (window.innerWidth <= 1023) {
        const panel = header.parentElement;
        panel.classList.toggle('collapsed');
    }
}

/**
 * Log message to terminal with timestamp and styling
 * @param {string} message - Message to log
 * @param {string} type - Message type (info, command, response, error, warning)
 */
function logToTerminal(message, type = 'info') {
    const terminal = document.getElementById('terminal');
    const line = document.createElement('div');
    line.className = `terminal-line ${type}`;
    const timestamp = new Date().toLocaleTimeString('en-US', { 
        hour12: false, 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit',
        fractionalSecondDigits: 3 
    });
    line.textContent = `[${timestamp}] ${message}`;
    terminal.appendChild(line);
    terminal.scrollTop = terminal.scrollHeight;
}

/**
 * Update connection status indicators and controls
 * @param {boolean} connected - Connection state
 */
function updateConnectionStatus(connected) {
    isConnected = connected;
    const indicator = document.getElementById('statusIndicator');
    const status = document.getElementById('connectionStatus');
    const connectBtn = document.getElementById('connectBtn');
    const resetBtn = document.getElementById('resetBtn');
    const sendBtn = document.getElementById('sendBtn');
    const commandInput = document.getElementById('commandInput');

    if (connected) {
        indicator.classList.add('connected');
        status.textContent = 'Connected';
        connectBtn.textContent = 'Disconnect';
        resetBtn.disabled = false;
        sendBtn.disabled = false;
        commandInput.disabled = false;
    } else {
        indicator.classList.remove('connected');
        status.textContent = 'Disconnected';
        connectBtn.textContent = 'Connect to Ground Station';
        resetBtn.disabled = true;
        sendBtn.disabled = true;
        commandInput.disabled = true;
    }
}

/**
 * Blink LED indicator based on radio configuration
 * @param {string} ledId - LED identifier
 * @param {number} duration - Blink duration in milliseconds
 */
function blinkLED(ledId, duration = 100) {
    // Use radio configuration to determine which LED to blink
    if (window.radioConfig) {
        if (ledId === 'rfm95TxLed' && window.radioConfig.uplink === 'rfm69') {
            ledId = 'rfm69TxLed';
        } else if (ledId === 'rfm95RxLed' && window.radioConfig.downlink === 'rfm69') {
            ledId = 'rfm69RxLed';
        } else if (ledId === 'rfm95TxLed' && window.radioConfig.uplink === 'rfm95') {
            ledId = 'rfm95TxLed';
        } else if (ledId === 'rfm95RxLed' && window.radioConfig.downlink === 'rfm95') {
            ledId = 'rfm95RxLed';
        }
    }
    
    const led = document.getElementById(ledId);
    if (led) {
        led.classList.add('active');
        setTimeout(() => led.classList.remove('active'), duration);
    }
}

// ============================================================================
// Radio Configuration Functions
// ============================================================================

/**
 * Update frequency range display and constraints based on band selection
 * @param {string} radio - Radio type ('uplink' or 'downlink')
 */
function updateFrequencyRange(radio) {
    const band = document.getElementById(`${radio}Band`).value;
    const freqInput = document.getElementById(`${radio}Freq`);
    const rangeDisplay = document.getElementById(`${radio}FreqRange`);
    const bandInfo = ISM_BANDS[band];
    
    // Update input constraints
    freqInput.min = bandInfo.min;
    freqInput.max = bandInfo.max;
    
    // Update range display
    rangeDisplay.textContent = `Valid range: ${bandInfo.min} - ${bandInfo.max} MHz`;
    
    // Set default frequency for the band
    const defaultFreqs = {
        '433': 433.92,
        '868': 868.0,
        '915': 915.0
    };
    
    freqInput.value = defaultFreqs[band];
    
    // Validate the frequency
    validateFrequency(radio);
}

/**
 * Validate frequency input against band constraints
 * @param {string} radio - Radio type ('uplink' or 'downlink')
 * @returns {boolean} - True if frequency is valid
 */
function validateFrequency(radio) {
    const band = document.getElementById(`${radio}Band`).value;
    const freqInput = document.getElementById(`${radio}Freq`);
    const freq = parseFloat(freqInput.value);
    const bandInfo = ISM_BANDS[band];
    
    if (freq < bandInfo.min || freq > bandInfo.max) {
        freqInput.style.borderColor = 'var(--accent-danger)';
        freqInput.title = `Frequency must be between ${bandInfo.min} and ${bandInfo.max} MHz`;
        return false;
    } else {
        freqInput.style.borderColor = 'var(--border-color)';
        freqInput.title = '';
        return true;
    }
}

/**
 * Query current radio configuration from ground station
 */
async function queryRadioConfig() {
    if (!writer) {
        logToTerminal('Not connected to Ground Station', 'error');
        return;
    }

    try {
        logToTerminal('Querying radio configuration...', 'info');
        
        // Clear any pending data
        dataBuffer = new Uint8Array();
        
        // Send the query command
        await sendCommand('get_radio_config');
        
        // Wait a bit for the response
        setTimeout(() => {
            if (dataBuffer.length === 0) {
                logToTerminal('No response received from hardware. Check connection.', 'warning');
            }
        }, 3000);
        
    } catch (error) {
        logToTerminal(`Query error: ${error.message}`, 'error');
    }
}

/**
 * Configure radios with current UI settings
 */
async function configureRadios() {
    if (!writer) {
        logToTerminal('Not connected to Ground Station', 'error');
        return;
    }

    // Validate frequencies
    if (!validateFrequency('uplink') || !validateFrequency('downlink')) {
        logToTerminal('Invalid frequency settings. Please check the frequency ranges.', 'error');
        return;
    }

    try {
        // Get radio configurations
        const uplinkRadio = document.getElementById('uplinkRadio').value;
        const uplinkFreq = document.getElementById('uplinkFreq').value;
        const satelliteAddress = document.getElementById('satelliteAddress').value;
        const uplinkBand = document.getElementById('uplinkBand').value;
        
        const downlinkRadio = document.getElementById('downlinkRadio').value;
        const downlinkFreq = document.getElementById('downlinkFreq').value;
        const downlinkNode = document.getElementById('downlinkNode').value;
        const downlinkBand = document.getElementById('downlinkBand').value;

        logToTerminal('Configuring radios...', 'info');
        
        // Build uplink command with satellite destination address
        let uplinkCmd = `set_uplink_radio ${uplinkRadio} ${uplinkFreq}`;
        if (satelliteAddress !== '255') {
            uplinkCmd += ` ${satelliteAddress}`;
        }
        
        // Build downlink command with ground node address
        let downlinkCmd = `set_downlink_radio ${downlinkRadio} ${downlinkFreq}`;
        if (downlinkNode !== '255') {
            downlinkCmd += ` ${downlinkNode}`;
        }

        // Send uplink configuration
        logToTerminal(`Uplink: ${uplinkRadio.toUpperCase()} @ ${uplinkFreq} MHz (${ISM_BANDS[uplinkBand].name}), Satellite Node ${satelliteAddress}`, 'info');
        await sendCommand(uplinkCmd);
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Send downlink configuration
        logToTerminal(`Downlink: ${downlinkRadio.toUpperCase()} @ ${downlinkFreq} MHz (${ISM_BANDS[downlinkBand].name}), Ground Node ${downlinkNode}`, 'info');
        await sendCommand(downlinkCmd);
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        logToTerminal('Radio configuration complete', 'response');
        
        // Update LED config based on selected radios
        updateLEDConfig(uplinkRadio, downlinkRadio);
        
    } catch (error) {
        logToTerminal(`Radio config error: ${error.message}`, 'error');
    }
}

/**
 * Update LED configuration for blinking indicators
 * @param {string} uplinkRadio - Uplink radio type
 * @param {string} downlinkRadio - Downlink radio type
 */
function updateLEDConfig(uplinkRadio, downlinkRadio) {
    // Store the configuration for LED blinking
    window.radioConfig = {
        uplink: uplinkRadio,
        downlink: downlinkRadio
    };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Clear terminal output
 */
function clearTerminal() {
    document.getElementById('terminal').innerHTML = '';
    logToTerminal('Terminal cleared', 'info');
}

/**
 * Show help information with all available commands
 */
function showHelp() {
    const commands = [
        'Available Commands:',
        '- GET_SOLAR: Get Solar Panel Voltages and Currents',
        '- EPS_STATUS: Get All EPS Values',
        '- EPS CH<n>,<0 or 1>: Set EPS Channel Off/On',
        '- ENV_POLL: Poll All Environmental Sensors*',
        '- GET_GYRO: Get Gyroscope Values (X,Y,Z)',
        '- GET_MAG: Get Magnetometer Values (X,Y,Z)',
        '- GET_ACCEL: Get Acceleration Values (X, Y, Z)',
        '- GET_ORIENTATION: Get Satellite Orientation',
        '- GET_EULER: Get Satellite Orientation in Euler Values',
        '- GET_QUATERNION: Get Satellite Orientation in Quaternion',
        '- GET_BME: Get Pressure, Temperature, Humidity, Altitude',
        '- GET_TEMP: Get Temperature from IMU',
        '- OBC_LIST_FILES <filepath>: List Files in Given Path*',
        '- OBC_PROCESSES: List Running Processes on OBC',
        '- OBC_DISK: Get OBC Disk Usage',
        '- OBC_RAM: Get OBC RAM Usage',
        '- OBC_SHUTDOWN: Shut Down OBC',
        '- OBC_RESTART: Reboot OBC',
        '- TAKE_PHOTO: Take Photo Using Onboard Camera',
        '- SEND_IMAGE <path>: Send Image Down to Ground Station*',
        '- RETRANSMIT <path> <packets>: Retransmit Packets',
        '- GET_HOSTNAME: Get Hostname of Satellite',
        '',
        'Radio Configuration:',
        '- get_radio_config: Query current radio configuration',
        '- set_uplink_radio <type> <freq> [sat_node]: Configure uplink to satellite',
        '- set_downlink_radio <type> <freq> [gnd_node]: Configure downlink from satellite',
        '  Radio types: rfm95 (LoRa), rfm69 (FSK)',
        '  Frequency ranges by band:',
        '    433 MHz: 433.05 - 434.79 MHz',
        '    868 MHz: 863.0 - 870.0 MHz (EU)',
        '    915 MHz: 902.0 - 928.0 MHz (US)',
        '  Satellite Node: 0-255 (destination satellite address)',
        '  Ground Node: 0-255 (ground station address)',
        '',
        'Image Commands:',
        '- Active Images: Show current image reception status',
        '- Clear Buffers: Clear image reception buffers',
        '- Manual Retransmit: Retransmit specific packets (format: filename packet1,packet2,packet3)',
        '',
        '* Non-Functioning Commands on RFM69'
    ];
    
    commands.forEach(cmd => logToTerminal(cmd, 'info'));
}

/**
 * Open settings modal
 */
function openSettings() {
    document.getElementById('settingsModal').classList.add('active');
}

/**
 * Close settings modal
 */
function closeSettings() {
    document.getElementById('settingsModal').classList.remove('active');
}

// ============================================================================
// Application Initialization
// ============================================================================

/**
 * Initialize application when DOM is loaded
 */
window.addEventListener('load', () => {
    logToTerminal('WebSerial Ground Station initialized', 'info');
    logToTerminal('Click "Connect to Ground Station" to begin', 'info');
    
    // Initialize radio config
    window.radioConfig = {
        uplink: 'rfm95',
        downlink: 'rfm95'
    };
    
    // Add tooltips for node address info
    const satelliteAddressInput = document.getElementById('satelliteAddress');
    const downlinkNodeInput = document.getElementById('downlinkNode');
    
    if (satelliteAddressInput) {
        satelliteAddressInput.title = 'The node address of the satellite to communicate with (0-255). Default is 255.';
    }
    
    if (downlinkNodeInput) {
        downlinkNodeInput.title = 'Node address for the ground station (0-255). Default is 255.';
    }
    
    // Initialize 3D orientation visualization after a short delay
    setTimeout(() => {
        if (typeof initOrientationVisualization === 'function') {
            initOrientationVisualization();
        }
    }, 100);
    
    // Start image timeout checker
    if (typeof startImageTimeoutChecker === 'function') {
        startImageTimeoutChecker();
    }
    
    logToTerminal('All systems initialized', 'response');
});

/**
 * Handle application cleanup before page unload
 */
window.addEventListener('beforeunload', async () => {
    // Cleanup 3D visualization
    if (typeof orientationAnimationId !== 'undefined' && orientationAnimationId) {
        cancelAnimationFrame(orientationAnimationId);
    }
    if (typeof orientationRenderer !== 'undefined' && orientationRenderer) {
        orientationRenderer.dispose();
    }
    
    // Disconnect serial connection
    if (typeof isConnected !== 'undefined' && isConnected && typeof disconnect === 'function') {
        await disconnect();
    }
});

// ============================================================================
// Error Handling
// ============================================================================

/**
 * Global error handler for unhandled errors
 */
window.addEventListener('error', (event) => {
    logToTerminal(`Global Error: ${event.error?.message || 'Unknown error occurred'}`, 'error');
    console.error('Global error:', event.error);
});

/**
 * Global handler for unhandled promise rejections
 */
window.addEventListener('unhandledrejection', (event) => {
    logToTerminal(`Unhandled Promise Rejection: ${event.reason?.message || event.reason}`, 'error');
    console.error('Unhandled promise rejection:', event.reason);
});

// ============================================================================
// Development Helpers
// ============================================================================

/**
 * Debug function to check application state
 * Only available in development (when console is open)
 */
window.debugGroundStation = () => {
    console.log('Ground Station Debug Info:');
    console.log('Connection Status:', typeof isConnected !== 'undefined' ? isConnected : 'Unknown');
    console.log('Radio Config:', window.radioConfig);
    console.log('Image Receptions:', typeof imageReceptions !== 'undefined' ? imageReceptions.size : 'Unknown');
    console.log('Data Buffer Length:', typeof dataBuffer !== 'undefined' ? dataBuffer.length : 'Unknown');
};