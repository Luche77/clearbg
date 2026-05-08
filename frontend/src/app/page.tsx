"use client";
import { useState, useCallback, useRef, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload, Sparkles, Download, Zap, Layers, Plus, Minus,
  RotateCcw, Image as ImageIcon, ZoomIn, ZoomOut,
  ArrowLeft, Maximize2, PenTool, Scissors,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { ReactCompareSlider, ReactCompareSliderImage } from "react-compare-slider";

type Stage = "idle" | "select" | "processing" | "done";
type Tool = "remove-bg" | "upscale" | "vectorize";
type BrushMode = "add" | "remove";
type BgMode = "transparent" | "color" | "gradient" | "image";
type Tab = "recortar" | "fondo" | "efectos";

const PRESET_GRADIENTS = [
  { label: "Cielo",     value: "linear-gradient(135deg,#667eea,#764ba2)" },
  { label: "Atardecer", value: "linear-gradient(135deg,#f093fb,#f5576c)" },
  { label: "Océano",    value: "linear-gradient(135deg,#4facfe,#00f2fe)" },
  { label: "Bosque",    value: "linear-gradient(135deg,#43e97b,#38f9d7)" },
  { label: "Fuego",     value: "linear-gradient(135deg,#fa709a,#fee140)" },
  { label: "Noche",     value: "linear-gradient(135deg,#0c0c0c,#1a1a2e)" },
  { label: "Aurora",    value: "linear-gradient(135deg,#a18cd1,#fbc2eb)" },
  { label: "Dorado",    value: "linear-gradient(135deg,#f6d365,#fda085)" },
];

const COLOR_PRESETS = [
  { label: "Blanco",      c: "#ffffff" },
  { label: "Crema",       c: "#fef9ef" },
  { label: "Gris claro",  c: "#f3f4f6" },
  { label: "Gris",        c: "#9ca3af" },
  { label: "Negro",       c: "#000000" },
  { label: "Azul claro",  c: "#e0f2fe" },
  { label: "Rojo",        c: "#ef4444" },
  { label: "Naranja",     c: "#f97316" },
  { label: "Amarillo",    c: "#eab308" },
  { label: "Verde",       c: "#22c55e" },
  { label: "Azul",        c: "#3b82f6" },
  { label: "Violeta",     c: "#8b5cf6" },
];

const TOOLS: { id: Tool; icon: React.ReactNode; title: string; desc: string; credits: string; soon?: boolean }[] = [
  {
    id: "remove-bg",
    icon: <Scissors size={28} />,
    title: "Eliminar fondo",
    desc: "Recorte preciso con IA — bordes perfectos en cabello y transparencias.",
    credits: "1 crédito",
  },
  {
    id: "upscale",
    icon: <Maximize2 size={28} />,
    title: "Mejorar a 4K",
    desc: "Amplía hasta 4× con IA, recuperando nitidez y detalle real.",
    credits: "4 créditos",
  },
  {
    id: "vectorize",
    icon: <PenTool size={28} />,
    title: "Vectorizar",
    desc: "Convierte logos e ilustraciones en SVG infinitamente escalable.",
    credits: "2 créditos",
    soon: true,
  },
];

// ── Portrait Mode Component ────────────────────────────────────────────────
function PortraitCanvas({ originalUrl, maskCanvas, blurAmount, subjectFilter, zoom }: {
  originalUrl: string;
  maskCanvas: HTMLCanvasElement | null;
  blurAmount: number;
  subjectFilter: string;
  zoom: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!maskCanvas || !originalUrl) return;
    const canvas = ref.current;
    if (!canvas) return;
    const W = maskCanvas.width, H = maskCanvas.height;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d")!;

    const orig = new Image();
    orig.crossOrigin = "anonymous";
    orig.onload = () => {
      ctx.clearRect(0, 0, W, H);
      ctx.filter = `blur(${blurAmount}px)`;
      ctx.drawImage(orig, -20, -20, W + 40, H + 40);
      ctx.filter = "none";
      ctx.save();
      const tmp = document.createElement("canvas");
      tmp.width = W; tmp.height = H;
      const tCtx = tmp.getContext("2d")!;
      tCtx.drawImage(orig, 0, 0, W, H);
      tCtx.globalCompositeOperation = "destination-in";
      tCtx.drawImage(maskCanvas, 0, 0);
      ctx.drawImage(tmp, 0, 0);
      ctx.restore();
    };
    orig.src = originalUrl;
  }, [originalUrl, maskCanvas, blurAmount]);

  return (
    <canvas
      ref={ref}
      className="max-w-full max-h-[520px] block relative z-10"
      style={{ transform: `scale(${zoom / 100})`, transformOrigin: "center", filter: subjectFilter || "none" }}
    />
  );
}

export default function HomePage() {
  const [stage, setStage] = useState<Stage>("idle");
  const [currentTool, setCurrentTool] = useState<Tool>("remove-bg");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [activeTab, setActiveTab] = useState<Tab>("recortar");
  const [zoom, setZoom] = useState(100);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const originalImgRef = useRef<HTMLImageElement | null>(null);
  const [canvasReady, setCanvasReady] = useState(false);

  const [brushMode, setBrushMode] = useState<BrushMode>("remove");
  const [brushSize, setBrushSize] = useState(20);
  const [isDrawing, setIsDrawing] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);

  const [bgMode, setBgMode] = useState<BgMode>("transparent");
  const [bgColor, setBgColor] = useState("#ffffff");
  const [bgGradient, setBgGradient] = useState(PRESET_GRADIENTS[0].value);
  const [bgImageUrl, setBgImageUrl] = useState<string | null>(null);
  const bgFileRef = useRef<HTMLInputElement>(null);
  const bgImgRef = useRef<HTMLImageElement | null>(null);

  const [blurBg, setBlurBg] = useState(false);
  const [blurAmount, setBlurAmount] = useState(8);
  const [shadow, setShadow] = useState(false);
  const [shadowOpacity, setShadowOpacity] = useState(40);
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [saturation, setSaturation] = useState(100);

  useEffect(() => {
    if (!bgImageUrl) return;
    const img = new Image();
    img.onload = () => { bgImgRef.current = img; };
    img.src = bgImageUrl;
  }, [bgImageUrl]);

  const initCanvas = useCallback(() => {
    if (!resultUrl) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    setCanvasReady(false);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      const ov = overlayRef.current;
      if (ov) { ov.width = img.naturalWidth; ov.height = img.naturalHeight; }
      setCanvasReady(true);
    };
    img.src = resultUrl;
    if (originalUrl) {
      const orig = new Image();
      orig.crossOrigin = "anonymous";
      orig.onload = () => { originalImgRef.current = orig; };
      orig.src = originalUrl;
    }
  }, [resultUrl, originalUrl]);

  useEffect(() => {
    if (stage !== "done" || currentTool !== "remove-bg") return;
    let attempts = 0;
    const tryInit = () => {
      if (canvasRef.current) { initCanvas(); }
      else if (attempts < 20) { attempts++; setTimeout(tryInit, 100); }
    };
    setTimeout(tryInit, 50);
  }, [stage, currentTool, initCanvas]);

  // ── File drop → go to tool selector ──────────────────────────────────────
  const handleFileDrop = useCallback((file: File) => {
    setSelectedFile(file);
    setOriginalUrl(URL.createObjectURL(file));
    setStage("select");
  }, []);

  // ── Tool selected → start processing ─────────────────────────────────────
  const handleToolSelect = useCallback((tool: Tool) => {
    if (!selectedFile) return;
    setCurrentTool(tool);
    if (tool === "remove-bg") removeBg(selectedFile);
    else if (tool === "upscale") upscaleImage(selectedFile);
  }, [selectedFile]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Remove background ─────────────────────────────────────────────────────
  const removeBg = useCallback(async (file: File) => {
    setStage("processing");
    setCanvasReady(false);
    setShowOriginal(false);
    setZoom(100);
    setBlurBg(false); setShadow(false);
    setBrightness(100); setContrast(100); setSaturation(100);
    setBgMode("transparent");
    setProgress(20);
    const formData = new FormData();
    formData.append("file", file);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    try {
      setProgress(50);
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/remove`, { method: "POST", body: formData, signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) throw new Error((await res.json()).detail || "Error al procesar");
      setProgress(90);
      const blob = await res.blob();
      setResultUrl(URL.createObjectURL(blob));
      setProgress(100);
      setStage("done");
    } catch (e: any) {
      clearTimeout(timeout);
      const msg = e.name === "AbortError"
        ? "Tiempo de espera agotado. Verificá que el backend esté corriendo."
        : (e.message?.includes("fetch") ? "No se pudo conectar al servidor. Verificá la URL del backend." : e.message || "Algo salió mal");
      toast.error(msg);
      setStage("select");
      setProgress(0);
    }
  }, []);

  // ── Upscale to 4K ─────────────────────────────────────────────────────────
  const upscaleImage = useCallback(async (file: File) => {
    setStage("processing");
    setProgress(15);
    const formData = new FormData();
    formData.append("file", file);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    try {
      setProgress(40);
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/upscale`, { method: "POST", body: formData, signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) throw new Error((await res.json()).detail || "Error al procesar");
      setProgress(90);
      const blob = await res.blob();
      setResultUrl(URL.createObjectURL(blob));
      setProgress(100);
      setStage("done");
    } catch (e: any) {
      clearTimeout(timeout);
      const msg = e.name === "AbortError"
        ? "Tiempo de espera agotado (2 min). El modelo tarda más de lo esperado."
        : (e.message?.includes("fetch") ? "No se pudo conectar al servidor. Verificá que el backend esté corriendo." : e.message || "Algo salió mal");
      toast.error(msg);
      setStage("select");
      setProgress(0);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { "image/*": [".jpg", ".jpeg", ".png", ".webp"] },
    maxFiles: 1, maxSize: 25 * 1024 * 1024,
    onDropAccepted: ([file]) => handleFileDrop(file),
    onDropRejected: () => toast.error("Archivo muy grande o formato no compatible."),
  });

  // ── Canvas painting ───────────────────────────────────────────────────────
  const getPos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  };

  const drawCursor = (x: number, y: number) => {
    const ov = overlayRef.current;
    if (!ov) return;
    const ctx = ov.getContext("2d")!;
    ctx.clearRect(0, 0, ov.width, ov.height);
    ctx.beginPath(); ctx.arc(x, y, brushSize, 0, Math.PI * 2);
    const color = brushMode === "remove" ? "255,60,60" : "60,220,100";
    ctx.strokeStyle = `rgba(${color},0.9)`;
    ctx.lineWidth = Math.max(1.5, brushSize * 0.06);
    ctx.stroke();
    ctx.fillStyle = `rgba(${color},0.12)`;
    ctx.fill();
  };

  const clearCursor = () => {
    const ov = overlayRef.current;
    if (ov) ov.getContext("2d")!.clearRect(0, 0, ov.width, ov.height);
  };

  const paint = useCallback((x: number, y: number) => {
    const c = canvasRef.current!;
    const ctx = c.getContext("2d")!;
    ctx.save();
    if (brushMode === "remove") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath(); ctx.arc(x, y, brushSize, 0, Math.PI * 2); ctx.fill();
    } else if (originalImgRef.current) {
      ctx.globalCompositeOperation = "source-over";
      ctx.beginPath(); ctx.arc(x, y, brushSize, 0, Math.PI * 2); ctx.clip();
      ctx.drawImage(originalImgRef.current, 0, 0, c.width, c.height);
    }
    ctx.restore();
  }, [brushMode, brushSize]);

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => { setIsDrawing(true); const p = getPos(e); paint(p.x, p.y); drawCursor(p.x, p.y); };
  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => { const p = getPos(e); drawCursor(p.x, p.y); if (isDrawing) paint(p.x, p.y); };
  const onMouseUp = () => setIsDrawing(false);
  const onMouseLeave = () => { setIsDrawing(false); clearCursor(); };

  const subjectFilter = [
    brightness !== 100 ? `brightness(${brightness}%)` : "",
    contrast !== 100 ? `contrast(${contrast}%)` : "",
    saturation !== 100 ? `saturate(${saturation}%)` : "",
    shadow ? `drop-shadow(0 ${Math.round(shadowOpacity / 4)}px ${Math.round(shadowOpacity / 2)}px rgba(0,0,0,${shadowOpacity / 100}))` : "",
  ].filter(Boolean).join(" ");

  const handleDownload = () => {
    if (currentTool === "upscale" && resultUrl) {
      const a = document.createElement("a");
      a.href = resultUrl;
      a.download = "clearbg-4k.jpg";
      a.click();
      return;
    }
    const src = canvasRef.current;
    if (!src || !canvasReady) return;
    const W = src.width, H = src.height;
    const off = document.createElement("canvas");
    off.width = W; off.height = H;
    const ctx = off.getContext("2d")!;
    if (bgMode === "color") { ctx.fillStyle = bgColor; ctx.fillRect(0, 0, W, H); }
    else if (bgMode === "gradient") {
      const m = bgGradient.match(/#[0-9a-f]{3,8}/gi);
      if (m?.length >= 2) { const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, m[0]); g.addColorStop(1, m[1]); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
    } else if (bgMode === "image" && bgImgRef.current) {
      const bw = bgImgRef.current.naturalWidth, bh = bgImgRef.current.naturalHeight;
      const s = Math.max(W / bw, H / bh);
      ctx.drawImage(bgImgRef.current, (W - bw * s) / 2, (H - bh * s) / 2, bw * s, bh * s);
    }
    if (blurBg && originalImgRef.current) {
      ctx.filter = `blur(${blurAmount}px)`;
      ctx.drawImage(originalImgRef.current, -20, -20, W + 40, H + 40);
      ctx.filter = "none";
      if (src) {
        const tmp = document.createElement("canvas"); tmp.width = W; tmp.height = H;
        const tCtx = tmp.getContext("2d")!;
        tCtx.drawImage(originalImgRef.current, 0, 0, W, H);
        tCtx.globalCompositeOperation = "destination-in"; tCtx.drawImage(src, 0, 0);
        ctx.drawImage(tmp, 0, 0);
      }
      const a2 = document.createElement("a"); a2.href = off.toDataURL("image/jpeg", 0.95); a2.download = "clearbg-retrato.jpg"; a2.click();
      return;
    }
    if (shadow) { ctx.shadowColor = `rgba(0,0,0,${shadowOpacity / 100})`; ctx.shadowBlur = Math.round(shadowOpacity / 2); ctx.shadowOffsetY = Math.round(shadowOpacity / 4); }
    ctx.filter = [brightness !== 100 ? `brightness(${brightness}%)` : "", contrast !== 100 ? `contrast(${contrast}%)` : "", saturation !== 100 ? `saturate(${saturation}%)` : ""].filter(Boolean).join(" ") || "none";
    ctx.drawImage(src, 0, 0); ctx.filter = "none"; ctx.shadowColor = "transparent";
    const isPng = bgMode === "transparent" && !blurBg;
    const a = document.createElement("a"); a.href = off.toDataURL(isPng ? "image/png" : "image/jpeg", 0.95); a.download = `clearbg.${isPng ? "png" : "jpg"}`; a.click();
  };

  const reset = () => {
    setStage("idle"); setSelectedFile(null); setCurrentTool("remove-bg");
    setOriginalUrl(null); setResultUrl(null); setProgress(0);
    setCanvasReady(false); setShowOriginal(false); setZoom(100);
    setBlurBg(false); setShadow(false);
    setBrightness(100); setContrast(100); setSaturation(100);
    setBgMode("transparent"); setActiveTab("recortar");
  };

  const bgStyle = (): React.CSSProperties => {
    if (bgMode === "color") return { background: bgColor };
    if (bgMode === "gradient") return { background: bgGradient };
    return {};
  };

  const checker = `url("data:image/svg+xml,%3Csvg width='20' height='20' xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='10' height='10' fill='%23333'/%3E%3Crect x='10' y='10' width='10' height='10' fill='%23333'/%3E%3Crect x='10' y='0' width='10' height='10' fill='%23222'/%3E%3Crect x='0' y='10' width='10' height='10' fill='%23222'/%3E%3C/svg%3E")`;

  const processingMessages: Record<Tool, { title: string; sub: string }> = {
    "remove-bg": { title: "Eliminando fondo con IA...", sub: "BiRefNet analizando bordes en GPU" },
    "upscale":   { title: "Mejorando a 4K con Real-ESRGAN...", sub: "Amplificando detalle pixel a pixel" },
    "vectorize": { title: "Vectorizando imagen...", sub: "Trazando curvas bezier con IA" },
  };

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white">
      <nav className="fixed top-0 w-full z-50 border-b border-white/5 bg-[#0a0a0a]/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <span className="text-lg font-semibold tracking-tight">clear<span className="text-[#a78bfa]">bg</span></span>
          <div className="flex items-center gap-6">
            <Link href="/pricing" className="text-sm text-white/50 hover:text-white transition-colors">Precios</Link>
            <Link href="/api-docs" className="text-sm text-white/50 hover:text-white transition-colors">API</Link>
            <Link href="/sign-in" className="text-sm px-4 py-1.5 rounded-full border border-white/10 hover:border-white/30 transition-colors">Iniciar sesión</Link>
            <Link href="/sign-up" className="text-sm px-4 py-1.5 rounded-full bg-[#a78bfa] text-black font-medium hover:bg-[#c4b5fd] transition-colors">Empezar gratis</Link>
          </div>
        </div>
      </nav>

      <section className="pt-32 pb-20 px-6 max-w-6xl mx-auto">
        <AnimatePresence mode="wait">

          {/* ── IDLE ── */}
          {stage === "idle" && (
            <motion.div key="idle" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-center max-w-3xl mx-auto">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#a78bfa]/10 border border-[#a78bfa]/20 text-[#c4b5fd] text-xs font-medium mb-8">
                <Sparkles size={12} /> Suite de herramientas IA — Fondo, 4K y Vectorizado
              </div>
              <h1 className="text-6xl font-semibold tracking-tight leading-[1.1] mb-6">
                Editá tus imágenes<br /><span className="text-[#a78bfa]">con inteligencia artificial</span>
              </h1>
              <p className="text-xl text-white/50 max-w-2xl mx-auto mb-12 leading-relaxed">
                Eliminá fondos, mejorá a 4K y vectorizá logos — todo desde una sola plataforma.
              </p>
              <div {...getRootProps()} className={`border-2 border-dashed rounded-2xl p-16 cursor-pointer transition-all ${isDragActive ? "border-[#a78bfa] bg-[#a78bfa]/5" : "border-white/10 hover:border-white/25 hover:bg-white/[0.02]"}`}>
                <input {...getInputProps()} />
                <div className="flex flex-col items-center gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
                    <Upload size={24} className="text-white/40" />
                  </div>
                  <div>
                    <p className="text-white/70 font-medium mb-1">{isDragActive ? "Soltá la imagen acá" : "Arrastrá tu imagen acá"}</p>
                    <p className="text-white/30 text-sm">o hacé click para buscar — JPEG, PNG, WebP hasta 25MB</p>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-[11px] text-white/25 bg-white/5 px-3 py-1 rounded-full">5 gratis por día</span>
                    <span className="text-[11px] text-white/25 bg-white/5 px-3 py-1 rounded-full">Sin cuenta</span>
                    <span className="text-[11px] text-white/25 bg-white/5 px-3 py-1 rounded-full">Resolución completa</span>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4 mt-16">
                {[
                  { icon: <Scissors size={18} />, title: "Eliminar fondo", desc: "Cada cabello y borde transparente" },
                  { icon: <Maximize2 size={18} />, title: "Mejorar a 4K", desc: "Upscaling IA con Real-ESRGAN" },
                  { icon: <PenTool size={18} />, title: "Vectorizar", desc: "SVG limpio para logos e iconos" },
                ].map((f, i) => (
                  <div key={i} className="p-5 rounded-2xl border border-white/5 bg-white/[0.02] text-left">
                    <div className="w-9 h-9 rounded-xl bg-[#a78bfa]/10 text-[#a78bfa] flex items-center justify-center mb-3">{f.icon}</div>
                    <p className="font-medium text-sm mb-1">{f.title}</p>
                    <p className="text-xs text-white/40">{f.desc}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* ── SELECT TOOL ── */}
          {stage === "select" && (
            <motion.div key="select" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="max-w-3xl mx-auto">
              <button onClick={reset} className="flex items-center gap-2 text-sm text-white/40 hover:text-white transition-colors mb-8">
                <ArrowLeft size={15} /> Cambiar imagen
              </button>

              <div className="flex flex-col items-center gap-3 mb-10">
                {originalUrl && (
                  <div className="w-28 h-28 rounded-2xl overflow-hidden border border-white/10 bg-white/5">
                    <img src={originalUrl} alt="Preview" className="w-full h-full object-cover" />
                  </div>
                )}
                <h2 className="text-2xl font-semibold tracking-tight">¿Qué querés hacer?</h2>
                <p className="text-white/40 text-sm">Elegí la herramienta y procesamos en segundos</p>
              </div>

              <div className="grid grid-cols-3 gap-4">
                {TOOLS.map((tool) => (
                  <motion.button
                    key={tool.id}
                    whileHover={tool.soon ? {} : { scale: 1.02 }}
                    whileTap={tool.soon ? {} : { scale: 0.98 }}
                    onClick={() => !tool.soon && handleToolSelect(tool.id)}
                    className={`relative flex flex-col items-start gap-4 p-6 rounded-2xl border text-left transition-all
                      ${tool.soon
                        ? "border-white/5 bg-white/[0.02] opacity-50 cursor-not-allowed"
                        : "border-white/10 bg-white/[0.02] hover:border-[#a78bfa]/50 hover:bg-[#a78bfa]/5 cursor-pointer"
                      }`}
                  >
                    {tool.soon && (
                      <span className="absolute top-4 right-4 text-[10px] font-medium px-2 py-0.5 rounded-full bg-white/10 text-white/40">
                        Próximamente
                      </span>
                    )}
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${tool.soon ? "bg-white/5 text-white/30" : "bg-[#a78bfa]/10 text-[#a78bfa]"}`}>
                      {tool.icon}
                    </div>
                    <div>
                      <p className="font-semibold mb-1">{tool.title}</p>
                      <p className="text-xs text-white/40 leading-relaxed">{tool.desc}</p>
                    </div>
                    <span className={`text-[11px] px-2.5 py-1 rounded-full font-medium ${tool.soon ? "bg-white/5 text-white/25" : "bg-[#a78bfa]/10 text-[#a78bfa]"}`}>
                      {tool.credits}
                    </span>
                  </motion.button>
                ))}
              </div>
            </motion.div>
          )}

          {/* ── PROCESSING ── */}
          {stage === "processing" && (
            <motion.div key="proc" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="relative rounded-2xl overflow-hidden border border-white/10 bg-white/[0.02] max-w-2xl mx-auto" style={{ height: 420 }}>
              {originalUrl && <img src={originalUrl} alt="" className="w-full h-full object-contain opacity-20" />}
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-6">
                <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                  className="w-12 h-12 border-2 border-[#a78bfa]/30 border-t-[#a78bfa] rounded-full" />
                <div className="text-center">
                  <p className="text-white/70 font-medium mb-1">{processingMessages[currentTool].title}</p>
                  <p className="text-white/30 text-sm">{processingMessages[currentTool].sub}</p>
                </div>
                <div className="w-48 h-1 bg-white/10 rounded-full overflow-hidden">
                  <motion.div className="h-full bg-[#a78bfa] rounded-full" style={{ width: `${progress}%` }} transition={{ duration: 0.4 }} />
                </div>
              </div>
            </motion.div>
          )}

          {/* ── DONE: REMOVE-BG editor ── */}
          {stage === "done" && currentTool === "remove-bg" && resultUrl && (
            <motion.div key="done-remove" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex gap-1 bg-white/5 p-1 rounded-xl">
                  {(["recortar", "fondo", "efectos"] as Tab[]).map(t => (
                    <button key={t} onClick={() => setActiveTab(t)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all capitalize ${activeTab === t ? "bg-white/10 text-white" : "text-white/40 hover:text-white"}`}>
                      {t === "recortar" ? "✂️ Recortar" : t === "fondo" ? "🖼 Fondo" : "✨ Efectos"}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 bg-white/5 rounded-lg px-2 py-1">
                    <button onClick={() => setZoom(z => Math.max(25, z - 25))} className="text-white/40 hover:text-white p-1"><ZoomOut size={14} /></button>
                    <span className="text-xs text-white/50 w-10 text-center">{zoom}%</span>
                    <button onClick={() => setZoom(z => Math.min(300, z + 25))} className="text-white/40 hover:text-white p-1"><ZoomIn size={14} /></button>
                  </div>
                  <button onClick={reset} className="text-xs px-3 py-1.5 border border-white/10 rounded-lg text-white/40 hover:text-white transition-colors">Nueva</button>
                  <button onClick={handleDownload} disabled={!canvasReady}
                    className="text-xs px-4 py-1.5 bg-[#a78bfa] text-black font-medium rounded-lg hover:bg-[#c4b5fd] transition-colors flex items-center gap-1.5 disabled:opacity-50">
                    <Download size={11} /> Descargar {bgMode === "transparent" && !blurBg ? "PNG" : "JPG"}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-[1fr_300px] gap-6">
                <div className="rounded-2xl border border-white/10 overflow-auto" style={{ maxHeight: 580 }}>
                  <div className="relative flex items-center justify-center" style={{ minHeight: 400, backgroundImage: bgMode === "transparent" && !blurBg ? checker : undefined, ...bgStyle() }}>
                    {bgMode === "image" && bgImageUrl && (<img src={bgImageUrl} alt="" className="absolute inset-0 w-full h-full object-cover pointer-events-none" />)}
                    {blurBg && originalUrl && canvasReady && (<PortraitCanvas originalUrl={originalUrl} maskCanvas={canvasRef.current} blurAmount={blurAmount} subjectFilter={subjectFilter} zoom={zoom} />)}
                    {showOriginal && originalUrl ? (
                      <img src={originalUrl} alt="Original" className="relative z-10 max-w-full max-h-[520px] object-contain pointer-events-none" style={{ transform: `scale(${zoom / 100})`, transformOrigin: "center" }} />
                    ) : (
                      <div className="relative" style={{ transform: `scale(${zoom / 100})`, transformOrigin: "center", display: blurBg ? "none" : "block" }}>
                        {!canvasReady && (<div className="absolute inset-0 flex items-center justify-center z-20"><div className="w-8 h-8 border-2 border-[#a78bfa]/30 border-t-[#a78bfa] rounded-full animate-spin" /></div>)}
                        <canvas ref={canvasRef} className="max-w-full max-h-[520px] block"
                          style={{ cursor: activeTab === "recortar" ? "none" : "default", filter: subjectFilter || "none", opacity: canvasReady ? 1 : 0 }}
                          onMouseDown={activeTab === "recortar" ? onMouseDown : undefined}
                          onMouseMove={activeTab === "recortar" ? onMouseMove : undefined}
                          onMouseUp={activeTab === "recortar" ? onMouseUp : undefined}
                          onMouseLeave={activeTab === "recortar" ? onMouseLeave : undefined}
                        />
                        <canvas ref={overlayRef} className="absolute inset-0 pointer-events-none" style={{ width: "100%", height: "100%" }} />
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-4 overflow-y-auto" style={{ maxHeight: 580 }}>
                  {activeTab === "recortar" && (
                    <div className="space-y-4">
                      <p className="text-xs text-white/40">Pintá sobre la imagen para corregir el recorte.</p>
                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => setBrushMode("remove")} className={`flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium border transition-all ${brushMode === "remove" ? "bg-red-500/15 border-red-500/40 text-red-400" : "border-white/8 text-white/40 hover:text-white"}`}><Minus size={14} /> Borrar</button>
                        <button onClick={() => setBrushMode("add")} className={`flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium border transition-all ${brushMode === "add" ? "bg-green-500/15 border-green-500/40 text-green-400" : "border-white/8 text-white/40 hover:text-white"}`}><Plus size={14} /> Restaurar</button>
                      </div>
                      <div>
                        <div className="flex justify-between text-xs text-white/40 mb-2"><span>Tamaño del pincel</span><span>{brushSize}px</span></div>
                        <input type="range" min={3} max={120} step={1} value={brushSize} onChange={e => setBrushSize(Number(e.target.value))} className="w-full accent-[#a78bfa]" />
                        <div className="flex justify-between text-[10px] text-white/20 mt-1"><span>Fino</span><span>Grueso</span></div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <button onMouseDown={() => setShowOriginal(true)} onMouseUp={() => setShowOriginal(false)} onMouseLeave={() => setShowOriginal(false)}
                          className={`py-2 border rounded-xl text-xs transition-colors select-none ${showOriginal ? "border-white/30 text-white bg-white/8" : "border-white/10 text-white/40 hover:text-white/70"}`}>
                          👁 Ver original
                        </button>
                        <button onClick={initCanvas} className="py-2 border border-white/10 rounded-xl text-xs text-white/40 hover:text-white/70 transition-colors flex items-center justify-center gap-1"><RotateCcw size={11} /> Resetear</button>
                      </div>
                    </div>
                  )}

                  {activeTab === "fondo" && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-2">
                        {([["transparent", "Sin fondo"], ["color", "Color"], ["gradient", "Degradado"], ["image", "Imagen"]] as [BgMode, string][]).map(([m, l]) => (
                          <button key={m} onClick={() => setBgMode(m)} className={`py-2.5 rounded-xl text-xs font-medium border transition-all ${bgMode === m ? "bg-[#a78bfa]/15 border-[#a78bfa]/40 text-[#a78bfa]" : "border-white/8 text-white/40 hover:text-white hover:border-white/15"}`}>{l}</button>
                        ))}
                      </div>
                      {bgMode === "color" && (
                        <div className="space-y-3">
                          <div className="grid grid-cols-6 gap-2">
                            {COLOR_PRESETS.map(({ c, label }) => (
                              <button key={c} onClick={() => setBgColor(c)} title={label} style={{ background: c }} className={`w-9 h-9 rounded-lg border-2 transition-all ${bgColor === c ? "border-[#a78bfa] scale-110" : "border-white/10 hover:scale-105"}`} />
                            ))}
                          </div>
                          <div className="flex items-center gap-3 pt-2 border-t border-white/8">
                            <input type="color" value={bgColor} onChange={e => setBgColor(e.target.value)} className="w-10 h-10 rounded-lg border border-white/10 cursor-pointer bg-transparent" />
                            <span className="text-xs font-mono text-white/40">{bgColor.toUpperCase()}</span>
                          </div>
                        </div>
                      )}
                      {bgMode === "gradient" && (
                        <div className="grid grid-cols-2 gap-2">
                          {PRESET_GRADIENTS.map(g => (
                            <button key={g.value} onClick={() => setBgGradient(g.value)} className={`h-14 rounded-xl overflow-hidden border-2 transition-all flex items-center justify-center ${bgGradient === g.value ? "border-[#a78bfa]" : "border-transparent hover:border-white/20"}`} style={{ background: g.value }}>
                              <span className="text-[11px] font-medium text-white drop-shadow">{g.label}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {bgMode === "image" && (
                        <>
                          <input ref={bgFileRef} type="file" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) setBgImageUrl(URL.createObjectURL(f)); }} className="hidden" />
                          <button onClick={() => bgFileRef.current?.click()} className="w-full py-3 border border-dashed border-white/15 rounded-xl text-sm text-white/40 hover:text-white/70 hover:border-white/30 transition-colors flex items-center justify-center gap-2">
                            <ImageIcon size={15} /> {bgImageUrl ? "Cambiar imagen" : "Subir imagen de fondo"}
                          </button>
                          {bgImageUrl && <div className="h-20 rounded-lg overflow-hidden border border-white/10"><img src={bgImageUrl} alt="" className="w-full h-full object-cover" /></div>}
                        </>
                      )}
                    </div>
                  )}

                  {activeTab === "efectos" && (
                    <div className="space-y-4">
                      <div className="p-4 bg-white/3 border border-white/8 rounded-xl space-y-3">
                        <div className="flex items-center justify-between">
                          <div><p className="text-sm font-medium">Modo retrato</p><p className="text-xs text-white/40 mt-0.5">Fondo difuminado, sujeto nítido</p></div>
                          <button onClick={() => setBlurBg(v => !v)} className={`w-11 h-6 rounded-full relative transition-colors ${blurBg ? "bg-[#a78bfa]" : "bg-white/15"}`}>
                            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${blurBg ? "left-6" : "left-1"}`} />
                          </button>
                        </div>
                        {blurBg && (
                          <div className="space-y-2">
                            <div className="flex justify-between text-xs text-white/40 mb-1"><span>Intensidad del desenfoque</span><span>{blurAmount}px</span></div>
                            <input type="range" min={2} max={25} step={1} value={blurAmount} onChange={e => setBlurAmount(Number(e.target.value))} className="w-full accent-[#a78bfa]" />
                          </div>
                        )}
                      </div>
                      <div className="p-4 bg-white/3 border border-white/8 rounded-xl space-y-3">
                        <div className="flex items-center justify-between">
                          <div><p className="text-sm font-medium">Sombra</p><p className="text-xs text-white/40 mt-0.5">Agrega profundidad al sujeto</p></div>
                          <button onClick={() => setShadow(v => !v)} className={`w-11 h-6 rounded-full relative transition-colors ${shadow ? "bg-[#a78bfa]" : "bg-white/15"}`}>
                            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${shadow ? "left-6" : "left-1"}`} />
                          </button>
                        </div>
                        {shadow && (
                          <div>
                            <div className="flex justify-between text-xs text-white/40 mb-1"><span>Opacidad</span><span>{shadowOpacity}%</span></div>
                            <input type="range" min={10} max={90} step={5} value={shadowOpacity} onChange={e => setShadowOpacity(Number(e.target.value))} className="w-full accent-[#a78bfa]" />
                          </div>
                        )}
                      </div>
                      <div className="p-4 bg-white/3 border border-white/8 rounded-xl space-y-4">
                        <p className="text-sm font-medium">Ajustes de imagen</p>
                        {[{ label: "Brillo", val: brightness, set: setBrightness }, { label: "Contraste", val: contrast, set: setContrast }, { label: "Saturación", val: saturation, set: setSaturation }].map(a => (
                          <div key={a.label}>
                            <div className="flex justify-between text-xs text-white/40 mb-1"><span>{a.label}</span><span>{a.val}%</span></div>
                            <input type="range" min={50} max={200} step={5} value={a.val} onChange={e => a.set(Number(e.target.value))} className="w-full accent-[#a78bfa]" />
                          </div>
                        ))}
                        <button onClick={() => { setBrightness(100); setContrast(100); setSaturation(100); }} className="w-full py-2 border border-white/10 rounded-lg text-xs text-white/40 hover:text-white/70 transition-colors">Resetear ajustes</button>
                      </div>
                    </div>
                  )}

                  <div className="pt-2 border-t border-white/8">
                    <button onClick={handleDownload} disabled={!canvasReady}
                      className="w-full py-3 bg-[#a78bfa] text-black font-medium rounded-xl hover:bg-[#c4b5fd] transition-colors flex items-center justify-center gap-2 text-sm disabled:opacity-50">
                      <Download size={15} /> Descargar {bgMode === "transparent" && !blurBg ? "PNG" : "JPG"}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── DONE: UPSCALE before/after ── */}
          {stage === "done" && currentTool === "upscale" && resultUrl && originalUrl && (
            <motion.div key="done-upscale" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-4xl mx-auto">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-[#a78bfa]/10 border border-[#a78bfa]/20 rounded-full">
                    <Maximize2 size={13} className="text-[#a78bfa]" />
                    <span className="text-xs text-[#c4b5fd] font-medium">Mejorado a 4K</span>
                  </div>
                  <p className="text-xs text-white/30">Deslizá para comparar antes / después</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => { setStage("select"); setResultUrl(null); setProgress(0); }} className="text-xs px-3 py-1.5 border border-white/10 rounded-lg text-white/40 hover:text-white transition-colors">
                    Cambiar herramienta
                  </button>
                  <button onClick={reset} className="text-xs px-3 py-1.5 border border-white/10 rounded-lg text-white/40 hover:text-white transition-colors">Nueva imagen</button>
                  <button onClick={handleDownload} className="text-xs px-4 py-1.5 bg-[#a78bfa] text-black font-medium rounded-lg hover:bg-[#c4b5fd] transition-colors flex items-center gap-1.5">
                    <Download size={11} /> Descargar 4K
                  </button>
                </div>
              </div>

              <div className="rounded-2xl overflow-hidden border border-white/10" style={{ maxHeight: 600 }}>
                <ReactCompareSlider
                  itemOne={
                    <div className="relative w-full h-full">
                      <ReactCompareSliderImage src={originalUrl} alt="Original" style={{ objectFit: "contain" }} />
                      <div className="absolute bottom-4 left-4 px-3 py-1 rounded-full bg-black/60 backdrop-blur text-xs text-white/70 font-medium">Original</div>
                    </div>
                  }
                  itemTwo={
                    <div className="relative w-full h-full">
                      <ReactCompareSliderImage src={resultUrl} alt="4K" style={{ objectFit: "contain" }} />
                      <div className="absolute bottom-4 right-4 px-3 py-1 rounded-full bg-[#a78bfa]/80 backdrop-blur text-xs text-black font-semibold">4K mejorado</div>
                    </div>
                  }
                  style={{ height: 560, background: "#111" }}
                />
              </div>

              <div className="mt-4 grid grid-cols-3 gap-3">
                {[
                  { label: "Resolución aumentada", value: "4×" },
                  { label: "Calidad de salida", value: "JPEG 95%" },
                  { label: "Motor IA", value: "Real-ESRGAN" },
                ].map(s => (
                  <div key={s.label} className="p-4 rounded-xl border border-white/5 bg-white/[0.02] text-center">
                    <p className="text-lg font-semibold text-[#a78bfa]">{s.value}</p>
                    <p className="text-xs text-white/40 mt-1">{s.label}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </section>
    </main>
  );
}
