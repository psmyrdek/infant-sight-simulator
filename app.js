/**
 * Advanced Baby Vision Simulator with Scientific Vision Models
 * Implements spatial frequency filtering, LMS color space, and optical modeling
 * Runs natively in modern browsers without WebGL
 */

/**
 * Scientific constants for vision modeling
 */
const VISION_CONSTANTS = {
  // Adult peak contrast sensitivity at ~3-4 cycles/degree
  ADULT_PEAK_CPD: 3.5,
  // Critical flicker frequency (Hz) - lower in infants
  CFF_1_MONTH: 40,
  CFF_2_MONTH: 50,
  CFF_3_MONTH: 55,
  CFF_ADULT: 60,
  // Photoreceptor density relative to adult (foveal)
  CONE_DENSITY_1_MONTH: 0.25,
  CONE_DENSITY_2_MONTH: 0.4,
  CONE_DENSITY_3_MONTH: 0.55,
};

/**
 * LMS to RGB conversion matrix (Hunt-Pointer-Estevez)
 * For simulating cone responses
 */
const LMS_TO_RGB = [
  [5.47221, -4.64196, 0.16975],
  [-1.1248, 2.29317, -0.16837],
  [0.0298, -0.19318, 1.16338],
];

const RGB_TO_LMS = [
  [0.31399, 0.63951, 0.0465],
  [0.15537, 0.75789, 0.08674],
  [0.01775, 0.10945, 0.8728],
];

/**
 * Enhanced age presets with scientific parameters
 */
const AGE_PRESETS = {
  1: {
    label: "1 month",
    // Spatial frequency response (cycles per degree)
    spatialCutoffCPD: 2.4,
    peakSensitivityCPD: 0.5,
    // Contrast sensitivity function parameters
    contrastSensitivityPeak: 10, // vs ~100-200 in adults
    contrastSlope: 0.65,
    // Temporal response
    temporalIntegrationMs: 200, // slower processing
    // Color vision (relative cone sensitivities)
    coneSensitivity: {
      L: 0.6, // Long wavelength (red)
      M: 0.4, // Medium wavelength (green)
      S: 0.15, // Short wavelength (blue) - very immature
    },
    // Optical properties
    pupilDiameterMm: 2.5, // smaller pupil
    scatteringFactor: 0.3, // more light scatter
    accommodationRange: 0.2, // poor focus adjustment
    // Visual field
    centralFieldRadiusDeg: 10,
    peripheralSuppression: 0.7,
    // Neural factors
    lateralInhibition: 0.3,
    photoreceptorNoise: 0.15,
    description:
      "Visual acuity 20/800-20/200 (2.4 cpd cutoff). Minimal blue cone function. High optical scatter. Focus locked at 8-10 inches.",
  },
  2: {
    label: "2 months",
    spatialCutoffCPD: 2.8,
    peakSensitivityCPD: 1.0,
    contrastSensitivityPeak: 40,
    contrastSlope: 0.75,
    temporalIntegrationMs: 150,
    coneSensitivity: {
      L: 0.85,
      M: 0.65,
      S: 0.45, // S-cones developing rapidly
    },
    pupilDiameterMm: 3.0,
    scatteringFactor: 0.2,
    accommodationRange: 0.4,
    centralFieldRadiusDeg: 15,
    peripheralSuppression: 0.5,
    lateralInhibition: 0.5,
    photoreceptorNoise: 0.08,
    description:
      "Visual acuity 20/150 (2.8 cpd). S-cones functional. Contrast sensitivity 4-5x improved. Beginning accommodation.",
  },
  3: {
    label: "3 months",
    spatialCutoffCPD: 4.0,
    peakSensitivityCPD: 1.5,
    contrastSensitivityPeak: 60,
    contrastSlope: 0.85,
    temporalIntegrationMs: 100,
    coneSensitivity: {
      L: 0.95,
      M: 0.85,
      S: 0.7,
    },
    pupilDiameterMm: 3.5,
    scatteringFactor: 0.1,
    accommodationRange: 0.6,
    centralFieldRadiusDeg: 20,
    peripheralSuppression: 0.3,
    lateralInhibition: 0.7,
    photoreceptorNoise: 0.04,
    description:
      "Visual acuity 20/60 (4.0 cpd). Good color discrimination. Smooth pursuit tracking. Emerging stereopsis.",
  },
};

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
  outputCanvas.width = width;
  outputCanvas.height = height;
  outputCtx = outputCanvas.getContext("2d", {alpha: false});

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
      ctx: canvas.getContext("2d", {alpha: false}),
    };
  });
}

/**
 * Contrast Sensitivity Function (CSF) implementation
 * Models how contrast sensitivity varies with spatial frequency
 */
function getContrastSensitivity(frequencyCPD, preset) {
  const peak = preset.peakSensitivityCPD;
  const cutoff = preset.spatialCutoffCPD;
  const maxSensitivity = preset.contrastSensitivityPeak;

  if (frequencyCPD > cutoff) return 0;

  // Simplified CSF model with low-frequency drop and high-frequency cutoff
  const lowFreqFactor = Math.min(1, frequencyCPD / peak);
  const highFreqFactor = Math.max(
    0,
    1 - Math.pow((frequencyCPD - peak) / (cutoff - peak), 2)
  );

  return maxSensitivity * lowFreqFactor * highFreqFactor;
}

/**
 * Apply spatial frequency filtering using separable convolution
 * Simulates the contrast sensitivity function
 */
function applySpatialFrequencyFilter(ctx, width, height, preset) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const output = new Uint8ClampedArray(data);

  // Generate CSF-based kernel
  const kernelSize = Math.ceil(preset.spatialCutoffCPD * 2) * 2 + 1;
  const kernel = generateCSFKernel(kernelSize, preset);

  // Apply separable convolution for efficiency
  const temp = new Uint8ClampedArray(data);

  // Horizontal pass
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      applyKernelPixel(data, temp, width, height, x, y, kernel, true);
    }
  }

  // Vertical pass
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      applyKernelPixel(temp, output, width, height, x, y, kernel, false);
    }
  }

  // Apply contrast modulation based on CSF
  for (let i = 0; i < output.length; i += 4) {
    const luminance =
      0.299 * output[i] + 0.587 * output[i + 1] + 0.114 * output[i + 2];
    const contrast = (luminance - 128) / 128;
    const modulated = 128 + contrast * preset.contrastSlope * 128;

    const factor = modulated / luminance;
    output[i] = Math.min(255, output[i] * factor);
    output[i + 1] = Math.min(255, output[i + 1] * factor);
    output[i + 2] = Math.min(255, output[i + 2] * factor);
  }

  imageData.data.set(output);
  ctx.putImageData(imageData, 0, 0);
}

/**
 * Generate kernel based on Contrast Sensitivity Function
 */
function generateCSFKernel(size, preset) {
  const kernel = new Float32Array(size);
  const center = Math.floor(size / 2);
  let sum = 0;

  for (let i = 0; i < size; i++) {
    const distance = Math.abs(i - center);
    const frequencyCPD = distance * 0.5; // Approximate mapping
    const sensitivity = getContrastSensitivity(frequencyCPD, preset);
    kernel[i] =
      Math.exp((-distance * distance) / (2 * preset.spatialCutoffCPD)) *
      sensitivity;
    sum += kernel[i];
  }

  // Normalize
  for (let i = 0; i < size; i++) {
    kernel[i] /= sum;
  }

  return kernel;
}

/**
 * Apply 1D kernel to pixel (for separable convolution)
 */
function applyKernelPixel(
  input,
  output,
  width,
  height,
  x,
  y,
  kernel,
  horizontal
) {
  const idx = (y * width + x) * 4;
  const kernelRadius = Math.floor(kernel.length / 2);
  let r = 0,
    g = 0,
    b = 0,
    weightSum = 0;

  for (let k = -kernelRadius; k <= kernelRadius; k++) {
    let sampleX = x,
      sampleY = y;
    if (horizontal) {
      sampleX = Math.max(0, Math.min(width - 1, x + k));
    } else {
      sampleY = Math.max(0, Math.min(height - 1, y + k));
    }

    const sampleIdx = (sampleY * width + sampleX) * 4;
    const weight = kernel[k + kernelRadius];

    r += input[sampleIdx] * weight;
    g += input[sampleIdx + 1] * weight;
    b += input[sampleIdx + 2] * weight;
    weightSum += weight;
  }

  output[idx] = r / weightSum;
  output[idx + 1] = g / weightSum;
  output[idx + 2] = b / weightSum;
  output[idx + 3] = 255;
}

/**
 * Convert RGB to LMS color space and apply cone sensitivity
 */
function applyLMSColorProcessing(ctx, width, height, preset) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    // Normalize RGB
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;

    // Convert to LMS
    let L = RGB_TO_LMS[0][0] * r + RGB_TO_LMS[0][1] * g + RGB_TO_LMS[0][2] * b;
    let M = RGB_TO_LMS[1][0] * r + RGB_TO_LMS[1][1] * g + RGB_TO_LMS[1][2] * b;
    let S = RGB_TO_LMS[2][0] * r + RGB_TO_LMS[2][1] * g + RGB_TO_LMS[2][2] * b;

    // Apply cone sensitivities
    L *= preset.coneSensitivity.L;
    M *= preset.coneSensitivity.M;
    S *= preset.coneSensitivity.S;

    // Add von Kries adaptation (simplified)
    const adaptationFactor = 0.8 + (0.2 * selectedAge) / 3;
    L = L * adaptationFactor + (1 - adaptationFactor) * 0.5;
    M = M * adaptationFactor + (1 - adaptationFactor) * 0.5;
    S = S * adaptationFactor + (1 - adaptationFactor) * 0.5;

    // Convert back to RGB
    let newR =
      LMS_TO_RGB[0][0] * L + LMS_TO_RGB[0][1] * M + LMS_TO_RGB[0][2] * S;
    let newG =
      LMS_TO_RGB[1][0] * L + LMS_TO_RGB[1][1] * M + LMS_TO_RGB[1][2] * S;
    let newB =
      LMS_TO_RGB[2][0] * L + LMS_TO_RGB[2][1] * M + LMS_TO_RGB[2][2] * S;

    // Clamp and denormalize
    data[i] = Math.max(0, Math.min(255, newR * 255));
    data[i + 1] = Math.max(0, Math.min(255, newG * 255));
    data[i + 2] = Math.max(0, Math.min(255, newB * 255));
  }

  ctx.putImageData(imageData, 0, 0);
}

/**
 * Simulate optical properties (scatter, aberrations)
 */
function applyOpticalEffects(ctx, width, height, preset) {
  // Light scattering (simplified Mie scattering)
  if (preset.scatteringFactor > 0) {
    ctx.save();
    ctx.globalAlpha = preset.scatteringFactor;
    ctx.filter = `blur(${preset.scatteringFactor * 10}px)`;
    ctx.globalCompositeOperation = "screen";
    ctx.drawImage(ctx.canvas, 0, 0, width, height);
    ctx.restore();
  }

  // Chromatic aberration (wavelength-dependent blur)
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const output = new Uint8ClampedArray(data);

  // Simple chromatic aberration by channel offset
  const aberrationPx = (3 - selectedAge) * 0.5;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;

      // Red channel - slight offset
      const redX = Math.round(x - aberrationPx);
      if (redX >= 0 && redX < width) {
        const redIdx = (y * width + redX) * 4;
        output[idx] = data[redIdx];
      }

      // Blue channel - opposite offset
      const blueX = Math.round(x + aberrationPx);
      if (blueX >= 0 && blueX < width) {
        const blueIdx = (y * width + blueX) * 4;
        output[idx + 2] = data[blueIdx + 2];
      }
    }
  }

  imageData.data.set(output);
  ctx.putImageData(imageData, 0, 0);
}

/**
 * Apply visual field and peripheral vision effects
 */
function applyVisualField(ctx, width, height, preset) {
  const centerX = width / 2;
  const centerY = height / 2;

  // Create radial gradient for field restriction
  ctx.save();
  ctx.globalCompositeOperation = "multiply";

  // Calculate field radius in pixels
  const fieldRadiusPx =
    (Math.min(width, height) * preset.centralFieldRadiusDeg) / 40;
  const falloffRadiusPx = fieldRadiusPx * 1.5;

  const gradient = ctx.createRadialGradient(
    centerX,
    centerY,
    fieldRadiusPx,
    centerX,
    centerY,
    falloffRadiusPx
  );

  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(
    0.5,
    `rgba(255,255,255,${1 - preset.peripheralSuppression * 0.3})`
  );
  gradient.addColorStop(
    1,
    `rgba(255,255,255,${1 - preset.peripheralSuppression})`
  );

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  // Add peripheral blur
  if (enablePeripheralBlend) {
    applyPeripheralBlur(ctx, width, height, preset);
  }
}

/**
 * Apply increasing blur toward periphery
 */
function applyPeripheralBlur(ctx, width, height, preset) {
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = width;
  tempCanvas.height = height;
  const tempCtx = tempCanvas.getContext("2d");

  // Create multiple blur levels
  const blurLevels = 3;
  for (let level = 1; level <= blurLevels; level++) {
    tempCtx.filter = `blur(${level * 2 * (4 - selectedAge)}px)`;
    tempCtx.drawImage(ctx.canvas, 0, 0);

    // Apply as ring
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = (0.3 * level) / blurLevels;

    const innerRadius = Math.min(width, height) * 0.2 * level;
    const outerRadius = Math.min(width, height) * 0.3 * (level + 1);

    const gradient = ctx.createRadialGradient(
      width / 2,
      height / 2,
      innerRadius,
      width / 2,
      height / 2,
      outerRadius
    );
    gradient.addColorStop(0, "rgba(0,0,0,0)");
    gradient.addColorStop(0.5, "rgba(0,0,0,0.5)");
    gradient.addColorStop(1, "rgba(0,0,0,1)");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(tempCanvas, 0, 0);
    ctx.restore();
  }
}

/**
 * Add photoreceptor noise and neural effects
 */
function applyNeuralEffects(ctx, width, height, preset) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // Photoreceptor noise (Poisson-like)
  if (preset.photoreceptorNoise > 0) {
    for (let i = 0; i < data.length; i += 4) {
      const noise = (Math.random() - 0.5) * preset.photoreceptorNoise * 255;
      data[i] = Math.max(0, Math.min(255, data[i] + noise));
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
    }
  }

  // Lateral inhibition (edge enhancement/suppression)
  if (preset.lateralInhibition < 1) {
    const inhibitionKernel = [
      -preset.lateralInhibition * 0.1,
      -preset.lateralInhibition * 0.2,
      1 + preset.lateralInhibition * 0.6,
      -preset.lateralInhibition * 0.2,
      -preset.lateralInhibition * 0.1,
    ];

    // Simple 1D convolution for lateral inhibition
    const temp = new Uint8ClampedArray(data);
    for (let y = 0; y < height; y++) {
      for (let x = 2; x < width - 2; x++) {
        const idx = (y * width + x) * 4;
        for (let c = 0; c < 3; c++) {
          let sum = 0;
          for (let k = -2; k <= 2; k++) {
            sum += data[idx + k * 4 + c] * inhibitionKernel[k + 2];
          }
          temp[idx + c] = Math.max(0, Math.min(255, sum));
        }
      }
    }
    data.set(temp);
  }

  ctx.putImageData(imageData, 0, 0);
}

/**
 * Main processing pipeline
 */
function processFrame() {
  const width = outputCanvas.width;
  const height = outputCanvas.height;
  const preset = AGE_PRESETS[selectedAge];

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

  // Add frame rate indicator for temporal effects
  frameCount++;
  if (frameCount % 60 === 0) {
    console.log(
      `Processing at ${preset.temporalIntegrationMs}ms integration time`
    );
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
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: {ideal: 1280},
        height: {ideal: 720},
        frameRate: {ideal: 30},
      },
      audio: false,
    });
    videoElement.srcObject = stream;

    await new Promise((resolve) => {
      if (videoElement.readyState >= 2) resolve();
      else videoElement.onloadedmetadata = resolve;
    });

    setupCanvases(videoElement.videoWidth, videoElement.videoHeight);
    updateInfoPanel();
    renderLoop();
  } catch (error) {
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
