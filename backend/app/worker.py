"""
Celery worker — async job queue for background processing.

When a user uploads an image, instead of processing it synchronously
(which would block the HTTP request), we enqueue a job here.
The API returns a job_id immediately, and the client polls /jobs/{id}.

This is essential for:
  - Handling traffic spikes without timeouts
  - Batch processing (50 images at once)
  - Long processing times on large images
"""

from celery import Celery
from app.core.config import settings

celery_app = Celery(
    "clearbg",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    result_expires=3600,        # Results expire after 1 hour
    task_time_limit=120,        # Kill tasks taking > 2 minutes
    task_soft_time_limit=90,    # Warn at 90s
    worker_prefetch_multiplier=1,  # Process one task at a time per worker (GPU bound)
)


@celery_app.task(bind=True, name="tasks.remove_background")
def remove_background_task(self, image_key: str, job_id: str, options: dict):
    """
    Async task for background removal.
    Called when processing large images or batch jobs.

    Args:
        image_key: R2 storage key of the original image
        job_id: UUID for tracking job status
        options: dict with refine_edges, output_format, etc.
    """
    import asyncio
    from app.services.model_service import ModelService
    from app.services.storage_service import StorageService

    async def _run():
        # Download original from R2
        # (In production, pass image bytes directly for small images)
        image_bytes = b""  # TODO: download from storage_key

        # Process
        result_bytes = await ModelService.remove_background(
            image_bytes=image_bytes,
            refine_edges=options.get("refine_edges", True),
        )

        # Upload result
        result_url = await StorageService.upload_result(result_bytes, job_id)
        return result_url

    try:
        self.update_state(state="PROCESSING", meta={"progress": 50})
        loop = asyncio.new_event_loop()
        result_url = loop.run_until_complete(_run())
        return {"status": "done", "url": result_url}
    except Exception as e:
        self.update_state(state="FAILURE", meta={"error": str(e)})
        raise
