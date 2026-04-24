"""
ClearBG — Backend en Modal con GPU A10G

Todo automático — el sistema detecta si es persona u objeto
y elige el mejor modelo sin que el usuario tenga que hacer nada.
"""

import modal
import io

# Pre-descargar modelos durante el build de la imagen
def download_models():
    import os
    from transformers import AutoModelForImageSegmentation
    os.environ["HF_HOME"] = "/model-cache"
    print("Descargando BiRefNet-portrait...")
    AutoModelForImageSegmentation.from_pretrained(
        "ZhengPeng7/BiRefNet-portrait",
        trust_remote_code=True,
        cache_dir="/model-cache",
    )
    print("Descargando BiRefNet general...")
    AutoModelForImageSegmentation.from_pretrained(
        "ZhengPeng7/BiRefNet",
        trust_remote_code=True,
        cache_dir="/model-cache",
    )
    print("Modelos descargados OK")

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
        "fastapi==0.115.0",
        "python-multipart==0.0.9",
        "uvicorn==0.30.6",
    )
    .run_function(
        download_models,
        volumes={"/model-cache": modal.Volume.from_name("clearbg-model-cache", create_if_missing=True)},
    )
)

app = modal.App("clearbg-api")
model_cache = modal.Volume.from_name("clearbg-model-cache", create_if_missing=True)

@app.cls(
    image=image,
    gpu="A10G",
    memory=10240,
    volumes={"/model-cache": model_cache},
    scaledown_window=300,
)
class BackgroundRemover:

    @modal.enter()
    def load_model(self):
        import os
        import torch
        from transformers import AutoModelForImageSegmentation

        os.environ["HF_HOME"] = "/model-cache"
        self.device = torch.device("cuda")

        print("📦 Cargando BiRefNet-portrait...")
        self.model_portrait = AutoModelForImageSegmentation.from_pretrained(
            "ZhengPeng7/BiRefNet-portrait",
            trust_remote_code=True,
            cache_dir="/model-cache",
        )
        self.model_portrait.to(self.device)
        self.model_portrait.eval()

        print("📦 Cargando BiRefNet general...")
        self.model_general = AutoModelForImageSegmentation.from_pretrained(
            "ZhengPeng7/BiRefNet",
            trust_remote_code=True,
            cache_dir="/model-cache",
        )
        self.model_general.to(self.device)
        self.model_general.eval()

        print("✅ Modelos listos en GPU")

    def _run_model(self, model, image_rgb, orig_w, orig_h):
        import torch
        import numpy as np
        from PIL import Image
        from torchvision.transforms.functional import normalize

        resized = image_rgb.resize([1024, 1024], Image.BILINEAR)
        t = torch.tensor(np.array(resized), dtype=torch.float32).permute(2,0,1) / 255.0
        t = normalize(t, [0.485,0.456,0.406], [0.229,0.224,0.225]).unsqueeze(0).to(self.device)
        with torch.no_grad():
            result = model(t)
        pred = result[-1].sigmoid().cpu().squeeze().numpy()
        mask = Image.fromarray((pred * 255).astype(np.uint8), mode="L")
        return mask.resize((orig_w, orig_h), Image.LANCZOS)

    @modal.method()
    def remove_background(self, image_bytes: bytes) -> bytes:
        import numpy as np
        from PIL import Image, ImageOps, ImageFilter

        img = Image.open(io.BytesIO(image_bytes))
        img = ImageOps.exif_transpose(img)
        original = img.convert("RGBA")
        orig_w, orig_h = original.size
        image_rgb = original.convert("RGB")

        # Intentar portrait primero
        mask_portrait = self._run_model(self.model_portrait, image_rgb, orig_w, orig_h)
        coverage = (np.array(mask_portrait) > 128).sum() / (orig_w * orig_h)

        if 0.04 < coverage < 0.82:
            # Portrait detectó algo razonable → usarlo
            mask = mask_portrait
        else:
            # Fallback al modelo general (autos, objetos, animales)
            mask = self._run_model(self.model_general, image_rgb, orig_w, orig_h)

        mask = mask.filter(ImageFilter.GaussianBlur(radius=0.5))
        result = original.copy()
        result.putalpha(mask)

        out = io.BytesIO()
        result.save(out, format="PNG", optimize=True)
        out.seek(0)
        return out.read()


@app.function(image=image)
@modal.asgi_app()
def api():
    from fastapi import FastAPI, UploadFile, File, HTTPException
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import Response
    import uuid

    web_app = FastAPI(title="ClearBG API")
    web_app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    remover = BackgroundRemover()

    @web_app.get("/health")
    def health():
        return {"status": "ok", "models": ["BiRefNet-portrait", "BiRefNet"], "device": "GPU A10G"}

    @web_app.post("/api/v1/remove")
    async def remove_background(file: UploadFile = File(...)):
        allowed = {"image/jpeg", "image/png", "image/webp"}
        if file.content_type not in allowed:
            raise HTTPException(status_code=415, detail="Formato no soportado.")
        image_bytes = await file.read()
        if len(image_bytes) > 25 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Imagen demasiado grande. Máximo 25MB.")
        try:
            result_bytes = remover.remove_background.remote(image_bytes)
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
        return Response(
            content=result_bytes,
            media_type="image/png",
            headers={"Content-Disposition": f'attachment; filename="clearbg_{uuid.uuid4().hex[:8]}.png"'}
        )

    return web_app
