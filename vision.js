/**
 * Baby Vision Processing Module
 * Contains all vision-specific constants, presets, and processing functions
 */

/**
 * Utility functions and scientific helpers
 */
const DEFAULT_CAMERA_HFOV_DEG = 60; // typical front camera horizontal FOV

function degToRad(deg) {
  return (deg * Math.PI) / 180;
}

function radToDeg(rad) {
  return (rad * 180) / Math.PI;
}

// Estimate pixels-per-degree using assumed camera FOV and canvas size
function estimatePixelsPerDegree(
  width,
  height,
  hfovDeg = DEFAULT_CAMERA_HFOV_DEG
) {
  const aspect = width > 0 && height > 0 ? width / height : 16 / 9;
  const hfovRad = degToRad(hfovDeg);
  const vfovRad = 2 * Math.atan(Math.tan(hfovRad / 2) / aspect);
  const vfovDeg = radToDeg(vfovRad);
  const ppdX = width / hfovDeg;
  const ppdY = height / vfovDeg;
  return Math.max(1, Math.min(ppdX, ppdY));
}

// sRGB <-> linear conversions (per-channel, values in 0..1)
function srgbToLinear(v) {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function linearToSrgb(v) {
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

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
    spatialCutoffCPD: 1.5,
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
    photoreceptorNoise: 0.08,
    description:
      "Visual acuity ~20/400 (1.5 cpd cutoff). Minimal blue cone function. High optical scatter. Best focus at 8-10 inches.",
  },
  2: {
    label: "2 months",
    spatialCutoffCPD: 2.5,
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
    photoreceptorNoise: 0.05,
    description:
      "Visual acuity ~20/150 (2.5 cpd). S-cones functional. Contrast sensitivity 4-5x improved. Beginning accommodation.",
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
    photoreceptorNoise: 0.02,
    description:
      "Visual acuity 20/60 (4.0 cpd). Good color discrimination. Smooth pursuit tracking. Emerging stereopsis.",
  },
};

/**
 * Apply infant color vision (black/white/red dominance)
 * Based on cone development: L-cones first, M-cones gradual, S-cones last
 */
function applyInfantColorVision(ctx, width, height, preset, selectedAge) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    // normalize and linearize
    const rS = data[i] / 255;
    const gS = data[i + 1] / 255;
    const bS = data[i + 2] / 255;
    const rL = srgbToLinear(rS);
    const gL = srgbToLinear(gS);
    const bL = srgbToLinear(bS);

    // Linear luminance (Rec.709)
    const luminance = 0.2126 * rL + 0.7152 * gL + 0.0722 * bL;

    if (selectedAge === 1) {
      // 1 month: Primarily black/white with strong red preference
      // Almost no blue/green discrimination
      const redStrength = rL * preset.coneSensitivity.L;
      const desaturated = luminance * 0.85;

      const outR = clamp01(desaturated + redStrength * 0.25);
      const outG = clamp01(desaturated * preset.coneSensitivity.M);
      const outB = clamp01(desaturated * preset.coneSensitivity.S);

      data[i] = Math.round(linearToSrgb(outR) * 255);
      data[i + 1] = Math.round(linearToSrgb(outG) * 255);
      data[i + 2] = Math.round(linearToSrgb(outB) * 255);
    } else if (selectedAge === 2) {
      // 2 months: Red/green developing, blue still very limited
      const outR = clamp01(rL * preset.coneSensitivity.L);
      const outG = clamp01(gL * preset.coneSensitivity.M);
      const outB = clamp01(
        Math.min(bL * preset.coneSensitivity.S, luminance * 0.3)
      );

      data[i] = Math.round(linearToSrgb(outR) * 255);
      data[i + 1] = Math.round(linearToSrgb(outG) * 255);
      data[i + 2] = Math.round(linearToSrgb(outB) * 255);
    } else {
      // 3 months: More adult-like but still limited
      const outR = clamp01(rL * preset.coneSensitivity.L);
      const outG = clamp01(gL * preset.coneSensitivity.M);
      const outB = clamp01(bL * preset.coneSensitivity.S);

      data[i] = Math.round(linearToSrgb(outR) * 255);
      data[i + 1] = Math.round(linearToSrgb(outG) * 255);
      data[i + 2] = Math.round(linearToSrgb(outB) * 255);
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

/**
 * Apply peripheral vision limitation (vignette effect)
 */
function applyPeripheralVision(ctx, width, height, preset) {
  const centerX = width / 2;
  const centerY = height / 2;
  const ppd = estimatePixelsPerDegree(width, height);
  const centralRadiusPx = Math.max(1, preset.centralFieldRadiusDeg * ppd);
  const maxRadiusPx = Math.hypot(width, height) * 0.5;

  ctx.save();
  ctx.globalCompositeOperation = "multiply";

  const gradient = ctx.createRadialGradient(
    centerX,
    centerY,
    Math.max(1, centralRadiusPx * 0.5),
    centerX,
    centerY,
    Math.max(centralRadiusPx, maxRadiusPx)
  );
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(
    0.5,
    `rgba(255,255,255,${1 - preset.peripheralSuppression * 0.4})`
  );
  gradient.addColorStop(
    1,
    `rgba(255,255,255,${1 - preset.peripheralSuppression})`
  );

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
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
 * Generate Gaussian kernel
 */
function generateGaussianKernel1D(sigmaPx) {
  const radius = Math.max(1, Math.floor(sigmaPx * 3));
  const size = radius * 2 + 1;
  const kernel = new Float32Array(size);
  const twoSigma2 = 2 * sigmaPx * sigmaPx;
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / twoSigma2);
    kernel[i + radius] = v;
    sum += v;
  }
  for (let i = 0; i < size; i++) kernel[i] /= sum;
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
 * Apply spatial frequency filtering using separable convolution
 * Simulates the contrast sensitivity function
 */
function applySpatialFrequencyFilter(ctx, width, height, preset) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const output = new Uint8ClampedArray(data.length);

  // Compute Gaussian sigma from cutoff CPD and PPD using -3 dB relation
  const ppd = estimatePixelsPerDegree(width, height);
  const cutoffCpd = Math.max(0.5, preset.spatialCutoffCPD);
  const cutoffCyclesPerPixel = cutoffCpd / ppd;
  const sigmaPx = Math.max(
    0.5,
    Math.sqrt(Math.log(2)) / (2 * Math.PI * cutoffCyclesPerPixel)
  );
  const kernel = generateGaussianKernel1D(sigmaPx);

  // Apply separable Gaussian
  const temp = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      applyKernelPixel(data, temp, width, height, x, y, kernel, true);
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      applyKernelPixel(temp, output, width, height, x, y, kernel, false);
    }
  }

  // Global contrast compression to reflect reduced CSF amplitude
  const slope = clamp01(preset.contrastSlope);
  for (let i = 0; i < output.length; i += 4) {
    // linearize
    let r = srgbToLinear(output[i] / 255);
    let g = srgbToLinear(output[i + 1] / 255);
    let b = srgbToLinear(output[i + 2] / 255);
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r = clamp01(L + (r - L) * slope);
    g = clamp01(L + (g - L) * slope);
    b = clamp01(L + (b - L) * slope);
    output[i] = Math.round(linearToSrgb(r) * 255);
    output[i + 1] = Math.round(linearToSrgb(g) * 255);
    output[i + 2] = Math.round(linearToSrgb(b) * 255);
  }

  imageData.data.set(output);
  ctx.putImageData(imageData, 0, 0);
}

/**
 * Convert RGB to LMS color space and apply cone sensitivity
 */
function applyLMSColorProcessing(ctx, width, height, preset, selectedAge) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    // Normalize RGB and convert to linear
    const r = srgbToLinear(data[i] / 255);
    const g = srgbToLinear(data[i + 1] / 255);
    const b = srgbToLinear(data[i + 2] / 255);

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

    // Clamp and encode to sRGB
    data[i] = Math.round(linearToSrgb(clamp01(newR)) * 255);
    data[i + 1] = Math.round(linearToSrgb(clamp01(newG)) * 255);
    data[i + 2] = Math.round(linearToSrgb(clamp01(newB)) * 255);
  }

  ctx.putImageData(imageData, 0, 0);
}

/**
 * Simulate optical properties (scatter, aberrations)
 */
function applyOpticalEffects(ctx, width, height, preset, selectedAge) {
  // Light scattering
  if (preset.scatteringFactor > 0) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, preset.scatteringFactor);
    ctx.filter = `blur(${preset.scatteringFactor * 8}px)`;
    ctx.globalCompositeOperation = "screen";
    ctx.drawImage(ctx.canvas, 0, 0, width, height);
    ctx.restore();
  }

  // Chromatic aberration (radial, wavelength-dependent)
  const imageData = ctx.getImageData(0, 0, width, height);
  const src = imageData.data;
  const dst = new Uint8ClampedArray(src);
  const cx = width / 2;
  const cy = height / 2;
  const maxR = Math.hypot(cx, cy);
  const strength = (3 - selectedAge) * 0.6; // px at the border

  function sampleNearest(ix, iy, channel) {
    const x = Math.max(0, Math.min(width - 1, Math.round(ix)));
    const y = Math.max(0, Math.min(height - 1, Math.round(iy)));
    return src[(y * width + x) * 4 + channel];
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const rNorm = Math.min(1, Math.hypot(dx, dy) / maxR);
      const ux = dx === 0 && dy === 0 ? 0 : dx / (Math.hypot(dx, dy) || 1);
      const uy = dx === 0 && dy === 0 ? 0 : dy / (Math.hypot(dx, dy) || 1);
      const shiftR = -strength * rNorm; // red inward
      const shiftB = strength * rNorm; // blue outward

      const rSampleX = x + ux * shiftR;
      const rSampleY = y + uy * shiftR;
      const bSampleX = x + ux * shiftB;
      const bSampleY = y + uy * shiftB;

      const idx = (y * width + x) * 4;
      dst[idx] = sampleNearest(rSampleX, rSampleY, 0);
      dst[idx + 1] = src[idx + 1]; // green minimal shift
      dst[idx + 2] = sampleNearest(bSampleX, bSampleY, 2);
    }
  }

  imageData.data.set(dst);
  ctx.putImageData(imageData, 0, 0);
}

/**
 * Add photoreceptor noise and neural effects
 */
function applyNeuralEffects(ctx, width, height, preset) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // Photoreceptor noise (signal-dependent, Poisson-like)
  if (preset.photoreceptorNoise > 0) {
    const scale = preset.photoreceptorNoise * 0.6;
    for (let i = 0; i < data.length; i += 4) {
      const L = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      const sigma = Math.sqrt(Math.max(1, L)) * scale; // heteroscedastic
      const nR = (Math.random() * 2 - 1) * sigma;
      const nG = (Math.random() * 2 - 1) * sigma;
      const nB = (Math.random() * 2 - 1) * sigma;
      data[i] = Math.max(0, Math.min(255, data[i] + nR));
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + nG));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + nB));
    }
  }

  // Lateral inhibition via Difference-of-Gaussians (DoG)
  if (preset.lateralInhibition > 0) {
    const alpha = Math.min(1, preset.lateralInhibition);
    const sigma1 = 0.8; // px
    const sigma2 = 2.0 + 2.0 * (1 - alpha); // broader surround
    const k1 = generateGaussianKernel1D(sigma1);
    const k2 = generateGaussianKernel1D(sigma2);

    // Blur pass 1
    const temp1 = new Uint8ClampedArray(data.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        applyKernelPixel(data, temp1, width, height, x, y, k1, true);
      }
    }
    const blur1 = new Uint8ClampedArray(data.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        applyKernelPixel(temp1, blur1, width, height, x, y, k1, false);
      }
    }

    // Blur pass 2
    const temp2 = new Uint8ClampedArray(data.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        applyKernelPixel(data, temp2, width, height, x, y, k2, true);
      }
    }
    const blur2 = new Uint8ClampedArray(data.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        applyKernelPixel(temp2, blur2, width, height, x, y, k2, false);
      }
    }

    // DoG combine (center minus surround)
    const k = 0.5 * alpha;
    for (let i = 0; i < data.length; i += 4) {
      const dogR = blur1[i] - blur2[i];
      const dogG = blur1[i + 1] - blur2[i + 1];
      const dogB = blur1[i + 2] - blur2[i + 2];
      data[i] = Math.max(0, Math.min(255, data[i] - k * dogR));
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] - k * dogG));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] - k * dogB));
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

// Optional temporal integration helper (not used by app.js yet)
const TEMPORAL_STATE = {
  buffer: null,
  width: 0,
  height: 0,
  lastTs: 0,
};

function applyTemporalIntegration(ctx, width, height, preset, nowMs) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const curr = imageData.data;
  const tauMs = Math.max(10, preset.temporalIntegrationMs);
  const now = typeof nowMs === "number" ? nowMs : performance.now();
  const dt = TEMPORAL_STATE.lastTs
    ? Math.max(1, now - TEMPORAL_STATE.lastTs)
    : 16;
  const alpha = Math.min(1, dt / tauMs);

  if (
    !TEMPORAL_STATE.buffer ||
    TEMPORAL_STATE.width !== width ||
    TEMPORAL_STATE.height !== height
  ) {
    TEMPORAL_STATE.buffer = new Uint8ClampedArray(curr);
    TEMPORAL_STATE.width = width;
    TEMPORAL_STATE.height = height;
  }

  const prev = TEMPORAL_STATE.buffer;
  for (let i = 0; i < curr.length; i += 4) {
    prev[i] = Math.round(prev[i] * (1 - alpha) + curr[i] * alpha);
    prev[i + 1] = Math.round(prev[i + 1] * (1 - alpha) + curr[i + 1] * alpha);
    prev[i + 2] = Math.round(prev[i + 2] * (1 - alpha) + curr[i + 2] * alpha);
    prev[i + 3] = 255;
  }

  imageData.data.set(prev);
  ctx.putImageData(imageData, 0, 0);
  TEMPORAL_STATE.lastTs = now;
}
