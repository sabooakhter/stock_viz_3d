import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- Configuration ---
// WARNING: Storing API keys directly in frontend code is highly insecure.
// This is for demonstration purposes ONLY. In a real application, use a backend proxy.
// PLEASE REVOKE THIS KEY PAIR AND GENERATE A NEW ONE AFTER THIS SESSION.
const ALPACA_API_KEY = 'AKK5VIWTC4QEEU8Y0FSA';
// NOTE: Alpaca requires a Secret Key as well for authentication, typically passed in headers.
// The basic '/v2/assets' endpoint might work with just the Key-ID in some contexts,
// but proper authentication usually requires both Key ID and Secret Key.
// A backend proxy is the correct way to handle authentication securely.
const ALPACA_API_SECRET = 'dgKXu2uwmmzbPNDhqgv4H7hhl8QNAmNbqZuea0KE'; // Replace if needed, otherwise remove header line below
const ALPACA_API_ENDPOINT = 'https://api.alpaca.markets'; // Using LIVE trading endpoint

const MAX_INDUSTRIES = 11; // Limit for performance/clarity
const MAX_STOCKS_PER_INDUSTRY = 15; // Limit for performance/clarity
const INDUSTRY_SPACING = 150;
const STOCK_SPACING = 15; // Increased spacing slightly
const NODE_SIZE_DEFAULT = 2;
const BEAM_LENGTH = 25; // Increased length
const BEAM_RADIUS = 0.5;

// --- Globals ---
let scene, camera, renderer, controls;
const industryGroups = {}; // Store industry data { industryName: { group: THREE.Group, stocks: [] } }
const mainContainer = new THREE.Group(); // Container for all visuals

// --- Initialization ---
function init() {
    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111); // Dark background

    // Camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
    camera.position.z = 250;
    camera.position.y = 100; // Raised camera slightly
    camera.lookAt(scene.position); // Look at the center

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    // Controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = false;
    controls.minDistance = 50;
    controls.maxDistance = 1000;
    controls.target.set(0, 0, 0); // Ensure controls target the center

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xcccccc, 0.6); // Slightly brighter ambient
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.9); // Slightly brighter directional
    directionalLight.position.set(1, 1.5, 1).normalize(); // Adjusted light angle
    scene.add(directionalLight);

    scene.add(mainContainer);

    // Start data loading and visualization setup
    loadDataAndVisualize();

    // Handle window resize
    window.addEventListener('resize', onWindowResize, false);

    // Start animation loop
    animate();
}

// --- Data Fetching and Processing ---
async function loadDataAndVisualize() {
    const loadingElement = document.getElementById('loading');
    loadingElement.style.display = 'block';

    try {
        console.log('Fetching assets from Alpaca...');
        // Note: Proper Alpaca authentication requires BOTH key and secret in headers.
        const headers = {
            'APCA-API-KEY-ID': ALPACA_API_KEY,
            'APCA-API-SECRET-KEY': ALPACA_API_SECRET // Now including the secret key
        };

        // Temporarily removing attributes=industry,sector for debugging the API call
        const response = await fetch(`${ALPACA_API_ENDPOINT}/v2/assets?status=active&asset_class=us_equity`, {
            method: 'GET',
            headers: headers
        });

        if (!response.ok) {
            const errorText = await response.text();
            // Try to parse error if JSON
            let detail = errorText;
            try {
                const errorJson = JSON.parse(errorText);
                detail = errorJson.message || errorText;
            } catch (e) { /* Ignore parsing error */ }
            throw new Error(`Alpaca API Error: ${response.status} ${response.statusText} - ${detail}`);
        }

        const assets = await response.json();
        console.log(`Fetched ${assets.length} assets.`);
        if (assets.length === 0) {
             throw new Error("Alpaca API returned 0 assets. Check API key, endpoint (paper/live), or asset filters.");
        }

        // Filter and group assets - THIS WILL LIKELY FAIL NOW as industry/sector are not requested
        const industriesData = {};
        let industryCount = 0;

        for (const asset of assets) {
            // Skip assets without industry/sector or non-tradable
            // We won't have industry/sector info now, so this grouping logic needs adjustment later
            // For now, let's just see if assets are fetched.
            // if (!asset.tradable || (!asset.industry && !asset.sector)) continue; // Commenting out for now

            // Temporary grouping by 'exchange' or just putting all in 'Other' for testing
            const industryName = asset.exchange || 'Other'; // Use exchange as a temporary grouping

            if (!industriesData[industryName]) {
                 if (industryCount >= MAX_INDUSTRIES) continue; // Limit groups
                 industriesData[industryName] = [];
                 industryCount++;
            }

            if (industriesData[industryName].length < MAX_STOCKS_PER_INDUSTRY) {
                 industriesData[industryName].push(asset);
            }
        }

        console.log(`Processing ${Object.keys(industriesData).length} industries.`);
        if (Object.keys(industriesData).length === 0) {
            console.warn("No industries found after filtering. Displaying raw assets if any.");
            // Potentially add fallback logic here if needed
        }
        createVisuals(industriesData);

    } catch (error) {
        console.error('Failed to load or process data:', error);
        loadingElement.textContent = `Error: ${error.message}. Check console & API Key/Secret.`;
        loadingElement.style.color = 'red';
        // Keep loading indicator visible on error
        return; // Stop execution if data loading fails
    }

    loadingElement.style.display = 'none'; // Hide loading indicator on success
}


// --- Visualization Creation ---
function createVisuals(industriesData) {
    const industryNames = Object.keys(industriesData);
    const numIndustries = industryNames.length;
    if (numIndustries === 0) {
        console.warn("No industries to visualize.");
        return;
    }
    const angleStep = (2 * Math.PI) / numIndustries; // Arrange industries in a circle

    industryNames.forEach((industryName, index) => {
        const industryAssets = industriesData[industryName];
        const industryGroup = new THREE.Group();

        // Position industry group in a circle on the XZ plane
        const angle = index * angleStep;
        const x = INDUSTRY_SPACING * Math.cos(angle);
        const z = INDUSTRY_SPACING * Math.sin(angle);
        industryGroup.position.set(x, 0, z); // Position industry center at y=0

        // Store for later reference
        industryGroups[industryName] = { group: industryGroup, stocks: [] };

        // Create stock nodes within this industry
        const numStocks = industryAssets.length;
        const stocksPerRow = Math.ceil(Math.sqrt(numStocks)); // Arrange in a rough square grid

        industryAssets.forEach((asset, stockIndex) => {
            const stockNode = createStockNode(asset);
            const beam = createBeam(asset); // Placeholder beam

            // Position stocks in a grid within the industry group's XY plane
            const row = Math.floor(stockIndex / stocksPerRow);
            const col = stockIndex % stocksPerRow;
            const stockX = (col - (stocksPerRow - 1) / 2) * STOCK_SPACING;
            const stockY = (row - (Math.ceil(numStocks / stocksPerRow) -1) / 2) * STOCK_SPACING; // Center grid vertically

            stockNode.position.set(stockX, stockY, 0); // Position relative to industry center
            beam.position.copy(stockNode.position); // Beam originates from node center

            // Point beam towards industry center (local 0,0,0)
            const direction = new THREE.Vector3(0, 0, 0).sub(stockNode.position).normalize();
            const quaternion = new THREE.Quaternion();
            // Cone points along +Y by default after translation, so align Y-axis with direction
            quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
            beam.setRotationFromQuaternion(quaternion);
            // Adjust position slightly so cone base is at node center
            beam.position.addScaledVector(direction, -BEAM_LENGTH / 2); // Move back along direction


            industryGroup.add(stockNode);
            industryGroup.add(beam);
            industryGroups[industryName].stocks.push({ asset, node: stockNode, beam });
        });

        mainContainer.add(industryGroup);

        // Optional: Add label for industry (requires CSS2DRenderer or similar)
        // createIndustryLabel(industryName, industryGroup.position);
    });

    console.log('Visualization created.');
}

function createStockNode(asset) {
    // Placeholder size for now
    const geometry = new THREE.SphereGeometry(NODE_SIZE_DEFAULT, 16, 16);
    const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(Math.random() * 0xffffff), // Random color per stock
        metalness: 0.3,
        roughness: 0.6
    });
    const sphere = new THREE.Mesh(geometry, material);
    sphere.userData = asset; // Store asset data for potential interaction later
    return sphere;
}

function createBeam(asset) {
    // Placeholder beam - random color for now
    const isOutflow = Math.random() > 0.5; // Random flow direction
    const beamColor = isOutflow ? 0xff4444 : 0xffff66; // Adjusted Red/Yellow

    const geometry = new THREE.ConeGeometry(BEAM_RADIUS, BEAM_LENGTH, 8);
    // Translate the geometry so the base is at the origin (0,0,0)
    geometry.translate(0, BEAM_LENGTH / 2, 0); // Cone points towards positive Y by default

    const material = new THREE.MeshBasicMaterial({ color: beamColor }); // Use MeshBasicMaterial for bright beams
    const cone = new THREE.Mesh(geometry, material);
    cone.userData = { isOutflow }; // Store flow direction if needed later
    return cone;
}

// --- Animation Loop ---
function animate() {
    requestAnimationFrame(animate);
    controls.update(); // Only required if controls.enableDamping or autoRotate are set to true
    renderer.render(scene, camera);
}

// --- Event Handlers ---
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// --- Start ---
init();
