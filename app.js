/**
 * Advanced Baby Vision Simulator - Main Application
 * Camera handling, UI controls, and rendering loop
 * Vision processing handled by vision.js module
 */

import {
  AGE_PRESETS,
  applyInfantColorVision,
  applyPeripheralVision,
  applySpatialFrequencyFilter,
  applyLMSColorProcessing,
  applyOpticalEffects,
  applyNeuralEffects,
  applyTemporalIntegration
} from './vision.js';

/**
 * DOM elements
 */
const videoElement = document.getElementById("cameraVideo");
const outputCanvas = document.getElementById("outputCanvas");
const infoPanel = document.getElementById("infoPanel");
const mirrorToggle = document.getElementById("mirrorToggle");
const peripheralBlurToggle = document.getElementById("peripheralBlurToggle");

/**
 * Canvas contexts and processing buffers
 */
let outputCtx;
let processingCanvases = {};
let selectedAge = 1;
let isMirrored = true;
let enablePeripheralBlend = true;
let animationFrameId = null;
let frameCount = 0;

/**
 * Initialize processing canvases
 */
function setupCanvases(width, height) {
  console.log("Setting up canvases with dimensions:", width, "x", height);

  if (width <= 0 || height <= 0) {
    console.error("Invalid canvas dimensions:", width, height);
    return;
  }

  outputCanvas.width = width;
  outputCanvas.height = height;
  outputCtx = outputCanvas.getContext("2d", {
    alpha: false,
    willReadFrequently: true,
  });

  console.log("Output canvas setup complete. Context:", outputCtx);

  // Create multiple processing buffers
  const canvasNames = [
    "input",
    "frequency",
    "color",
    "spatial",
    "temporal",
    "final",
  ];
  canvasNames.forEach((name) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    processingCanvases[name] = {
      canvas: canvas,
      ctx: canvas.getContext("2d", {alpha: false, willReadFrequently: true}),
    };
  });

  console.log("All processing canvases created");
}

// Vision processing functions are now in vision.js

/**
 * Main processing pipeline
 */
function processFrame() {
  if (!outputCtx) {
    console.error("Output context not available");
    return;
  }

  const width = outputCanvas.width;
  const height = outputCanvas.height;

  if (width <= 0 || height <= 0) {
    console.error("Invalid canvas dimensions in processFrame:", width, height);
    return;
  }

  if (!videoElement || videoElement.readyState < 2) {
    console.log("Video not ready, skipping frame");
    return;
  }

  // Step 1: Draw base video with mirroring
  try {
    outputCtx.save();
    if (isMirrored) {
      outputCtx.translate(width, 0);
      outputCtx.scale(-1, 1);
    }
    outputCtx.drawImage(videoElement, 0, 0, width, height);
    outputCtx.restore();
  } catch (error) {
    console.error("Error drawing video to canvas:", error);
    return;
  }

  // Step 2: Apply proper infant color vision (black/white/red dominance)
  const preset = AGE_PRESETS[selectedAge];
  const blurAmount = Math.max(0, (4 - selectedAge) * 2);

  // Apply basic blur and contrast first
  if (blurAmount > 0) {
    outputCtx.save();
    outputCtx.filter = `blur(${blurAmount}px) contrast(${
      preset.contrastSensitivityPeak * 2
    }%)`;
    outputCtx.drawImage(outputCtx.canvas, 0, 0);
    outputCtx.restore();
  }

  // Apply infant-specific color vision processing
  applyInfantColorVision(outputCtx, width, height, preset, selectedAge);

  // Step 3: Apply peripheral vision limitation (vignette)
  if (enablePeripheralBlend) {
    applyPeripheralVision(outputCtx, width, height, preset);
  }

  // TODO: Re-enable filters step by step
  /*
  // Step 1: Capture input
  const inputCtx = processingCanvases.input.ctx;
  inputCtx.save();
  if (isMirrored) {
    inputCtx.translate(width, 0);
    inputCtx.scale(-1, 1);
  }
  inputCtx.drawImage(videoElement, 0, 0, width, height);
  inputCtx.restore();

  // Step 2: Apply spatial frequency filtering (CSF)
  processingCanvases.frequency.ctx.drawImage(
    processingCanvases.input.canvas,
    0,
    0
  );
  applySpatialFrequencyFilter(
    processingCanvases.frequency.ctx,
    width,
    height,
    preset
  );

  // Step 3: LMS color processing
  processingCanvases.color.ctx.drawImage(
    processingCanvases.frequency.canvas,
    0,
    0
  );
  applyLMSColorProcessing(processingCanvases.color.ctx, width, height, preset);

  // Step 4: Optical effects (scatter, aberrations)
  processingCanvases.spatial.ctx.drawImage(
    processingCanvases.color.canvas,
    0,
    0
  );
  applyOpticalEffects(processingCanvases.spatial.ctx, width, height, preset);

  // Step 5: Visual field and peripheral effects
  processingCanvases.temporal.ctx.drawImage(
    processingCanvases.spatial.canvas,
    0,
    0
  );
  applyVisualField(processingCanvases.temporal.ctx, width, height, preset);

  // Step 6: Neural effects (noise, lateral inhibition)
  processingCanvases.final.ctx.drawImage(
    processingCanvases.temporal.canvas,
    0,
    0
  );
  applyNeuralEffects(processingCanvases.final.ctx, width, height, preset);

  // Output to display
  outputCtx.drawImage(processingCanvases.final.canvas, 0, 0);
  */

  // Add frame rate indicator for temporal effects
  frameCount++;
  if (frameCount === 1) {
    console.log("First frame processed successfully!");
  }
  if (frameCount % 60 === 0) {
    console.log(`Raw camera feed - ${frameCount} frames processed`);
  }
}

/**
 * Render loop with temporal integration
 */
function renderLoop() {
  processFrame();
  animationFrameId = requestAnimationFrame(renderLoop);
}

/**
 * Update info panel with scientific details
 */
function updateInfoPanel() {
  const preset = AGE_PRESETS[selectedAge];

  const scientificDetails = `
    <div style="margin-top: 10px; font-size: 0.9em; color: #666;">
      <strong>Scientific Parameters:</strong><br>
      • Spatial cutoff: ${preset.spatialCutoffCPD} cpd<br>
      • Contrast sensitivity: ${preset.contrastSensitivityPeak}x<br>
      • Cone responses: L=${preset.coneSensitivity.L}, M=${
    preset.coneSensitivity.M
  }, S=${preset.coneSensitivity.S}<br>
      • Optical scatter: ${(preset.scatteringFactor * 100).toFixed(0)}%<br>
      • Central field: ${preset.centralFieldRadiusDeg}°
    </div>
  `;

  infoPanel.innerHTML = `
    <strong>${preset.label}</strong>: ${preset.description}
    ${scientificDetails}
  `;
}

/**
 * Camera initialization
 */
async function startCamera() {
  try {
    console.log("Requesting camera access...");
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: {ideal: 1280},
        height: {ideal: 720},
        frameRate: {ideal: 30},
      },
      audio: false,
    });

    console.log("Camera stream obtained:", stream);
    videoElement.srcObject = stream;

    await new Promise((resolve) => {
      if (videoElement.readyState >= 2) {
        console.log("Video ready immediately");
        resolve();
      } else {
        console.log("Waiting for video metadata...");
        videoElement.onloadedmetadata = () => {
          console.log("Video metadata loaded");
          resolve();
        };
      }
    });

    console.log(
      "Video dimensions:",
      videoElement.videoWidth,
      "x",
      videoElement.videoHeight
    );

    // CRITICAL: Start playing the video
    await videoElement.play();
    console.log("Video playing started");

    // Use container dimensions, not video dimensions
    const container = outputCanvas.parentElement;
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    console.log("Container dimensions:", containerWidth, "x", containerHeight);

    setupCanvases(containerWidth, containerHeight);
    updateInfoPanel();
    renderLoop();
    console.log("Camera initialization complete");
  } catch (error) {
    console.error("Camera error:", error);
    handleCameraError(error);
  }
}

/**
 * Setup UI controls
 */
function setupControls() {
  document.querySelectorAll('input[name="age"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      selectedAge = Number(radio.value);
      updateInfoPanel();
    });
  });

  mirrorToggle.addEventListener("change", () => {
    isMirrored = mirrorToggle.checked;
  });

  peripheralBlurToggle.addEventListener("change", () => {
    enablePeripheralBlend = peripheralBlurToggle.checked;
    updateInfoPanel();
  });
}

/**
 * Error handling
 */
function handleCameraError(error) {
  const message = document.createElement("div");
  message.style.background = "rgba(255,0,0,0.08)";
  message.style.border = "1px solid rgba(255,0,0,0.25)";
  message.style.padding = "0.75rem";
  message.style.borderRadius = "10px";
  message.style.marginTop = "1rem";
  message.innerHTML = `
    <strong>Unable to access camera</strong><br>
    Please allow camera permissions and use a supported browser over HTTPS or localhost.<br>
    <small>Error: ${error.message}</small>
  `;
  infoPanel.replaceChildren(message);
  console.error("Camera error:", error);
}

/**
 * Canvas resizing
 */
function resizeCanvasToContainer() {
  const wrap = outputCanvas.parentElement;
  if (!wrap) return;
  const rect = wrap.getBoundingClientRect();
  outputCanvas.style.width = rect.width + "px";
  outputCanvas.style.height = rect.height + "px";
}

/**
 * Initialize application
 */
function boot() {
  setupControls();
  resizeCanvasToContainer();
  window.addEventListener("resize", resizeCanvasToContainer);

  console.log("Advanced Baby Vision Simulator initialized");
  console.log(
    "Features: CSF-based spatial filtering, LMS color space, optical modeling"
  );
  console.log(
    "Research basis: Contrast sensitivity development, cone maturation, optical properties"
  );

  startCamera();
}

document.addEventListener("DOMContentLoaded", boot);
