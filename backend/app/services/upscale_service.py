"""
Upscale Service — AI-powered image upscaling using Real-ESRGAN.

Uses Real-ESRGAN x4plus model for photo-realistic upscaling.
Falls back to high-quality Lanczos resampling if the model isn't available.
"""

import asyncio
import io
import logging
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)

MAX_OUTPUT_DIM = 3840  # 4K ceiling


class UpscaleService:
    _executor = ThreadPoolExecutor(max_workers=1)
    _upsampler = None
    _model_loaded = False

    @classmethod
    async def load_model(cls):
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(cls._executor, cls._load_model_sync)

    @classmethod
    def _load_model_sync(cls):
        try:
            import torch
            from basicsr.archs.rrdbnet_arch import RRDBNet
            from realesrgan import RealESRGANer

            model = RRDBNet(
                num_in_ch=3, num_out_ch=3,
                num_feat=64, num_block=23,
                num_grow_ch=32, scale=4,
            )
            device = "cuda" if torch.cuda.is_available() else "cpu"
            cls._upsampler = RealESRGANer(
                scale=4,
                model_path="https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth",
                model=model,
                tile=512,
                tile_pad=10,
                pre_pad=0,
                half=(device == "cuda"),
                device=torch.device(device),
            )
            cls._model_loaded = True
            logger.info("Real-ESRGAN model loaded (device=%s)", device)
        except Exception as exc:
            logger.warning("Real-ESRGAN unavailable, using Lanczos fallback: %s", exc)
            cls._upsampler = None
            cls._model_loaded = False

    @classmethod
    async def upscale(cls, image_bytes: bytes, scale: int = 4) -> bytes:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(cls._executor, cls._upscale_sync, image_bytes, scale)

    @classmethod
    def _upscale_sync(cls, image_bytes: bytes, scale: int) -> bytes:
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")

        if cls._upsampler is not None:
            try:
                img_np = np.array(img)
                output, _ = cls._upsampler.enhance(img_np, outscale=scale)
                result = Image.fromarray(output)
            except Exception as exc:
                logger.error("Real-ESRGAN inference failed, using Lanczos fallback: %s", exc)
                result = cls._lanczos_upscale(img, scale)
        else:
            result = cls._lanczos_upscale(img, scale)

        buf = io.BytesIO()
        result.save(buf, format="JPEG", quality=95, optimize=True)
        buf.seek(0)
        return buf.read()

    @staticmethod
    def _lanczos_upscale(img: Image.Image, scale: int) -> Image.Image:
        new_w = img.width * scale
        new_h = img.height * scale
        if new_w > MAX_OUTPUT_DIM or new_h > MAX_OUTPUT_DIM:
            ratio = min(MAX_OUTPUT_DIM / new_w, MAX_OUTPUT_DIM / new_h)
            new_w = int(new_w * ratio)
            new_h = int(new_h * ratio)
        return img.resize((new_w, new_h), Image.LANCZOS)
