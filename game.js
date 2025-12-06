const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Set canvas to full viewport width and 80% of viewport height
canvas.width = window.innerWidth;
canvas.height = window.innerHeight * 0.8;

// Scale: 30px = 1m (3x larger than before)
const SCALE = 20;

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
    ground1Length: 17, // meters
    ground1Height: 25, // meters
    gap: 10, // meters (changed from 25 to 10)
    ground2Length: 10, // meters
    ground2Height: 22 // meters (changed from 5 to 22)
};

// Car data
let selectedCar = 1; // Default: Sports Car
const cars = [
    { name: "Motorcycle", acceleration: 4.5, mass: 1200 },
    { name: "Sports Car", acceleration: 6.5, mass: 1400 },
    { name: "Supercar", acceleration: 12, mass: 1500 }
];

// Car position (3x larger)
let car = {
    x: 0,
    y: 0,
    width: 240, // 3x larger (was 80)
    height: 120, // 3x larger (was 40)
    velocity: 0,
    velocityY: 0,
    isJumping: false
};

function drawLevel() {
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Calculate centered starting position
    const totalWidth = (currentLevel.ground1Length + currentLevel.gap + currentLevel.ground2Length) * SCALE;
    const startX = (canvas.width - totalWidth) / 2;
    
    const ground1X = startX;
    const ground1Y = canvas.height - (currentLevel.ground1Height * SCALE);
    const ground1Width = currentLevel.ground1Length * SCALE;
    const ground1Height = currentLevel.ground1Height * SCALE;
    
    const ground2X = ground1X + ground1Width + (currentLevel.gap * SCALE);
    const ground2Y = canvas.height - (currentLevel.ground2Height * SCALE);
    const ground2Width = currentLevel.ground2Length * SCALE;
    const ground2Height = currentLevel.ground2Height * SCALE;
    
    // Update car position to be on ground 1
    car.x = ground1X + 50;
    car.y = ground1Y - car.height + 60; // Lower position for 3D perspective
    
    // Draw Ground 1 (with image if loaded, otherwise solid color)
    if (ground1Img.complete && ground1Img.naturalWidth > 0) {
        ctx.drawImage(ground1Img, ground1X, ground1Y, ground1Width, ground1Height);
    } else {
        ctx.fillStyle = '#8B4513';
        ctx.fillRect(ground1X, ground1Y, ground1Width, ground1Height);
    }
    
    // Draw Ground 2 (with image if loaded, otherwise solid color)
    if (ground2Img.complete && ground2Img.naturalWidth > 0) {
        ctx.drawImage(ground2Img, ground2X, ground2Y, ground2Width, ground2Height);
    } else {
        ctx.fillStyle = '#A0522D';
        ctx.fillRect(ground2X, ground2Y, ground2Width, ground2Height);
    }
    
    // Draw cliff edge indicators (red dashed lines)
    ctx.strokeStyle = '#FF0000';
    ctx.lineWidth = 4;
    ctx.setLineDash([15, 8]);
    
    // Ground 1 cliff edge
    ctx.beginPath();
    ctx.moveTo(ground1X + ground1Width, ground1Y);
    ctx.lineTo(ground1X + ground1Width, canvas.height);
    ctx.stroke();
    
    // Ground 2 start edge
    ctx.beginPath();
    ctx.moveTo(ground2X, ground2Y);
    ctx.lineTo(ground2X, canvas.height);
    ctx.stroke();
    
    ctx.setLineDash([]);
    
    // Draw gap measurement
    ctx.fillStyle = '#333';
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(
        `Gap: ${currentLevel.gap}m`,
        ground1X + ground1Width + (currentLevel.gap * SCALE) / 2,
        canvas.height - 30
    );
    
    // Draw ground labels
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

function drawCar() {
    if (carImages[selectedCar].complete && carImages[selectedCar].naturalWidth > 0) {
        ctx.drawImage(carImages[selectedCar], car.x, car.y, car.width, car.height);
    } else {
        // Fallback rectangle
        ctx.fillStyle = '#FF5722';
        ctx.fillRect(car.x, car.y, car.width, car.height);
    }
}

function animate() {
    drawLevel();
    drawCar();
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

// Start animation immediately (will show colors until images load)
animate();

// Handle window resize
window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight * 0.8;
    
    // Redraw immediately after resize
    drawLevel();
    drawCar();
});

// Car selection
document.querySelectorAll('.car-option').forEach((option, index) => {
    option.addEventListener('click', () => {
        document.querySelectorAll('.car-option').forEach(o => o.classList.remove('selected'));
        option.classList.add('selected');
        selectedCar = index;
        console.log(`Selected car: ${cars[index].name}`);
    });
});

// Start button
document.getElementById('startButton').addEventListener('click', () => {
    document.getElementById('mathPanel').classList.add('hidden');
    document.getElementById('startButton').classList.add('hidden');
    console.log('Simulation started!');
    // Start simulation here
});