"""
Images API — Core endpoints for background removal.

POST /api/v1/remove     → Upload image, get back PNG with transparency
GET  /api/v1/jobs/{id}  → Poll job status (for async processing)
POST /api/v1/batch      → Multiple images at once (Pro plan only)
"""

import uuid
import io
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, Header
from fastapi.responses import Response, JSONResponse
from PIL import Image
from app.services.model_service import ModelService
from app.services.storage_service import StorageService
from app.core.config import settings

router = APIRouter()

ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif", "image/tiff"}
MAX_BYTES = settings.MAX_IMAGE_SIZE_MB * 1024 * 1024


def validate_image(file: UploadFile):
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported image type: {file.content_type}. Use JPEG, PNG, WebP, GIF or TIFF."
        )


@router.post("/remove")
async def remove_background(
    file: UploadFile = File(...),
    output_format: str = "png",          # png | jpg (jpg = white background)
    refine_edges: bool = True,           # Enable alpha matting post-processing
    # x_api_key: str = Header(None),     # Uncomment to enable API key auth
):
    """
    Remove background from an image.

    Returns a PNG with transparent background (or JPG with white background).
    Free tier: max 1080px height. Pro: full resolution.

    Example with curl:
        curl -X POST https://api.clearbg.com/api/v1/remove \\
          -H "X-Api-Key: YOUR_KEY" \\
          -F "file=@photo.jpg" \\
          --output result.png
    """
    validate_image(file)

    image_bytes = await file.read()
    if len(image_bytes) > MAX_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Image too large. Max size is {settings.MAX_IMAGE_SIZE_MB}MB."
        )

    # --- Free plan resolution limit ---
    # TODO: Check user plan from JWT/API key and set limit accordingly
    # For now, all requests get full resolution
    # free_plan = True  # Replace with actual plan check
    # if free_plan:
    #     image_bytes = _limit_resolution(image_bytes, settings.FREE_MAX_RESOLUTION)

    try:
        result_bytes = await ModelService.remove_background(
            image_bytes=image_bytes,
            refine_edges=refine_edges,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Processing failed: {str(e)}")

    if output_format == "jpg":
        result_bytes = _png_to_jpg_white_bg(result_bytes)
        return Response(content=result_bytes, media_type="image/jpeg")

    return Response(
        content=result_bytes,
        media_type="image/png",
        headers={
            "Content-Disposition": f'attachment; filename="clearbg_{uuid.uuid4().hex[:8]}.png"',
            "X-Original-Filename": file.filename or "image",
        }
    )


@router.post("/remove/url")
async def remove_background_from_url(body: dict):
    """
    Remove background from an image URL.
    Useful for API integrations.

    Body: { "url": "https://example.com/photo.jpg" }
    """
    import httpx
    url = body.get("url")
    if not url:
        raise HTTPException(status_code=400, detail="Missing 'url' in request body.")

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(url)
        if resp.status_code != 200:
            raise HTTPException(status_code=400, detail="Could not fetch image from URL.")
        image_bytes = resp.content

    result_bytes = await ModelService.remove_background(image_bytes=image_bytes)
    return Response(content=result_bytes, media_type="image/png")


@router.post("/batch")
async def batch_remove(files: list[UploadFile] = File(...)):
    """
    Process multiple images at once.
    Pro plan only — returns a list of result URLs.
    """
    if len(files) > 50:
        raise HTTPException(status_code=400, detail="Max 50 images per batch request.")

    results = []
    for file in files:
        validate_image(file)
        image_bytes = await file.read()
        try:
            result_bytes = await ModelService.remove_background(image_bytes)
            job_id = uuid.uuid4().hex
            url = await StorageService.upload_result(result_bytes, job_id)
            results.append({"filename": file.filename, "url": url, "status": "success"})
        except Exception as e:
            results.append({"filename": file.filename, "error": str(e), "status": "error"})

    return JSONResponse(content={"results": results})


def _png_to_jpg_white_bg(png_bytes: bytes) -> bytes:
    """Convert PNG with transparency to JPEG with white background."""
    img = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    bg = Image.new("RGB", img.size, (255, 255, 255))
    bg.paste(img, mask=img.split()[3])
    out = io.BytesIO()
    bg.save(out, format="JPEG", quality=95)
    out.seek(0)
    return out.read()


def _limit_resolution(image_bytes: bytes, max_height: int) -> bytes:
    """Downscale image if height exceeds limit (for free plan)."""
    img = Image.open(io.BytesIO(image_bytes))
    if img.height > max_height:
        ratio = max_height / img.height
        new_size = (int(img.width * ratio), max_height)
        img = img.resize(new_size, Image.LANCZOS)
        out = io.BytesIO()
        img.save(out, format="PNG")
        out.seek(0)
        return out.read()
    return image_bytes
