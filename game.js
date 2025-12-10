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


// Scale: 30px = 1m (3x larger than before)
const SCALE = 20;
const GRAVITY = 9.8;
const RUN_START_OFFSET = 1;

let levelMetrics = null;

let physicsCalculationsPanel = null;
let lastPhysicsData = null;

const simulation = {
    isRunning: false,
    hasLaunched: false,
    hasFinished: false,
    hasLanded: false,
    success: null,
    worldX: 0,
    worldY: 0,
    velocityX: 0,
    velocityY: 0,
    elapsedTime: 0,
    timeSinceLaunch: 0
};

let lastFrameTime = null;

// Load ground images
const ground1Img = new Image();
ground1Img.src = 'img/Ground1.png';

const ground2Img = new Image();
ground2Img.src = 'img/Ground2.png';

// Load car images
const carImages = [
    new Image(), // Motorcycle
    new Image(), // Sports Car
    new Image()  // Supercar
];
carImages[0].src = 'img/cars-motors/motorcycle.png';
carImages[1].src = 'img/cars-motors/car1.png';
carImages[2].src = 'img/cars-motors/Volkswagen Golf Mk1 Cabriolet.png';

// Level data (corrected values)
let currentLevel = {
    ground1Length: 26, // meters
    ground1Height: 26, // meters
    gap: 10, // meters (changed from 25 to 10)
    ground2Length: 10, // meters
    ground2Height: 22 // meters (changed from 5 to 22)
};

// Car data
let selectedCar = 1; // Default: Sports Car
const cars = [
    { name: "Motorcycle", acceleration: 10.1, mass: 1200 },
    { name: "Sports Car", acceleration: 6.5, mass: 1400 },
    { name: "Supercar", acceleration: 12, mass: 1500 }
];

// Car position (3x larger)
let car = {
    x: 0,
    y: 0,
    width: 240, // Updated dynamically each frame
    height: 120, // Updated dynamically each frame
    lengthMeters: 240 / SCALE,
    velocity: 0,
    velocityY: 0,
    isJumping: false
};

const DEFAULT_CAR_ASPECT = 120 / 240;

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

function getCarLengthMeters() {
    return car.lengthMeters;
}

function resetSimulationState() {
    simulation.isRunning = false;
    simulation.hasLaunched = false;
    simulation.hasFinished = false;
    simulation.hasLanded = false;
    simulation.success = null;
    simulation.worldX = RUN_START_OFFSET;
    simulation.worldY = 0;
    simulation.velocityX = 0;
    simulation.velocityY = 0;
    simulation.elapsedTime = 0;
    simulation.timeSinceLaunch = 0;
}

function startSimulation() {
    resetSimulationState();
    simulation.isRunning = true;
    lastFrameTime = null;
}

function handleLandingResult(success, carFrontX, ground2Start, ground2End, dropToGround2) {
    simulation.success = success;

    const landingVelocity = simulation.velocityX;
    const actualHorizontal = landingVelocity * simulation.timeSinceLaunch;
    const baseData = lastPhysicsData ? { ...lastPhysicsData } : computePhysicsData();

    const actualData = {
        ...baseData,
        takeoffVelocity: landingVelocity,
        fallTime: simulation.timeSinceLaunch,
        horizontalDistance: actualHorizontal,
        success
    };

    let statusText = 'Result: ❌ Missed the platform!';

    if (success) {
        simulation.hasLanded = true;
        simulation.hasFinished = false;
        simulation.hasLaunched = false;
        simulation.timeSinceLaunch = 0;
        simulation.worldY = dropToGround2;
        simulation.velocityY = 0;

        const maxLeft = ground2End - getCarLengthMeters();
        simulation.worldX = Math.min(Math.max(ground2Start - getCarLengthMeters(), simulation.worldX), maxLeft);

        statusText = 'Result: ✅ Landed safely on Ground 2!';
    } else {
        simulation.isRunning = false;
        simulation.hasFinished = true;
        simulation.hasLanded = false;
        simulation.worldY = currentLevel.ground1Height;
        simulation.velocityX = 0;
        simulation.velocityY = 0;

        if (carFrontX < ground2Start) {
            statusText = 'Result: ❌ Fell short of the gap!';
        } else if (carFrontX > ground2End) {
            statusText = 'Result: ❌ Overshot the platform!';
        }
    }

    lastPhysicsData = actualData;
    refreshPhysicsDisplays(actualData, statusText);
}

function updateSimulation(delta) {
    if (!simulation.isRunning) {
        return;
    }

    simulation.elapsedTime += delta;

    if (simulation.hasLanded) {
        const trackEnd = currentLevel.ground1Length + currentLevel.gap + currentLevel.ground2Length - getCarLengthMeters();
        const dropToGround2 = Math.max(0, currentLevel.ground1Height - currentLevel.ground2Height);

        simulation.worldX += simulation.velocityX * delta;
        simulation.worldY = dropToGround2;

        if (simulation.worldX >= trackEnd) {
            simulation.worldX = trackEnd;
            simulation.velocityX = 0;
            simulation.isRunning = false;
            simulation.hasFinished = true;

            if (lastPhysicsData) {
                refreshPhysicsDisplays(lastPhysicsData, 'Result: ✅ Landed safely on Ground 2! (Stopped at far edge)');
            }
        }

        return;
    }

    if (!simulation.hasLaunched) {
        simulation.velocityX += cars[selectedCar].acceleration * delta;
        simulation.worldX += simulation.velocityX * delta;

        const takeoffLeftEdge = Math.max(0, currentLevel.ground1Length - getCarLengthMeters());

        if (simulation.worldX >= takeoffLeftEdge) {
            simulation.worldX = takeoffLeftEdge;
            simulation.hasLaunched = true;
            simulation.timeSinceLaunch = 0;
        }
    } else {
        simulation.timeSinceLaunch += delta;
        simulation.velocityY += GRAVITY * delta;
        simulation.worldX += simulation.velocityX * delta;
        simulation.worldY += simulation.velocityY * delta;

        const dropToGround2 = Math.max(0, currentLevel.ground1Height - currentLevel.ground2Height);
        const ground2Start = currentLevel.ground1Length + currentLevel.gap;
        const ground2End = ground2Start + currentLevel.ground2Length;
        const carFrontX = simulation.worldX + getCarLengthMeters();

        if (simulation.worldY >= dropToGround2) {
            const landedOnPlatform = carFrontX >= ground2Start && carFrontX <= ground2End;
            handleLandingResult(landedOnPlatform, carFrontX, ground2Start, ground2End, dropToGround2);
        }
    }
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

    const baseYGround1 = levelMetrics.ground1Y - drawHeight;

    if (!simulation.isRunning && !simulation.hasFinished) {
        car.x = levelMetrics.ground1X + RUN_START_OFFSET * horizontalScale;
        car.y = baseYGround1;
        return;
    }

    const worldX = simulation.worldX;
    const worldY = simulation.worldY;
    car.x = levelMetrics.ground1X + worldX * horizontalScale;

    if (simulation.success) {
        car.y = levelMetrics.ground2Y - drawHeight;
    } else if (simulation.hasLaunched || simulation.isRunning) {
        car.y = baseYGround1 + worldY * SCALE;
    } else {
        car.y = baseYGround1;
    }
}

function drawCar() {
    if (carImages[selectedCar].complete && carImages[selectedCar].naturalWidth > 0) {
        ctx.drawImage(carImages[selectedCar], car.x, car.y, car.width, car.height);
    } else {
        // Fallback rectangle
        ctx.fillStyle = '#FF5722';
        ctx.fillRect(car.x, car.y, car.width, car.height);
    }
}

function animate(timestamp) {
    if (lastFrameTime === null) {
        lastFrameTime = timestamp;
    }

    const deltaSeconds = (timestamp - lastFrameTime) / 1000;
    updateSimulation(deltaSeconds);

    drawLevel();
    updateCarScreenPosition();
    drawCar();

    lastFrameTime = timestamp;
    requestAnimationFrame(animate);
}

// Wait for images to load
let imagesLoaded = 0;
const totalImages = 5; // 2 grounds + 3 cars

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

// Start animation loop
requestAnimationFrame(animate);

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

function refreshPhysicsDisplays(data, statusText) {
    if (mathResultEl) {
        mathResultEl.innerHTML = `
            <strong>Acceleration:</strong> ${data.acceleration.toFixed(2)} m/s²<br>
            <strong>Run-up Distance:</strong> ${data.runDistance.toFixed(2)} m<br>
            <strong>Takeoff Speed:</strong> ${data.takeoffVelocity.toFixed(2)} m/s<br>
            <strong>Air Time:</strong> ${data.fallTime.toFixed(2)} s<br>
            <strong>Horizontal Travel:</strong> ${data.horizontalDistance.toFixed(2)} m (needs ${data.requiredHorizontalMin.toFixed(2)}-${data.requiredHorizontalMax.toFixed(2)} m)<br>
            <strong>Status:</strong> ${statusText}
        `;
    }

    if (physicsCalculationsPanel) {
        physicsCalculationsPanel.innerHTML = `
            <h3>Physics Calculations</h3>
            <p><strong>Acceleration:</strong> ${data.acceleration.toFixed(2)} m/s²</p>
            <p><strong>Run-up distance:</strong> ${data.runDistance.toFixed(2)} m</p>
            <p><strong>Takeoff speed:</strong> ${data.takeoffVelocity.toFixed(2)} m/s</p>
            <p><strong>Acceleration time:</strong> ${data.timeToTakeoff.toFixed(2)} s</p>
            <p><strong>Air time:</strong> ${data.fallTime.toFixed(2)} s</p>
            <p><strong>Horizontal travel:</strong> ${data.horizontalDistance.toFixed(2)} m</p>
            <p><strong>Landing window:</strong> ${data.requiredHorizontalMin.toFixed(2)}-${data.requiredHorizontalMax.toFixed(2)} m</p>
            <p><strong>Status:</strong> ${statusText}</p>
        `;
    }
}

function updateMathPanel(statusPrefix = 'Prediction:') {
    lastPhysicsData = computePhysicsData();
    const statusText = buildPredictionStatus(lastPhysicsData, statusPrefix);
    refreshPhysicsDisplays(lastPhysicsData, statusText);
}

// Car selection
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

// Start button
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

updateMathPanel();