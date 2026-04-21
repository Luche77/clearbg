"""
ClearBG — Backend en Modal con GPU A10G

GPU da resultados notablemente mejores:
- Procesa en 2-3 segundos (vs 60s en CPU)
- Bordes más precisos en pelo, transparencias y objetos complejos
- BiRefNet corre en su máximo potencial
"""

import modal
import io
from pathlib import Path

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
)

app = modal.App("clearbg-api")

model_cache = modal.Volume.from_name("clearbg-model-cache", create_if_missing=True)

@app.cls(
    image=image,
    gpu="A10G",            # GPU — resultados notablemente mejores
    memory=8192,           # 8GB RAM
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

        print("📦 Cargando BiRefNet en GPU...")
        self.device = torch.device("cuda")
        self.model = AutoModelForImageSegmentation.from_pretrained(
            "ZhengPeng7/BiRefNet",
            trust_remote_code=True,
            cache_dir="/model-cache",
        )
        self.model.to(self.device)
        self.model.eval()
        print("✅ Modelo listo en GPU")

    @modal.method()
    def remove_background(self, image_bytes: bytes) -> bytes:
        import torch
        import numpy as np
        from PIL import Image, ImageOps
        from torchvision.transforms.functional import normalize

        img = Image.open(io.BytesIO(image_bytes))
        img = ImageOps.exif_transpose(img)
        original = img.convert("RGBA")
        orig_w, orig_h = original.size

        model_size = [1024, 1024]
        image_rgb = original.convert("RGB").resize(model_size, Image.BILINEAR)
        img_tensor = torch.tensor(np.array(image_rgb), dtype=torch.float32).permute(2, 0, 1)
        img_tensor = img_tensor / 255.0
        img_tensor = normalize(img_tensor, [0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
        img_tensor = img_tensor.unsqueeze(0).to(self.device)

        with torch.no_grad():
            result = self.model(img_tensor)

        pred = result[-1].sigmoid().cpu().squeeze().numpy()
        mask = Image.fromarray((pred * 255).astype(np.uint8), mode="L")
        mask = mask.resize((orig_w, orig_h), Image.LANCZOS)

        # Post-procesado para bordes más limpios
        from PIL import ImageFilter
        mask = mask.filter(ImageFilter.GaussianBlur(radius=0.8))

        result_img = original.copy()
        result_img.putalpha(mask)

        out = io.BytesIO()
        result_img.save(out, format="PNG", optimize=True)
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
        return {"status": "ok", "model": "BiRefNet", "device": "GPU A10G"}

    @web_app.post("/api/v1/remove")
    async def remove_background(file: UploadFile = File(...)):
        allowed = {"image/jpeg", "image/png", "image/webp"}
        if file.content_type not in allowed:
            raise HTTPException(status_code=415, detail="Formato no soportado")

        image_bytes = await file.read()
        if len(image_bytes) > 25 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Imagen demasiado grande (máx 25MB)")

        try:
            result_bytes = remover.remove_background.remote(image_bytes)
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        return Response(
            content=result_bytes,
            media_type="image/png",
            headers={
                "Content-Disposition": f'attachment; filename="clearbg_{uuid.uuid4().hex[:8]}.png"'
            }
        )

    return web_app
