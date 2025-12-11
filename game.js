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
const GRAVITY = 9.81;
const RUN_START_OFFSET = 1;

const MIN_AIR_ROTATION = -Math.PI / 12;
const MAX_AIR_ROTATION = Math.PI / 3;
const INITIAL_AIR_SPIN = Math.PI / 10;          // slight initial wobble when leaving ground
const AIR_SPIN_NOISE = Math.PI * 0.25;          // random spin impulse per second while airborne
const MAX_SAFE_LANDING_ANGLE = Math.PI / 10;    // land successfully only if |rotation| <= ~18°
const LANDING_PENETRATION_TOLERANCE = 0.4;      // extra vertical tolerance before counting as floor clip
const FRICTION_DECEL = 4;                       // simple ground friction after a safe landing (m/s²)
const CAR_GROUND_OFFSET = 2;                  // lower the car so wheels sit into the ground slightly (meters)

const ANGULAR_DAMPING = 0.92;                   // mild damping so spin does not explode
const ANGULAR_DAMPING_DT = 60;                  // reference FPS for damping scaling

const NO_GROUND = Number.POSITIVE_INFINITY;

const TIPPING_STIFFNESS = 18;                   // spring strength pulling rotation toward target while tipping
const TIPPING_DAMPING = 6;                      // damping for tipping angular velocity
const TIPPING_RELEASE_ANGLE = Math.PI / 3;      // release into free fall once nose dips ~60°
const MAX_TIPPING_ANGULAR_VELOCITY = Math.PI;   // cap tipping angular speed (rad/s)
const PIVOT_BLEND_RATE = 3;                     // blend per second from rear pivot to center once airborne
const TIPPING_TARGET_NOSE_DOWN = Math.PI / 6;   // desired nose-down angle while tipping off the edge

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
    success: null,
    elapsedTime: 0,
    timeSinceLaunch: 0,
    takeoffWorldX: 0,
    takeoffVelocity: 0,
    landDropHeight: 0,
    landTrackEnd: 0
};

// Drawing + physics state for the car
let car = {
    x: 0,
    y: 0,
    width: 100,
    height: 70,
    lengthMeters: 100 / SCALE,
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

const carImages = [
    new Image(),
    new Image(),
    new Image()
];
carImages[0].src = 'img/cars-motors/motorcycle.png';
carImages[1].src = 'img/cars-motors/car1.png';
carImages[2].src = 'img/cars-motors/Volkswagen Golf Mk1 Cabriolet.png';

// -----------------------------------------------------------------------------
// Level + vehicle data
// -----------------------------------------------------------------------------
let currentLevel = {
    ground1Length: 26,
    ground1Height: 26,
    gap: 10,
    ground2Length: 10,
    ground2Height: 22
};

let selectedCar = 1;
const cars = [
    { name: "Motorcycle", acceleration: 1, mass: 1200 },
    { name: "Sports Car", acceleration: 3, mass: 1400 },
    { name: "Supercar", acceleration: 12, mass: 1500 }
];

// -----------------------------------------------------------------------------
// Level rendering + layout
// -----------------------------------------------------------------------------
function computeLevelMetrics() {
    const totalHorizontalMeters = currentLevel.ground1Length + currentLevel.gap + currentLevel.ground2Length;
    const horizontalScale = totalHorizontalMeters > 0 ? INTERNAL_WIDTH / totalHorizontalMeters : SCALE;

    const gapWidth = currentLevel.gap * horizontalScale;
    const ground1Width = currentLevel.ground1Length * horizontalScale;
    const ground2Width = currentLevel.ground2Length * horizontalScale;

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

function drawLevel() {
    ctx.clearRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);

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
    const img = carImages[selectedCar];

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
    const centerX = car.x + car.width / 2;
    const centerY = car.y + car.height / 2;
    const imageReady = carImages[selectedCar].complete && carImages[selectedCar].naturalWidth > 0;

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(car.rotation);

    if (imageReady) {
        ctx.drawImage(carImages[selectedCar], -car.width / 2, -car.height / 2, car.width, car.height);
    } else {
        ctx.fillStyle = '#FF5722';
        ctx.fillRect(-car.width / 2, -car.height / 2, car.width, car.height);
    }

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
    simulation.success = null;
    simulation.elapsedTime = 0;
    simulation.timeSinceLaunch = 0;
    simulation.takeoffWorldX = 0;
    simulation.takeoffVelocity = 0;
    simulation.landDropHeight = 0;
    simulation.landTrackEnd = 0;

    car.worldX = RUN_START_OFFSET;
    car.worldY = 0;
    car.vx = 0;
    car.vy = 0;
    car.ax = 0;
    car.rotation = 0;
    car.angularVelocity = 0;
}

function startSimulation() {
    resetSimulationState();
    simulation.isRunning = true;
    lastFrameTime = null;
}

function getGroundHeightAt(frontX) {
    const ground1End = currentLevel.ground1Length;
    const ground2Start = ground1End + currentLevel.gap;
    const ground2End = ground2Start + currentLevel.ground2Length;
    const ground2Height = Math.max(0, currentLevel.ground1Height - currentLevel.ground2Height);
    const carRearX = car.worldX;

    // If the car has fully left Ground 1 and has not yet reached Ground 2, there is no ground beneath it.
    if (carRearX >= ground1End && frontX <= ground2Start) {
        return NO_GROUND;
    }

    if (frontX <= ground1End) {
        return 0;
    }

    if (frontX >= ground2Start && frontX <= ground2End) {
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
    }

    lastPhysicsData = actualData;
    refreshPhysicsDisplays(actualData, statusText);
}

function updatePhysics(dt) {
    if (!simulation.isRunning) {
        return;
    }

    simulation.elapsedTime += dt;

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
        }
        return;
    }

    // Ground run: accelerate along Ground 1 until takeoff
    if (!simulation.hasLaunched) {
        const groundAccel = cars[selectedCar].acceleration;
        const carFrontX = car.worldX + getCarLengthMeters();
        const ground1End = currentLevel.ground1Length;
        const frontHasNoGround = carFrontX > ground1End;
        const rearStillOnGround = car.worldX <= ground1End;

        // Normal run while fully on ground
        if (!frontHasNoGround) {
            car.ax = groundAccel;
            car.vx += car.ax * dt;
            car.worldX += car.vx * dt;
            car.worldY = 0;
            car.rotation = 0;
            car.angularVelocity = 0;
            return;
        }

        // Tipping phase: front is over the edge, rear still on ground -> pitch nose down
        if (frontHasNoGround && rearStillOnGround) {
            car.ax = groundAccel;
            car.vx += car.ax * dt;
            car.worldX += car.vx * dt;
            car.worldY = 0;

            const targetRotation = TIPPING_TARGET_NOSE_DOWN; // nose-down bias
            const angAccel = (targetRotation - car.rotation) * TIPPING_STIFFNESS - car.angularVelocity * TIPPING_DAMPING;
            car.angularVelocity += angAccel * dt;
            car.angularVelocity = clamp(car.angularVelocity, -MAX_TIPPING_ANGULAR_VELOCITY, MAX_TIPPING_ANGULAR_VELOCITY);
            car.rotation += car.angularVelocity * dt;
            car.rotation = clamp(car.rotation, MIN_AIR_ROTATION, MAX_AIR_ROTATION);

            // Release into flight once rotation tips far enough or rear leaves ground
            const rearOffGround = car.worldX > ground1End;
            if (Math.abs(car.rotation) >= TIPPING_RELEASE_ANGLE || rearOffGround) {
                simulation.hasLaunched = true;
                simulation.timeSinceLaunch = 0;
                simulation.takeoffWorldX = car.worldX;
                simulation.takeoffVelocity = car.vx;
                car.ax = 0;
                car.vy = 0;
                // keep current angular velocity to carry the tip into the air
            }
            return;
        }

        // Rear has also cleared: start airborne phase
        simulation.hasLaunched = true;
        simulation.timeSinceLaunch = 0;
        simulation.takeoffWorldX = car.worldX;
        simulation.takeoffVelocity = car.vx;
        car.ax = 0;
        car.vy = 0;
        car.angularVelocity = (Math.random() - 0.5) * INITIAL_AIR_SPIN;
        return;
    }

    // Airborne: integrate dt-based motion with gravity and angular dynamics
    simulation.timeSinceLaunch += dt;

    car.ax = 0; // no thrust in mid-air
    car.vy += GRAVITY * dt;
    car.worldX += car.vx * dt;
    car.worldY += car.vy * dt;

    // Random angular jitter to keep the spin lively
    const angularJitter = (Math.random() - 0.5) * AIR_SPIN_NOISE * dt;
    car.angularVelocity += angularJitter;

    // Manual control hook: adjust car.angularVelocity here in the future.

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
    const killPlaneY = getKillPlaneY();
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
            const shortFall = carFrontX < ground2Start;
            const reason = shortFall ? 'short' : 'long';
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
        // Already in a post-crash fall: finish once we reach the canyon floor.
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

if (gameContainerEl && carSelectionEl) {
    gameContainerEl.insertBefore(physicsCalculationsPanel, carSelectionEl.nextSibling);
}

function computePhysicsData() {
    const acceleration = cars[selectedCar].acceleration;
    const carLength = getCarLengthMeters();
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

    return {
        acceleration,
        carLength,
        runDistance,
        takeoffVelocity,
        timeToTakeoff,
        fallTime,
        horizontalDistance,
        requiredHorizontalMin,
        requiredHorizontalMax,
        dropHeight,
        success
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
        buildOptionalLine('Acceleration', data.acceleration, (v) => `${v.toFixed(2)} m/s²`),
        buildOptionalLine('Run-up Distance', data.runDistance, (v) => `${v.toFixed(2)} m`),
        buildOptionalLine('Takeoff Speed', data.takeoffVelocity, (v) => `${v.toFixed(2)} m/s`),
        buildOptionalLine('Acceleration Time', data.timeToTakeoff, (v) => `${v.toFixed(2)} s`),
        buildOptionalLine('Air Time', data.fallTime, (v) => `${v.toFixed(2)} s`),
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

    if (physicsCalculationsPanel) {
        physicsCalculationsPanel.innerHTML = `
            <h3>Physics Calculations</h3>
            ${mathLines.map(line => `<p>${line}</p>`).join('')}
            <p><strong>Status:</strong> ${statusText}</p>
        `;
    }
}

function updateMathPanel(statusPrefix = 'Prediction:') {
    lastPhysicsData = computePhysicsData();
    const statusText = buildPredictionStatus(lastPhysicsData, statusPrefix);
    refreshPhysicsDisplays(lastPhysicsData, statusText);
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
const totalImages = 5;

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

carImages.forEach((img, index) => {
    img.onload = imageLoaded;
    img.onerror = () => {
        console.error(`Failed to load car image ${index}`);
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

    startButtonEl.classList.add('hidden');
    const data = lastPhysicsData || computePhysicsData();
    refreshPhysicsDisplays(data, 'Simulation running...');

    console.log('Simulation started!');
    startSimulation();
});

// -----------------------------------------------------------------------------
// Kick things off
// -----------------------------------------------------------------------------
updateMathPanel();
requestAnimationFrame(animate);