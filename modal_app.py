"""
ClearBG — Backend en Modal con GPU A10G

Herramientas disponibles:
  - POST /api/v1/remove   → Eliminar fondo (BiRefNet dual-model, auto-detecta retrato/objeto)
  - POST /api/v1/upscale  → Mejorar a 4K (Real-ESRGAN x4plus)
  - GET  /health          → Estado del servicio
"""

import modal
import io

MODEL_CACHE = "/model-cache"
REALESRGAN_MODEL_PATH = f"{MODEL_CACHE}/realesrgan/RealESRGAN_x4plus.pth"
REALESRGAN_URL = "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth"


def download_birefnet_models():
    import os
    from transformers import AutoModelForImageSegmentation
    os.environ["HF_HOME"] = MODEL_CACHE
    print("Descargando BiRefNet-portrait...")
    AutoModelForImageSegmentation.from_pretrained(
        "ZhengPeng7/BiRefNet-portrait",
        trust_remote_code=True,
        cache_dir=MODEL_CACHE,
    )
    print("Descargando BiRefNet general...")
    AutoModelForImageSegmentation.from_pretrained(
        "ZhengPeng7/BiRefNet",
        trust_remote_code=True,
        cache_dir=MODEL_CACHE,
    )
    print("BiRefNet descargado OK")


def download_realesrgan_model():
    import os
    import urllib.request
    os.makedirs(f"{MODEL_CACHE}/realesrgan", exist_ok=True)
    if not os.path.exists(REALESRGAN_MODEL_PATH):
        print("Descargando Real-ESRGAN x4plus (~67MB)...")
        urllib.request.urlretrieve(REALESRGAN_URL, REALESRGAN_MODEL_PATH)
        print("Real-ESRGAN descargado OK")
    else:
        print("Real-ESRGAN ya en caché")


image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch==2.4.1",
        "torchvision==0.19.1",
        "transformers==4.45.2",
        "huggingface-hub==0.25.1",
        "Pillow==10.4.0",
        "numpy==1.26.4",
        "kornia==0.7.3",
        "einops==0.8.0",
        "timm==1.0.9",
        "basicsr==1.4.2",
        "realesrgan==0.3.0",
        "facexlib==0.3.0",
        "fastapi==0.115.0",
        "python-multipart==0.0.9",
        "uvicorn==0.30.6",
    )
    .run_function(
        download_birefnet_models,
        volumes={MODEL_CACHE: modal.Volume.from_name("clearbg-model-cache", create_if_missing=True)},
    )
    .run_function(
        download_realesrgan_model,
        volumes={MODEL_CACHE: modal.Volume.from_name("clearbg-model-cache", create_if_missing=True)},
    )
)

app = modal.App("clearbg-api")
model_cache = modal.Volume.from_name("clearbg-model-cache", create_if_missing=True)


@app.cls(
    image=image,
    gpu="A10G",
    memory=10240,
    volumes={MODEL_CACHE: model_cache},
    scaledown_window=300,
)
class ImageProcessor:

    @modal.enter()
    def load_models(self):
        import os
        import torch
        from transformers import AutoModelForImageSegmentation
        from basicsr.archs.rrdbnet_arch import RRDBNet
        from realesrgan import RealESRGANer

        os.environ["HF_HOME"] = MODEL_CACHE
        self.device = torch.device("cuda")

        # ── BiRefNet ──────────────────────────────────────────────────────
        print("📦 Cargando BiRefNet-portrait...")
        self.model_portrait = AutoModelForImageSegmentation.from_pretrained(
            "ZhengPeng7/BiRefNet-portrait",
            trust_remote_code=True,
            cache_dir=MODEL_CACHE,
        ).to(self.device).eval()

        print("📦 Cargando BiRefNet general...")
        self.model_general = AutoModelForImageSegmentation.from_pretrained(
            "ZhengPeng7/BiRefNet",
            trust_remote_code=True,
            cache_dir=MODEL_CACHE,
        ).to(self.device).eval()

        # ── Real-ESRGAN ───────────────────────────────────────────────────
        print("📦 Cargando Real-ESRGAN x4plus...")
        esrgan_model = RRDBNet(
            num_in_ch=3, num_out_ch=3,
            num_feat=64, num_block=23,
            num_grow_ch=32, scale=4,
        )
        self.upsampler = RealESRGANer(
            scale=4,
            model_path=REALESRGAN_MODEL_PATH,
            model=esrgan_model,
            tile=512,
            tile_pad=10,
            pre_pad=0,
            half=True,
            device=self.device,
        )

        print("✅ Todos los modelos listos en GPU A10G")

    # ── Background Removal ────────────────────────────────────────────────
    def _run_birefnet(self, model, image_rgb, orig_w, orig_h):
        import torch
        import numpy as np
        from PIL import Image
        from torchvision.transforms.functional import normalize

        resized = image_rgb.resize([1024, 1024], Image.BILINEAR)
        t = torch.tensor(np.array(resized), dtype=torch.float32).permute(2, 0, 1) / 255.0
        t = normalize(t, [0.485, 0.456, 0.406], [0.229, 0.224, 0.225]).unsqueeze(0).to(self.device)
        with torch.no_grad():
            result = model(t)
        pred = result[-1].sigmoid().cpu().squeeze().numpy()
        mask = Image.fromarray((pred * 255).astype(np.uint8), mode="L")
        return mask.resize((orig_w, orig_h), Image.LANCZOS)

    @modal.method()
    def remove_background(self, image_bytes: bytes) -> bytes:
        import numpy as np
        from PIL import Image, ImageOps, ImageFilter

        img = ImageOps.exif_transpose(Image.open(io.BytesIO(image_bytes)))
        original = img.convert("RGBA")
        orig_w, orig_h = original.size
        image_rgb = original.convert("RGB")

        mask_portrait = self._run_birefnet(self.model_portrait, image_rgb, orig_w, orig_h)
        coverage = (np.array(mask_portrait) > 128).sum() / (orig_w * orig_h)
        mask = (
            mask_portrait if 0.04 < coverage < 0.82
            else self._run_birefnet(self.model_general, image_rgb, orig_w, orig_h)
        )
        mask = mask.filter(ImageFilter.GaussianBlur(radius=0.5))

        result = original.copy()
        result.putalpha(mask)
        out = io.BytesIO()
        result.save(out, format="PNG", optimize=True)
        out.seek(0)
        return out.read()

    # ── Upscaling ─────────────────────────────────────────────────────────
    @modal.method()
    def upscale(self, image_bytes: bytes, scale: int = 4) -> bytes:
        import numpy as np
        from PIL import Image

        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        output, _ = self.upsampler.enhance(np.array(img), outscale=scale)
        result = Image.fromarray(output)

        max_dim = 3840
        if result.width > max_dim or result.height > max_dim:
            ratio = min(max_dim / result.width, max_dim / result.height)
            result = result.resize(
                (int(result.width * ratio), int(result.height * ratio)),
                Image.LANCZOS,
            )

        buf = io.BytesIO()
        result.save(buf, format="JPEG", quality=95, optimize=True)
        buf.seek(0)
        return buf.read()


# ── FastAPI ASGI app ──────────────────────────────────────────────────────────
@app.function(image=image)
@modal.asgi_app()
def api():
    from fastapi import FastAPI, UploadFile, File, HTTPException
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import Response
    import uuid

    web_app = FastAPI(title="ClearBG API", version="2.0.0")
    web_app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    processor = ImageProcessor()
    _allowed = {"image/jpeg", "image/png", "image/webp"}
    _max_bytes = 25 * 1024 * 1024

    def _validate(file: UploadFile, data: bytes):
        if file.content_type not in _allowed:
            raise HTTPException(status_code=415, detail="Formato no soportado. Usá JPEG, PNG o WebP.")
        if len(data) > _max_bytes:
            raise HTTPException(status_code=413, detail="Imagen demasiado grande. Máximo 25MB.")

    @web_app.get("/health")
    def health():
        return {
            "status": "ok",
            "models": ["BiRefNet-portrait", "BiRefNet", "Real-ESRGAN-x4plus"],
            "device": "GPU A10G",
        }

    @web_app.post("/api/v1/remove")
    async def remove_background(file: UploadFile = File(...)):
        data = await file.read()
        _validate(file, data)
        try:
            result = processor.remove_background.remote(data)
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
        return Response(
            content=result,
            media_type="image/png",
            headers={"Content-Disposition": f'attachment; filename="clearbg_{uuid.uuid4().hex[:8]}.png"'},
        )

    @web_app.post("/api/v1/upscale")
    async def upscale_image(file: UploadFile = File(...), scale: int = 4):
        if scale not in (2, 4):
            raise HTTPException(status_code=400, detail="Scale debe ser 2 o 4.")
        data = await file.read()
        _validate(file, data)
        try:
            result = processor.upscale.remote(data, scale)
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
        return Response(
            content=result,
            media_type="image/jpeg",
            headers={"Content-Disposition": f'attachment; filename="clearbg_4k_{uuid.uuid4().hex[:8]}.jpg"'},
        )

    return web_app
