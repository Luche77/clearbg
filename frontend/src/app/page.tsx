"use client";
import { useState, useCallback, useRef, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, Sparkles, Download, Zap, Layers, Plus, Minus, RotateCcw, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

type Stage = "idle" | "processing" | "done";
type BrushMode = "add" | "remove";
type BgMode = "transparent" | "color" | "gradient" | "image";

const PRESET_COLORS = ["#ffffff","#000000","#f3f4f6","#1e1e2e","#ef4444","#f97316","#eab308","#22c55e","#3b82f6","#8b5cf6","#ec4899","#14b8a6"];
const PRESET_GRADIENTS = [
  { label: "Cielo",     value: "linear-gradient(135deg,#667eea,#764ba2)" },
  { label: "Atardecer", value: "linear-gradient(135deg,#f093fb,#f5576c)" },
  { label: "Océano",    value: "linear-gradient(135deg,#4facfe,#00f2fe)" },
  { label: "Bosque",    value: "linear-gradient(135deg,#43e97b,#38f9d7)" },
  { label: "Fuego",     value: "linear-gradient(135deg,#fa709a,#fee140)" },
  { label: "Noche",     value: "linear-gradient(135deg,#0c0c0c,#1a1a2e)" },
];

export default function HomePage() {
  const [stage, setStage] = useState<Stage>("idle");
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [editMode, setEditMode] = useState(false);

  // Editor
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [brushMode, setBrushMode] = useState<BrushMode>("remove");
  const [brushSize, setBrushSize] = useState(20);
  const [isDrawing, setIsDrawing] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const originalImgRef = useRef<HTMLImageElement | null>(null);

  // Background
  const [bgMode, setBgMode] = useState<BgMode>("transparent");
  const [bgColor, setBgColor] = useState("#ffffff");
  const [bgGradient, setBgGradient] = useState(PRESET_GRADIENTS[0].value);
  const [bgImageUrl, setBgImageUrl] = useState<string | null>(null);
  const bgFileRef = useRef<HTMLInputElement>(null);

  const initCanvas = useCallback(() => {
    if (!resultUrl) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      // Also load original
      if (originalUrl) {
        const orig = new Image();
        orig.crossOrigin = "anonymous";
        orig.onload = () => { originalImgRef.current = orig; };
        orig.src = originalUrl;
      }
    };
    img.src = resultUrl;
  }, [resultUrl, originalUrl]);

  useEffect(() => {
    if (editMode) {
      setTimeout(initCanvas, 50);
    }
  }, [editMode, initCanvas]);

  const processImage = useCallback(async (file: File) => {
    setStage("processing");
    setEditMode(false);
    setOriginalUrl(URL.createObjectURL(file));
    setProgress(20);
    const formData = new FormData();
    formData.append("file", file);
    try {
      setProgress(50);
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/remove`, { method: "POST", body: formData });
      if (!res.ok) throw new Error((await res.json()).detail || "Error al procesar");
      setProgress(90);
      const blob = await res.blob();
      setResultUrl(URL.createObjectURL(blob));
      setProgress(100);
      setStage("done");
    } catch (e: any) {
      toast.error(e.message || "Algo salió mal");
      setStage("idle");
      setProgress(0);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { "image/*": [".jpg",".jpeg",".png",".webp"] },
    maxFiles: 1,
    maxSize: 25 * 1024 * 1024,
    onDropAccepted: ([file]) => processImage(file),
    onDropRejected: () => toast.error("Archivo muy grande o formato no compatible."),
  });

  const getCanvasPos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const paint = useCallback((x: number, y: number) => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    ctx.save();
    if (brushMode === "remove") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath();
      ctx.arc(x, y, brushSize, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,1)";
      ctx.fill();
    } else if (originalImgRef.current) {
      ctx.globalCompositeOperation = "source-over";
      ctx.beginPath();
      ctx.arc(x, y, brushSize, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(originalImgRef.current, 0, 0, canvas.width, canvas.height);
    }
    ctx.restore();
  }, [brushMode, brushSize]);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => { setIsDrawing(true); const p = getCanvasPos(e); paint(p.x, p.y); };
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => { if (!isDrawing) return; const p = getCanvasPos(e); paint(p.x, p.y); };
  const handleMouseUp = () => setIsDrawing(false);

  const handleReset = () => { initCanvas(); };

  const getPreviewStyle = (): React.CSSProperties => {
    const checker = `url("data:image/svg+xml,%3Csvg width='20' height='20' xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='10' height='10' fill='%23333'/%3E%3Crect x='10' y='10' width='10' height='10' fill='%23333'/%3E%3Crect x='10' y='0' width='10' height='10' fill='%23222'/%3E%3Crect x='0' y='10' width='10' height='10' fill='%23222'/%3E%3C/svg%3E")`;
    if (bgMode === "color") return { background: bgColor };
    if (bgMode === "gradient") return { background: bgGradient };
    if (bgMode === "image" && bgImageUrl) return { backgroundImage: `url(${bgImageUrl})`, backgroundSize: "cover", backgroundPosition: "center" };
    return { backgroundImage: checker };
  };

  const handleDownload = () => {
    if (editMode) {
      const canvas = canvasRef.current!;
      const off = document.createElement("canvas");
      off.width = canvas.width; off.height = canvas.height;
      const ctx = off.getContext("2d")!;
      if (bgMode === "color") { ctx.fillStyle = bgColor; ctx.fillRect(0, 0, off.width, off.height); }
      else if (bgMode === "gradient") {
        const match = bgGradient.match(/#[0-9a-f]{3,8}/gi);
        if (match?.length >= 2) { const g = ctx.createLinearGradient(0,0,off.width,off.height); g.addColorStop(0,match[0]); g.addColorStop(1,match[1]); ctx.fillStyle=g; ctx.fillRect(0,0,off.width,off.height); }
      }
      ctx.drawImage(canvas, 0, 0);
      const a = document.createElement("a");
      a.href = off.toDataURL(bgMode === "transparent" ? "image/png" : "image/jpeg", 0.95);
      a.download = `clearbg-resultado.${bgMode === "transparent" ? "png" : "jpg"}`;
      a.click();
    } else {
      const a = document.createElement("a");
      a.href = resultUrl!;
      a.download = "clearbg-resultado.png";
      a.click();
    }
  };

  const reset = () => { setStage("idle"); setOriginalUrl(null); setResultUrl(null); setProgress(0); setBgMode("transparent"); setEditMode(false); };

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

          {stage === "idle" && (
            <motion.div key="idle" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-center max-w-3xl mx-auto">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#a78bfa]/10 border border-[#a78bfa]/20 text-[#c4b5fd] text-xs font-medium mb-8">
                <Sparkles size={12} /> Impulsado por BiRefNet con GPU — lo mejor del 2024
              </div>
              <h1 className="text-6xl font-semibold tracking-tight leading-[1.1] mb-6">
                Eliminá fondos<br /><span className="text-[#a78bfa]">con bordes perfectos</span>
              </h1>
              <p className="text-xl text-white/50 max-w-2xl mx-auto mb-12 leading-relaxed">
                La herramienta más precisa disponible. Cada cabello, cada borde transparente — manejado con precisión.
              </p>
              <div {...getRootProps()} className={`border-2 border-dashed rounded-2xl p-16 cursor-pointer transition-all ${isDragActive ? "border-[#a78bfa] bg-[#a78bfa]/5" : "border-white/10 hover:border-white/25 hover:bg-white/2"}`}>
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
                  { icon: <Zap size={18}/>, title: "GPU en la nube", desc: "2-3 segundos por imagen" },
                  { icon: <Sparkles size={18}/>, title: "Editor integrado", desc: "Corregí bordes con pincel" },
                  { icon: <Layers size={18}/>, title: "Fondos personalizados", desc: "Color, degradado o imagen" },
                ].map((f,i) => (
                  <div key={i} className="p-5 rounded-2xl border border-white/5 bg-white/2 text-left">
                    <div className="w-9 h-9 rounded-xl bg-[#a78bfa]/10 text-[#a78bfa] flex items-center justify-center mb-3">{f.icon}</div>
                    <p className="font-medium text-sm mb-1">{f.title}</p>
                    <p className="text-xs text-white/40">{f.desc}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {stage === "processing" && (
            <motion.div key="processing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="relative rounded-2xl overflow-hidden border border-white/10 bg-white/2 max-w-2xl mx-auto" style={{ height: 420 }}>
              {originalUrl && <img src={originalUrl} alt="" className="w-full h-full object-contain opacity-20" />}
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-6">
                <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                  className="w-12 h-12 border-2 border-[#a78bfa]/30 border-t-[#a78bfa] rounded-full" />
                <div className="text-center">
                  <p className="text-white/70 font-medium mb-1">Eliminando fondo con IA...</p>
                  <p className="text-white/30 text-sm">BiRefNet analizando bordes en GPU</p>
                </div>
                <div className="w-48 h-1 bg-white/10 rounded-full overflow-hidden">
                  <motion.div className="h-full bg-[#a78bfa] rounded-full" style={{ width: `${progress}%` }} transition={{ duration: 0.4 }} />
                </div>
              </div>
            </motion.div>
          )}

          {stage === "done" && resultUrl && (
            <motion.div key="done" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex gap-2">
                  <button onClick={() => setEditMode(false)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${!editMode ? "bg-white/10 text-white" : "text-white/40 hover:text-white"}`}>
                    Vista previa
                  </button>
                  <button onClick={() => setEditMode(true)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${editMode ? "bg-white/10 text-white" : "text-white/40 hover:text-white"}`}>
                    ✏️ Editar bordes
                  </button>
                </div>
                <div className="flex gap-2">
                  <button onClick={reset} className="text-xs px-3 py-1.5 border border-white/10 rounded-lg text-white/40 hover:text-white transition-colors flex items-center gap-1.5">
                    <RotateCcw size={11}/> Nueva imagen
                  </button>
                  <button onClick={handleDownload}
                    className="text-xs px-4 py-1.5 bg-[#a78bfa] text-black font-medium rounded-lg hover:bg-[#c4b5fd] transition-colors flex items-center gap-1.5">
                    <Download size={11}/> Descargar
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-[1fr_280px] gap-6">
                {/* Preview / Canvas */}
                <div>
                  <div className="rounded-2xl overflow-hidden border border-white/10 relative" style={getPreviewStyle()}>
                    {bgMode === "image" && bgImageUrl && (
                      <img src={bgImageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
                    )}
                    {!editMode ? (
                      <img src={resultUrl} alt="Resultado" className="w-full max-h-[500px] object-contain relative z-10 block" />
                    ) : showOriginal && originalUrl ? (
                      <img src={originalUrl} alt="Original" className="w-full max-h-[500px] object-contain relative z-10 block" />
                    ) : (
                      <canvas
                        ref={canvasRef}
                        className="w-full max-h-[500px] object-contain relative z-10 block"
                        style={{ cursor: brushMode === "remove" ? "crosshair" : "cell" }}
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                        onMouseLeave={handleMouseUp}
                      />
                    )}
                  </div>

                  {editMode && (
                    <div className="flex items-center gap-4 p-3 bg-white/3 border border-white/8 rounded-xl mt-3">
                      <div className="flex bg-white/5 rounded-lg p-1 gap-1">
                        <button onClick={() => setBrushMode("remove")}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${brushMode === "remove" ? "bg-red-500/20 text-red-400 border border-red-500/30" : "text-white/40 hover:text-white/70"}`}>
                          <Minus size={12}/> Quitar fondo
                        </button>
                        <button onClick={() => setBrushMode("add")}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${brushMode === "add" ? "bg-green-500/20 text-green-400 border border-green-500/30" : "text-white/40 hover:text-white/70"}`}>
                          <Plus size={12}/> Recuperar
                        </button>
                      </div>
                      <div className="flex items-center gap-2 flex-1">
                        <span className="text-xs text-white/30">Tamaño</span>
                        <input type="range" min={5} max={80} step={1} value={brushSize}
                          onChange={(e) => setBrushSize(Number(e.target.value))}
                          className="flex-1 accent-[#a78bfa]" />
                        <span className="text-xs text-white/50 w-6">{brushSize}</span>
                      </div>
                      <button onMouseDown={() => setShowOriginal(true)} onMouseUp={() => setShowOriginal(false)} onMouseLeave={() => setShowOriginal(false)}
                        className="text-xs px-3 py-1.5 border border-white/10 rounded-lg text-white/40 hover:text-white/70 transition-colors">
                        Ver original
                      </button>
                      <button onClick={handleReset}
                        className="text-xs px-3 py-1.5 border border-white/10 rounded-lg text-white/40 hover:text-white/70 transition-colors flex items-center gap-1">
                        <RotateCcw size={11}/> Resetear
                      </button>
                    </div>
                  )}
                </div>

                {/* Background panel */}
                <div className="space-y-4">
                  <p className="text-sm font-medium text-white/70">Fondo</p>
                  <div className="grid grid-cols-2 gap-2">
                    {([["transparent","Sin fondo"],["color","Color"],["gradient","Degradado"],["image","Imagen"]] as [BgMode,string][]).map(([m,label]) => (
                      <button key={m} onClick={() => setBgMode(m)}
                        className={`py-2 px-3 rounded-xl text-xs font-medium transition-all border ${bgMode === m ? "bg-[#a78bfa]/15 border-[#a78bfa]/40 text-[#a78bfa]" : "border-white/8 text-white/40 hover:text-white/70 hover:border-white/15"}`}>
                        {label}
                      </button>
                    ))}
                  </div>

                  {bgMode === "color" && (
                    <div>
                      <div className="grid grid-cols-6 gap-2 mb-3">
                        {PRESET_COLORS.map(c => (
                          <button key={c} onClick={() => setBgColor(c)} style={{ background: c }}
                            className={`w-8 h-8 rounded-lg border-2 transition-all ${bgColor === c ? "border-[#a78bfa] scale-110" : "border-transparent hover:scale-105"}`} />
                        ))}
                      </div>
                      <div className="flex items-center gap-3">
                        <input type="color" value={bgColor} onChange={e => setBgColor(e.target.value)}
                          className="w-10 h-10 rounded-lg border border-white/10 cursor-pointer bg-transparent" />
                        <span className="text-xs font-mono text-white/40">{bgColor.toUpperCase()}</span>
                      </div>
                    </div>
                  )}

                  {bgMode === "gradient" && (
                    <div className="grid grid-cols-2 gap-2">
                      {PRESET_GRADIENTS.map(g => (
                        <button key={g.value} onClick={() => setBgGradient(g.value)}
                          className={`relative h-12 rounded-xl overflow-hidden border-2 transition-all flex items-center justify-center ${bgGradient === g.value ? "border-[#a78bfa]" : "border-transparent hover:border-white/20"}`}
                          style={{ background: g.value }}>
                          <span className="text-[11px] font-medium text-white drop-shadow">{g.label}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {bgMode === "image" && (
                    <>
                      <input ref={bgFileRef} type="file" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if(f) setBgImageUrl(URL.createObjectURL(f)); }} className="hidden" />
                      <button onClick={() => bgFileRef.current?.click()}
                        className="w-full py-3 border border-dashed border-white/15 rounded-xl text-sm text-white/40 hover:text-white/70 hover:border-white/30 transition-colors flex items-center justify-center gap-2">
                        <ImageIcon size={15}/> {bgImageUrl ? "Cambiar imagen" : "Subir imagen de fondo"}
                      </button>
                    </>
                  )}

                  <div className="pt-2 border-t border-white/8">
                    <button onClick={handleDownload}
                      className="w-full py-3 bg-[#a78bfa] text-black font-medium rounded-xl hover:bg-[#c4b5fd] transition-colors flex items-center justify-center gap-2 text-sm">
                      <Download size={15}/> Descargar {bgMode === "transparent" ? "PNG" : "JPG"}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </section>
    </main>
  );
}
