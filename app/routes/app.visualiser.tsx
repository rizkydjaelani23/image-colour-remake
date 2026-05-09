import { useEffect, useRef, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import type { CSSProperties } from "react";

type LoaderData = {
  apiKey: string;
};

type ProductVariant = {
  id: string;
  title: string;
  image: string | null;
};

type SelectedProduct = {
  id: string;
  title: string;
  handle: string;
  featuredImage: string | null;
  variants: ProductVariant[];
};

type Zone = {
  id: string;
  name: string;
  maskPath: string;
  createdAt: string;
  updatedAt: string;
};

type SaveZoneResponse = {
  success?: boolean;
  zone?: Zone;
  error?: string;
};

type ListZonesResponse = {
  success?: boolean;
  zones?: Zone[];
  baseImageUrl?: string | null;
  error?: string;
};

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
  };
}

export default function VisualiserPage() {
  useLoaderData<typeof loader>();
  const shopify = useAppBridge();

  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [product, setProduct] = useState<SelectedProduct | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [brushSize, setBrushSize] = useState(24);
  const [tool, setTool] = useState<"draw" | "erase" | "outline" | "smart-outline" | "drag">("draw");
  const [isDrawing, setIsDrawing] = useState(false);
  const [maskSaving, setMaskSaving] = useState(false);
  const [maskError, setMaskError] = useState<string | null>(null);
  const [maskLocked, setMaskLocked] = useState(false);
  const [zones, setZones] = useState<Zone[]>([]);
  const [activeZoneId, setActiveZoneId] = useState<string | null>(null);
  const [fabricName, setFabricName] = useState("");
  const [swatchFile, setSwatchFile] = useState<File | null>(null);
  const [swatchUrl, setSwatchUrl] = useState<string | null>(null);
  const [swatchSource, setSwatchSource] = useState<"file" | "url" | null>(null);
  const [recentSwatches, setRecentSwatches] = useState<Array<{
    id: string;
    fabricFamily: string;
    colourName: string;
    imageUrl: string | null;
    updatedAt: string;
  }>>([]);
  const [recentSwatchesLoading, setRecentSwatchesLoading] = useState(false);
  const [selectedRecentSwatchIds, setSelectedRecentSwatchIds] = useState<string[]>([]);
  const [bulkSwatchFiles, setBulkSwatchFiles] = useState<File[]>([]);
  const [bulkPreviewLoading, setBulkPreviewLoading] = useState(false);
  const [bulkPreviewError, setBulkPreviewError] = useState<string | null>(null);
  const [selectedBulkIndex, setSelectedBulkIndex] = useState<number | null>(null);
  const [bulkPreviewResults, setBulkPreviewResults] = useState<
    Array<{
      fileName: string;
      previewUrl: string;
    }>
  >([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [generatedPreviewUrl, setGeneratedPreviewUrl] = useState<string | null>(null);
  const [outlinePoints, setOutlinePoints] = useState<Array<{ x: number; y: number }>>([]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [generationNotice, setGenerationNotice] = useState<string | null>(null);
  const [currentBatch, setCurrentBatch] = useState<number>(0);
  const [totalBatches, setTotalBatches] = useState<number>(0);
  const [generatedCount, setGeneratedCount] = useState<number>(0);

  const imageRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const edgeMapRef = useRef<Uint8ClampedArray | null>(null);
  const edgeWidthRef = useRef(0);
  const edgeHeightRef = useRef(0);

  async function openProductPicker() {
    setError(null);

    try {
      const selection = await shopify.resourcePicker({
        type: "product",
        action: "select",
        multiple: false,
      });

      if (!selection || selection.length === 0) return;

      const pickedProduct = selection[0];
      setSelectedProductId(pickedProduct.id);
      setMaskLocked(false);
      setZones([]);
      setActiveZoneId(null);
      setGeneratedPreviewUrl(null);
      setPreviewError(null);
      setMaskError(null);
      setFabricName("");
      setSwatchFile(null);
      setSwatchUrl(null);
      setSwatchSource(null);
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setBulkPreviewResults([]);
      setBulkPreviewError(null);
      setBulkSwatchFiles([]);
      setSelectedRecentSwatchIds([]);
      setGenerationNotice(null);
      setCurrentBatch(0);
      setTotalBatches(0);
      setGeneratedCount(0);
    } catch (err) {
      console.error("Product picker error:", err);
      setError("Could not open the product picker.");
    }
  }

  async function loadZones(productId: string): Promise<Zone[]> {
    try {
      const response = await fetch(
        `/api/list-zones?productId=${encodeURIComponent(productId)}`,
      );

      const rawText = await response.text();

      let data: ListZonesResponse;
      try {
        data = JSON.parse(rawText) as ListZonesResponse;
      } catch {
        throw new Error(rawText || "Server did not return valid JSON");
      }

      if (!response.ok) {
        throw new Error(data.error || "Failed to load zones");
      }

      const zones = data.zones || [];
      setZones(zones);

      if (zones.length > 0) {
        setActiveZoneId(zones[0].id);
        setMaskLocked(true);
      } else {
        setActiveZoneId(null);
        setMaskLocked(false);
      }

      return zones;
    } catch (err) {
      console.error("Load zones error:", err);

      if (err instanceof Error) {
        setMaskError(err.message);
      } else {
        setMaskError("Failed to load zones.");
      }

      return [];
    }
  }

  function loadZoneMaskOntoCanvas(zone: Zone) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = zone.maskPath;
    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
  }

  useEffect(() => {
    if (!selectedProductId) return;

    async function loadProduct() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/product/${encodeURIComponent(selectedProductId ?? "")}`,
        );

        const rawText = await response.text();


        let data: unknown;
        try {
          data = JSON.parse(rawText);
        } catch {
          throw new Error(rawText || "Server did not return valid JSON");
        }

        if (!response.ok) {
          const errorMessage =
            typeof data === "object" &&
              data !== null &&
              "error" in data &&
              typeof (data as { error: unknown }).error === "string"
              ? (data as { error: string }).error
              : "Failed to fetch product";

          throw new Error(errorMessage);
        }

        setProduct(data as SelectedProduct);
        await loadZones((data as SelectedProduct).id);
      } catch (err) {
        console.error("Load product error:", err);

        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError("Could not load product details.");
        }
      } finally {
        setLoading(false);
      }
    }

    loadProduct();
  }, [selectedProductId]);


  useEffect(() => {
    if (tool === "outline" || tool === "smart-outline") {
      redrawOutlinePreview();
    }
  }, [outlinePoints, tool]);

  function getBatchInfo(totalItems: number, batchSize = 10) {
    const totalBatches = Math.ceil(totalItems / batchSize);
    return { batchSize, totalBatches };
  }

  function resizeCanvasToImage() {
    const image = imageRef.current;
    const canvas = canvasRef.current;
    const previewCanvas = previewCanvasRef.current;

    if (!image || !canvas || !previewCanvas) return;

    const width = image.clientWidth;
    const height = image.clientHeight;

    if (width === 0 || height === 0) return;

    for (const c of [canvas, previewCanvas]) {
      c.width = width;
      c.height = height;
      c.style.width = `${width}px`;
      c.style.height = `${height}px`;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "rgba(0,0,0,1)";
    ctx.fillRect(0, 0, width, height);

    clearPreviewCanvas();
  }

  function generateEdgeMap() {
    const image = imageRef.current;
    if (!image) return;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;

    ctx.drawImage(image, 0, 0);

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;

    const gray = new Uint8ClampedArray(canvas.width * canvas.height);

    for (let i = 0; i < data.length; i += 4) {
      gray[i / 4] = Math.round(
        0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2],
      );
    }

    const edges = new Uint8ClampedArray(gray.length);

    for (let y = 1; y < canvas.height - 1; y++) {
      for (let x = 1; x < canvas.width - 1; x++) {
        const i = y * canvas.width + x;

        const gx =
          -gray[i - canvas.width - 1] +
          gray[i - canvas.width + 1] +
          -2 * gray[i - 1] +
          2 * gray[i + 1] +
          -gray[i + canvas.width - 1] +
          gray[i + canvas.width + 1];

        const gy =
          -gray[i - canvas.width - 1] -
          2 * gray[i - canvas.width] -
          gray[i - canvas.width + 1] +
          gray[i + canvas.width - 1] +
          2 * gray[i + canvas.width] +
          gray[i + canvas.width + 1];

        const magnitude = Math.min(255, Math.sqrt(gx * gx + gy * gy));
        edges[i] = magnitude > 35 ? magnitude : 0;
      }
    }

    edgeMapRef.current = edges;
    edgeWidthRef.current = canvas.width;
    edgeHeightRef.current = canvas.height;
  }

  function snapToEdge(x: number, y: number): { x: number; y: number } {
    const edges = edgeMapRef.current;
    if (!edges) return { x, y };

    const w = edgeWidthRef.current;
    const h = edgeHeightRef.current;

    const searchRadius = 18;

    let bestX = x;
    let bestY = y;
    let bestScore = -Infinity;

    const scaleX = w / (canvasRef.current?.width || 1);
    const scaleY = h / (canvasRef.current?.height || 1);

    const cx = Math.floor(x * scaleX);
    const cy = Math.floor(y * scaleY);

    for (let dy = -searchRadius; dy <= searchRadius; dy++) {
      for (let dx = -searchRadius; dx <= searchRadius; dx++) {
        const nx = cx + dx;
        const ny = cy + dy;

        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;

        const idx = ny * w + nx;
        const edgeStrength = edges[idx];

        if (edgeStrength <= 0) continue;

        const distance = Math.sqrt(dx * dx + dy * dy);

        // stronger edges win, but closer edges are preferred
        const score = edgeStrength - distance * 3;

        if (score > bestScore) {
          bestScore = score;
          bestX = nx / scaleX;
          bestY = ny / scaleY;
        }
      }
    }

    return { x: bestX, y: bestY };
  }

  function clearPreviewCanvas() {
    const previewCanvas = previewCanvasRef.current;
    if (!previewCanvas) return;

    const ctx = previewCanvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  }

  function getPointerPosition(
    event: React.PointerEvent<HTMLCanvasElement>,
  ): { x: number; y: number } | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();

    return {
      x: (event.clientX - rect.left) / zoom,
      y: (event.clientY - rect.top) / zoom,
    };
  }

  function drawPoint(x: number, y: number) {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    ctx.beginPath();
    ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);

    if (tool === "draw") {
      ctx.fillStyle = "rgba(255,255,255,1)";
      ctx.fill();
    } else {
      ctx.fillStyle = "rgba(0,0,0,1)";
      ctx.fill();
    }
  }

  function redrawOutlinePreview() {
    const previewCanvas = previewCanvasRef.current;
    if (!previewCanvas) return;

    const ctx = previewCanvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);

    if (outlinePoints.length === 0) return;

    ctx.strokeStyle =
      tool === "smart-outline"
        ? "rgba(255, 140, 0, 1)"
        : "rgba(0, 200, 255, 1)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(outlinePoints[0].x, outlinePoints[0].y);

    for (let i = 1; i < outlinePoints.length; i++) {
      ctx.lineTo(outlinePoints[i].x, outlinePoints[i].y);
    }

    ctx.stroke();

    for (const point of outlinePoints) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
      ctx.fillStyle =
        tool === "smart-outline"
          ? "rgba(255, 140, 0, 1)"
          : "rgba(0, 200, 255, 1)";
      ctx.fill();
    }
  }

  function finishOutline() {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (outlinePoints.length < 3) {
      setMaskError("Add at least 3 outline points.");
      return;
    }

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    ctx.beginPath();
    ctx.moveTo(outlinePoints[0].x, outlinePoints[0].y);

    for (let i = 1; i < outlinePoints.length; i++) {
      ctx.lineTo(outlinePoints[i].x, outlinePoints[i].y);
    }

    ctx.closePath();
    ctx.fillStyle = "rgba(255,255,255,1)";
    ctx.fill();

    // only clear the temporary preview points
    setOutlinePoints([]);
    clearPreviewCanvas();
    setMaskError(null);

    // keep tool in outline mode so user can start another one
    setTool((current) =>
      current === "smart-outline" ? "smart-outline" : "outline",
    );
  }
  function undoLastOutlinePoint() {
    setOutlinePoints((prev) => prev.slice(0, -1));
  }
  function clearCurrentOutline() {
    setOutlinePoints([]);
    clearPreviewCanvas();
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (tool === "drag") {
      setIsPanning(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      setPanStart({
        x: event.clientX - pan.x,
        y: event.clientY - pan.y,
      });
      return;
    }

    if (maskLocked) return;

    const point = getPointerPosition(event);
    if (!point) return;

    if (tool === "outline" || tool === "smart-outline") {
      let newPoint = point;

      if (tool === "smart-outline") {
        newPoint = snapToEdge(point.x, point.y);
      }

      setOutlinePoints((prev) => [...prev, newPoint]);
      return;
    }

    setIsDrawing(true);
    drawPoint(point.x, point.y);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (tool === "drag" && isPanning) {
      setPan({
        x: event.clientX - panStart.x,
        y: event.clientY - panStart.y,
      });
      return;
    }

    if (maskLocked) return;
    if (tool === "outline" || tool === "smart-outline") return;
    if (!isDrawing) return;

    const point = getPointerPosition(event);
    if (!point) return;

    drawPoint(point.x, point.y);
  }

  function handlePointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    setIsDrawing(false);
    setIsPanning(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function clearMask() {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "rgba(0,0,0,1)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }

    clearPreviewCanvas();
    setOutlinePoints([]);
    setMaskError(null);
    setMaskLocked(false);
    setActiveZoneId(null);
    setGeneratedPreviewUrl(null);
    setPreviewError(null);
  }

  function editMask() {
    setMaskLocked(false);
    setPreviewError(null);
    setOutlinePoints([]);
    clearPreviewCanvas();
  }

  async function loadRecentSwatches() {
    setRecentSwatchesLoading(true);
    try {
      const response = await fetch("/api/recent-swatches");
      const data = await response.json();

      if (response.ok && Array.isArray(data.swatches)) {
        setRecentSwatches(data.swatches);
      }
    } catch (err) {
      console.error("Failed to load recent swatches:", err);
    } finally {
      setRecentSwatchesLoading(false);
    }
  }

  useEffect(() => {
    loadRecentSwatches();
  }, []);

  function toggleRecentSwatch(swatchId: string) {
    setSelectedRecentSwatchIds((prev) => {
      if (prev.includes(swatchId)) {
        return prev.filter((id) => id !== swatchId);
      }
      return [...prev, swatchId];
    });
    setGeneratedPreviewUrl(null);
    setPreviewError(null);
    setBulkPreviewError(null);
  }

  function clearRecentSwatchSelection() {
    setSelectedRecentSwatchIds([]);
  }

  // Legacy single-pick helper kept for clarity - not used in UI anymore
  function selectRecentSwatch(swatch: {
    colourName: string;
    fabricFamily: string;
    imageUrl: string | null;
  }) {
    if (!swatch.imageUrl) return;
    setSwatchFile(null);
    setSwatchUrl(swatch.imageUrl);
    setSwatchSource("url");
    if (!fabricName.trim()) {
      setFabricName(swatch.colourName);
    }
    setGeneratedPreviewUrl(null);
    setPreviewError(null);
  }

  async function generatePreview() {
    if (!product) {
      setPreviewError("Please select a product first.");
      return;
    }

    if (!product.featuredImage) {
      setPreviewError("This product has no base image.");
      return;
    }

    if (!activeZoneId) {
      setPreviewError("Please save a zone first.");
      return;
    }

    if (!fabricName.trim()) {
      setPreviewError("Please enter a fabric or colour name.");
      return;
    }

    if (!swatchFile && !swatchUrl) {
      setPreviewError("Please upload a swatch, pick one from Shopify Files, or select a recent colour.");
      return;
    }

    setPreviewLoading(true);
    setPreviewError(null);

    try {
      const formData = new FormData();
      formData.append("productId", product.id);
      formData.append("zoneId", activeZoneId);
      if (swatchFile) {
        formData.append("swatch", swatchFile);
      } else if (swatchUrl) {
        formData.append("swatchUrl", swatchUrl);
      }
      formData.append("fabricFamily", "General");
      formData.append("colourName", fabricName.trim());

      const response = await fetch("/api/generate-preview", {
        method: "POST",
        body: formData,
      });

      const rawText = await response.text();
      console.log("Generate preview response:", rawText);

      let data: unknown;
      try {
        data = JSON.parse(rawText);
      } catch {
        throw new Error(rawText || "Server did not return valid JSON");
      }

      if (!response.ok) {
        const errorMessage =
          typeof data === "object" &&
            data !== null &&
            "error" in data &&
            typeof (data as { error: unknown }).error === "string"
            ? (data as { error: string }).error
            : "Failed to generate preview";

        throw new Error(errorMessage);
      }

      if (
        typeof data === "object" &&
        data !== null &&
        "preview" in data &&
        typeof (data as { preview: { url?: string } }).preview?.url === "string"
      ) {
        setGeneratedPreviewUrl((data as { preview: { url: string } }).preview.url);
        // Refresh recent swatches so the one we just used appears at the top
        loadRecentSwatches();
      } else {
        throw new Error("Preview URL was not returned.");
      }
    } catch (err) {
      console.error("Generate preview error:", err);

      if (err instanceof Error) {
        setPreviewError(err.message);
      } else {
        setPreviewError("Failed to generate preview.");
      }
    } finally {
      setPreviewLoading(false);
    }
  }

  async function generateBulkPreviews() {
  if (!product) {
    setBulkPreviewError("Please select a product first.");
    return;
  }

  if (!product.featuredImage) {
    setBulkPreviewError("This product has no base image.");
    return;
  }

  if (!activeZoneId) {
    setBulkPreviewError("Please save or select a zone first.");
    return;
  }

  // Build the combined list of jobs: selected recent swatches + uploaded files
  type BulkJob =
    | { kind: "file"; file: File; colourName: string }
    | { kind: "url"; url: string; colourName: string; fabricFamily: string };

  const jobs: BulkJob[] = [];

  // Add recent swatches first (in selection order)
  for (const swatchId of selectedRecentSwatchIds) {
    const swatch = recentSwatches.find((s) => s.id === swatchId);
    if (swatch && swatch.imageUrl) {
      jobs.push({
        kind: "url",
        url: swatch.imageUrl,
        colourName: swatch.colourName,
        fabricFamily: swatch.fabricFamily || "General",
      });
    }
  }

  // Then add uploaded files
  for (const file of bulkSwatchFiles) {
    jobs.push({
      kind: "file",
      file,
      colourName: file.name.replace(/\.[^/.]+$/, ""),
    });
  }

  if (jobs.length === 0) {
    setBulkPreviewError(
      "Please select at least 1 recent colour or upload at least 1 swatch file.",
    );
    return;
  }

  setBulkPreviewLoading(true);
  setBulkPreviewError(null);
  setBulkPreviewResults([]);
  setSelectedBulkIndex(null);

  const totalItems = jobs.length;
  const batchSize = 10;
  const { totalBatches: batches } = getBatchInfo(totalItems, batchSize);

  setCurrentBatch(0);
  setTotalBatches(batches);
  setGeneratedCount(0);
  setGenerationNotice(
    "Previews are generated in batches of 10 to keep processing fast and stable. You can view completed images in the Preview Manager."
  );

  const results: Array<{ fileName: string; previewUrl: string }> = [];
  const skipped: string[] = [];

  try {
    for (let i = 0; i < jobs.length; i += batchSize) {
      const batch = jobs.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;

      setCurrentBatch(batchNumber);

      for (const job of batch) {
        const formData = new FormData();
        formData.append("productId", product.id);
        formData.append("zoneId", activeZoneId);
        formData.append("fabricFamily", job.kind === "url" ? job.fabricFamily : "General");
        formData.append("colourName", job.colourName);

        if (job.kind === "file") {
          formData.append("swatch", job.file);
        } else {
          formData.append("swatchUrl", job.url);
        }

        try {
          const response = await fetch("/api/generate-preview", {
            method: "POST",
            body: formData,
          });

          const rawText = await response.text();

          let data: unknown;
          try {
            data = JSON.parse(rawText);
          } catch {
            skipped.push(job.colourName);
            continue;
          }

          if (!response.ok) {
            const errorMessage =
              typeof data === "object" &&
              data !== null &&
              "error" in data &&
              typeof (data as { error: unknown }).error === "string"
                ? (data as { error: string }).error
                : `Failed on ${job.colourName}`;
            skipped.push(`${job.colourName} (${errorMessage})`);
            continue;
          }

          if (
            typeof data === "object" &&
            data !== null &&
            "preview" in data &&
            typeof (data as { preview: { url?: string } }).preview?.url === "string"
          ) {
            results.push({
              fileName: job.colourName,
              previewUrl: (data as { preview: { url: string } }).preview.url,
            });
            setBulkPreviewResults([...results]);
          } else {
            skipped.push(job.colourName);
          }
        } catch {
          skipped.push(job.colourName);
        }
      }

      setGeneratedCount(results.length);
    }

    // Refresh recent swatches and clear selection after bulk run
    loadRecentSwatches();
    setSelectedRecentSwatchIds([]);

    if (skipped.length > 0) {
      setBulkPreviewError(
        `${skipped.length} preview${skipped.length === 1 ? "" : "s"} could not be generated: ${skipped.join(", ")}`
      );
    }

    setGenerationNotice(
      results.length > 0
        ? "Preview generation finished. Review completed images in the Preview Manager."
        : null
    );
    setCurrentBatch(0);
    setTotalBatches(0);
  } catch (err) {
    console.error("Bulk preview error:", err);
    setBulkPreviewError(
      err instanceof Error ? err.message : "Failed to generate bulk previews."
    );
  } finally {
    setBulkPreviewLoading(false);
  }
}

  async function saveZone() {
    if (!product) {
      setMaskError("Please select a product first.");
      return;
    }

    if (!product.featuredImage) {
      setMaskError("This product has no base image.");
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      setMaskError("Mask canvas is not ready.");
      return;
    }

    setMaskSaving(true);
    setMaskError(null);

    try {
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((result) => resolve(result), "image/png");
      });

      if (!blob) {
        throw new Error("Could not create mask image.");
      }

      const zoneId = activeZoneId ?? `zone-${Date.now()}`;

      const formData = new FormData();
      formData.append("productId", product.id);
      formData.append("baseImageUrl", product.featuredImage ?? "");
      formData.append("productTitle", product.title ?? "");
      formData.append("zoneId", zoneId);
      formData.append("zoneName", "Main Area");
      formData.append("mask", blob, `${zoneId}.png`);

      const response = await fetch("/api/save-zone", {
        method: "POST",
        body: formData,
      });

      const rawText = await response.text();

      let data: SaveZoneResponse;
      try {
        data = JSON.parse(rawText) as SaveZoneResponse;
      } catch {
        throw new Error(rawText || "Server did not return valid JSON");
      }

      if (!response.ok) {
        throw new Error(data.error || "Failed to save zone");
      }

      setActiveZoneId(data.zone?.id ?? zoneId);
      setMaskLocked(true);
      setGeneratedPreviewUrl(null);
      setPreviewError(null);

      // Keep the saved zone in local UI immediately
      setZones((prev) => {
        const existing = prev.find((z) => z.id === zoneId);

        if (existing) {
          return prev.map((z) =>
            z.id === zoneId
              ? {
                  ...z,
                  name: "Main Area",
                }
              : z,
          );
        }

        return [
          ...prev,
          {
            id: zoneId,
            name: "Main Area",
            maskPath: URL.createObjectURL(blob),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ];
      });

      // TEMP: do not reload zones immediately until /api/list-zones is updated
      // await loadZones(product.id);
    } catch (err) {
      console.error("Save zone error:", err);

      if (err instanceof Error) {
        setMaskError(err.message);
      } else {
        setMaskError("Failed to save zone.");
      }
    } finally {
      setMaskSaving(false);
    }
  }

const stepCardStyle: CSSProperties = {
  border: "1px solid #e3e3e3",
  borderRadius: "14px",
  padding: "14px",
  background: "#fff",
  minWidth: 0,
};

const pageWrapStyle: CSSProperties = {
  padding: "24px",
  maxWidth: "1440px",
  margin: "0 auto",
};

const sectionCardStyle: CSSProperties = {
  border: "1px solid #e3e3e3",
  borderRadius: "16px",
  padding: "20px",
  background: "#fff",
  boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
};

const sectionTitleStyle: CSSProperties = {
  margin: "0 0 6px 0",
  fontSize: "20px",
  fontWeight: 700,
  color: "#111",
};

const sectionTextStyle: CSSProperties = {
  margin: 0,
  fontSize: "13px",
  color: "#666",
  lineHeight: 1.5,
};

const subtleButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: "10px",
  border: "1px solid #d9d9d9",
  background: "#fff",
  cursor: "pointer",
  font: "inherit",
};

const primaryButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: "10px",
  border: "1px solid #111",
  background: "#111",
  color: "#fff",
  cursor: "pointer",
  font: "inherit",
};

const stepNumberStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 700,
  color: "#666",
  marginBottom: "6px",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const stepTitleStyle: CSSProperties = {
  fontSize: "15px",
  fontWeight: 700,
  color: "#111",
  marginBottom: "6px",
};

const stepTextStyle: CSSProperties = {
  fontSize: "13px",
  color: "#666",
  lineHeight: 1.45,
};


  return (
  <div style={pageWrapStyle}>
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ marginBottom: "8px" }}>Product Setup</h1>
        <p style={{ margin: 0, color: "#555", maxWidth: "780px", lineHeight: 1.5 }}>
          Set up your product, mark the fabric areas, upload swatches, and create realistic colour previews for your storefront.
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "12px",
          marginBottom: "24px",
        }}
      >
        <div style={stepCardStyle}>
          <div style={stepNumberStyle}>Step 1</div>
          <div style={stepTitleStyle}>Select product</div>
          <div style={stepTextStyle}>
            Choose the product you want to create colour previews for.
          </div>
        </div>

        <div style={stepCardStyle}>
          <div style={stepNumberStyle}>Step 2</div>
          <div style={stepTitleStyle}>Save fabric areas</div>
          <div style={stepTextStyle}>
            Mark the upholstery areas that should change colour.
          </div>
        </div>

        <div style={stepCardStyle}>
          <div style={stepNumberStyle}>Step 3</div>
          <div style={stepTitleStyle}>Upload swatches</div>
          <div style={stepTextStyle}>
            Add one or more fabric swatches to use for previews.
          </div>
        </div>

        <div style={stepCardStyle}>
          <div style={stepNumberStyle}>Step 4</div>
          <div style={stepTitleStyle}>Create previews</div>
          <div style={stepTextStyle}>
            Generate one preview or create all previews in bulk.
          </div>
        </div>

        <div style={stepCardStyle}>
          <div style={stepNumberStyle}>Step 5</div>
          <div style={stepTitleStyle}>Approve colours</div>
          <div style={stepTextStyle}>
            Review your generated previews and choose which ones to show.
          </div>
        </div>

        <div style={stepCardStyle}>
          <div style={stepNumberStyle}>Step 6</div>
          <div style={stepTitleStyle}>Enable storefront gallery</div>
          <div style={stepTextStyle}>
            Turn on the colour gallery for products you want live on your store.
          </div>
        </div>
      </div>

        <div style={{ ...sectionCardStyle, marginBottom: "20px" }}>
          <h2 style={sectionTitleStyle}>Step 1: Select product</h2>
          <p style={{ ...sectionTextStyle, marginBottom: "14px" }}>
            Choose the product you want to create colour previews for.
          </p>

          <button
            type="button"
            onClick={openProductPicker}
            style={primaryButtonStyle}
          >
            Select product
          </button>

          {product && (
            <p style={{ marginTop: "10px", fontSize: "13px", color: "#666" }}>
              Selected product: <strong>{product.title}</strong>
            </p>
          )}

          <div
            style={{
              background: "#f6f7f9",
              border: "1px solid #e1e3e5",
              padding: "10px 12px",
              borderRadius: "10px",
              fontSize: "13px",
              marginTop: "14px",
              color: "#333",
              maxWidth: "760px",
              lineHeight: 1.5,
            }}
          >
            <strong>Tip:</strong> For best results, use products with a light or white base colour.
            Dark products may produce less accurate colour previews.
          </div>

          <p style={{ marginTop: "8px", fontSize: "13px", color: "#666" }}>
            Use a clear, high-quality product image for the most realistic results.
          </p>
        </div>

        {loading && <p>Loading product...</p>}

        {error && (
          <p style={{ color: "crimson", fontWeight: 600 }}>
            {error}
          </p>
        )}

        {product && (
        <>
            <div
              style={{
                ...sectionCardStyle,
                marginBottom: "24px",
              }}
            >
              <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
                {product.featuredImage && (
                  <img
                    src={product.featuredImage}
                    alt={product.title}
                    style={{
                      width: "80px",
                      height: "80px",
                      objectFit: "cover",
                      borderRadius: "8px",
                      border: "1px solid #ddd",
                    }}
                  />
                )}

                <div>
                  <h2 style={{ margin: 0 }}>{product.title}</h2>
                  <p style={{ margin: "4px 0 0", fontSize: "13px", color: "#666" }}>
                    Product selected for colour previews
                  </p>
                </div>
              </div>

                            <div
                style={{
                  border: "1px solid #e3e3e3",
                  borderRadius: "12px",
                  padding: "14px",
                  background: "#fff",
                  marginTop: "16px",
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: "8px" }}>Setup progress</div>

                <div style={{ fontSize: "13px", color: "#555", lineHeight: 1.8 }}>
                  <div>✅ Product selected</div>
                  <div>{zones.length > 0 ? "✅" : "⏳"} Fabric area saved</div>
                  <div>{swatchFile || bulkSwatchFiles.length > 0 ? "✅" : "⏳"} Swatch uploaded</div>
                  <div>{generatedPreviewUrl || bulkPreviewResults.length > 0 ? "✅" : "⏳"} Preview created</div>
                </div>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1.65fr) minmax(320px, 420px)",
                gap: "24px",
                alignItems: "start",
                marginTop: "8px",
              }}
            >
              <div
                style={{
                  border: "1px solid #ddd",
                  borderRadius: "12px",
                  padding: "20px",
                  background: "#fff",
                }}
              >
                <h2 style={{ marginTop: 0 }}>Tools</h2>
                <p style={{ fontSize: "13px", color: "#666", marginTop: "6px", marginBottom: "14px" }}>
                  Paint over the parts of the product that should change colour.
                </p>

                {!product.featuredImage ? (
                  <p>This product has no featured image.</p>
                ) : (
                  <div
                    style={{
                      position: "relative",
                      overflow: "hidden",
                      width: "100%",
                      height: "720px",
                      borderRadius: "8px",
                      background: "#f7f7f7",
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        height: "100%",
                        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                        transformOrigin: "top left",
                        cursor:
                          tool === "drag"
                            ? isPanning
                              ? "grabbing"
                              : "grab"
                            : "default",
                      }}
                    >
                      <img
                        ref={imageRef}
                        src={product.featuredImage}
                        alt={product.title}
                        crossOrigin="anonymous"
                        onLoad={() => {
                          setZoom(1);
                          setPan({ x: 0, y: 0 });
                          resizeCanvasToImage();
                          generateEdgeMap();
                        }}
                        style={{
                          maxWidth: "100%",
                          height: "auto",
                          display: "block",
                          borderRadius: "8px",
                        }}
                      />

                      <canvas
                        ref={canvasRef}
                        onPointerDown={handlePointerDown}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                        onPointerLeave={handlePointerUp}
                        style={{
                          position: "absolute",
                          inset: 0,
                          touchAction: "none",
                          cursor:
                            tool === "drag"
                              ? isPanning
                                ? "grabbing"
                                : "grab"
                              : tool === "erase"
                                ? "cell"
                                : "crosshair",
                          opacity: 0.35,
                          borderRadius: "8px",
                          zIndex: 1,
                        }}
                      />

                      <canvas
                        ref={previewCanvasRef}
                        style={{
                          position: "absolute",
                          inset: 0,
                          pointerEvents: "none",
                          borderRadius: "8px",
                          zIndex: 2,
                        }}
                      />
                    </div>
                  </div>
                )}

                {generatedPreviewUrl && (
                  <div style={{ marginTop: "20px" }}>
                    <h3>Step 4: Preview result</h3>
                    <p style={{ fontSize: "13px", color: "#666" }}>
                      This shows how your product will look with the selected fabric.
                    </p>

                    <div>
                      <img
                        src={generatedPreviewUrl}
                        alt="Generated preview"
                        style={{
                          maxWidth: "100%",
                          borderRadius: "8px",
                          display: "block",
                          border: "1px solid #ddd",
                        }}
                      />

                      <p style={{ fontSize: "14px", color: "#666", marginTop: "8px" }}>
                        Generated preview
                      </p>
                    </div>
                  </div>
                )}

                {bulkPreviewResults.length > 0 && (
                  <div style={{ marginTop: "24px" }}>
                    <h3>Generated colour previews</h3>
                    <p style={{ fontSize: "13px", color: "#666" }}>
                      Click a preview to view it in full.
                    </p>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                        gap: "12px",
                      }}
                    >
                      {bulkPreviewResults.map((item, index) => (
                        <button
                          key={item.previewUrl}
                          type="button"
                          onClick={() => setSelectedBulkIndex(index)}
                          style={{
                            border: "1px solid #ddd",
                            borderRadius: "8px",
                            padding: "8px",
                            background: "#fff",
                            cursor: "pointer",
                            textAlign: "left",
                          }}
                        >
                          <img
                            src={item.previewUrl}
                            alt={item.fileName}
                            style={{
                              width: "100%",
                              borderRadius: "6px",
                              display: "block",
                              marginBottom: "8px",
                            }}
                          />
                          <p style={{ fontSize: "13px", margin: 0 }}>{item.fileName}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div> {/* ✅ THIS WAS MISSING */}

              <div
                style={{
                  border: "1px solid #ddd",
                  borderRadius: "12px",
                  padding: "20px",
                  background: "#fff",
                }}
              >
                <h2 style={{ marginTop: 0 }}>Tools</h2>

                <div style={{ marginBottom: "16px" }}>
                  <p style={{ fontWeight: 600, marginBottom: "8px" }}>Zoom</p>

                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={() => setZoom((z) => Math.min(z + 0.25, 4))}
                      style={{
                        padding: "8px 12px",
                        borderRadius: "8px",
                        border: "1px solid #ccc",
                        cursor: "pointer",
                        minWidth: "104px",
                        minHeight: "44px",
                      }}
                    >
                      Zoom In
                    </button>

                    <button
                      type="button"
                      onClick={() => setZoom((z) => Math.max(z - 0.25, 0.5))}
                      style={{
                        padding: "8px 12px",
                        borderRadius: "8px",
                        border: "1px solid #ccc",
                        cursor: "pointer",
                        minWidth: "104px",
                        minHeight: "44px",
                      }}
                    >
                      Zoom Out
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setZoom(1);
                        setPan({ x: 0, y: 0 });
                      }}
                      style={{
                        padding: "8px 12px",
                        borderRadius: "8px",
                        border: "1px solid #ccc",
                        cursor: "pointer",
                        minWidth: "104px",
                        minHeight: "44px",
                      }}
                    >
                      Reset View
                    </button>
                  </div>
                </div>

                <div style={{ marginBottom: "16px" }}>
                  <p style={{ fontWeight: 600, marginBottom: "8px" }}>Mode</p>

                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={() => setTool("draw")}
                      style={{
                        padding: "8px 12px",
                        borderRadius: "8px",
                        border: "1px solid #ccc",
                        background: tool === "draw" ? "#111" : "#fff",
                        color: tool === "draw" ? "#fff" : "#111",
                        cursor: "pointer",
                        minWidth: "104px",
                        minHeight: "44px",
                      }}
                    >
                      Draw mask
                    </button>

                    <button
                      type="button"
                      onClick={() => setTool("outline")}
                      style={{
                        padding: "8px 12px",
                        borderRadius: "8px",
                        border: "1px solid #ccc",
                        background: tool === "outline" ? "#111" : "#fff",
                        color: tool === "outline" ? "#fff" : "#111",
                        cursor: "pointer",
                        minWidth: "104px",
                        minHeight: "44px",
                      }}
                    >
                      Outline
                    </button>

                    <button
                      type="button"
                      onClick={() => setTool("smart-outline")}
                      style={{
                        padding: "8px 12px",
                        borderRadius: "8px",
                        border: "1px solid #ccc",
                        background: tool === "smart-outline" ? "#111" : "#fff",
                        color: tool === "smart-outline" ? "#fff" : "#111",
                        cursor: "pointer",
                        minWidth: "104px",
                        minHeight: "44px",
                      }}
                    >
                      Smart Outline
                    </button>

                    <button
                      type="button"
                      onClick={() => setTool("drag")}
                      style={{
                        padding: "8px 12px",
                        borderRadius: "8px",
                        border: "1px solid #ccc",
                        background: tool === "drag" ? "#111" : "#fff",
                        color: tool === "drag" ? "#fff" : "#111",
                        cursor: "pointer",
                        minWidth: "104px",
                        minHeight: "44px",
                      }}
                    >
                      Drag
                    </button>

                    <button
                      type="button"
                      onClick={() => setTool("erase")}
                      style={{
                        padding: "8px 12px",
                        borderRadius: "8px",
                        border: "1px solid #ccc",
                        background: tool === "erase" ? "#111" : "#fff",
                        color: tool === "erase" ? "#fff" : "#111",
                        cursor: "pointer",
                        minWidth: "104px",
                        minHeight: "44px",
                      }}
                    >
                      Erase
                    </button>
                  </div>
                </div>

                <div style={{ marginBottom: "16px" }}>
                  <label style={{ display: "block", fontWeight: 600, marginBottom: "8px" }}>
                    Brush size: {brushSize}px
                  </label>
                  <input
                    type="range"
                    min="6"
                    max="80"
                    value={brushSize}
                    onChange={(e) => setBrushSize(Number(e.target.value))}
                    style={{ width: "100%" }}
                  />
                </div>

                <div style={{ marginBottom: "16px" }}>
                  <p style={{ fontWeight: 600, marginBottom: "8px" }}>Saved zones</p>

                  {zones.length === 0 ? (
                    <p style={{ fontSize: "14px", color: "#666", margin: 0 }}>
                      No saved zones yet.
                    </p>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {zones.map((zone) => (
                        <div
                          key={zone.id}
                          style={{
                            display: "flex",
                            gap: "8px",
                            alignItems: "center",
                          }}
                        >
                          <button
                            type="button"
                            onClick={async () => {
                              setActiveZoneId(zone.id);
                              setMaskLocked(true);
                              setGeneratedPreviewUrl(null);
                              setPreviewError(null);
                              setZoom(1);
                              setPan({ x: 0, y: 0 });

                              loadZoneMaskOntoCanvas(zone);
                            }}
                            style={{
                              flex: 1,
                              padding: "10px 12px",
                              borderRadius: "8px",
                              border: "1px solid #ccc",
                              background: activeZoneId === zone.id ? "#111" : "#fff",
                              color: activeZoneId === zone.id ? "#fff" : "#111",
                              textAlign: "left",
                              cursor: "pointer",
                            }}
                          >
                            {zone.name}
                          </button>

                          <button
                            type="button"
                            onClick={async () => {
                              if (!product) return;

                              const newName = window.prompt("Rename zone", zone.name);
                              if (!newName || !newName.trim()) return;

                              const formData = new FormData();
                              formData.append("productId", product.id);
                              formData.append("zoneId", zone.id);
                              formData.append("zoneName", newName.trim());

                              const response = await fetch("/api/rename-zone", {
                                method: "POST",
                                body: formData,
                              });

                              if (!response.ok) {
                                alert("Failed to rename zone");
                                return;
                              }

                              await loadZones(product.id);
                            }}
                            style={{
                              padding: "10px 12px",
                              borderRadius: "8px",
                              border: "1px solid #ccc",
                              background: "#fff",
                              cursor: "pointer",
                            }}
                          >
                            Rename
                          </button>

                          <button
                            type="button"
                            onClick={async () => {
                              if (!product) return;

                              const confirmed = window.confirm(`Delete zone "${zone.name}"?`);
                              if (!confirmed) return;

                              const formData = new FormData();
                              formData.append("productId", product.id);
                              formData.append("zoneId", zone.id);

                              const response = await fetch("/api/delete-zone", {
                                method: "POST",
                                body: formData,
                              });

                              if (!response.ok) {
                                alert("Failed to delete zone");
                                return;
                              }

                              clearMask();

                              const remaining = await loadZones(product.id);
                              if (remaining.length > 0) {
                                loadZoneMaskOntoCanvas(remaining[0]);
                              }
                            }}
                            style={{
                              padding: "10px 12px",
                              borderRadius: "8px",
                              border: "1px solid #ccc",
                              background: "#fff",
                              cursor: "pointer",
                              minWidth: "104px",
                              minHeight: "44px",
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* ========== MASK ACTIONS ========== */}
                <div style={{ marginBottom: "16px" }}>
                  {/* Row 1: Edit mask + Clear mask side by side */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: maskLocked ? "1fr 1fr" : "1fr",
                      gap: "8px",
                      marginBottom: "8px",
                    }}
                  >
                    {maskLocked && (
                      <button
                        type="button"
                        onClick={editMask}
                        style={{
                          padding: "10px 14px",
                          borderRadius: "8px",
                          border: "1px solid #ccc",
                          background: "#ffffff",
                          cursor: "pointer",
                          minHeight: "44px",
                          fontWeight: 600,
                        }}
                      >
                        Edit mask
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={clearMask}
                      style={{
                        padding: "10px 14px",
                        borderRadius: "8px",
                        border: "1px solid #ccc",
                        background: "#ffffff",
                        cursor: "pointer",
                        minHeight: "44px",
                        fontWeight: 600,
                      }}
                    >
                      Clear mask
                    </button>
                  </div>

                  {/* Row 2: Save zone on its own line, full width, primary action */}
                  <button
                    type="button"
                    onClick={saveZone}
                    disabled={maskSaving || maskLocked}
                    style={{
                      width: "100%",
                      padding: "12px 14px",
                      borderRadius: "8px",
                      border: maskLocked ? "1px solid #bbf7d0" : "1px solid #111827",
                      background: maskLocked ? "#f0fdf4" : "#111827",
                      color: maskLocked ? "#166534" : "#ffffff",
                      cursor: maskSaving || maskLocked ? "not-allowed" : "pointer",
                      opacity: maskSaving ? 0.7 : 1,
                      minHeight: "48px",
                      fontWeight: 700,
                      fontSize: "14px",
                    }}
                  >
                    {maskSaving
                      ? "Saving..."
                      : maskLocked
                      ? "✓ Zone saved"
                      : "Save zone"}
                  </button>

                  {/* Outline-mode-specific secondary buttons (only visible when drawing an outline) */}
                  {(tool === "outline" || tool === "smart-outline") && !maskLocked && (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: "8px",
                        marginTop: "8px",
                      }}
                    >
                      <button
                        type="button"
                        onClick={undoLastOutlinePoint}
                        style={{
                          padding: "10px 14px",
                          borderRadius: "8px",
                          border: "1px solid #ccc",
                          background: "#ffffff",
                          cursor: "pointer",
                          minHeight: "44px",
                          fontWeight: 600,
                        }}
                      >
                        Undo point
                      </button>

                      <button
                        type="button"
                        onClick={clearCurrentOutline}
                        style={{
                          padding: "10px 14px",
                          borderRadius: "8px",
                          border: "1px solid #ccc",
                          background: "#ffffff",
                          cursor: "pointer",
                          minHeight: "44px",
                          fontWeight: 600,
                        }}
                      >
                        Clear outline
                      </button>
                    </div>
                  )}

                  {(tool === "outline" || tool === "smart-outline") && !maskLocked && (
                    <button
                      type="button"
                      onClick={finishOutline}
                      style={{
                        width: "100%",
                        marginTop: "8px",
                        padding: "10px 14px",
                        borderRadius: "8px",
                        border: "1px solid #ccc",
                        background: "#ffffff",
                        cursor: "pointer",
                        minHeight: "44px",
                        fontWeight: 600,
                      }}
                    >
                      Finish outline
                    </button>
                  )}
                </div>

                <p style={{ fontSize: "14px", lineHeight: 1.5 }}>
                  Paint the upholstery area in white. Black means “do not affect this area”.
                </p>

                {maskError && (
                  <p style={{ color: "crimson", fontWeight: 600 }}>
                    {maskError}
                  </p>
                )}

                {maskLocked && (
                  <p style={{ color: "green", fontWeight: 600 }}>
                    Zone saved and ready for preview.
                  </p>
                )}
                {maskLocked && (
                  <div style={{ marginTop: "24px", paddingTop: "16px", borderTop: "1px solid #eee" }}>
                    <h3 style={{ marginTop: 0 }}>Fabric / colour</h3>

                    <div style={{ marginBottom: "14px" }}>
                      <label
                        style={{
                          display: "block",
                          fontWeight: 600,
                          marginBottom: "6px",
                        }}
                      >

                        Colour / fabric name
                      </label>
                      <input
                        type="text"
                        value={fabricName}
                        onChange={(e) => setFabricName(e.target.value)}
                        placeholder="e.g. Naples Silver"
                        style={{
                          width: "100%",
                          padding: "10px",
                          borderRadius: "8px",
                          border: "1px solid #ccc",
                          boxSizing: "border-box",
                        }}
                      />
                    </div>

                    {bulkPreviewError && (
                      <p style={{ color: "crimson", fontWeight: 600 }}>
                        {bulkPreviewError}
                      </p>
                    )}

                    {/* ===== RECENTLY USED COLOURS ===== */}
                    <div
                      style={{
                        marginBottom: "14px",
                        padding: "14px",
                        borderRadius: "12px",
                        background: "#ffffff",
                        border: "1px solid #e5e7eb",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: "10px",
                        }}
                      >
                        <div
                          style={{
                            fontSize: "13px",
                            fontWeight: 700,
                            color: "#0f172a",
                          }}
                        >
                          Recently used colours
                        </div>
                        {selectedRecentSwatchIds.length > 0 ? (
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <div
                              style={{
                                fontSize: "12px",
                                color: "#1d4ed8",
                                fontWeight: 700,
                              }}
                            >
                              {selectedRecentSwatchIds.length} selected
                            </div>
                            <button
                              type="button"
                              onClick={clearRecentSwatchSelection}
                              style={{
                                padding: "4px 10px",
                                borderRadius: "6px",
                                border: "1px solid #d1d5db",
                                background: "#ffffff",
                                color: "#111827",
                                cursor: "pointer",
                                fontSize: "12px",
                                fontWeight: 600,
                              }}
                            >
                              Clear all
                            </button>
                          </div>
                        ) : (
                          recentSwatches.length > 0 && (
                            <div
                              style={{
                                fontSize: "12px",
                                color: "#64748b",
                                fontWeight: 600,
                              }}
                            >
                              {recentSwatches.length}{" "}
                              {recentSwatches.length === 1 ? "colour" : "colours"}
                            </div>
                          )
                        )}
                      </div>

                      {recentSwatches.length > 0 && (
                        <div
                          style={{
                            fontSize: "12px",
                            color: "#64748b",
                            marginBottom: "10px",
                            lineHeight: 1.5,
                          }}
                        >
                          Tap a colour to select it for bulk generation. Selected colours will be queued together with any swatches you upload below.
                        </div>
                      )}

                      {recentSwatchesLoading && recentSwatches.length === 0 ? (
                        <div style={{ fontSize: "13px", color: "#64748b" }}>
                          Loading...
                        </div>
                      ) : recentSwatches.length === 0 ? (
                        <div
                          style={{
                            fontSize: "13px",
                            color: "#64748b",
                            lineHeight: 1.5,
                          }}
                        >
                          No previous colours yet. Generate a preview and your swatch will be saved here automatically.
                        </div>
                      ) : (
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))",
                            gap: "10px",
                            maxHeight: "260px",
                            overflowY: "auto",
                            paddingRight: "4px",
                          }}
                        >
                          {recentSwatches.map((swatch) => {
                            const selectionIndex = selectedRecentSwatchIds.indexOf(swatch.id);
                            const isSelected = selectionIndex >= 0;

                            return (
                              <button
                                key={swatch.id}
                                type="button"
                                onClick={() => toggleRecentSwatch(swatch.id)}
                                title={`${swatch.colourName} · ${swatch.fabricFamily}`}
                                style={{
                                  position: "relative",
                                  padding: "4px",
                                  borderRadius: "10px",
                                  border: isSelected
                                    ? "2px solid #1d4ed8"
                                    : "1px solid #e5e7eb",
                                  background: isSelected ? "#eff6ff" : "#ffffff",
                                  cursor: "pointer",
                                  textAlign: "left",
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: "4px",
                                }}
                              >
                                {isSelected && (
                                  <div
                                    style={{
                                      position: "absolute",
                                      top: "6px",
                                      right: "6px",
                                      width: "22px",
                                      height: "22px",
                                      borderRadius: "50%",
                                      background: "#1d4ed8",
                                      color: "#ffffff",
                                      fontSize: "12px",
                                      fontWeight: 800,
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                                      zIndex: 1,
                                    }}
                                  >
                                    {selectionIndex + 1}
                                  </div>
                                )}
                                <div
                                  style={{
                                    width: "100%",
                                    aspectRatio: "1 / 1",
                                    borderRadius: "6px",
                                    overflow: "hidden",
                                    background: "#f8fafc",
                                  }}
                                >
                                  {swatch.imageUrl ? (
                                    <img
                                      src={swatch.imageUrl}
                                      alt={swatch.colourName}
                                      style={{
                                        width: "100%",
                                        height: "100%",
                                        objectFit: "cover",
                                        display: "block",
                                      }}
                                    />
                                  ) : (
                                    <div
                                      style={{
                                        width: "100%",
                                        height: "100%",
                                        background: "#e5e7eb",
                                      }}
                                    />
                                  )}
                                </div>
                                <div
                                  style={{
                                    fontSize: "11px",
                                    fontWeight: 700,
                                    color: "#0f172a",
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    padding: "0 2px",
                                  }}
                                >
                                  {swatch.colourName}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* ========== SINGLE PREVIEW CARD ========== */}
                    <div
                      style={{
                        marginBottom: "16px",
                        padding: "16px",
                        borderRadius: "12px",
                        background: "#ffffff",
                        border: "1px solid #e5e7eb",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "14px",
                          fontWeight: 700,
                          color: "#0f172a",
                          marginBottom: "4px",
                        }}
                      >
                        Single preview
                      </div>
                      <div
                        style={{
                          fontSize: "12px",
                          color: "#64748b",
                          marginBottom: "12px",
                          lineHeight: 1.5,
                        }}
                      >
                        Upload one swatch to create a single preview right now.
                      </div>

                      <div style={{ marginBottom: "12px" }}>
                        <label
                          style={{
                            display: "block",
                            fontWeight: 600,
                            marginBottom: "6px",
                            fontSize: "13px",
                          }}
                        >
                          Upload swatch
                        </label>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => {
                            const file = e.target.files?.[0] || null;
                            setSwatchFile(file);
                            setSwatchUrl(null);
                            setSwatchSource(file ? "file" : null);
                            setGeneratedPreviewUrl(null);
                            setPreviewError(null);

                            if (file && !fabricName.trim()) {
                              const nameWithoutExtension = file.name.replace(/\.[^/.]+$/, "");
                              setFabricName(nameWithoutExtension);
                            }
                          }}
                        />

                        {swatchSource === "file" && swatchFile && (
                          <p style={{ marginTop: "8px", fontSize: "13px", color: "#166534", fontWeight: 600 }}>
                            ✓ {swatchFile.name}
                          </p>
                        )}

                        {!swatchSource && (
                          <p style={{ marginTop: "8px", fontSize: "13px", color: "#64748b" }}>
                            No swatch selected
                          </p>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={generatePreview}
                        disabled={previewLoading || (!swatchFile && !swatchUrl)}
                        title={(!swatchFile && !swatchUrl) ? "Pick or upload a swatch first" : undefined}
                        style={{
                          width: "100%",
                          padding: "12px 14px",
                          borderRadius: "8px",
                          border: "1px solid #111827",
                          background: "#111827",
                          color: "#ffffff",
                          cursor: (previewLoading || (!swatchFile && !swatchUrl)) ? "not-allowed" : "pointer",
                          opacity: (previewLoading || (!swatchFile && !swatchUrl)) ? 0.45 : 1,
                          minHeight: "44px",
                          fontWeight: 700,
                          fontSize: "14px",
                        }}
                      >
                        {previewLoading ? "Generating..." : (!swatchFile && !swatchUrl) ? "Pick a swatch first" : "Create single preview"}
                      </button>

                      {previewError && (
                        <p style={{ marginTop: "10px", color: "crimson", fontWeight: 600, fontSize: "13px" }}>
                          {previewError}
                        </p>
                      )}
                    </div>

                    {/* ========== BULK PREVIEW CARD ========== */}
                    <div
                      style={{
                        marginBottom: "16px",
                        padding: "16px",
                        borderRadius: "12px",
                        background: "#ffffff",
                        border: "1px solid #e5e7eb",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "14px",
                          fontWeight: 700,
                          color: "#0f172a",
                          marginBottom: "4px",
                        }}
                      >
                        Bulk preview
                      </div>
                      <div
                        style={{
                          fontSize: "12px",
                          color: "#64748b",
                          marginBottom: "12px",
                          lineHeight: 1.5,
                        }}
                      >
                        Queue multiple swatches — selected recent colours plus any new files you upload — and the app will generate them in batches of 10.
                      </div>

                      <div style={{ marginBottom: "12px" }}>
                        <label
                          style={{
                            display: "block",
                            fontWeight: 600,
                            marginBottom: "6px",
                            fontSize: "13px",
                          }}
                        >
                          Upload new swatches (optional)
                        </label>

                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={(e) => {
                            const files = Array.from(e.target.files || []).slice(0, 10);
                            setBulkSwatchFiles(files);
                            setBulkPreviewResults([]);
                            setBulkPreviewError(null);
                          }}
                        />

                        <p style={{ marginTop: "8px", fontSize: "13px", color: "#64748b" }}>
                          {bulkSwatchFiles.length > 0
                            ? `${bulkSwatchFiles.length} new ${bulkSwatchFiles.length === 1 ? "file" : "files"} ready`
                            : "No new files"}
                        </p>
                      </div>

                      {/* Queue summary */}
                      {(selectedRecentSwatchIds.length > 0 || bulkSwatchFiles.length > 0) && (
                        <div
                          style={{
                            marginBottom: "12px",
                            padding: "10px 12px",
                            borderRadius: "8px",
                            background: "#eff6ff",
                            border: "1px solid #bfdbfe",
                            fontSize: "13px",
                            color: "#1d4ed8",
                            fontWeight: 600,
                          }}
                        >
                          Queue: {selectedRecentSwatchIds.length + bulkSwatchFiles.length} total
                          {selectedRecentSwatchIds.length > 0 &&
                            ` (${selectedRecentSwatchIds.length} recent${bulkSwatchFiles.length > 0 ? `, ${bulkSwatchFiles.length} new` : ""})`}
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={generateBulkPreviews}
                        disabled={
                          bulkPreviewLoading ||
                          (bulkSwatchFiles.length === 0 && selectedRecentSwatchIds.length === 0)
                        }
                        style={{
                          width: "100%",
                          padding: "12px 14px",
                          borderRadius: "8px",
                          border: "1px solid #111827",
                          background:
                            bulkPreviewLoading ||
                            (bulkSwatchFiles.length === 0 && selectedRecentSwatchIds.length === 0)
                              ? "#9ca3af"
                              : "#111827",
                          color: "#ffffff",
                          cursor:
                            bulkPreviewLoading ||
                            (bulkSwatchFiles.length === 0 && selectedRecentSwatchIds.length === 0)
                              ? "not-allowed"
                              : "pointer",
                          opacity:
                            bulkPreviewLoading ||
                            (bulkSwatchFiles.length === 0 && selectedRecentSwatchIds.length === 0)
                              ? 0.8
                              : 1,
                          minHeight: "44px",
                          fontWeight: 700,
                          fontSize: "14px",
                        }}
                      >
                        {bulkPreviewLoading
                          ? "Generating previews..."
                          : "Generate bulk previews"}
                      </button>

                      {/* Progress / status */}
                      {bulkPreviewLoading && totalBatches > 0 && (
                        <div
                          style={{
                            marginTop: "10px",
                            fontSize: "13px",
                            fontWeight: 700,
                            color: "#1d4ed8",
                          }}
                        >
                          Generating batch {currentBatch} of {totalBatches}
                          {generatedCount > 0
                            ? ` • ${generatedCount} preview${generatedCount === 1 ? "" : "s"} completed`
                            : ""}
                        </div>
                      )}

                      {generationNotice && !bulkPreviewLoading && (
                        <div
                          style={{
                            marginTop: "10px",
                            fontSize: "13px",
                            color: "#0f766e",
                            fontWeight: 600,
                          }}
                        >
                          {generationNotice}
                        </div>
                      )}

                      {bulkPreviewError && (
                        <p style={{ marginTop: "10px", color: "crimson", fontWeight: 600, fontSize: "13px" }}>
                          {bulkPreviewError}
                        </p>
                      )}

                      <div
                        style={{
                          marginTop: "12px",
                          padding: "10px 12px",
                          borderRadius: "8px",
                          background: "#f8fafc",
                          border: "1px solid #e2e8f0",
                          fontSize: "12px",
                          color: "#475569",
                          lineHeight: 1.5,
                        }}
                      >
                        Previews are generated in batches of 10 for performance. Completed previews appear in the Preview Manager.
                      </div>
                    </div>
                  </div>
                )}
              </div>

                            {selectedBulkIndex !== null && bulkPreviewResults[selectedBulkIndex] && (
                <div
                  onClick={() => setSelectedBulkIndex(null)}
                  style={{
                    position: "fixed",
                    inset: 0,
                    background: "rgba(0,0,0,0.75)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    zIndex: 9999,
                    padding: "24px",
                  }}
                >
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      background: "#fff",
                      borderRadius: "12px",
                      padding: "16px",
                      maxWidth: "1000px",
                      width: "100%",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: "12px",
                      }}
                    >
                      <h3 style={{ margin: 0 }}>
                        {bulkPreviewResults[selectedBulkIndex].fileName}
                      </h3>

                      <button
                        type="button"
                        onClick={() => setSelectedBulkIndex(null)}
                        style={{
                          padding: "8px 12px",
                          borderRadius: "8px",
                          border: "1px solid #ccc",
                          cursor: "pointer",
                        }}
                      >
                        Close
                      </button>
                    </div>

                    <img
                      src={bulkPreviewResults[selectedBulkIndex].previewUrl}
                      alt={bulkPreviewResults[selectedBulkIndex].fileName}
                      style={{
                        width: "100%",
                        maxHeight: "75vh",
                        objectFit: "contain",
                        borderRadius: "8px",
                        display: "block",
                      }}
                    />

                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginTop: "12px",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedBulkIndex((prev) =>
                            prev === null
                              ? null
                              : prev === 0
                                ? bulkPreviewResults.length - 1
                                : prev - 1,
                          )
                        }
                      >
                        Previous
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          setSelectedBulkIndex((prev) =>
                            prev === null
                              ? null
                              : prev === bulkPreviewResults.length - 1
                                ? 0
                                : prev + 1,
                          )
                        }
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
    </div>
  );
}