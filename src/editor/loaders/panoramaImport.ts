const PANORAMA_IMAGE_EXTENSION_RE = /\.(jpe?g|png|webp)$/i;
const PANORAMA_RATIO = 2;
const PANORAMA_RATIO_TOLERANCE = 0.02;
const PANORAMA_MIN_WIDTH = 2048;
const PANORAMA_MAX_WIDTH = 4096;
export const PANORAMA_PERSISTENCE_BUDGET_CHARS = 1_500_000;
const PANORAMA_PERSISTENCE_MIN_WIDTH = 512;
const PANORAMA_PERSISTENCE_WIDTH_SCALE = 0.75;
const PANORAMA_PERSISTENCE_QUALITIES = [0.92, 0.82, 0.72, 0.62, 0.52] as const;
const PANORAMA_REENCODE_MIME_TYPE = "image/jpeg" as const;
const SUPPORTED_PANORAMA_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const PANORAMA_SEAM_BLEND_RATIO = 0.035;
const PANORAMA_SEAM_MIN_WIDTH = 32;
const PANORAMA_SEAM_MAX_WIDTH = 192;
const PANORAMA_POLE_BLEND_RATIO = 0.16;
const PANORAMA_POLE_MIN_HEIGHT = 48;
const PANORAMA_POLE_MAX_HEIGHT = 220;

type PanoramaImageSource = {
  width: number;
  height: number;
  close?: () => void;
};

type SupportedPanoramaMimeType = (typeof SUPPORTED_PANORAMA_MIME_TYPES)[number];

type ContainPlacement = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function isPanoramaRatio(width: number, height: number) {
  return Math.abs(width / height - PANORAMA_RATIO) <= PANORAMA_RATIO_TOLERANCE;
}

export function isPanoramaDataUrlWithinPersistenceBudget(dataUrl: string) {
  return dataUrl.length <= PANORAMA_PERSISTENCE_BUDGET_CHARS;
}

export function getPanoramaPersistenceWidthCandidates(sourceWidth: number) {
  const safeSourceWidth = Number.isFinite(sourceWidth) && sourceWidth > 0 ? sourceWidth : PANORAMA_PERSISTENCE_MIN_WIDTH;
  let width = roundToEven(
    clamp(safeSourceWidth, PANORAMA_PERSISTENCE_MIN_WIDTH, PANORAMA_MAX_WIDTH)
  );
  const candidates = [width];

  while (width > PANORAMA_PERSISTENCE_MIN_WIDTH) {
    const nextWidth = roundToEven(Math.max(PANORAMA_PERSISTENCE_MIN_WIDTH, width * PANORAMA_PERSISTENCE_WIDTH_SCALE));
    if (nextWidth >= width) break;

    candidates.push(nextWidth);
    width = nextWidth;
  }

  return candidates;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundToEven(value: number) {
  const rounded = Math.round(value);
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

function isSupportedPanoramaMimeType(value: string): value is SupportedPanoramaMimeType {
  return (SUPPORTED_PANORAMA_MIME_TYPES as readonly string[]).includes(value);
}

function getPanoramaFileExtension(fileName: string) {
  return fileName.match(/\.([^.]+)$/i)?.[1]?.toLowerCase() ?? "";
}

function getPanoramaMimeTypeForExtension(extension: string): SupportedPanoramaMimeType | null {
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  return null;
}

function normalizePanoramaFileMimeType(file: File): SupportedPanoramaMimeType {
  const extensionMimeType = getPanoramaMimeTypeForExtension(getPanoramaFileExtension(file.name));
  if (!extensionMimeType) {
    throw new Error("当前全景图仅支持 JPG / PNG / WEBP");
  }

  const declaredMimeType = file.type.trim().toLowerCase();
  if (!declaredMimeType) return extensionMimeType;
  if (!isSupportedPanoramaMimeType(declaredMimeType)) {
    throw new Error("全景图 MIME 类型仅支持 image/jpeg、image/png、image/webp");
  }
  if (declaredMimeType !== extensionMimeType) {
    throw new Error("全景图 MIME 类型与扩展名不匹配");
  }

  return declaredMimeType;
}

function normalizePanoramaDataUrl(dataUrl: string, expectedMimeType?: SupportedPanoramaMimeType) {
  const match = /^data:([^;,]*);base64,([A-Za-z0-9+/_-]+={0,2})$/i.exec(dataUrl.trim());
  if (!match) {
    throw new Error("全景图必须是受支持的 image data URL");
  }

  const declaredMimeType = match[1]?.toLowerCase() ?? "";
  const mimeType = declaredMimeType || expectedMimeType;
  if (!mimeType || !isSupportedPanoramaMimeType(mimeType)) {
    throw new Error("全景图必须是受支持的 image data URL");
  }
  if (expectedMimeType && declaredMimeType && declaredMimeType !== expectedMimeType) {
    throw new Error("全景图 data URL MIME 类型与文件扩展名不匹配");
  }

  return `data:${mimeType};base64,${match[2] ?? ""}`;
}

function getContainPlacement(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number
): ContainPlacement {
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;

  return {
    x: (targetWidth - width) / 2,
    y: (targetHeight - height) / 2,
    width,
    height,
  };
}

function getCoverPlacement(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number
): ContainPlacement {
  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;

  return {
    x: (targetWidth - width) / 2,
    y: (targetHeight - height) / 2,
    width,
    height,
  };
}

function getSeamBlendWidth(width: number) {
  return Math.max(PANORAMA_SEAM_MIN_WIDTH, Math.min(PANORAMA_SEAM_MAX_WIDTH, Math.round(width * PANORAMA_SEAM_BLEND_RATIO)));
}

function getPoleBlendHeight(height: number) {
  return Math.max(PANORAMA_POLE_MIN_HEIGHT, Math.min(PANORAMA_POLE_MAX_HEIGHT, Math.round(height * PANORAMA_POLE_BLEND_RATIO)));
}

function averageRowColor(pixels: Uint8ClampedArray, width: number, row: number) {
  let red = 0;
  let green = 0;
  let blue = 0;
  let alpha = 0;

  for (let x = 0; x < width; x += 1) {
    const index = (row * width + x) * 4;
    red += pixels[index] ?? 0;
    green += pixels[index + 1] ?? 0;
    blue += pixels[index + 2] ?? 0;
    alpha += pixels[index + 3] ?? 0;
  }

  return [
    Math.round(red / width),
    Math.round(green / width),
    Math.round(blue / width),
    Math.round(alpha / width),
  ] as const;
}

export function blendPanoramaSeamPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  seamWidth: number
) {
  const next = new Uint8ClampedArray(pixels);
  const maxDistance = Math.max(1, seamWidth - 1);

  for (let y = 0; y < height; y += 1) {
    for (let distance = 0; distance < seamWidth; distance += 1) {
      const leftIndex = (y * width + distance) * 4;
      const rightIndex = (y * width + (width - 1 - distance)) * 4;
      const blend = distance / maxDistance;

      for (let channel = 0; channel < 4; channel += 1) {
        const left = pixels[leftIndex + channel] ?? 0;
        const right = pixels[rightIndex + channel] ?? 0;
        const averaged = Math.round((left + right) / 2);
        next[leftIndex + channel] = Math.round(averaged + (left - averaged) * blend);
        next[rightIndex + channel] = Math.round(averaged + (right - averaged) * blend);
      }
    }
  }

  return next;
}

export function softenPanoramaPolePixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  poleBlendHeight: number
) {
  const next = new Uint8ClampedArray(pixels);
  const topReferenceRow = Math.min(height - 1, poleBlendHeight);
  const bottomReferenceRow = Math.max(0, height - 1 - poleBlendHeight);
  const topPoleColor = averageRowColor(pixels, width, topReferenceRow);
  const bottomPoleColor = averageRowColor(pixels, width, bottomReferenceRow);
  const maxDistance = Math.max(1, poleBlendHeight - 1);

  for (let y = 0; y < poleBlendHeight; y += 1) {
    const blend = Math.pow(y / maxDistance, 1.35);

    for (let x = 0; x < width; x += 1) {
      const topIndex = (y * width + x) * 4;
      const bottomIndex = ((height - 1 - y) * width + x) * 4;

      for (let channel = 0; channel < 4; channel += 1) {
        const topOriginal = pixels[topIndex + channel] ?? 0;
        const bottomOriginal = pixels[bottomIndex + channel] ?? 0;
        next[topIndex + channel] = Math.round(topPoleColor[channel] + (topOriginal - topPoleColor[channel]) * blend);
        next[bottomIndex + channel] = Math.round(
          bottomPoleColor[channel] + (bottomOriginal - bottomPoleColor[channel]) * blend
        );
      }
    }
  }

  return next;
}

function getColumnTransitionScore(pixels: Uint8ClampedArray, width: number, height: number, seamColumn: number) {
  const topGuard = Math.max(0, Math.min(height - 1, Math.round(height * 0.08)));
  const bottomGuard = Math.max(topGuard + 1, height - topGuard);
  let score = 0;

  for (let y = topGuard; y < bottomGuard; y += 1) {
    const leftIndex = (y * width + (seamColumn - 1)) * 4;
    const rightIndex = (y * width + seamColumn) * 4;

    score += Math.abs((pixels[leftIndex] ?? 0) - (pixels[rightIndex] ?? 0));
    score += Math.abs((pixels[leftIndex + 1] ?? 0) - (pixels[rightIndex + 1] ?? 0));
    score += Math.abs((pixels[leftIndex + 2] ?? 0) - (pixels[rightIndex + 2] ?? 0));
    score += Math.abs((pixels[leftIndex + 3] ?? 255) - (pixels[rightIndex + 3] ?? 255));
  }

  return score;
}

function normalizeSeamColumn(seamColumn: number, width: number) {
  if (width <= 0) return 0;
  return ((Math.round(seamColumn) % width) + width) % width;
}

export function findLowestEnergySeamColumn(pixels: Uint8ClampedArray, width: number, height: number) {
  if (width <= 1) return 0;

  let bestColumn = 1;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let seamColumn = 1; seamColumn < width; seamColumn += 1) {
    const score = getColumnTransitionScore(pixels, width, height, seamColumn);
    if (score < bestScore) {
      bestScore = score;
      bestColumn = seamColumn;
    }
  }

  return bestColumn;
}

export function relocatePanoramaSeamPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  seamColumn = findLowestEnergySeamColumn(pixels, width, height)
) {
  const normalizedSeam = normalizeSeamColumn(seamColumn, width);

  if (normalizedSeam === 0) {
    return new Uint8ClampedArray(pixels);
  }

  const next = new Uint8ClampedArray(pixels.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = (x + normalizedSeam) % width;
      const sourceIndex = (y * width + sourceX) * 4;
      const targetIndex = (y * width + x) * 4;

      next[targetIndex] = pixels[sourceIndex] ?? 0;
      next[targetIndex + 1] = pixels[sourceIndex + 1] ?? 0;
      next[targetIndex + 2] = pixels[sourceIndex + 2] ?? 0;
      next[targetIndex + 3] = pixels[sourceIndex + 3] ?? 255;
    }
  }

  return next;
}

function optimizeAdaptedPanoramaProjection(context: CanvasRenderingContext2D, width: number, height: number) {
  if (typeof context.getImageData !== "function" || typeof context.putImageData !== "function") {
    return;
  }

  const frame = context.getImageData(0, 0, width, height);
  const seamRelocated = relocatePanoramaSeamPixels(frame.data, width, height);
  const seamSafe = blendPanoramaSeamPixels(seamRelocated, width, height, getSeamBlendWidth(width));
  const poleSafe = softenPanoramaPolePixels(seamSafe, width, height, getPoleBlendHeight(height));
  frame.data.set(poleSafe);
  context.putImageData(frame, 0, 0);
}

function createPanoramaCanvasSize(sourceWidth: number, sourceHeight: number) {
  const desiredWidth = Math.max(sourceWidth, sourceHeight * PANORAMA_RATIO, PANORAMA_MIN_WIDTH);
  const normalizedWidth = roundToEven(clamp(desiredWidth, PANORAMA_MIN_WIDTH, PANORAMA_MAX_WIDTH));

  return {
    width: normalizedWidth,
    height: normalizedWidth / PANORAMA_RATIO,
  };
}

function drawImageContain(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  placement: ContainPlacement
) {
  context.drawImage(source, placement.x, placement.y, placement.width, placement.height);
}

async function readImageSource(file: File): Promise<PanoramaImageSource & CanvasImageSource> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    return bitmap;
  }

  return await new Promise<HTMLImageElement>((resolve, reject) => {
    let probeUrl: string;
    try {
      probeUrl = URL.createObjectURL(file);
    } catch {
      reject(new Error("无法读取全景图尺寸，请重新选择图片"));
      return;
    }

    let image: HTMLImageElement | null = null;
    let settled = false;
    let revoked = false;

    const revokeProbeUrl = () => {
      if (revoked) return;
      revoked = true;
      try {
        URL.revokeObjectURL(probeUrl);
      } catch {
        // Releasing a temporary probe URL must not mask the original read result.
      }
    };

    const cleanup = () => {
      try {
        if (image) {
          image.onload = null;
          image.onerror = null;
        }
      } finally {
        revokeProbeUrl();
      }
    };

    const fail = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("无法读取全景图尺寸，请重新选择图片"));
    };

    const succeed = () => {
      if (settled || !image) return;
      settled = true;
      const resolvedImage = image;
      cleanup();
      resolve(resolvedImage);
    };

    try {
      image = new Image();
      image.onload = succeed;
      image.onerror = fail;
      image.src = probeUrl;
    } catch {
      fail();
    }
  });
}

function readFileAsDataUrl(file: File, expectedMimeType: SupportedPanoramaMimeType): Promise<string> {
  return new Promise((resolve, reject) => {
    let reader: FileReader | null = null;
    let settled = false;

    const cleanup = () => {
      if (!reader) return;
      reader.onload = null;
      reader.onerror = null;
      reader.onabort = null;
    };

    const resolveOnce = (dataUrl: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(dataUrl);
    };

    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const fail = () => rejectOnce(new Error("无法将全景图持久化为 data URL"));

    try {
      reader = new FileReader();
      reader.onload = () => {
        if (!reader || typeof reader.result !== "string") {
          fail();
          return;
        }

        try {
          resolveOnce(normalizePanoramaDataUrl(reader.result, expectedMimeType));
        } catch (error) {
          rejectOnce(error instanceof Error ? error : new Error("全景图必须是受支持的 image data URL"));
        }
      };
      reader.onerror = fail;
      reader.onabort = fail;
      reader.readAsDataURL(file);
    } catch {
      fail();
    }
  });
}

function createSafePanoramaDataUrl(source: PanoramaImageSource & CanvasImageSource) {
  let canvas: HTMLCanvasElement;
  let context: CanvasRenderingContext2D | null;

  try {
    canvas = document.createElement("canvas");
    context = canvas.getContext("2d");
  } catch {
    throw new Error("当前环境无法生成安全全景图");
  }

  if (!context) {
    throw new Error("当前环境无法生成安全全景图");
  }

  let invalidDataUrl = false;

  for (const width of getPanoramaPersistenceWidthCandidates(source.width)) {
    const height = width / PANORAMA_RATIO;
    canvas.width = width;
    canvas.height = height;
    context.fillStyle = "#06080D";
    context.fillRect(0, 0, width, height);

    try {
      drawImageContain(context, source, getContainPlacement(source.width, source.height, width, height));
    } catch {
      continue;
    }

    for (const quality of PANORAMA_PERSISTENCE_QUALITIES) {
      let dataUrl: string;
      try {
        dataUrl = canvas.toDataURL(PANORAMA_REENCODE_MIME_TYPE, quality);
      } catch {
        continue;
      }

      try {
        const normalizedDataUrl = normalizePanoramaDataUrl(dataUrl);
        if (isPanoramaDataUrlWithinPersistenceBudget(normalizedDataUrl)) {
          return normalizedDataUrl;
        }
      } catch {
        invalidDataUrl = true;
      }
    }
  }

  if (invalidDataUrl) {
    throw new Error("全景图重编码结果不是受支持的 image data URL");
  }
  throw new Error("无法将全景图压缩到安全持久化大小");
}

async function buildAdaptedPanoramaAsset(file: File, inputMimeType: SupportedPanoramaMimeType) {
  const source = await readImageSource(file);

  try {
    if (isPanoramaRatio(source.width, source.height)) {
      if (file.size <= PANORAMA_PERSISTENCE_BUDGET_CHARS) {
        const dataUrl = await readFileAsDataUrl(file, inputMimeType);
        if (isPanoramaDataUrlWithinPersistenceBudget(dataUrl)) {
          return {
            projectionMode: "equirectangular" as const,
            url: dataUrl,
          };
        }
      }

      return {
        projectionMode: "equirectangular" as const,
        url: createSafePanoramaDataUrl(source),
      };
    }

    const { width, height } = createPanoramaCanvasSize(source.width, source.height);
    const placement = getCoverPlacement(source.width, source.height, width, height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("当前环境无法生成全景图，请稍后重试");
    }

    context.fillStyle = "#06080D";
    context.fillRect(0, 0, width, height);

    drawImageContain(context, source, placement);

    optimizeAdaptedPanoramaProjection(context, width, height);

    let initialDataUrl: string | null = null;
    try {
      initialDataUrl = canvas.toDataURL("image/jpeg", 0.92);
    } catch {
      // Let the bounded fallback encoder produce the final explicit error or result.
    }

    if (initialDataUrl) {
      try {
        const normalizedDataUrl = normalizePanoramaDataUrl(initialDataUrl);
        if (isPanoramaDataUrlWithinPersistenceBudget(normalizedDataUrl)) {
          return {
            projectionMode: "backdrop" as const,
            url: normalizedDataUrl,
          };
        }
      } catch {
        // Let the bounded fallback encoder produce the final explicit error or result.
      }
    }

    return {
      projectionMode: "backdrop" as const,
      url: createSafePanoramaDataUrl(canvas),
    };
  } finally {
    source.close?.();
  }
}

export async function readPanoramaFile(file: File) {
  if (!PANORAMA_IMAGE_EXTENSION_RE.test(file.name)) {
    throw new Error("当前全景图仅支持 JPG / PNG / WEBP");
  }
  const inputMimeType = normalizePanoramaFileMimeType(file);
  const result = await buildAdaptedPanoramaAsset(file, inputMimeType);

  return {
    id: crypto.randomUUID(),
    fileName: file.name,
    name: file.name,
    projectionMode: result.projectionMode,
    url: result.url,
  };
}
