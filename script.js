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
const NODE_SIZE_DEFAULT = 1.5; // Slightly smaller default
const NODE_SIZE_MIN = 1;
const NODE_SIZE_MAX = 10; // Max size based on volume proxy
const VOLUME_SCALE_FACTOR = 0.000001; // Adjust this to scale volume to node size reasonably
const SPOTLIGHT_DISTANCE = 30; // How far the spotlight is from the node
const SPOTLIGHT_ANGLE = Math.PI / 6; // Cone angle of the spotlight
const SPOTLIGHT_INTENSITY_DEFAULT = 0.8;
const SPOTLIGHT_INTENSITY_MIN = 0.2;
const SPOTLIGHT_INTENSITY_MAX = 2.5;
const VOLUME_INTENSITY_SCALE_FACTOR = 0.0000005; // Adjust to scale volume to intensity
const MAX_SNAPSHOTS_PER_INDUSTRY = 5; // Limit snapshot calls per industry

// --- Globals ---
let scene, camera, renderer, controls;
const industryGroups = {}; // Store industry data { industryName: { group: THREE.Group, stocks: [], stockData: Map<symbol, {asset, node, light, snapshot?}> } }
const mainContainer = new THREE.Group(); // Container for all visuals
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let intersectedObject = null;
const infoDiv = document.getElementById('info'); // Get info div reference

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
    // Handle mouse move for hover effects
    window.addEventListener('mousemove', onMouseMove, false);

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

        // --- Most Basic Request: Removing ALL query parameters for debugging ---
        console.log("Attempting most basic asset fetch (no filters)...");
        const response = await fetch(`${ALPACA_API_ENDPOINT}/v2/assets`, {
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

        // Filter and group assets (adjusting for lack of specific attributes/filters)
        const industriesData = {};
        let industryCount = 0;

        for (const asset of assets) {
            // Apply basic filtering here if needed, e.g., only tradable US equities
             if (!asset.tradable || asset.asset_class !== 'us_equity') continue;

            // Group by exchange or just 'Other' since industry/sector aren't requested
            const industryName = asset.exchange || 'Other';

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

        // --- Fetch Snapshots for a subset ---
        console.log('Fetching snapshots for a subset of stocks...');
        const snapshotPromises = [];
        const symbolsWithSnapshots = new Set(); // Track symbols we are fetching

        for (const industryName in industriesData) {
            const assetsInIndustry = industriesData[industryName];
            let snapshotsFetched = 0;
            for (const asset of assetsInIndustry) {
                if (snapshotsFetched >= MAX_SNAPSHOTS_PER_INDUSTRY) break;
                if (!asset.symbol || symbolsWithSnapshots.has(asset.symbol)) continue; // Skip if no symbol or already fetching

                symbolsWithSnapshots.add(asset.symbol);
                snapshotPromises.push(
                    fetch(`${ALPACA_API_ENDPOINT}/v2/stocks/${asset.symbol}/snapshot`, { headers })
                        .then(res => {
                            if (!res.ok) {
                                console.warn(`Snapshot fetch failed for ${asset.symbol}: ${res.status}`);
                                return null; // Don't throw, just return null for this one
                            }
                            return res.json();
                        })
                        .then(snapshot => ({ symbol: asset.symbol, snapshot })) // Include symbol with result
                        .catch(err => {
                            console.warn(`Snapshot fetch error for ${asset.symbol}:`, err);
                            return null;
                        })
                );
                snapshotsFetched++;
            }
        }

        const snapshotResults = await Promise.all(snapshotPromises);
        const snapshotsMap = new Map();
        snapshotResults.forEach(result => {
            if (result && result.snapshot) {
                snapshotsMap.set(result.symbol, result.snapshot);
            }
        });
        console.log(`Fetched ${snapshotsMap.size} snapshots successfully.`);

        // --- Create Visuals ---
        createVisuals(industriesData, snapshotsMap);

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
function createVisuals(industriesData, snapshotsMap) {
    const industryNames = Object.keys(industriesData);
    const numIndustries = industryNames.length;
    const gotIndustryData = industryNames.length > 0 && industryNames[0] !== 'Other'; // Simple check if we likely got real industry data

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
        industryGroups[industryName] = { group: industryGroup, stocks: [], stockData: new Map() };

        // Create stock nodes within this industry
        const numStocks = industryAssets.length;
        const stocksPerRow = Math.ceil(Math.sqrt(numStocks)); // Arrange in a rough square grid
        const stockNodes = []; // Keep track of nodes in this group for linking

        industryAssets.forEach((asset, stockIndex) => {
            const snapshot = snapshotsMap.get(asset.symbol);
            const nodeSize = calculateNodeSize(snapshot);
            const stockNode = createStockNode(asset, nodeSize);
            const light = createSpotlight(asset, snapshot); // Use spotlight instead of beam

            // Position stocks in a grid within the industry group's XY plane
            const row = Math.floor(stockIndex / stocksPerRow);
            const col = stockIndex % stocksPerRow;
            const stockX = (col - (stocksPerRow - 1) / 2) * STOCK_SPACING;
            const stockY = (row - (Math.ceil(numStocks / stocksPerRow) - 1) / 2) * STOCK_SPACING; // Center grid vertically

            stockNode.position.set(stockX, stockY, 0); // Position relative to industry center

            // Position spotlight away from the node, pointing at it
            const lightPosition = stockNode.position.clone().add(new THREE.Vector3(0, 0, SPOTLIGHT_DISTANCE)); // Position behind the node
            light.position.copy(lightPosition);
            light.target = stockNode; // Make the light point at the node

            industryGroup.add(stockNode);
            industryGroup.add(light);
            industryGroup.add(light.target); // Target needs to be added to the scene graph

            // Store references
            const stockInfo = { asset, node: stockNode, light, snapshot };
            industryGroups[industryName].stocks.push(stockInfo);
            industryGroups[industryName].stockData.set(asset.symbol, stockInfo);
            stockNodes.push(stockNode); // Add to list for linking
        });

        // Add links between nodes in the same industry (if we have industry data)
        if (gotIndustryData && stockNodes.length > 1) {
            const lineMaterial = new THREE.LineBasicMaterial({ color: 0x555555, transparent: true, opacity: 0.3 });
            for (let i = 0; i < stockNodes.length; i++) {
                for (let j = i + 1; j < stockNodes.length; j++) {
                    const points = [stockNodes[i].position, stockNodes[j].position];
                    const geometry = new THREE.BufferGeometry().setFromPoints(points);
                    const line = new THREE.Line(geometry, lineMaterial);
                    industryGroup.add(line);
                }
            }
        }

        mainContainer.add(industryGroup);

        // Optional: Add label for industry (requires CSS2DRenderer or similar)
        // createIndustryLabel(industryName, industryGroup.position); // Requires CSS2DRenderer setup
    });

    console.log('Visualization created.');
}

function calculateNodeSize(snapshot) {
    if (!snapshot || !snapshot.dailyBar || !snapshot.dailyBar.v) {
        return NODE_SIZE_DEFAULT;
    }
    // Scale volume to node size
    const size = NODE_SIZE_MIN + snapshot.dailyBar.v * VOLUME_SCALE_FACTOR;
    return Math.min(size, NODE_SIZE_MAX); // Clamp size
}

function createStockNode(asset, size) {
    const geometry = new THREE.SphereGeometry(size, 16, 16);
    const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(Math.random() * 0xffffff), // Keep random color for now
        metalness: 0.4,
        roughness: 0.5
    });
    const sphere = new THREE.Mesh(geometry, material);
    sphere.userData = { type: 'stockNode', asset: asset }; // Add type for raycasting
    return sphere;
}

function createSpotlight(asset, snapshot) {
    let color = 0xaaaaaa; // Default color (greyish)
    let intensity = SPOTLIGHT_INTENSITY_DEFAULT;

    if (snapshot && snapshot.todaysChangePerc !== undefined && snapshot.dailyBar && snapshot.dailyBar.v !== undefined) {
        // Color based on price change
        color = snapshot.todaysChangePerc >= 0 ? 0x66ff66 : 0xff6666; // Green for up/flat, Red for down

        // Intensity based on volume
        intensity = SPOTLIGHT_INTENSITY_MIN + snapshot.dailyBar.v * VOLUME_INTENSITY_SCALE_FACTOR;
        intensity = Math.min(intensity, SPOTLIGHT_INTENSITY_MAX); // Clamp intensity
    }

    const spotLight = new THREE.SpotLight(color, intensity);
    spotLight.angle = SPOTLIGHT_ANGLE;
    spotLight.penumbra = 0.3; // Softer edge
    spotLight.decay = 2; // Realistic falloff
    // spotLight.castShadow = true; // Optional: enable shadows if needed (performance cost)

    return spotLight;
}


// --- Animation Loop ---
function animate() {
    requestAnimationFrame(animate);
    controls.update(); // Only required if controls.enableDamping or autoRotate are set to true

    // Hover effect logic moved to onMouseMove to avoid running every frame
    // findIntersections(); // Call hover check

    renderer.render(scene, camera);
}

// --- Event Handlers ---
function onMouseMove(event) {
    // Calculate mouse position in normalized device coordinates (-1 to +1)
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = - (event.clientY / window.innerHeight) * 2 + 1;

    findIntersections(); // Check for intersections when mouse moves
}

function findIntersections() {
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(mainContainer.children, true); // Check recursively

    let currentIntersectedSymbol = null;

    if (intersects.length > 0) {
        let intersectedNode = null;
        // Find the first intersected object that is a stock node
        for (const intersect of intersects) {
            if (intersect.object.userData && intersect.object.userData.type === 'stockNode') {
                intersectedNode = intersect.object;
                break;
            }
        }

        if (intersectedNode) {
            currentIntersectedSymbol = intersectedNode.userData.asset.symbol;
            if (intersectedObject !== intersectedNode) {
                // Clear previous highlight if any (optional)
                // if (intersectedObject) intersectedObject.material.emissive.setHex(0x000000);

                intersectedObject = intersectedNode;
                // Add highlight (optional)
                // intersectedObject.material.emissive.setHex(0x555555);

                // Update info div
                const asset = intersectedObject.userData.asset;
                let infoText = `Symbol: ${asset.symbol}<br>Name: ${asset.name || 'N/A'}`;
                // Find the corresponding stock data including snapshot
                let snapshotData = null;
                for(const industryName in industryGroups) {
                    const data = industryGroups[industryName].stockData.get(asset.symbol);
                    if (data && data.snapshot) {
                        snapshotData = data.snapshot;
                        break;
                    }
                }

                if (snapshotData) {
                    infoText += `<br>Last Price: ${snapshotData.latestTrade?.p || 'N/A'}`;
                    infoText += `<br>Day Change: ${snapshotData.todaysChangePerc?.toFixed(2) || 'N/A'}%`;
                    infoText += `<br>Volume: ${snapshotData.dailyBar?.v || 'N/A'}`;
                } else {
                     infoText += `<br>(Snapshot data not loaded for this stock)`;
                }
                 infoDiv.innerHTML = infoText;
                 infoDiv.style.display = 'block'; // Show info div
            }
        } else {
             // Mouse is not over a known stock node
             clearIntersection();
        }
    } else {
        // Mouse is not over any object in the main container
        clearIntersection();
    }
}

function clearIntersection() {
     if (intersectedObject) {
        // Clear highlight (optional)
        // intersectedObject.material.emissive.setHex(0x000000);
        infoDiv.style.display = 'none'; // Hide info div
    }
    intersectedObject = null;
}


function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// --- Start ---
init();
