"""
ClearBG — Backend en Modal con GPU A10G

Usa dos modelos según el contenido:
- BiRefNet-portrait: para personas (mejor resultado en fotos de personas)  
- BiRefNet general: para productos, animales, objetos
"""

import modal
import io

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
    gpu="A10G",
    memory=8192,
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

        # Modelo portrait — específico para personas, mejor que el general
        print("📦 Cargando BiRefNet-portrait en GPU...")
        self.model_portrait = AutoModelForImageSegmentation.from_pretrained(
            "ZhengPeng7/BiRefNet-portrait",
            trust_remote_code=True,
            cache_dir="/model-cache",
        )
        self.model_portrait.to(self.device)
        self.model_portrait.eval()

        # Modelo general — para productos, animales, objetos
        print("📦 Cargando BiRefNet general en GPU...")
        self.model_general = AutoModelForImageSegmentation.from_pretrained(
            "ZhengPeng7/BiRefNet",
            trust_remote_code=True,
            cache_dir="/model-cache",
        )
        self.model_general.to(self.device)
        self.model_general.eval()

        print("✅ Ambos modelos listos en GPU")

    def _run_model(self, model, image_rgb, orig_w, orig_h):
        """Corre el modelo y devuelve la máscara en tamaño original."""
        import torch
        import numpy as np
        from PIL import Image
        from torchvision.transforms.functional import normalize

        model_size = [1024, 1024]
        resized = image_rgb.resize(model_size, Image.BILINEAR)
        img_tensor = torch.tensor(np.array(resized), dtype=torch.float32).permute(2, 0, 1)
        img_tensor = img_tensor / 255.0
        img_tensor = normalize(img_tensor, [0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
        img_tensor = img_tensor.unsqueeze(0).to(self.device)

        with torch.no_grad():
            result = model(img_tensor)

        pred = result[-1].sigmoid().cpu().squeeze().numpy()
        mask = Image.fromarray((pred * 255).astype(np.uint8), mode="L")
        mask = mask.resize((orig_w, orig_h), Image.LANCZOS)
        return mask

    @modal.method()
    def remove_background(self, image_bytes: bytes, mode: str = "auto") -> bytes:
        """
        mode: "auto" | "person" | "general"
        - "person": usa BiRefNet-portrait (mejor para fotos de personas)
        - "general": usa BiRefNet general (productos, animales, objetos)
        - "auto": detecta si hay persona y elige el modelo correcto
        """
        import torch
        import numpy as np
        from PIL import Image, ImageOps, ImageFilter

        img = Image.open(io.BytesIO(image_bytes))
        img = ImageOps.exif_transpose(img)
        original = img.convert("RGBA")
        orig_w, orig_h = original.size
        image_rgb = original.convert("RGB")

        # Elegir modelo
        if mode == "person":
            mask = self._run_model(self.model_portrait, image_rgb, orig_w, orig_h)
        elif mode == "general":
            mask = self._run_model(self.model_general, image_rgb, orig_w, orig_h)
        else:
            # Auto: correr portrait primero, si la máscara cubre >10% y <90% de la imagen
            # probablemente hay una persona bien detectada
            mask_portrait = self._run_model(self.model_portrait, image_rgb, orig_w, orig_h)
            import numpy as np
            mask_arr = np.array(mask_portrait)
            coverage = (mask_arr > 128).sum() / mask_arr.size
            if 0.05 < coverage < 0.85:
                # Portrait model detected something reasonable — use it
                mask = mask_portrait
            else:
                # Fallback to general model
                mask = self._run_model(self.model_general, image_rgb, orig_w, orig_h)

        # Suavizar bordes
        mask = mask.filter(ImageFilter.GaussianBlur(radius=0.6))

        result_img = original.copy()
        result_img.putalpha(mask)

        out = io.BytesIO()
        result_img.save(out, format="PNG", optimize=True)
        out.seek(0)
        return out.read()


@app.function(image=image)
@modal.asgi_app()
def api():
    from fastapi import FastAPI, UploadFile, File, HTTPException, Query
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import Response
    import uuid

    web_app = FastAPI(title="ClearBG API")
    web_app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

    remover = BackgroundRemover()

    @web_app.get("/health")
    def health():
        return {"status": "ok", "model": "BiRefNet-portrait + BiRefNet", "device": "GPU A10G"}

    @web_app.post("/api/v1/remove")
    async def remove_background(
        file: UploadFile = File(...),
        mode: str = Query(default="auto", description="auto | person | general"),
    ):
        allowed = {"image/jpeg", "image/png", "image/webp"}
        if file.content_type not in allowed:
            raise HTTPException(status_code=415, detail="Formato no soportado")

        image_bytes = await file.read()
        if len(image_bytes) > 25 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Imagen demasiado grande (máx 25MB)")

        try:
            result_bytes = remover.remove_background.remote(image_bytes, mode=mode)
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        return Response(
            content=result_bytes,
            media_type="image/png",
            headers={"Content-Disposition": f'attachment; filename="clearbg_{uuid.uuid4().hex[:8]}.png"'}
        )

    return web_app
