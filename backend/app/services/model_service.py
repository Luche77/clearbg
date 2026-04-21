"""
ModelService — Core AI background removal engine.

Uses RMBG-2.0 (BiRefNet architecture) from Hugging Face.
This is the best open-source segmentation model available (2024),
outperforming remove.bg on hair, fur, and transparent edges.

Pipeline:
  1. Load image & resize if needed
  2. Run RMBG-2.0 segmentation → raw alpha mask
  3. Post-process mask (alpha matting + edge refinement)
  4. Apply mask to original image
  5. Return PNG with transparency
"""

import io
import asyncio
from PIL import Image
import numpy as np
import torch
import torch.nn.functional as F
from torchvision.transforms.functional import normalize
from transformers import AutoModelForImageSegmentation
from app.core.config import settings


class ModelService:
    _model = None
    _device = None

    @classmethod
    async def load_model(cls):
        """Load BiRefNet/RMBG-2.0 model at startup. Called once."""
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, cls._load_model_sync)

    @classmethod
    def _load_model_sync(cls):
        cls._device = torch.device(settings.MODEL_DEVICE if torch.cuda.is_available() else "cpu")
        print(f"📦 Loading {settings.MODEL_NAME} on {cls._device}...")
        cls._model = AutoModelForImageSegmentation.from_pretrained(
            settings.MODEL_NAME,
            trust_remote_code=True,
        )
        cls._model.to(cls._device)
        cls._model.eval()
        print(f"✅ Model ready on {cls._device}")

    @classmethod
    async def remove_background(
        cls,
        image_bytes: bytes,
        refine_edges: bool = True,
    ) -> bytes:
        """
        Main method. Takes raw image bytes, returns PNG bytes with transparency.

        Args:
            image_bytes: Input image (JPEG, PNG, WebP, etc.)
            refine_edges: Apply alpha matting post-processing for sharper edges
        """
        if cls._model is None:
            raise RuntimeError("Model not loaded. Call load_model() first.")

        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            cls._process_sync,
            image_bytes,
            refine_edges,
        )
        return result

    @classmethod
    def _process_sync(cls, image_bytes: bytes, refine_edges: bool) -> bytes:
        # --- 1. Load image ---
        # Fix EXIF rotation (phones save images rotated)
        from PIL import ImageOps
        _img = Image.open(io.BytesIO(image_bytes))
        _img = ImageOps.exif_transpose(_img)  # Respect EXIF orientation
        original = _img.convert("RGBA")
        orig_w, orig_h = original.size

        # --- 2. Prepare input tensor ---
        # RMBG-2.0 works best at 1024x1024
        model_input_size = [1024, 1024]
        image_rgb = original.convert("RGB")
        resized = image_rgb.resize(model_input_size, Image.BILINEAR)

        img_tensor = torch.tensor(np.array(resized), dtype=torch.float32).permute(2, 0, 1)
        img_tensor = img_tensor / 255.0
        img_tensor = normalize(img_tensor, [0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
        img_tensor = img_tensor.unsqueeze(0).to(cls._device)

        # --- 3. Model inference ---
        with torch.no_grad():
            result = cls._model(img_tensor)

        # RMBG-2.0 returns list of predictions; last one is the finest
        pred = result[-1].sigmoid().cpu()
        pred = pred.squeeze()  # (H, W)

        # --- 4. Resize mask back to original dimensions ---
        mask_np = pred.numpy()
        mask_pil = Image.fromarray((mask_np * 255).astype(np.uint8), mode="L")
        mask_pil = mask_pil.resize((orig_w, orig_h), Image.BILINEAR)

        if refine_edges:
            mask_pil = cls._refine_mask(mask_pil, orig_w, orig_h)

        # --- 5. Apply mask as alpha channel ---
        result_img = original.copy()
        result_img.putalpha(mask_pil)

        # --- 6. Export as PNG ---
        out = io.BytesIO()
        result_img.save(out, format="PNG", optimize=True)
        out.seek(0)
        return out.read()

    @classmethod
    def _refine_mask(cls, mask: Image.Image, w: int, h: int) -> Image.Image:
        """
        Post-processing for sharper, cleaner edges.
        Applies morphological operations to reduce halo artifacts.
        For maximum quality, swap this with full alpha matting (pymatting).
        """
        mask_np = np.array(mask).astype(np.float32) / 255.0

        # Threshold: make core solid, transition zone smooth
        # Values > 0.8 → fully opaque, < 0.2 → fully transparent, middle → smooth
        refined = np.where(mask_np > 0.8, 1.0, np.where(mask_np < 0.2, 0.0, mask_np))

        # Slight blur on edges only (transition zone) to avoid jagged edges
        from PIL import ImageFilter
        mask_out = Image.fromarray((refined * 255).astype(np.uint8), mode="L")
        edge_blur = mask_out.filter(ImageFilter.GaussianBlur(radius=1.2))

        # Blend: keep solid areas intact, smooth edges
        solid = np.array(mask_out)
        blurred = np.array(edge_blur)
        transition = (mask_np > 0.2) & (mask_np < 0.8)
        final = solid.copy()
        final[transition] = blurred[transition]

        return Image.fromarray(final.astype(np.uint8), mode="L")
