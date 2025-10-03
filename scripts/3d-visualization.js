// 3D visualization for TEMPEST Ground Station
// Handles Three.js-based satellite orientation display using Euler angles

// Global variables for 3D scene
let orientationScene, orientationCamera, orientationRenderer;
let satelliteModel;
let orientationAnimationId;
let gridHelper, axesHelper;
let ambientLight, directionalLight;

// Configuration
const CAMERA_DISTANCE = 8;
const SATELLITE_SIZE = 1.5;
const GRID_SIZE = 10;
const AXES_SIZE = 3;

// ============================================================================
// Scene Initialization
// ============================================================================

/**
 * Initialize the 3D orientation visualization
 * Creates scene, camera, renderer, lighting, and satellite model
 */
function initOrientationVisualization() {
    try {
        const container = document.getElementById('orientationCanvas');
        if (!container) {
            console.warn('Orientation canvas container not found');
            return;
        }

        const width = container.clientWidth;
        const height = container.clientHeight;

        if (width === 0 || height === 0) {
            console.warn('Orientation canvas has zero dimensions, retrying...');
            setTimeout(initOrientationVisualization, 500);
            return;
        }

        // Create scene
        orientationScene = new THREE.Scene();
        orientationScene.background = new THREE.Color(0x0a0e27); // Match CSS background

        // Create camera
        orientationCamera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
        orientationCamera.position.set(CAMERA_DISTANCE, CAMERA_DISTANCE, CAMERA_DISTANCE);
        orientationCamera.lookAt(0, 0, 0);

        // Create renderer
        orientationRenderer = new THREE.WebGLRenderer({ 
            antialias: true,
            alpha: true
        });
        orientationRenderer.setSize(width, height);
        orientationRenderer.shadowMap.enabled = true;
        orientationRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
        
        // Clear existing content and add renderer
        container.innerHTML = '';
        container.appendChild(orientationRenderer.domElement);

        // Set up lighting
        setupLighting();

        // Create satellite model
        createSatelliteModel();

        // Add reference objects
        addReferenceObjects();

        // Handle window resize
        setupResizeHandler(container);

        // Start animation loop
        animateOrientation();

        logToTerminal('3D satellite visualization initialized', 'response');

    } catch (error) {
        logToTerminal(`3D visualization error: ${error.message}`, 'error');
        console.error('3D visualization initialization failed:', error);
    }
}

/**
 * Set up scene lighting
 */
function setupLighting() {
    // Ambient light for general illumination
    ambientLight = new THREE.AmbientLight(0x404040, 0.6);
    orientationScene.add(ambientLight);

    // Directional light for shadows and definition
    directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 10, 5);
    directionalLight.castShadow = true;
    
    // Configure shadow properties
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 500;
    directionalLight.shadow.camera.left = -10;
    directionalLight.shadow.camera.right = 10;
    directionalLight.shadow.camera.top = 10;
    directionalLight.shadow.camera.bottom = -10;
    
    orientationScene.add(directionalLight);
}

/**
 * Create the satellite model (CubeSat representation)
 */
function createSatelliteModel() {
    // Create main body geometry
    const bodyGeometry = new THREE.BoxGeometry(SATELLITE_SIZE, SATELLITE_SIZE, SATELLITE_SIZE);
    
    // Create materials for each face with different colors for identification
    const materials = [
        new THREE.MeshLambertMaterial({ color: 0x3b82f6 }), // Right face (+X) - Blue
        new THREE.MeshLambertMaterial({ color: 0x1e40af }), // Left face (-X) - Dark Blue
        new THREE.MeshLambertMaterial({ color: 0x10b981 }), // Top face (+Y) - Green
        new THREE.MeshLambertMaterial({ color: 0x047857 }), // Bottom face (-Y) - Dark Green
        new THREE.MeshLambertMaterial({ color: 0xef4444 }), // Front face (+Z) - Red
        new THREE.MeshLambertMaterial({ color: 0xb91c1c })  // Back face (-Z) - Dark Red
    ];

    // Create main satellite body
    satelliteModel = new THREE.Mesh(bodyGeometry, materials);
    satelliteModel.castShadow = true;
    satelliteModel.receiveShadow = true;
    
    // Add solar panels
    addSolarPanels();
    
    // Add antenna
    addAntenna();
    
    orientationScene.add(satelliteModel);
}

/**
 * Add solar panels to the satellite model
 */
function addSolarPanels() {
    const panelGeometry = new THREE.BoxGeometry(0.1, SATELLITE_SIZE * 1.5, SATELLITE_SIZE * 0.8);
    const panelMaterial = new THREE.MeshLambertMaterial({ 
        color: 0x1a1a2e,
        transparent: true,
        opacity: 0.8
    });

    // Left solar panel (-X side)
    const leftPanel = new THREE.Mesh(panelGeometry, panelMaterial);
    leftPanel.position.set(-SATELLITE_SIZE * 0.6, 0, 0);
    leftPanel.castShadow = true;
    satelliteModel.add(leftPanel);

    // Right solar panel (+X side)
    const rightPanel = new THREE.Mesh(panelGeometry, panelMaterial);
    rightPanel.position.set(SATELLITE_SIZE * 0.6, 0, 0);
    rightPanel.castShadow = true;
    satelliteModel.add(rightPanel);
}

/**
 * Add antenna to the satellite model
 */
function addAntenna() {
    const antennaGeometry = new THREE.CylinderGeometry(0.02, 0.02, 0.5);
    const antennaMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
    
    const antenna = new THREE.Mesh(antennaGeometry, antennaMaterial);
    antenna.position.set(0, SATELLITE_SIZE * 0.6, 0);
    antenna.castShadow = true;
    satelliteModel.add(antenna);
}

/**
 * Add reference objects (axes and grid)
 */
function addReferenceObjects() {
    // Add coordinate axes helper
    axesHelper = new THREE.AxesHelper(AXES_SIZE);
    axesHelper.material.linewidth = 2;
    orientationScene.add(axesHelper);

    // Add grid helper
    gridHelper = new THREE.GridHelper(GRID_SIZE, 20, 0x374151, 0x1a1f3a);
    gridHelper.position.y = -SATELLITE_SIZE;
    orientationScene.add(gridHelper);

    // Add orbital reference plane
    const orbitGeometry = new THREE.RingGeometry(4, 4.1, 64);
    const orbitMaterial = new THREE.MeshBasicMaterial({ 
        color: 0x6366f1, 
        transparent: true, 
        opacity: 0.3,
        side: THREE.DoubleSide
    });
    const orbitRing = new THREE.Mesh(orbitGeometry, orbitMaterial);
    orbitRing.rotation.x = Math.PI / 2;
    orientationScene.add(orbitRing);
}

/**
 * Set up window resize handler
 * @param {HTMLElement} container - Canvas container element
 */
function setupResizeHandler(container) {
    const resizeObserver = new ResizeObserver(entries => {
        for (let entry of entries) {
            const { width, height } = entry.contentRect;
            if (width > 0 && height > 0) {
                orientationCamera.aspect = width / height;
                orientationCamera.updateProjectionMatrix();
                orientationRenderer.setSize(width, height);
            }
        }
    });

    resizeObserver.observe(container);

    // Fallback for older browsers
    window.addEventListener('resize', () => {
        const width = container.clientWidth;
        const height = container.clientHeight;
        if (width > 0 && height > 0) {
            orientationCamera.aspect = width / height;
            orientationCamera.updateProjectionMatrix();
            orientationRenderer.setSize(width, height);
        }
    });
}

// ============================================================================
// Animation and Updates
// ============================================================================

/**
 * Main animation loop
 */
function animateOrientation() {
    orientationAnimationId = requestAnimationFrame(animateOrientation);
    
    if (orientationScene && orientationCamera && orientationRenderer) {
        // Gentle camera rotation for better visualization
        // const time = Date.now() * 0.0005;
        // orientationCamera.position.x = Math.cos(time) * CAMERA_DISTANCE;
        // orientationCamera.position.z = Math.sin(time) * CAMERA_DISTANCE;
        // orientationCamera.lookAt(0, 0, 0);
        
        // Render the scene
        orientationRenderer.render(orientationScene, orientationCamera);
    }
}

/**
 * Update satellite orientation based on telemetry data
 * @param {number} roll - Roll angle in degrees
 * @param {number} pitch - Pitch angle in degrees  
 * @param {number} yaw - Yaw angle in degrees
 */
function updateSatelliteOrientation(roll, pitch, yaw) {
    if (!satelliteModel) {
        console.warn('Satellite model not initialized');
        return;
    }

    try {
        // Convert degrees to radians
        const rollRad = (roll * Math.PI) / 180;
        const pitchRad = (pitch * Math.PI) / 180;
        const yawRad = (yaw * Math.PI) / 180;

        // Apply Euler rotation (ZYX order - aerospace convention)
        satelliteModel.rotation.set(pitchRad, yawRad, rollRad);

        // Update display values in UI
        updateOrientationDisplay(roll, pitch, yaw);

        // Add some visual feedback for large movements
        const totalRotation = Math.abs(roll) + Math.abs(pitch) + Math.abs(yaw);
        if (totalRotation > 45) {
            // Increase ambient light slightly for high-movement indication
            if (ambientLight) {
                ambientLight.intensity = Math.min(0.8, 0.6 + (totalRotation - 45) / 180);
            }
        } else {
            if (ambientLight) {
                ambientLight.intensity = 0.6;
            }
        }

    } catch (error) {
        logToTerminal(`Orientation update error: ${error.message}`, 'error');
    }
}

/**
 * Update orientation display values in the UI
 * @param {number} roll - Roll angle in degrees
 * @param {number} pitch - Pitch angle in degrees
 * @param {number} yaw - Yaw angle in degrees
 */
function updateOrientationDisplay(roll, pitch, yaw) {
    const rollElement = document.getElementById('rollValue');
    const pitchElement = document.getElementById('pitchValue');
    const yawElement = document.getElementById('yawValue');

    if (rollElement) {
        rollElement.textContent = `${roll.toFixed(1)}°`;
        // Color coding for extreme values
        if (Math.abs(roll) > 45) {
            rollElement.style.color = 'var(--accent-warning)';
        } else {
            rollElement.style.color = 'var(--accent-primary)';
        }
    }

    if (pitchElement) {
        pitchElement.textContent = `${pitch.toFixed(1)}°`;
        if (Math.abs(pitch) > 45) {
            pitchElement.style.color = 'var(--accent-warning)';
        } else {
            pitchElement.style.color = 'var(--accent-primary)';
        }
    }

    if (yawElement) {
        yawElement.textContent = `${yaw.toFixed(1)}°`;
        if (Math.abs(yaw) > 45) {
            yawElement.style.color = 'var(--accent-warning)';
        } else {
            yawElement.style.color = 'var(--accent-primary)';
        }
    }
}

// ============================================================================
// Control Functions
// ============================================================================

/**
 * Reset satellite orientation to default position
 */
function resetSatelliteOrientation() {
    if (satelliteModel) {
        satelliteModel.rotation.set(0, 0, 0);
        updateOrientationDisplay(0, 0, 0);
        logToTerminal('Satellite orientation reset to zero', 'info');
    }
}

/**
 * Toggle reference objects visibility
 */
function toggleReferenceObjects() {
    if (axesHelper && gridHelper) {
        const visible = !axesHelper.visible;
        axesHelper.visible = visible;
        gridHelper.visible = visible;
        logToTerminal(`Reference objects ${visible ? 'shown' : 'hidden'}`, 'info');
    }
}

/**
 * Set camera to predefined viewpoint
 * @param {string} viewpoint - Viewpoint name ('front', 'side', 'top', 'iso')
 */
function setCameraView(viewpoint) {
    if (!orientationCamera) return;

    const distance = CAMERA_DISTANCE;
    
    switch (viewpoint.toLowerCase()) {
        case 'front':
            orientationCamera.position.set(0, 0, distance);
            break;
        case 'side':
            orientationCamera.position.set(distance, 0, 0);
            break;
        case 'top':
            orientationCamera.position.set(0, distance, 0);
            break;
        case 'iso':
        default:
            orientationCamera.position.set(distance, distance, distance);
            break;
    }
    
    orientationCamera.lookAt(0, 0, 0);
    logToTerminal(`Camera view set to ${viewpoint}`, 'info');
}

// ============================================================================
// Cleanup and Disposal
// ============================================================================

/**
 * Dispose of 3D visualization resources
 */
function dispose3DVisualization() {
    try {
        // Cancel animation frame
        if (orientationAnimationId) {
            cancelAnimationFrame(orientationAnimationId);
            orientationAnimationId = null;
        }

        // Dispose of renderer
        if (orientationRenderer) {
            orientationRenderer.dispose();
            orientationRenderer = null;
        }

        // Dispose of geometries and materials
        if (orientationScene) {
            orientationScene.traverse((object) => {
                if (object.geometry) {
                    object.geometry.dispose();
                }
                if (object.material) {
                    if (Array.isArray(object.material)) {
                        object.material.forEach(material => material.dispose());
                    } else {
                        object.material.dispose();
                    }
                }
            });
        }

        // Clear references
        orientationScene = null;
        orientationCamera = null;
        satelliteModel = null;
        gridHelper = null;
        axesHelper = null;
        ambientLight = null;
        directionalLight = null;

        logToTerminal('3D visualization disposed', 'info');

    } catch (error) {
        console.error('Error disposing 3D visualization:', error);
    }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get current satellite orientation
 * @returns {Object|null} - Current orientation in degrees or null
 */
function getCurrentOrientation() {
    if (!satelliteModel) return null;
    
    return {
        roll: (satelliteModel.rotation.z * 180) / Math.PI,
        pitch: (satelliteModel.rotation.x * 180) / Math.PI,
        yaw: (satelliteModel.rotation.y * 180) / Math.PI
    };
}

/**
 * Check if 3D visualization is initialized
 * @returns {boolean} - True if initialized
 */
function is3DInitialized() {
    return !!(orientationScene && orientationCamera && orientationRenderer && satelliteModel);
}

/**
 * Get 3D scene statistics
 * @returns {Object} - Scene statistics
 */
function get3DStats() {
    if (!orientationScene) return null;
    
    let objects = 0, vertices = 0, faces = 0;
    
    orientationScene.traverse((object) => {
        objects++;
        if (object.geometry) {
            if (object.geometry.attributes.position) {
                vertices += object.geometry.attributes.position.count;
            }
            if (object.geometry.index) {
                faces += object.geometry.index.count / 3;
            }
        }
    });
    
    return { objects, vertices, faces };
}

// ============================================================================
// Export functions for debugging (development only)
// ============================================================================

window.visualization3D = {
    reset: resetSatelliteOrientation,
    toggleGrid: toggleReferenceObjects,
    setCameraView,
    getCurrentOrientation,
    is3DInitialized,
    get3DStats,
    dispose: dispose3DVisualization
};