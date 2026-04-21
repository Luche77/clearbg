"use client";
import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { motion, AnimatePresence } from "framer-motion";
import { ReactCompareSlider, ReactCompareSliderImage } from "react-compare-slider";
import { Upload, Sparkles, Download, ArrowRight, Zap, Shield, Layers } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

type Stage = "idle" | "uploading" | "processing" | "done";

export default function HomePage() {
  const [stage, setStage] = useState<Stage>("idle");
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const processImage = useCallback(async (file: File) => {
    setStage("uploading");
    setOriginalUrl(URL.createObjectURL(file));
    setProgress(20);

    const formData = new FormData();
    formData.append("file", file);

    try {
      setStage("processing");
      setProgress(50);

      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/v1/remove`,
        { method: "POST", body: formData }
      );

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Error al procesar");
      }

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
    accept: { "image/*": [".jpg", ".jpeg", ".png", ".webp"] },
    maxFiles: 1,
    maxSize: 25 * 1024 * 1024,
    onDropAccepted: ([file]) => processImage(file),
    onDropRejected: () => toast.error("Archivo muy grande o formato no compatible."),
  });

  const reset = () => {
    setStage("idle");
    setOriginalUrl(null);
    setResultUrl(null);
    setProgress(0);
  };

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Nav */}
      <nav className="fixed top-0 w-full z-50 border-b border-white/5 bg-[#0a0a0a]/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <span className="text-lg font-semibold tracking-tight">
            clear<span className="text-[#a78bfa]">bg</span>
          </span>
          <div className="flex items-center gap-6">
            <Link href="/pricing" className="text-sm text-white/50 hover:text-white transition-colors">
              Precios
            </Link>
            <Link href="/api-docs" className="text-sm text-white/50 hover:text-white transition-colors">
              API
            </Link>
            <Link href="/sign-in" className="text-sm px-4 py-1.5 rounded-full border border-white/10 hover:border-white/30 transition-colors">
              Iniciar sesión
            </Link>
            <Link href="/sign-up" className="text-sm px-4 py-1.5 rounded-full bg-[#a78bfa] text-black font-medium hover:bg-[#c4b5fd] transition-colors">
              Empezar gratis
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-40 pb-20 px-6 text-center max-w-4xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#a78bfa]/10 border border-[#a78bfa]/20 text-[#c4b5fd] text-xs font-medium mb-8">
            <Sparkles size={12} />
            Impulsado por BiRefNet — lo mejor del 2024
          </div>
          <h1 className="text-6xl font-semibold tracking-tight leading-[1.1] mb-6">
            Eliminá fondos
            <br />
            <span className="text-[#a78bfa]">con bordes perfectos</span>
          </h1>
          <p className="text-xl text-white/50 max-w-2xl mx-auto mb-12 leading-relaxed">
            La herramienta de eliminación de fondos más precisa disponible.
            Cada cabello, cada borde transparente — manejado con precisión.
          </p>
        </motion.div>

        {/* Upload / Result */}
        <AnimatePresence mode="wait">
          {stage === "idle" && (
            <motion.div key="upload" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }}>
              <div
                {...getRootProps()}
                className={`relative border-2 border-dashed rounded-2xl p-16 cursor-pointer transition-all duration-200 ${
                  isDragActive ? "border-[#a78bfa] bg-[#a78bfa]/5" : "border-white/10 hover:border-white/25 hover:bg-white/2"
                }`}
              >
                <input {...getInputProps()} />
                <div className="flex flex-col items-center gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
                    <Upload size={24} className="text-white/40" />
                  </div>
                  <div>
                    <p className="text-white/70 font-medium mb-1">
                      {isDragActive ? "Soltá la imagen acá" : "Arrastrá tu imagen acá"}
                    </p>
                    <p className="text-white/30 text-sm">o hacé click para buscar — JPEG, PNG, WebP hasta 25MB</p>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-[11px] text-white/25 bg-white/5 px-3 py-1 rounded-full">5 gratis por día</span>
                    <span className="text-[11px] text-white/25 bg-white/5 px-3 py-1 rounded-full">Sin cuenta</span>
                    <span className="text-[11px] text-white/25 bg-white/5 px-3 py-1 rounded-full">Resolución completa</span>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {(stage === "uploading" || stage === "processing") && (
            <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="relative rounded-2xl overflow-hidden border border-white/10 bg-white/2" style={{ height: 360 }}>
              {originalUrl && <img src={originalUrl} alt="Procesando" className="w-full h-full object-contain opacity-30" />}
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-6">
                <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                  className="w-12 h-12 border-2 border-[#a78bfa]/30 border-t-[#a78bfa] rounded-full" />
                <div className="text-center">
                  <p className="text-white/70 font-medium mb-1">
                    {stage === "uploading" ? "Subiendo..." : "Eliminando fondo..."}
                  </p>
                  <p className="text-white/30 text-sm">Analizando bordes con IA</p>
                </div>
                <div className="w-48 h-1 bg-white/10 rounded-full overflow-hidden">
                  <motion.div className="h-full bg-[#a78bfa] rounded-full" style={{ width: `${progress}%` }} transition={{ duration: 0.4 }} />
                </div>
              </div>
            </motion.div>
          )}

          {stage === "done" && originalUrl && resultUrl && (
            <motion.div key="result" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="space-y-6">
              <div className="rounded-2xl overflow-hidden border border-white/10" style={{ height: 420 }}>
                <ReactCompareSlider
                  itemOne={<ReactCompareSliderImage src={originalUrl} alt="Original" style={{ objectFit: "contain" }} />}
                  itemTwo={
                    <div className="w-full h-full" style={{
                      backgroundImage: `url("data:image/svg+xml,%3Csvg width='20' height='20' xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='10' height='10' fill='%23333'/%3E%3Crect x='10' y='10' width='10' height='10' fill='%23333'/%3E%3Crect x='10' y='0' width='10' height='10' fill='%23222'/%3E%3Crect x='0' y='10' width='10' height='10' fill='%23222'/%3E%3C/svg%3E")`,
                    }}>
                      <img src={resultUrl} alt="Resultado" className="w-full h-full object-contain" />
                    </div>
                  }
                  style={{ height: 420 }}
                />
              </div>
              <div className="flex items-center justify-center gap-4">
                <a href={resultUrl} download="clearbg-resultado.png"
                  className="flex items-center gap-2 px-6 py-3 bg-[#a78bfa] text-black font-medium rounded-full hover:bg-[#c4b5fd] transition-colors">
                  <Download size={16} />
                  Descargar PNG
                </a>
                <button onClick={reset}
                  className="px-6 py-3 border border-white/10 rounded-full text-white/60 hover:text-white hover:border-white/30 transition-colors text-sm">
                  Probar otra imagen
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {/* Features */}
      <section className="py-24 px-6 max-w-5xl mx-auto">
        <div className="grid grid-cols-3 gap-6">
          {[
            { icon: <Zap size={20} />, title: "Procesamiento instantáneo", desc: "Menos de 2 segundos por imagen. Hasta 50 imágenes a la vez en Pro." },
            { icon: <Sparkles size={20} />, title: "Bordes perfectos", desc: "Cabello, pelo, vidrio, humo — BiRefNet maneja cada borde con precisión al píxel." },
            { icon: <Layers size={20} />, title: "Resolución completa", desc: "Sin límites artificiales. Procesá tus imágenes originales en 4K u 8K." },
            { icon: <Shield size={20} />, title: "Privado y seguro", desc: "Imágenes eliminadas automáticamente tras 1 hora. Nunca usadas para entrenar IA." },
            { icon: <ArrowRight size={20} />, title: "API para desarrolladores", desc: "API REST simple. Integrá la eliminación de fondos en tu app en minutos." },
            { icon: <Upload size={20} />, title: "Fondos personalizados", desc: "Reemplazá el fondo con cualquier color, degradado o imagen propia." },
          ].map((f, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }} transition={{ delay: i * 0.08, duration: 0.5 }}
              className="p-6 rounded-2xl border border-white/5 bg-white/2 hover:bg-white/4 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-[#a78bfa]/10 text-[#a78bfa] flex items-center justify-center mb-4">
                {f.icon}
              </div>
              <h3 className="font-medium mb-2 text-white/90">{f.title}</h3>
              <p className="text-sm text-white/40 leading-relaxed">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>
    </main>
  );
}
