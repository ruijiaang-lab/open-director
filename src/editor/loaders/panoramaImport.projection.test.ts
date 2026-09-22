import * as panoramaImport from "./panoramaImport";
import { afterEach, vi } from "vitest";

const { blendPanoramaSeamPixels, softenPanoramaPolePixels } = panoramaImport;
const PERSISTENT_PANORAMA_DATA_URL = "data:image/jpeg;base64,cGVyc2lzdGVudC1wYW5vcmFtYQ==";
const SAFE_FALLBACK_DATA_URL = "data:image/jpeg;base64,c2FmZS1mYWxsYmFjaw==";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function pixelAt(pixels: Uint8ClampedArray, width: number, x: number, y: number) {
  const index = (y * width + x) * 4;
  return Array.from(pixels.slice(index, index + 4));
}

it("blends the left and right panorama edges so the sphere seam closes cleanly", () => {
  const width = 6;
  const height = 1;
  const pixels = new Uint8ClampedArray([
    0, 0, 0, 255,
    20, 20, 20, 255,
    40, 40, 40, 255,
    160, 160, 160, 255,
    180, 180, 180, 255,
    240, 240, 240, 255,
  ]);

  const result = blendPanoramaSeamPixels(pixels, width, height, 2);

  expect(pixelAt(result, width, 0, 0)).toEqual(pixelAt(result, width, width - 1, 0));
});

it("relocates the sphere seam to a low-contrast cut inside the image before wrapping", () => {
  const seamRelocator = (panoramaImport as Record<string, unknown>).relocatePanoramaSeamPixels as
    | ((pixels: Uint8ClampedArray, width: number, height: number) => Uint8ClampedArray)
    | undefined;

  expect(typeof seamRelocator).toBe("function");

  const width = 6;
  const height = 2;
  const pixels = new Uint8ClampedArray([
    0, 0, 0, 255,
    40, 0, 0, 255,
    180, 0, 0, 255,
    182, 0, 0, 255,
    220, 0, 0, 255,
    250, 0, 0, 255,
    0, 0, 0, 255,
    40, 0, 0, 255,
    180, 0, 0, 255,
    182, 0, 0, 255,
    220, 0, 0, 255,
    250, 0, 0, 255,
  ]);

  const result = seamRelocator!(pixels, width, height);

  expect(pixelAt(result, width, 0, 0)).toEqual(pixelAt(pixels, width, 3, 0));
  expect(pixelAt(result, width, width - 1, 0)).toEqual(pixelAt(pixels, width, 2, 0));
});

it("softens the top and bottom pole rows to avoid starburst distortion", () => {
  const width = 4;
  const height = 6;
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let x = 0; x < width; x += 1) {
    const topIndex = x * 4;
    pixels[topIndex] = x * 60;
    pixels[topIndex + 1] = 0;
    pixels[topIndex + 2] = 0;
    pixels[topIndex + 3] = 255;

    const bottomIndex = ((height - 1) * width + x) * 4;
    pixels[bottomIndex] = 0;
    pixels[bottomIndex + 1] = x * 50;
    pixels[bottomIndex + 2] = 0;
    pixels[bottomIndex + 3] = 255;
  }

  const result = softenPanoramaPolePixels(pixels, width, height, 2);

  expect(pixelAt(result, width, 0, 0)).toEqual(pixelAt(result, width, width - 1, 0));
  expect(pixelAt(result, width, 0, height - 1)).toEqual(pixelAt(result, width, width - 1, height - 1));
});

it("returns a durable data URL for an exact 2:1 panorama file", async () => {
  const createObjectURL = vi.fn(() => "blob:temporary-panorama");

  class SuccessfulFileReader {
    result: string | null = null;
    onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
    onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;

    readAsDataURL(_file: Blob) {
      this.result = PERSISTENT_PANORAMA_DATA_URL;
      this.onload?.({ target: this } as unknown as ProgressEvent<FileReader>);
    }
  }

  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 4096, height: 2048, close: vi.fn() })));
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
  vi.stubGlobal("FileReader", SuccessfulFileReader);

  const result = await panoramaImport.readPanoramaFile(new File(["image"], "studio-360.jpg", { type: "image/jpeg" }));

  expect(result.url).toBe(PERSISTENT_PANORAMA_DATA_URL);
  expect(createObjectURL).not.toHaveBeenCalled();
});

it("reports a clear error when an exact 2:1 panorama cannot be persisted", async () => {
  class FailingFileReader {
    result: string | null = null;
    onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
    onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;

    readAsDataURL(_file: Blob) {
      this.onerror?.({ target: this } as unknown as ProgressEvent<FileReader>);
    }
  }

  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 4096, height: 2048, close: vi.fn() })));
  vi.stubGlobal("FileReader", FailingFileReader);

  await expect(
    panoramaImport.readPanoramaFile(new File(["image"], "studio-360.jpg", { type: "image/jpeg" }))
  ).rejects.toThrow("无法将全景图持久化为 data URL");
});

it("exposes a bounded persistence budget and deterministic fallback widths", () => {
  const budget = (panoramaImport as Record<string, unknown>).PANORAMA_PERSISTENCE_BUDGET_CHARS;
  const isWithinBudget = (panoramaImport as Record<string, unknown>).isPanoramaDataUrlWithinPersistenceBudget as
    | ((dataUrl: string) => boolean)
    | undefined;
  const getFallbackWidths = (panoramaImport as Record<string, unknown>).getPanoramaPersistenceWidthCandidates as
    | ((sourceWidth: number) => number[])
    | undefined;

  expect(typeof budget).toBe("number");
  expect(typeof isWithinBudget).toBe("function");
  expect(typeof getFallbackWidths).toBe("function");
  if (typeof budget !== "number" || !isWithinBudget || !getFallbackWidths) return;

  expect(isWithinBudget("x".repeat(budget))).toBe(true);
  expect(isWithinBudget("x".repeat(budget + 1))).toBe(false);

  const widths = getFallbackWidths(8192);
  expect(widths[0]).toBe(4096);
  expect(widths[widths.length - 1]).toBeGreaterThan(0);
  expect(widths.every((width) => width % 2 === 0)).toBe(true);
  expect(widths.some((width, index) => index > 0 && width < (widths[index - 1] ?? width))).toBe(true);
});

it("re-encodes an exact 2:1 data URL over budget without cropping and keeps equirectangular projection", async () => {
  const budget = (panoramaImport as Record<string, unknown>).PANORAMA_PERSISTENCE_BUDGET_CHARS;
  expect(typeof budget).toBe("number");
  if (typeof budget !== "number") return;

  const oversizedDataUrl = `data:image/jpeg;base64,${"A".repeat(budget)}`;
  const encodedDataUrls = [
    ...Array.from({ length: 5 }, () => oversizedDataUrl),
    SAFE_FALLBACK_DATA_URL,
  ];
  const canvasAttempts: Array<{ width: number; height: number; mimeType: string; quality?: number }> = [];
  const drawImage = vi.fn();

  class SuccessfulFileReader {
    result: string | null = oversizedDataUrl;
    onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
    onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;
    onabort: ((event: ProgressEvent<FileReader>) => void) | null = null;

    readAsDataURL(_file: Blob) {
      this.onload?.({ target: this } as unknown as ProgressEvent<FileReader>);
    }
  }

  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 8192, height: 4096, close: vi.fn() })));
  vi.stubGlobal("FileReader", SuccessfulFileReader);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () =>
      ({
        fillRect: vi.fn(),
        drawImage,
        fillStyle: "#000000",
      }) as unknown as CanvasRenderingContext2D
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(function (
    this: HTMLCanvasElement,
    mimeType = "image/png",
    quality?: number
  ) {
    canvasAttempts.push({ width: this.width, height: this.height, mimeType, quality });
    return encodedDataUrls.shift() ?? SAFE_FALLBACK_DATA_URL;
  });

  const result = await panoramaImport.readPanoramaFile(
    new File(["small source"], "studio-360.jpg", { type: "image/jpeg" })
  );

  expect(result.projectionMode).toBe("equirectangular");
  expect(result.url).toBe(SAFE_FALLBACK_DATA_URL);
  expect(canvasAttempts.some((attempt) => attempt.width === 4096)).toBe(true);
  expect(canvasAttempts.some((attempt) => attempt.width < 4096)).toBe(true);
  expect(canvasAttempts.every((attempt) => attempt.height === attempt.width / 2)).toBe(true);
  expect(canvasAttempts.every((attempt) => attempt.mimeType === "image/jpeg")).toBe(true);
  expect(drawImage).toHaveBeenCalled();
});

it("skips direct FileReader persistence for an oversized exact 2:1 source", async () => {
  const budget = (panoramaImport as Record<string, unknown>).PANORAMA_PERSISTENCE_BUDGET_CHARS;
  expect(typeof budget).toBe("number");
  if (typeof budget !== "number") return;

  const readAsDataURL = vi.fn();
  const toDataURL = vi.fn(() => SAFE_FALLBACK_DATA_URL);
  const drawImage = vi.fn();

  class UnexpectedFileReader {
    result: string | null = null;
    onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
    onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;
    onabort: ((event: ProgressEvent<FileReader>) => void) | null = null;

    readAsDataURL(file: Blob) {
      readAsDataURL(file);
      throw new Error("oversized source should use decoded fallback");
    }
  }

  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 8192, height: 4096, close: vi.fn() })));
  vi.stubGlobal("FileReader", UnexpectedFileReader);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () =>
      ({
        fillRect: vi.fn(),
        drawImage,
        fillStyle: "#000000",
      }) as unknown as CanvasRenderingContext2D
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(toDataURL);

  const file = new File([new Uint8Array(budget + 1)], "studio-360.jpg", { type: "image/jpeg" });
  const result = await panoramaImport.readPanoramaFile(file);

  expect(result.projectionMode).toBe("equirectangular");
  expect(result.url).toBe(SAFE_FALLBACK_DATA_URL);
  expect(readAsDataURL).not.toHaveBeenCalled();
});

it("re-encodes an oversized adapted backdrop from its first 2:1 canvas without changing projection semantics", async () => {
  const budget = (panoramaImport as Record<string, unknown>).PANORAMA_PERSISTENCE_BUDGET_CHARS;
  expect(typeof budget).toBe("number");
  if (typeof budget !== "number") return;

  const oversizedDataUrl = `data:image/jpeg;base64,${"A".repeat(budget)}`;
  const encodedDataUrls = [
    oversizedDataUrl,
    ...Array.from({ length: 5 }, () => oversizedDataUrl),
    SAFE_FALLBACK_DATA_URL,
  ];
  const drawImage = vi.fn();
  const canvasAttempts: Array<{ width: number; height: number; mimeType: string; quality?: number }> = [];

  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 2752, height: 1536, close: vi.fn() })));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () =>
      ({
        fillRect: vi.fn(),
        drawImage,
        fillStyle: "#000000",
      }) as unknown as CanvasRenderingContext2D
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(function (
    this: HTMLCanvasElement,
    mimeType = "image/png",
    quality?: number
  ) {
    canvasAttempts.push({ width: this.width, height: this.height, mimeType, quality });
    return encodedDataUrls.shift() ?? SAFE_FALLBACK_DATA_URL;
  });

  const result = await panoramaImport.readPanoramaFile(
    new File(["small source"], "stadium.jpg", { type: "image/jpeg" })
  );

  expect(result.projectionMode).toBe("backdrop");
  expect(result.url).toBe(SAFE_FALLBACK_DATA_URL);
  expect(canvasAttempts[0]).toMatchObject({ width: 3072, height: 1536, mimeType: "image/jpeg", quality: 0.92 });
  expect(canvasAttempts.some((attempt) => attempt.width < 3072)).toBe(true);
  expect(canvasAttempts.every((attempt) => attempt.mimeType === "image/jpeg")).toBe(true);

  const firstDraw = drawImage.mock.calls[0];
  expect(firstDraw?.[1]).toBeCloseTo(0, 0);
  expect(firstDraw?.[2]).toBeLessThan(0);
  expect(firstDraw?.[3]).toBeCloseTo(3072, 0);
  expect(firstDraw?.[4]).toBeGreaterThan(1536);

  const firstDownsample = drawImage.mock.calls[1];
  expect(firstDownsample?.[1]).toBeCloseTo(0, 0);
  expect(firstDownsample?.[2]).toBeCloseTo(0, 0);
  expect(firstDownsample?.[3]).toBeCloseTo(3072, 0);
  expect(firstDownsample?.[4]).toBeCloseTo(1536, 0);
});

it("does not return a short invalid initial backdrop data URL", async () => {
  const encodedDataUrls = ["data:,", SAFE_FALLBACK_DATA_URL];
  const canvasAttempts: Array<{ width: number; height: number; mimeType: string; quality?: number }> = [];

  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 2752, height: 1536, close: vi.fn() })));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () =>
      ({
        fillRect: vi.fn(),
        drawImage: vi.fn(),
        fillStyle: "#000000",
      }) as unknown as CanvasRenderingContext2D
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(function (
    this: HTMLCanvasElement,
    mimeType = "image/png",
    quality?: number
  ) {
    canvasAttempts.push({ width: this.width, height: this.height, mimeType, quality });
    return encodedDataUrls.shift() ?? SAFE_FALLBACK_DATA_URL;
  });

  const result = await panoramaImport.readPanoramaFile(
    new File(["small source"], "stadium.jpg", { type: "image/jpeg" })
  );

  expect(result.projectionMode).toBe("backdrop");
  expect(result.url).toBe(SAFE_FALLBACK_DATA_URL);
  expect(result.url).not.toBe("data:,");
  expect(canvasAttempts.length).toBeGreaterThan(1);
});

it("infers and normalizes an image MIME type from an extension when Blob.type is empty", async () => {
  class EmptyMimeFileReader {
    result = "data:;base64,cGVyc2lzdGVudC1wYW5vcmFtYQ==";
    onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
    onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;
    onabort: ((event: ProgressEvent<FileReader>) => void) | null = null;

    readAsDataURL(_file: Blob) {
      this.onload?.({ target: this } as unknown as ProgressEvent<FileReader>);
    }
  }

  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 4096, height: 2048, close: vi.fn() })));
  vi.stubGlobal("FileReader", EmptyMimeFileReader);

  const result = await panoramaImport.readPanoramaFile(new File(["image"], "studio-360.JPG", { type: "" }));

  expect(result.url).toBe(PERSISTENT_PANORAMA_DATA_URL);
});

it.each(["data:text/html;base64,PGgxPk5vdCBhbiBpbWFnZTwvaDE+", "data:application/octet-stream;base64,AA=="])(
  "rejects unsupported FileReader data URL MIME %s",
  async (invalidDataUrl) => {
    class InvalidMimeFileReader {
      result = invalidDataUrl;
      onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
      onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;
      onabort: ((event: ProgressEvent<FileReader>) => void) | null = null;

      readAsDataURL(_file: Blob) {
        this.onload?.({ target: this } as unknown as ProgressEvent<FileReader>);
      }
    }

    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 4096, height: 2048, close: vi.fn() })));
    vi.stubGlobal("FileReader", InvalidMimeFileReader);

    await expect(
      panoramaImport.readPanoramaFile(new File(["image"], "studio-360.jpg", { type: "image/jpeg" }))
    ).rejects.toThrow("受支持的 image data URL");
  }
);

it("rejects an input MIME that conflicts with its supported extension", async () => {
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 4096, height: 2048, close: vi.fn() })));

  await expect(
    panoramaImport.readPanoramaFile(new File(["image"], "studio-360.jpg", { type: "image/png" }))
  ).rejects.toThrow("MIME 类型与扩展名不匹配");
});

it("cleans FileReader handlers after an abort", async () => {
  let reader: AbortFileReader | undefined;

  class AbortFileReader {
    result: string | null = null;
    onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
    onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;
    onabort: ((event: ProgressEvent<FileReader>) => void) | null = null;

    constructor() {
      reader = this;
    }

    readAsDataURL(_file: Blob) {
      const event = { target: this } as unknown as ProgressEvent<FileReader>;
      if (this.onabort) {
        this.onabort(event);
      } else {
        this.onload?.(event);
      }
    }
  }

  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 4096, height: 2048, close: vi.fn() })));
  vi.stubGlobal("FileReader", AbortFileReader);

  await expect(
    panoramaImport.readPanoramaFile(new File(["image"], "studio-360.jpg", { type: "image/jpeg" }))
  ).rejects.toThrow("无法将全景图持久化为 data URL");
  expect(reader?.onload).toBeNull();
  expect(reader?.onerror).toBeNull();
  expect(reader?.onabort).toBeNull();
});

it("revokes the fallback object URL exactly once when Image construction throws", async () => {
  const revokeObjectURL = vi.fn();
  vi.stubGlobal("createImageBitmap", undefined);
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:probe"), revokeObjectURL });
  vi.stubGlobal(
    "Image",
    function ThrowingImage(): never {
      throw new Error("image constructor failed");
    }
  );

  await expect(
    panoramaImport.readPanoramaFile(new File(["image"], "studio-360.jpg", { type: "image/jpeg" }))
  ).rejects.toThrow("无法读取全景图尺寸");
  expect(revokeObjectURL).toHaveBeenCalledTimes(1);
});

it("revokes the fallback object URL exactly once when Image.src assignment throws", async () => {
  const revokeObjectURL = vi.fn();

  class ThrowingSrcImage {
    width = 4096;
    height = 2048;
    onload: ((event: Event) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;

    set src(_value: string) {
      throw new Error("image src failed");
    }
  }

  vi.stubGlobal("createImageBitmap", undefined);
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:probe"), revokeObjectURL });
  vi.stubGlobal("Image", ThrowingSrcImage);

  await expect(
    panoramaImport.readPanoramaFile(new File(["image"], "studio-360.jpg", { type: "image/jpeg" }))
  ).rejects.toThrow("无法读取全景图尺寸");
  expect(revokeObjectURL).toHaveBeenCalledTimes(1);
});

it("revokes the fallback object URL exactly once on Image load", async () => {
  const revokeObjectURL = vi.fn();

  class LoadingImage {
    width = 4096;
    height = 2048;
    onload: ((event: Event) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;

    set src(_value: string) {
      this.onload?.(new Event("load"));
    }
  }

  class SuccessfulFileReader {
    result = PERSISTENT_PANORAMA_DATA_URL;
    onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
    onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;
    onabort: ((event: ProgressEvent<FileReader>) => void) | null = null;

    readAsDataURL(_file: Blob) {
      this.onload?.({ target: this } as unknown as ProgressEvent<FileReader>);
    }
  }

  vi.stubGlobal("createImageBitmap", undefined);
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:probe"), revokeObjectURL });
  vi.stubGlobal("Image", LoadingImage);
  vi.stubGlobal("FileReader", SuccessfulFileReader);

  await panoramaImport.readPanoramaFile(new File(["image"], "studio-360.jpg", { type: "image/jpeg" }));

  expect(revokeObjectURL).toHaveBeenCalledTimes(1);
});

it("revokes the fallback object URL exactly once on Image error", async () => {
  const revokeObjectURL = vi.fn();

  class ErrorImage {
    width = 4096;
    height = 2048;
    onload: ((event: Event) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;

    set src(_value: string) {
      this.onerror?.(new Event("error"));
    }
  }

  vi.stubGlobal("createImageBitmap", undefined);
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:probe"), revokeObjectURL });
  vi.stubGlobal("Image", ErrorImage);

  await expect(
    panoramaImport.readPanoramaFile(new File(["image"], "studio-360.jpg", { type: "image/jpeg" }))
  ).rejects.toThrow("无法读取全景图尺寸");
  expect(revokeObjectURL).toHaveBeenCalledTimes(1);
});
