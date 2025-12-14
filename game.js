const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// FIXED internal resolution (not affected by zoom)
const INTERNAL_WIDTH = 1920;
const INTERNAL_HEIGHT = 1080;

canvas.width = INTERNAL_WIDTH;
canvas.height = INTERNAL_HEIGHT;

// CSS scales the canvas visually (zoom-proof)
canvas.style.display = "block";

function resizeCanvas() {
    const aspectRatio = INTERNAL_WIDTH / INTERNAL_HEIGHT;
    const maxWidth = window.innerWidth;
    const maxHeight = window.innerHeight * 0.95;
    let displayWidth = maxWidth;
    let displayHeight = displayWidth / aspectRatio;

    if (displayHeight > maxHeight) {
        displayHeight = maxHeight;
        displayWidth = displayHeight * aspectRatio;
    }

    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayHeight}px`;
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// -----------------------------------------------------------------------------
// Physics configuration (all units in meters, seconds, radians)
// -----------------------------------------------------------------------------
const SCALE = 20;
const GRAVITY = 9.8;
const REFERENCE_MASS = 1000;  // Reference mass (kg) for gravity scaling - heavier cars fall faster
const MASS_GRAVITY_FACTOR = 0.3;  // How much mass affects gravity (0 = no effect, 1 = strong effect)
const RUN_START_OFFSET = 1;

const MIN_AIR_ROTATION = -Math.PI / 12;
const MAX_AIR_ROTATION = Math.PI / 3;
const INITIAL_AIR_SPIN = Math.PI / 10;          // slight initial wobble when leaving ground
const AIR_SPIN_NOISE = Math.PI * 0.25;          // random spin impulse per second while airborne
const MAX_SAFE_LANDING_ANGLE = Math.PI / 10;    // land successfully only if |rotation| <= ~18°
const LANDING_PENETRATION_TOLERANCE = 0.4;      // extra vertical tolerance before counting as floor clip
const FRICTION_DECEL = 4;                       // simple ground friction after a safe landing (m/s²)
const CAR_GROUND_OFFSET = 2;   

const ANGULAR_DAMPING = 0.92;                   // mild damping so spin does not explode
const ANGULAR_DAMPING_DT = 60;                  // reference FPS for damping scaling

const NO_GROUND = Number.POSITIVE_INFINITY;

const TIPPING_STIFFNESS = 18;                   // spring strength pulling rotation toward target while tipping
const TIPPING_DAMPING = 6;                      // damping for tipping angular velocity
const TIPPING_RELEASE_ANGLE = Math.PI / 3;      // release into free fall once nose dips ~60°
const MAX_TIPPING_ANGULAR_VELOCITY = Math.PI;   // cap tipping angular speed (rad/s)
const PIVOT_BLEND_RATE = 3;                     // blend per second from rear pivot to center once airborne

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function toDegrees(rad) {
    return rad * (180 / Math.PI);
}

// -----------------------------------------------------------------------------
// Global state
// -----------------------------------------------------------------------------
let levelMetrics = null;
let physicsCalculationsPanel = null;
let lastPhysicsData = null;

const simulation = {
    isRunning: false,
    hasLaunched: false,
    hasFinished: false,
    hasLanded: false,
    fallingAfterCrash: false,
    showStopwatch: false,
    showAccelStopwatch: false,
    success: null,
    elapsedTime: 0,
    accelerationTime: 0,
    finalAccelTime: 0,
    timeSinceLaunch: 0,
    finalAirTime: 0,
    takeoffWorldX: 0,
    takeoffVelocity: 0,
    landDropHeight: 0,
    landTrackEnd: 0
};

// Camera system for following the car
const camera = {
    x: 0,
    y: 0,
    targetX: 0,
    targetY: 0,
    zoom: 1,
    targetZoom: 1,
    followSpeed: 10,      // How fast camera catches up to target
    zoomSpeed: 2,         // How fast zoom changes
    activeZoom: 4,      // Zoom level when simulation is running
    defaultZoom: 1        // Zoom level when not running
};

// Drawing + physics state for the car
let car = {
    x: 0,
    y: 0,
    width: 100,
    height: 70,
    lengthMeters: 4.5,  // Typical car length in meters
    worldX: RUN_START_OFFSET,
    worldY: 0,
    vx: 0,
    vy: 0,
    ax: 0,
    rotation: 0,
    angularVelocity: 0
};

const DEFAULT_CAR_ASPECT = 120 / 240;

// -----------------------------------------------------------------------------
// Assets
// -----------------------------------------------------------------------------
const ground1Img = new Image();
ground1Img.src = 'img/Ground1.png';

const ground2Img = new Image();
ground2Img.src = 'img/Ground2.png';

// Car body images (without wheels)
const carBodyImages = {};
// Wheel images
const carWheelImages = {};

// Car configurations: each car has body image, wheel image, and wheel positions
// Wheel positions are defined as percentages of the car's width/height
// frontWheel and rearWheel: { x: percentage from left, y: percentage from top, size: wheel size as percentage of car height }
const carConfigs = [
    {
        name: "Burner",
        bodyImage: "img/carsNoWheels/Burner.png",
        wheelImage: "img/wheels/BurnerWheels.png",
        frontWheel: { x: 0.76, y: 0.77, size: 0.46 },
        rearWheel: { x: 0.195, y: 0.77, size: 0.35 }
    },{
        name: "Formula-1",
        bodyImage: "img/carsNoWheels/Formula-1.png",
        wheelImage: "img/wheels/Formula-1Wheels.png",
        frontWheel: { x: 0.766, y: 0.67, size: 0.56 },
        rearWheel: { x: 0.12, y: 0.67, size: 0.56 }
    },{
        name: "Jeep Wrangler",
        bodyImage: "img/carsNoWheels/Jeep Wrangler.png",
        wheelImage: "img/wheels/Jeep WranglerWheels.png",
        frontWheel: { x: 0.87, y: 0.75, size: 0.40 },
        rearWheel: { x: 0.21, y: 0.75, size: 0.40 }
    },{
        name: "McLaren P1",
        bodyImage: "img/carsNoWheels/McLaren P1.png",
        wheelImage: "img/wheels/McLaren P1Wheels.png",
        frontWheel: { x: 0.775, y: 0.76, size: 0.57 },
        rearWheel: { x: 0.127, y: 0.76, size: 0.57 }
    },{
        name: "Nissan GT-R R35",
        bodyImage: "img/carsNoWheels/Nissan GT-R R35.png",
        wheelImage: "img/wheels/Nissan GT-R R35Wheels.png",
        frontWheel: { x: 0.825, y: 0.79, size: 0.415 },
        rearWheel: { x: 0.185, y: 0.79, size: 0.415 }
    },{
        name: "Ram 1500",
        bodyImage: "img/carsNoWheels/Ram 1500 pickup truck.png",
        wheelImage: "img/wheels/Ram 1500 pickup truckWheels.png",
        frontWheel: { x: 0.83, y: 0.75, size: 0.55 },
        rearWheel: { x: 0.20, y: 0.75, size: 0.38 }
    },{
        name: "Scroom",
        bodyImage: "img/carsNoWheels/Scroom.png",
        wheelImage: "img/wheels/ScroomWheels.png",
        frontWheel: { x: 0.825, y: 0.78, size: 0.46 },
        rearWheel: { x: 0.21, y: 0.78, size: 0.46 }
    },{
        name: "Shelby Cobra Daytona",
        bodyImage: "img/carsNoWheels/Shelby Cobra Daytona Coupe.png",
        wheelImage: "img/wheels/Shelby Cobra Daytona CoupeWheels.png",
        frontWheel: { x: 0.82, y: 0.73, size: 0.56 },
        rearWheel: { x: 0.235, y: 0.73, size: 0.56 }
    },{
        name: "Supra-1",
        bodyImage: "img/carsNoWheels/Supra-1.png",
        wheelImage: "img/wheels/Supra-1Wheels.png",
        frontWheel: { x: 0.853, y: 0.81, size: 0.49 },
        rearWheel: { x: 0.19, y: 0.81, size: 0.49 }
    },{
        name: "VW Golf Mk1",
        bodyImage: "img/carsNoWheels/Volkswagen Golf Mk1 Cabriolet.png",
        wheelImage: "img/wheels/Volkswagen Golf Mk1 CabrioletWheels.png",
        frontWheel: { x: 0.804, y: 0.80, size: 0.423 },
        rearWheel: { x: 0.173, y: 0.80, size: 0.423 }
    },{
        name: "Z-Spider",
        bodyImage: "img/carsNoWheels/Z-Spider.png",
        wheelImage: "img/wheels/Z-SpiderWheels.png",
        frontWheel: { x: 0.78, y: 0.78, size: 0.45 },
        rearWheel: { x: 0.155, y: 0.78, size: 0.45 }
    } 
];

// Load all car body and wheel images
carConfigs.forEach((config, index) => {
    carBodyImages[index] = new Image();
    carBodyImages[index].src = config.bodyImage;
    
    carWheelImages[index] = new Image();
    carWheelImages[index].src = config.wheelImage;
});

// Wheel rotation tracking (in radians)
let wheelRotation = 0;

// -----------------------------------------------------------------------------
// Level + vehicle data
// -----------------------------------------------------------------------------
let currentLevelNumber = 1;

let currentLevel = {
    ground1Length: 50,   // 50m run-up distance
    ground1Height: 25,   // 10m high ramp/cliff
    gap: 15,             // 15m gap to jump
    ground2Length: 25,   // 25m landing zone
    ground2Height: 23    // 8m high landing platform (2m drop)
};

let selectedCar = 0;
let chosenAcceleration = 9; // Will be updated based on car and slider

const cars = [
    { name: "Burner", minAcceleration: 3, maxAcceleration: 9, mass: 900 },
    { name: "Formula-1", minAcceleration: 5, maxAcceleration: 14, mass: 800 },
    { name: "Jeep Wrangler", minAcceleration: 2, maxAcceleration: 4, mass: 2000 },
    { name: "McLaren P1", minAcceleration: 4, maxAcceleration: 10, mass: 1500 },
    { name: "Nissan GT-R R35", minAcceleration: 3, maxAcceleration: 9, mass: 1700 },
    { name: "Ram 1500", minAcceleration: 2, maxAcceleration: 5, mass: 2500 },
    { name: "Scroom", minAcceleration: 3, maxAcceleration: 7, mass: 1200 },
    { name: "Shelby Cobra Daytona", minAcceleration: 3, maxAcceleration: 8, mass: 1100 },
    { name: "Supra-1", minAcceleration: 5, maxAcceleration: 13, mass: 1500 },
    { name: "VW Golf Mk1", minAcceleration: 1, maxAcceleration: 3, mass: 1400 },
    { name: "Z-Spider", minAcceleration: 4, maxAcceleration: 10, mass: 1100 }
];

// -----------------------------------------------------------------------------
// Level rendering + layout
// -----------------------------------------------------------------------------
function computeLevelMetrics() {
    const totalHorizontalMeters = currentLevel.ground1Length + currentLevel.gap + currentLevel.ground2Length;
    const horizontalScale = totalHorizontalMeters > 0 ? INTERNAL_WIDTH / totalHorizontalMeters : SCALE;

    const gapWidth = currentLevel.gap * horizontalScale;
    const ground1Width = currentLevel.ground1Length * horizontalScale;
    // Ground2 extends from gap to the right edge of the canvas
    const ground2Width = INTERNAL_WIDTH - (ground1Width + gapWidth);

    const ground1Height = currentLevel.ground1Height * SCALE;
    const ground2Height = currentLevel.ground2Height * SCALE;

    const ground1X = 0;
    const ground1Y = INTERNAL_HEIGHT - ground1Height;

    const gapX = ground1X + ground1Width;
    const ground2X = gapX + gapWidth;
    const ground2Y = INTERNAL_HEIGHT - ground2Height;

    return {
        ground1X,
        ground1Y,
        ground1Width,
        ground1Height,
        ground2X,
        ground2Y,
        ground2Width,
        ground2Height,
        gapX,
        gapWidth,
        horizontalScale
    };
}

function updateCamera(dt) {
    if (!levelMetrics) return;
    
    const horizontalScale = levelMetrics.horizontalScale;
    
    // Calculate car center position in screen coordinates (needed for both running and finished states)
    const carCenterX = levelMetrics.ground1X + car.worldX * horizontalScale + car.width / 2;
    const carCenterY = simulation.success 
        ? levelMetrics.ground2Y - car.height / 2 + CAR_GROUND_OFFSET * SCALE
        : levelMetrics.ground1Y - car.height / 2 + CAR_GROUND_OFFSET * SCALE + car.worldY * SCALE;
    
    if (simulation.isRunning && !simulation.hasFinished) {
        // Target camera to center on car while running
        camera.targetX = carCenterX - INTERNAL_WIDTH / 2 / camera.activeZoom;
        camera.targetY = carCenterY - INTERNAL_HEIGHT / 2 / camera.activeZoom;
        camera.targetZoom = camera.activeZoom;
        
        // Keep camera in bounds
        const maxX = INTERNAL_WIDTH * (1 - 1 / camera.activeZoom);
        const maxY = INTERNAL_HEIGHT * (1 - 1 / camera.activeZoom);
        camera.targetX = clamp(camera.targetX, 0, maxX);
        camera.targetY = clamp(camera.targetY, 0, maxY);
    } else if (simulation.hasFinished) {
        // Car has stopped - slowly zoom out while keeping car in view
        // As zoom decreases, smoothly transition camera position to show full canvas
        camera.targetZoom = camera.defaultZoom;
        
        // Calculate where camera should be to keep car visible as we zoom out
        // Blend from car-centered to full canvas view based on current zoom
        const zoomProgress = (camera.zoom - camera.defaultZoom) / (camera.activeZoom - camera.defaultZoom);
        const clampedProgress = clamp(zoomProgress, 0, 1);
        
        // At full zoom, center on car; at default zoom, show full canvas (0, 0)
        const carTargetX = carCenterX - INTERNAL_WIDTH / 2 / camera.zoom;
        const carTargetY = carCenterY - INTERNAL_HEIGHT / 2 / camera.zoom;
        
        // Keep in bounds
        const maxX = Math.max(0, INTERNAL_WIDTH * (1 - 1 / camera.zoom));
        const maxY = Math.max(0, INTERNAL_HEIGHT * (1 - 1 / camera.zoom));
        
        camera.targetX = clamp(carTargetX, 0, maxX) * clampedProgress;
        camera.targetY = clamp(carTargetY, 0, maxY) * clampedProgress;
    } else {
        // Reset camera when not running
        camera.targetX = 0;
        camera.targetY = 0;
        camera.targetZoom = camera.defaultZoom;
    }
    
    // Smooth camera movement
    const lerpFactor = 1 - Math.exp(-camera.followSpeed * dt);
    camera.x += (camera.targetX - camera.x) * lerpFactor;
    camera.y += (camera.targetY - camera.y) * lerpFactor;
    
    // Smooth zoom (slower for zoom out to make it more gradual)
    const zoomOutSpeed = simulation.hasFinished ? 1 : camera.zoomSpeed;
    const zoomLerpFactor = 1 - Math.exp(-zoomOutSpeed * dt);
    camera.zoom += (camera.targetZoom - camera.zoom) * zoomLerpFactor;
}

function drawLevel() {
    ctx.clearRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);
    
    // Apply camera transform
    ctx.save();
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);

    levelMetrics = computeLevelMetrics();

    const {
        ground1X,
        ground1Y,
        ground1Width,
        ground1Height,
        ground2X,
        ground2Y,
        ground2Width,
        ground2Height,
        gapX,
        gapWidth
    } = levelMetrics;

    if (ground1Img.complete && ground1Img.naturalWidth > 0) {
        ctx.drawImage(ground1Img, ground1X, ground1Y, ground1Width, ground1Height);
    } else {
        ctx.fillStyle = '#8B4513';
        ctx.fillRect(ground1X, ground1Y, ground1Width, ground1Height);
    }

    if (ground2Img.complete && ground2Img.naturalWidth > 0) {
        ctx.drawImage(ground2Img, ground2X, ground2Y, ground2Width, ground2Height);
    } else {
        ctx.fillStyle = '#A0522D';
        ctx.fillRect(ground2X, ground2Y, ground2Width, ground2Height);
    }

    ctx.strokeStyle = '#FF0000';
    ctx.lineWidth = 4;
    ctx.setLineDash([15, 8]);

    ctx.beginPath();
    ctx.moveTo(gapX, ground1Y);
    ctx.lineTo(gapX, INTERNAL_HEIGHT);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(ground2X, ground2Y);
    ctx.lineTo(ground2X, INTERNAL_HEIGHT);
    ctx.stroke();

    ctx.setLineDash([]);

    ctx.fillStyle = '#333';
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(
        `Gap: ${currentLevel.gap}m`,
        gapX + gapWidth / 2,
        INTERNAL_HEIGHT - 30
    );

    ctx.fillText(
        `Ground 1: ${currentLevel.ground1Length}m × ${currentLevel.ground1Height}m`,
        ground1X + ground1Width / 2,
        ground1Y - 20
    );

    ctx.fillText(
        `Ground 2: ${currentLevel.ground2Length}m × ${currentLevel.ground2Height}m`,
        ground2X + ground2Width / 2,
        ground2Y - 20
    );
    
    // Restore camera transform before drawing UI elements
    ctx.restore();
    
    // Draw stopwatch (UI element, not affected by camera)
    if (simulation.showStopwatch || simulation.showAccelStopwatch) {
        drawStopwatch();
    }
}

// -----------------------------------------------------------------------------
// Car rendering helpers
// -----------------------------------------------------------------------------
function getCarLengthMeters() {
    return car.lengthMeters;
}

function getCarDrawDimensions(horizontalScale) {
    const drawWidth = car.lengthMeters * horizontalScale;
    let aspect = DEFAULT_CAR_ASPECT;
    const img = carBodyImages[selectedCar];

    if (img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
        aspect = img.naturalHeight / img.naturalWidth;
    }

    const drawHeight = drawWidth * aspect;
    return { drawWidth, drawHeight };
}

function updateCarScreenPosition() {
    if (!levelMetrics) {
        return;
    }

    const horizontalScale = levelMetrics.horizontalScale;
    const { drawWidth, drawHeight } = getCarDrawDimensions(horizontalScale);

    car.height = drawHeight;
    car.width = drawWidth;

    const baseYGround1 = levelMetrics.ground1Y - drawHeight + CAR_GROUND_OFFSET * SCALE;


    if (!simulation.isRunning && !simulation.hasFinished) {
        car.x = levelMetrics.ground1X + RUN_START_OFFSET * horizontalScale;
        car.y = baseYGround1;
        return;
    }

    car.x = levelMetrics.ground1X + car.worldX * horizontalScale;

    if (simulation.success) {
        // Snap to the landing platform height
        car.y = levelMetrics.ground2Y - drawHeight + CAR_GROUND_OFFSET * SCALE;

    } else {
        car.y = baseYGround1 + car.worldY * SCALE;
    }
}

function drawCar() {
    // Apply camera transform for car drawing
    ctx.save();
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);
    
    const centerX = car.x + car.width / 2;
    const centerY = car.y + car.height / 2;
    
    const bodyImg = carBodyImages[selectedCar];
    const wheelImg = carWheelImages[selectedCar];
    const config = carConfigs[selectedCar];
    
    const bodyReady = bodyImg && bodyImg.complete && bodyImg.naturalWidth > 0;
    const wheelReady = wheelImg && wheelImg.complete && wheelImg.naturalWidth > 0;

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(car.rotation);

    if (bodyReady) {
        // Draw the car body
        ctx.drawImage(bodyImg, -car.width / 2, -car.height / 2, car.width, car.height);
        
        // Draw wheels if available
        if (wheelReady && config) {
            const wheelSize = car.height * config.frontWheel.size;
            
            // Calculate wheel positions relative to car center
            const frontWheelX = -car.width / 2 + car.width * config.frontWheel.x;
            const frontWheelY = -car.height / 2 + car.height * config.frontWheel.y;
            
            const rearWheelX = -car.width / 2 + car.width * config.rearWheel.x;
            const rearWheelY = -car.height / 2 + car.height * config.rearWheel.y;
            
            // Draw front wheel with rotation
            ctx.save();
            ctx.translate(frontWheelX, frontWheelY);
            ctx.rotate(wheelRotation);
            ctx.drawImage(wheelImg, -wheelSize / 2, -wheelSize / 2, wheelSize, wheelSize);
            ctx.restore();
            
            // Draw rear wheel with rotation
            ctx.save();
            ctx.translate(rearWheelX, rearWheelY);
            ctx.rotate(wheelRotation);
            ctx.drawImage(wheelImg, -wheelSize / 2, -wheelSize / 2, wheelSize, wheelSize);
            ctx.restore();
        }
    } else {
        ctx.fillStyle = '#FF5722';
        ctx.fillRect(-car.width / 2, -car.height / 2, car.width, car.height);
    }

    ctx.restore();
    
    // Restore camera transform
    ctx.restore();
}

// -----------------------------------------------------------------------------
// Physics + gameplay
// -----------------------------------------------------------------------------
function resetSimulationState() {
    simulation.isRunning = false;
    simulation.hasLaunched = false;
    simulation.hasFinished = false;
    simulation.hasLanded = false;
    simulation.fallingAfterCrash = false;
    simulation.showStopwatch = false;
    simulation.showAccelStopwatch = false;
    simulation.success = null;
    simulation.elapsedTime = 0;
    simulation.accelerationTime = 0;
    simulation.finalAccelTime = 0;
    simulation.timeSinceLaunch = 0;
    simulation.finalAirTime = 0;
    simulation.takeoffWorldX = 0;
    simulation.takeoffVelocity = 0;
    simulation.landDropHeight = 0;
    simulation.landTrackEnd = 0;
    
    // Reset camera
    camera.x = 0;
    camera.y = 0;
    camera.zoom = camera.defaultZoom;
    camera.targetZoom = camera.defaultZoom;

    car.worldX = RUN_START_OFFSET;
    car.worldY = 0;
    car.vx = 0;
    car.vy = 0;
    car.ax = 0;
    car.rotation = 0;
    car.angularVelocity = 0;
    
    // Reset wheel rotation
    wheelRotation = 0;
}

function startSimulation() {
    resetSimulationState();
    simulation.isRunning = true;
    lastFrameTime = null;
}

function getGroundHeightAt(frontX) {
    const ground1End = currentLevel.ground1Length;
    const ground2Start = ground1End + currentLevel.gap;
    const ground2Height = Math.max(0, currentLevel.ground1Height - currentLevel.ground2Height);
    const carRearX = car.worldX;

    // If the car has fully left Ground 1 and has not yet reached Ground 2, there is no ground beneath it.
    if (carRearX >= ground1End && frontX <= ground2Start) {
        return NO_GROUND;
    }

    if (frontX <= ground1End) {
        return 0;
    }

    // Ground 2 extends to the right edge of the canvas (no right boundary)
    if (frontX >= ground2Start) {
        return ground2Height;
    }

    return NO_GROUND;
}

function getKillPlaneY() {
    // Bottom of the visible canvas so crashes occur at the canyon floor, not mid-air.
    return (INTERNAL_HEIGHT / SCALE) - 0.5;
}

// Handles both successful and failed landings/crashes
function handleLanding(outcome) {
    const {
        success,
        reason,
        dropToGround2,
        ground2Start,
        ground2End,
        carFrontX
    } = outcome;

    simulation.success = success;
    simulation.finalAirTime = simulation.timeSinceLaunch;

    const baseData = lastPhysicsData ? { ...lastPhysicsData } : computePhysicsData();
    const horizontalDistance = Math.max(0, car.worldX - simulation.takeoffWorldX);
    const actualData = {
        ...baseData,
        takeoffVelocity: simulation.takeoffVelocity,
        fallTime: simulation.timeSinceLaunch,
        horizontalDistance,
        currentVx: car.vx,
        currentVy: car.vy,
        rotation: car.rotation,
        angularVelocity: car.angularVelocity,
        success
    };

    let statusText = 'Result: ❌ Crash!';

    if (success) {
        // Align car with landing platform and bleed speed using ground friction
        simulation.hasLanded = true;
        simulation.hasFinished = false;
        simulation.hasLaunched = false;
        simulation.timeSinceLaunch = 0;
        simulation.landDropHeight = dropToGround2;
        simulation.landTrackEnd = ground2End - getCarLengthMeters();

        const minX = ground2Start - getCarLengthMeters();
        const maxX = simulation.landTrackEnd;
        car.worldX = clamp(car.worldX, minX, maxX);
        car.worldY = dropToGround2;
        car.vy = 0;
        car.ax = 0;
        car.angularVelocity = 0;
        car.rotation = 0;

        statusText = 'Result: ✅ Landed safely on Ground 2!';
    } else {
        simulation.isRunning = false;
        simulation.hasFinished = true;
        simulation.hasLanded = false;
        simulation.hasLaunched = false;

        car.ax = 0;
        car.vx = 0;
        car.vy = 0;
        car.angularVelocity = 0;

        if (reason === 'short') {
            statusText = 'Result: ❌ Fell short of the gap!';
        } else if (reason === 'long') {
            statusText = 'Result: ❌ Overshot the platform!';
        } else if (reason === 'rotation') {
            statusText = 'Result: ❌ Crashed – landing angle too steep!';
        } else if (reason === 'penetration') {
            statusText = 'Result: ❌ Crashed – hit the ground too hard!';
        } else {
            statusText = 'Result: ❌ Missed the platform!';
        }
        
        // Show restart button on crash
        const restartBtn = document.getElementById('restartButton');
        if (restartBtn) {
            restartBtn.style.display = 'block';
        }
    }

    lastPhysicsData = actualData;
    refreshPhysicsDisplays(actualData, statusText);
}

function updatePhysics(dt) {
    if (!simulation.isRunning) {
        return;
    }

    simulation.elapsedTime += dt;
    
    // Update wheel rotation based on velocity
    // Assume wheel radius is proportional to car height
    const config = carConfigs[selectedCar];
    const wheelRadius = (car.height * (config ? config.frontWheel.size : 0.3)) / 2 / SCALE;
    if (wheelRadius > 0) {
        wheelRotation += (car.vx * dt) / wheelRadius;
    }

    // After a safe landing, roll to a stop on Ground 2 with simple friction
    if (simulation.hasLanded && simulation.success) {
        car.ax = 0;
        if (car.vx > 0) {
            car.vx = Math.max(0, car.vx - FRICTION_DECEL * dt);
        }
        car.worldX = Math.min(simulation.landTrackEnd, car.worldX + car.vx * dt);
        car.worldY = simulation.landDropHeight;
        car.rotation = 0;
        car.angularVelocity = 0;

        // Stop once the car reaches the end or loses all speed
        if (car.vx <= 0.05 || car.worldX >= simulation.landTrackEnd - 1e-3) {
            car.vx = 0;
            simulation.isRunning = false;
            simulation.hasFinished = true;
            
            // Show next level button on successful landing
            const nextLevelBtn = document.getElementById('nextLevelButton');
            if (nextLevelBtn) {
                nextLevelBtn.style.display = 'block';
            }
        }
        return;
    }

    // Ground run: accelerate along Ground 1 until takeoff
    if (!simulation.hasLaunched) {
        simulation.showAccelStopwatch = true;
        simulation.accelerationTime += dt;
        
        car.ax = chosenAcceleration;
        car.vx += car.ax * dt;
        car.worldX += car.vx * dt;
        car.worldY = 0;
        car.rotation = 0;
        car.angularVelocity = 0;

        const takeoffLeftEdge = Math.max(0, currentLevel.ground1Length - getCarLengthMeters());
        if (car.worldX >= takeoffLeftEdge) {
            car.worldX = takeoffLeftEdge;
            simulation.hasLaunched = true;
            simulation.showStopwatch = true;
            simulation.finalAccelTime = simulation.accelerationTime;
            simulation.timeSinceLaunch = 0;
            simulation.takeoffWorldX = car.worldX;
            simulation.takeoffVelocity = car.vx;
            car.ax = 0;
            car.vy = 0;
            // Begin rotating in the air with a slight random spin
            car.angularVelocity = (Math.random() - 0.5) * INITIAL_AIR_SPIN;
        }
        return;
    }

    // Airborne: integrate dt-based motion with gravity and angular dynamics
    simulation.timeSinceLaunch += dt;

    // Mass affects gravity - heavier cars are pulled down harder
    const mass = cars[selectedCar].mass;
    const massRatio = mass / REFERENCE_MASS;
    const effectiveGravity = GRAVITY * (1 + (massRatio - 1) * MASS_GRAVITY_FACTOR);

    car.ax = 0; // no thrust in mid-air
    car.vy += effectiveGravity * dt;
    car.worldX += car.vx * dt;
    car.worldY += car.vy * dt;

    // Calculate the trajectory angle from velocity vector
    // The car should naturally nose-down to follow its parabolic trajectory
    const trajectoryAngle = Math.atan2(car.vy, car.vx);
    
    // Smoothly rotate the car to align with trajectory (realistic physics)
    // Use a spring-like approach to pull rotation toward trajectory angle
    const TRAJECTORY_STIFFNESS = 5;  // How quickly car aligns with trajectory
    const angleDiff = trajectoryAngle - car.rotation;
    car.angularVelocity += angleDiff * TRAJECTORY_STIFFNESS * dt;
    
    // Apply angular damping so spin stays reasonable
    const dampingFactor = Math.pow(ANGULAR_DAMPING, (dt * ANGULAR_DAMPING_DT));
    car.angularVelocity *= dampingFactor;

    car.rotation += car.angularVelocity * dt;
    car.rotation = clamp(car.rotation, MIN_AIR_ROTATION, MAX_AIR_ROTATION);

    // Landing / crash checks
    const carFrontX = car.worldX + getCarLengthMeters();
    const groundHeight = getGroundHeightAt(carFrontX);
    const ground2Start = currentLevel.ground1Length + currentLevel.gap;
    const ground2End = ground2Start + currentLevel.ground2Length;
    const ground2HeightDrop = Math.max(0, currentLevel.ground1Height - currentLevel.ground2Height);
    const killPlaneY = getKillPlaneY();
    
    // Check for wall collision: car hits the side of Ground 2
    // Only triggers if the car front JUST crossed the wall AND is significantly below the platform
    if (!simulation.fallingAfterCrash) {
        const previousFrontX = carFrontX - car.vx * dt;
        const justCrossedWall = previousFrontX < ground2Start && carFrontX >= ground2Start;
        // Car must be well below platform surface to count as wall hit (not just touching)
        const tooLowToLand = car.worldY > ground2HeightDrop + 2.0;
        
        if (justCrossedWall && tooLowToLand) {
            // Hit the wall! Start falling and rotating (nose down)
            simulation.fallingAfterCrash = true;
            simulation.hasFinished = false;
            simulation.isRunning = true;
            simulation.hasLaunched = true;
            
            // Stop at the wall
            car.worldX = ground2Start - getCarLengthMeters();
            car.vx = 0;
            car.ax = 0;
            
            // Add rotation - gravity pulls the front down (positive = clockwise = nose down)
            car.angularVelocity = Math.PI * 1.5; // Start rotating nose-down with stronger spin
        }
    }
    
    if (!simulation.fallingAfterCrash) {
        if (groundHeight !== NO_GROUND) {
            if (car.worldY >= groundHeight) {
                const belowGround = car.worldY > groundHeight + LANDING_PENETRATION_TOLERANCE;
                const rotationSafe = Math.abs(car.rotation) <= MAX_SAFE_LANDING_ANGLE;
                const success = !belowGround && rotationSafe;

                let reason = 'generic';
                if (!rotationSafe) {
                    reason = 'rotation';
                } else if (belowGround) {
                    reason = 'penetration';
                }

                if (success) {
                    car.worldY = groundHeight;
                    handleLanding({
                        success,
                        reason,
                        dropToGround2: groundHeight,
                        ground2Start,
                        ground2End,
                        carFrontX
                    });
                } else {
                    // Begin post-crash free-fall: stop horizontal motion and let gravity take over.
                    simulation.fallingAfterCrash = true;
                    simulation.hasFinished = false;
                    simulation.isRunning = true;
                    simulation.hasLaunched = true;
                    car.worldY = Math.max(car.worldY, groundHeight);
                    car.vx = 0;
                    car.ax = 0;
                    car.vy = Math.max(car.vy, 0.5);
                    // keep rotation/omega; damping continues above
                }
            }
        } else if (car.worldY >= killPlaneY) {
            // Car fell into the gap - only possible if it fell short
            const reason = 'short';
            car.worldY = killPlaneY;

            handleLanding({
                success: false,
                reason,
                dropToGround2: killPlaneY,
                ground2Start,
                ground2End,
                carFrontX
            });
        }
    } else {
        // Already in a post-crash fall: continue rotating as it falls
        // Apply gravity to rotation (nose tips down more as it falls)
        car.angularVelocity += GRAVITY * 0.02 * dt; // Gentle rotation acceleration
        car.angularVelocity = clamp(car.angularVelocity, -MAX_TIPPING_ANGULAR_VELOCITY, MAX_TIPPING_ANGULAR_VELOCITY);
        car.rotation += car.angularVelocity * dt;
        // Allow more rotation range during crash
        car.rotation = clamp(car.rotation, -Math.PI / 2, Math.PI / 2);
        
        // Finish once we reach the canyon floor.
        if (car.worldY >= killPlaneY) {
            car.worldY = killPlaneY;
            simulation.fallingAfterCrash = false;
            handleLanding({
                success: false,
                reason: 'fall',
                dropToGround2: killPlaneY,
                ground2Start,
                ground2End,
                carFrontX
            });
        }
    }
}

// -----------------------------------------------------------------------------
// UI + displays
// -----------------------------------------------------------------------------
const mathResultEl = document.getElementById('mathResult');
const startButtonEl = document.getElementById('startButton');
const carSelectionEl = document.getElementById('carSelection');
const gameContainerEl = document.querySelector('.game-container');

physicsCalculationsPanel = document.createElement('div');
physicsCalculationsPanel.id = 'physicsCalculationsPanel';
physicsCalculationsPanel.className = 'physics-calculations';

// Create restart button
const restartButtonEl = document.createElement('button');
restartButtonEl.id = 'restartButton';
restartButtonEl.className = 'restart-button';
restartButtonEl.textContent = 'Restart';
restartButtonEl.style.display = 'none';

// Create next level button
const nextLevelButtonEl = document.createElement('button');
nextLevelButtonEl.id = 'nextLevelButton';
nextLevelButtonEl.className = 'next-level-button';
nextLevelButtonEl.textContent = 'Next Level';
nextLevelButtonEl.style.display = 'none';

// Get level display element
const levelDisplayEl = document.querySelector('.level-display');

// Create acceleration slider container
const accelerationSliderContainer = document.createElement('div');
accelerationSliderContainer.id = 'accelerationSliderContainer';
accelerationSliderContainer.className = 'acceleration-slider-container';
accelerationSliderContainer.innerHTML = `
    <label for="accelerationSlider">Acceleration: <span id="accelerationValue">${cars[selectedCar].maxAcceleration}</span> m/s²</label>
    <input type="range" id="accelerationSlider" min="${cars[selectedCar].minAcceleration}" max="${cars[selectedCar].maxAcceleration}" value="${cars[selectedCar].maxAcceleration}" step="0.5">
    <div class="slider-labels">
        <span id="minAccelLabel">${cars[selectedCar].minAcceleration} m/s²</span>
        <span id="maxAccelLabel">${cars[selectedCar].maxAcceleration} m/s²</span>
    </div>
`;

// Initialize chosenAcceleration to the selected car's max
chosenAcceleration = cars[selectedCar].maxAcceleration;

if (gameContainerEl && carSelectionEl) {
    gameContainerEl.insertBefore(physicsCalculationsPanel, carSelectionEl.nextSibling);
    gameContainerEl.appendChild(restartButtonEl);
    gameContainerEl.appendChild(nextLevelButtonEl);
    // Insert slider before car selection
    gameContainerEl.insertBefore(accelerationSliderContainer, carSelectionEl);
}

// Get slider elements
const accelerationSlider = document.getElementById('accelerationSlider');
const accelerationValueDisplay = document.getElementById('accelerationValue');
const minAccelLabel = document.getElementById('minAccelLabel');
const maxAccelLabel = document.getElementById('maxAccelLabel');

// Update slider when value changes
accelerationSlider.addEventListener('input', () => {
    chosenAcceleration = parseFloat(accelerationSlider.value);
    accelerationValueDisplay.textContent = chosenAcceleration;
    updateMathPanel();
});

// Function to update slider for selected car
function updateAccelerationSlider() {
    const car = cars[selectedCar];
    accelerationSlider.min = car.minAcceleration;
    accelerationSlider.max = car.maxAcceleration;
    accelerationSlider.value = car.maxAcceleration;
    chosenAcceleration = car.maxAcceleration;
    accelerationValueDisplay.textContent = chosenAcceleration;
    minAccelLabel.textContent = `${car.minAcceleration} m/s²`;
    maxAccelLabel.textContent = `${car.maxAcceleration} m/s²`;
}

function computePhysicsData() {
    const acceleration = chosenAcceleration;
    const carLength = getCarLengthMeters();
    const mass = cars[selectedCar].mass;
    const takeoffLeftEdge = Math.max(0, currentLevel.ground1Length - carLength);
    const runDistance = Math.max(0, takeoffLeftEdge - RUN_START_OFFSET);
    const takeoffVelocity = Math.sqrt(Math.max(0, 2 * acceleration * runDistance));
    const timeToTakeoff = acceleration > 0 ? takeoffVelocity / acceleration : 0;
    const dropHeight = Math.max(0, currentLevel.ground1Height - currentLevel.ground2Height);
    const fallTime = dropHeight > 0 ? Math.sqrt((2 * dropHeight) / GRAVITY) : 0;
    const horizontalDistance = takeoffVelocity * fallTime;
    const requiredHorizontalMin = currentLevel.gap;
    const requiredHorizontalMax = currentLevel.gap + currentLevel.ground2Length;
    const success = horizontalDistance >= requiredHorizontalMin && horizontalDistance <= requiredHorizontalMax;
    
    // Calculate minimum acceleration needed to clear the gap
    // Required velocity: v = gap / fallTime
    // Required acceleration: a = v² / (2 * runDistance)
    const requiredVelocity = fallTime > 0 ? requiredHorizontalMin / fallTime : 0;
    const minAccelToSucceed = runDistance > 0 ? (requiredVelocity * requiredVelocity) / (2 * runDistance) : 0;
    
    // Force and energy calculations using mass
    const force = mass * acceleration;  // F = ma (Newtons)
    const weight = mass * GRAVITY;  // W = mg (Newtons) - gravitational force while airborne
    
    // Effective gravity based on mass (heavier cars fall faster in this simulation)
    const massRatio = mass / REFERENCE_MASS;
    const effectiveGravity = GRAVITY * (1 + (massRatio - 1) * MASS_GRAVITY_FACTOR);
    const effectiveWeight = mass * effectiveGravity;  // Actual pulling force in simulation
    
    const kineticEnergy = 0.5 * mass * takeoffVelocity * takeoffVelocity;  // KE = ½mv² (Joules)
    const minForceNeeded = mass * minAccelToSucceed;  // Minimum force to succeed
    
    // Final velocity when landing on ground2
    // v_f = v_i + g*t (initial vertical velocity is 0 at takeoff)
    const finalVerticalVelocity = effectiveGravity * fallTime;  // Vertical velocity at landing
    const finalVelocity = Math.sqrt(takeoffVelocity * takeoffVelocity + finalVerticalVelocity * finalVerticalVelocity);  // Total velocity magnitude
    
    // Height fallen using kinematic equation: h = v₀t + ½gt²
    // Since initial vertical velocity v₀ = 0, this simplifies to h = ½gt²
    // Uses standard gravity (ignoring air resistance - all objects fall at same rate)
    const heightFallen = 0.5 * GRAVITY * fallTime * fallTime;

    return {
        acceleration,
        carLength,
        mass,
        runDistance,
        takeoffVelocity,
        timeToTakeoff,
        fallTime,
        horizontalDistance,
        requiredHorizontalMin,
        requiredHorizontalMax,
        dropHeight,
        success,
        minAccelToSucceed,
        requiredVelocity,
        force,
        weight,
        effectiveGravity,
        effectiveWeight,
        kineticEnergy,
        minForceNeeded,
        finalVerticalVelocity,
        finalVelocity,
        heightFallen
    };
}

function buildPredictionStatus(data, prefix) {
    if (data.horizontalDistance < data.requiredHorizontalMin) {
        return `${prefix} ⚠️ Needs more speed!`;
    }

    if (data.horizontalDistance > data.requiredHorizontalMax) {
        return `${prefix} ⚠️ Too fast, will overshoot!`;
    }

    return `${prefix} ✅ Will make it!`;
}

function buildOptionalLine(label, value, formatter = (v) => v.toFixed(2)) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        return '';
    }
    return `<strong>${label}:</strong> ${formatter(value)}`;
}

function refreshPhysicsDisplays(data, statusText) {
    const mathLines = [
        buildOptionalLine('Car Mass', data.mass, (v) => `${v.toLocaleString()} kg`),
        buildOptionalLine('Acceleration', data.acceleration, (v) => `${v.toFixed(2)} m/s²`),
        buildOptionalLine('Engine Force', data.force, (v) => `${v.toLocaleString()} N`),
        buildOptionalLine('Effective Gravity', data.effectiveGravity, (v) => `${v.toFixed(2)} m/s²`),
        buildOptionalLine('Effective Weight', data.effectiveWeight, (v) => `${v.toLocaleString()} N`),
        buildOptionalLine('Run-up Distance', data.runDistance, (v) => `${v.toFixed(2)} m`),
        buildOptionalLine('Takeoff Speed', data.takeoffVelocity, (v) => `${v.toFixed(2)} m/s`),
        buildOptionalLine('Kinetic Energy', data.kineticEnergy, (v) => `${(v / 1000).toFixed(2)} kJ`),
        buildOptionalLine('Acceleration Time', data.timeToTakeoff, (v) => `${v.toFixed(2)} s`),
        buildOptionalLine('Air Time', data.fallTime, (v) => `${v.toFixed(2)} s`),
        buildOptionalLine('Final Vertical Velocity', data.finalVerticalVelocity, (v) => `${v.toFixed(2)} m/s`),
        buildOptionalLine('Final Velocity (landing)', data.finalVelocity, (v) => `${v.toFixed(2)} m/s`),
        buildOptionalLine('Height Fallen', data.heightFallen, (v) => `${v.toFixed(2)} m`),
        buildOptionalLine(
            'Horizontal Travel',
            data.horizontalDistance,
            (v) => `${v.toFixed(2)} m (needs ${data.requiredHorizontalMin.toFixed(2)}-${data.requiredHorizontalMax.toFixed(2)} m)`
        ),
        buildOptionalLine('Current Vx', data.currentVx, (v) => `${v.toFixed(2)} m/s`),
        buildOptionalLine('Current Vy', data.currentVy, (v) => `${v.toFixed(2)} m/s`),
        buildOptionalLine('Rotation', data.rotation, (v) => `${toDegrees(v).toFixed(1)}°`),
        buildOptionalLine('Angular Velocity', data.angularVelocity, (v) => `${toDegrees(v).toFixed(1)}°/s`)
    ].filter(Boolean);

    if (mathResultEl) {
        mathResultEl.innerHTML = `
            ${mathLines.slice(0, 6).join('<br>')}<br>
            ${buildOptionalLine('Status', null, () => statusText)}
        `;
    }

    // Build step-by-step calculation explanations
    const stepByStep = `
        <div class="step-by-step">
            <h4>📐 Step-by-Step Calculations</h4>
            
            <div class="calc-section">
                <h5>1. Engine Force (F)</h5>
                <p class="formula">F = m × a</p>
                <p class="values">F = ${data.mass.toLocaleString()} × ${data.acceleration.toFixed(2)}</p>
                <p class="result">F = <strong>${data.force.toLocaleString()} N</strong></p>
            </div>
            
            <div class="calc-section">
                <h5>2. Effective Gravity & Weight (in air)</h5>
                <p class="formula">g_eff = g × (1 + (m/m_ref - 1) × factor)</p>
                <p class="values">g_eff = ${GRAVITY} × (1 + (${data.mass.toLocaleString()}/${REFERENCE_MASS} - 1) × ${MASS_GRAVITY_FACTOR})</p>
                <p class="result">g_eff = <strong>${data.effectiveGravity.toFixed(2)} m/s²</strong></p>
                <p class="formula">W_eff = m × g_eff</p>
                <p class="values">W_eff = ${data.mass.toLocaleString()} × ${data.effectiveGravity.toFixed(2)}</p>
                <p class="result">W_eff = <strong>${data.effectiveWeight.toLocaleString()} N</strong> (pulling car down while airborne)</p>
            </div>
            
            <div class="calc-section">
                <h5>3. Takeoff Speed (v)</h5>
                <p class="formula">v = √(2 × a × d)</p>
                <p class="values">v = √(2 × ${data.acceleration.toFixed(2)} × ${data.runDistance.toFixed(2)})</p>
                <p class="result">v = <strong>${data.takeoffVelocity.toFixed(2)} m/s</strong></p>
            </div>
            
            <div class="calc-section">
                <h5>4. Kinetic Energy at Takeoff (KE)</h5>
                <p class="formula">KE = ½ × m × v²</p>
                <p class="values">KE = ½ × ${data.mass.toLocaleString()} × ${data.takeoffVelocity.toFixed(2)}²</p>
                <p class="result">KE = <strong>${(data.kineticEnergy / 1000).toFixed(2)} kJ</strong></p>
            </div>
            
            <div class="calc-section">
                <h5>5. Acceleration Time (t₁)</h5>
                <p class="formula">t₁ = v / a</p>
                <p class="values">t₁ = ${data.takeoffVelocity.toFixed(2)} / ${data.acceleration.toFixed(2)}</p>
                <p class="result">t₁ = <strong>${data.timeToTakeoff.toFixed(2)} s</strong></p>
            </div>
            
            <div class="calc-section">
                <h5>6. Air Time (t₂)</h5>
                <p class="formula">t₂ = √(2 × h / g)</p>
                <p class="values">t₂ = √(2 × ${data.dropHeight.toFixed(2)} / ${GRAVITY})</p>
                <p class="result">t₂ = <strong>${data.fallTime.toFixed(2)} s</strong></p>
            </div>
            
            <div class="calc-section">
                <h5>7. Horizontal Distance (x)</h5>
                <p class="formula">x = v × t₂</p>
                <p class="values">x = ${data.takeoffVelocity.toFixed(2)} × ${data.fallTime.toFixed(2)}</p>
                <p class="result">x = <strong>${data.horizontalDistance.toFixed(2)} m</strong></p>
            </div>
            
            <div class="calc-section">
                <h5>8. Final Velocity at Landing</h5>
                <p class="formula">v_fy = v_iy + g × t₂  (initial vertical velocity = 0)</p>
                <p class="values">v_fy = 0 + ${data.effectiveGravity.toFixed(2)} × ${data.fallTime.toFixed(2)}</p>
                <p class="result">v_fy = <strong>${data.finalVerticalVelocity.toFixed(2)} m/s</strong> (downward)</p>
                <p class="formula">v_f = √(v_x² + v_fy²)</p>
                <p class="values">v_f = √(${data.takeoffVelocity.toFixed(2)}² + ${data.finalVerticalVelocity.toFixed(2)}²)</p>
                <p class="result">v_f = <strong>${data.finalVelocity.toFixed(2)} m/s</strong> (total speed at impact)</p>
            </div>
            
            <div class="calc-section">
                <h5>9. Height Fallen (Vertical Displacement)</h5>
                <p class="formula">h = v₀t + ½gt²  (initial vertical velocity v₀ = 0)</p>
                <p class="values">h = 0 + ½ × ${GRAVITY} × ${data.fallTime.toFixed(2)}²</p>
                <p class="result">h = <strong>${data.heightFallen.toFixed(2)} m</strong></p>
            </div>
            
            <div class="calc-section highlight">
                <h5>10. Minimum Requirements to Succeed</h5>
                <p class="formula">v_min = gap / t₂ = ${data.requiredHorizontalMin.toFixed(2)} / ${data.fallTime.toFixed(2)} = ${data.requiredVelocity.toFixed(2)} m/s</p>
                <p class="formula">a_min = v_min² / (2 × d)</p>
                <p class="values">a_min = ${data.requiredVelocity.toFixed(2)}² / (2 × ${data.runDistance.toFixed(2)})</p>
                <p class="result">a_min = <strong>${data.minAccelToSucceed.toFixed(2)} m/s²</strong></p>
                <p class="formula">F_min = m × a_min</p>
                <p class="result">F_min = <strong>${data.minForceNeeded.toLocaleString()} N</strong></p>
            </div>
        </div>
    `;

    if (physicsCalculationsPanel) {
        physicsCalculationsPanel.innerHTML = `
            <h3>Physics Calculations</h3>
            ${mathLines.map(line => `<p>${line}</p>`).join('')}
            <p><strong>Min. Acceleration Needed:</strong> ${data.minAccelToSucceed.toFixed(2)} m/s²</p>
            <p><strong>Status:</strong> ${statusText}</p>
            ${stepByStep}
        `;
    }
}

function updateMathPanel(statusPrefix = 'Prediction:') {
    lastPhysicsData = computePhysicsData();
    const statusText = buildPredictionStatus(lastPhysicsData, statusPrefix);
    refreshPhysicsDisplays(lastPhysicsData, statusText);
}

// -----------------------------------------------------------------------------
// Stopwatch display
// -----------------------------------------------------------------------------
function drawStopwatch() {
    const boxWidth = 180;
    const boxHeight = 60;
    const gap = 20;
    const totalWidth = boxWidth * 2 + gap;
    const startX = INTERNAL_WIDTH / 2 - totalWidth / 2;
    const boxY = 20;
    
    // Draw Acceleration Time stopwatch (left)
    if (simulation.showAccelStopwatch) {
        const accelTime = simulation.finalAccelTime > 0 ? simulation.finalAccelTime : simulation.accelerationTime;
        const accelMinutes = Math.floor(accelTime / 60);
        const accelSeconds = Math.floor(accelTime % 60);
        const accelMs = Math.floor((accelTime % 1) * 100);
        const accelTimeString = `${accelMinutes.toString().padStart(2, '0')}:${accelSeconds.toString().padStart(2, '0')}.${accelMs.toString().padStart(2, '0')}`;
        
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.beginPath();
        ctx.roundRect(startX, boxY, boxWidth, boxHeight, 10);
        ctx.fill();
        
        ctx.fillStyle = '#aaa';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('ACCEL TIME', startX + boxWidth / 2, boxY + 16);
        
        // Color: white during accel, blue once launched
        if (simulation.hasLaunched) {
            ctx.fillStyle = '#2196F3';
        } else {
            ctx.fillStyle = '#fff';
        }
        ctx.font = 'bold 28px monospace';
        ctx.fillText(accelTimeString, startX + boxWidth / 2, boxY + 46);
    }
    
    // Draw Air Time stopwatch (right)
    const airBoxX = startX + boxWidth + gap;
    const airTime = simulation.finalAirTime > 0 ? simulation.finalAirTime : simulation.timeSinceLaunch;
    const minutes = Math.floor(airTime / 60);
    const seconds = Math.floor(airTime % 60);
    const milliseconds = Math.floor((airTime % 1) * 100);
    const timeString = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(2, '0')}`;
    
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.beginPath();
    ctx.roundRect(airBoxX, boxY, boxWidth, boxHeight, 10);
    ctx.fill();
    
    ctx.fillStyle = '#aaa';
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('AIR TIME', airBoxX + boxWidth / 2, boxY + 16);
    
    // Draw time - green if landed successfully, red if crashed, white if still flying
    if (simulation.hasFinished || simulation.hasLanded) {
        ctx.fillStyle = simulation.success ? '#4CAF50' : '#f44336';
    } else {
        ctx.fillStyle = '#fff';
    }
    ctx.font = 'bold 28px monospace';
    ctx.fillText(timeString, airBoxX + boxWidth / 2, boxY + 46);
}

// -----------------------------------------------------------------------------
// Animation loop
// -----------------------------------------------------------------------------
let lastFrameTime = null;

function animate(timestamp) {
    if (lastFrameTime === null) {
        lastFrameTime = timestamp;
    }

    const deltaSeconds = (timestamp - lastFrameTime) / 1000;
    updatePhysics(deltaSeconds);
    updateCamera(deltaSeconds);

    drawLevel();
    updateCarScreenPosition();
    drawCar();

    lastFrameTime = timestamp;
    requestAnimationFrame(animate);
}

// -----------------------------------------------------------------------------
// Asset loading instrumentation
// -----------------------------------------------------------------------------
let imagesLoaded = 0;
const totalImages = 2 + carConfigs.length * 2; // ground images + body + wheel for each car

function imageLoaded() {
    imagesLoaded++;
    console.log(`Image loaded: ${imagesLoaded}/${totalImages}`);
    if (imagesLoaded === totalImages) {
        console.log('All images loaded!');
    }
}

ground1Img.onload = imageLoaded;
ground1Img.onerror = () => {
    console.error('Failed to load Ground1.png');
    imageLoaded();
};

ground2Img.onload = imageLoaded;
ground2Img.onerror = () => {
    console.error('Failed to load Ground2.png');
    imageLoaded();
};

// Load car body and wheel images
carConfigs.forEach((config, index) => {
    carBodyImages[index].onload = imageLoaded;
    carBodyImages[index].onerror = () => {
        console.error(`Failed to load car body image: ${config.bodyImage}`);
        imageLoaded();
    };
    
    carWheelImages[index].onload = imageLoaded;
    carWheelImages[index].onerror = () => {
        console.error(`Failed to load wheel image: ${config.wheelImage}`);
        imageLoaded();
    };
});

// -----------------------------------------------------------------------------
// UI Wiring
// -----------------------------------------------------------------------------
const carOptions = document.querySelectorAll('.car-option');

carOptions.forEach((option, index) => {
    option.addEventListener('click', () => {
        if (simulation.isRunning || simulation.hasFinished) {
            return;
        }

        carOptions.forEach(o => o.classList.remove('selected'));
        option.classList.add('selected');
        selectedCar = index;
        console.log(`Selected car: ${cars[index].name}`);
        updateAccelerationSlider();
        updateMathPanel();
    });
});

startButtonEl.addEventListener('click', () => {
    if (simulation.isRunning) {
        return;
    }

    if (carSelectionEl) {
        carSelectionEl.classList.add('hidden');
    }

    if (physicsCalculationsPanel) {
        physicsCalculationsPanel.classList.add('show');
    }
    
    // Hide acceleration slider
    accelerationSliderContainer.classList.add('hidden');

    startButtonEl.classList.add('hidden');
    const data = lastPhysicsData || computePhysicsData();
    refreshPhysicsDisplays(data, 'Simulation running...');

    console.log('Simulation started!');
    startSimulation();
});

// Restart button click handler
restartButtonEl.addEventListener('click', () => {
    // Hide restart button
    restartButtonEl.style.display = 'none';
    
    // Reset to level 1
    currentLevelNumber = 1;
    currentLevel.gap = 15;
    currentLevel.ground2Height = 23; // Reset ground2 height to initial value
    
    // Reset ground2 image to original
    ground2Img.src = 'img/Ground2.png';
    
    // Update level display
    if (levelDisplayEl) {
        levelDisplayEl.textContent = `Level ${currentLevelNumber}`;
    }
    
    // Show car selection and start button again
    if (carSelectionEl) {
        carSelectionEl.classList.remove('hidden');
    }
    if (physicsCalculationsPanel) {
        physicsCalculationsPanel.classList.remove('show');
    }
    startButtonEl.classList.remove('hidden');
    accelerationSliderContainer.classList.remove('hidden');
    
    // Reset simulation
    resetSimulationState();
    updateMathPanel();
    
    console.log('Simulation restarted! Back to Level 1');
});

// Next Level button click handler
nextLevelButtonEl.addEventListener('click', () => {
    // Hide next level button
    nextLevelButtonEl.style.display = 'none';
    
    // Increase level number, gap, and lower ground2 height
    currentLevelNumber++;
    currentLevel.gap += 5;
    currentLevel.ground2Height = Math.max(5, currentLevel.ground2Height - 2); // Lower ground2, minimum 5m
    
    // Change ground2 image for level 5 and above
    if (currentLevelNumber >= 5) {
        ground2Img.src = 'img/Ground2(level5).png';
    }
    if (currentLevelNumber >= 8){
        ground2Img.src = 'img/Ground2(level8).png';
    }
    
    // Update level display
    if (levelDisplayEl) {
        levelDisplayEl.textContent = `Level ${currentLevelNumber}`;
    }
    
    // Show car selection and start button again
    if (carSelectionEl) {
        carSelectionEl.classList.remove('hidden');
    }
    if (physicsCalculationsPanel) {
        physicsCalculationsPanel.classList.remove('show');
    }
    startButtonEl.classList.remove('hidden');
    accelerationSliderContainer.classList.remove('hidden');
    
    // Reset simulation
    resetSimulationState();
    updateMathPanel();
    
    console.log(`Proceeding to Level ${currentLevelNumber} with gap: ${currentLevel.gap}m`);
});

// -----------------------------------------------------------------------------
// Kick things off
// -----------------------------------------------------------------------------
updateMathPanel();
requestAnimationFrame(animate);