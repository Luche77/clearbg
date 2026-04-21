"""
StorageService — Cloudflare R2 storage (S3-compatible).

R2 is preferred over AWS S3 because:
- Zero egress fees (huge savings for image-heavy apps)
- Cheaper storage per GB
- S3-compatible API (same boto3 SDK)
"""

import uuid
import boto3
from botocore.config import Config
from app.core.config import settings


class StorageService:
    _client = None

    @classmethod
    def _get_client(cls):
        if cls._client is None:
            cls._client = boto3.client(
                "s3",
                endpoint_url=f"https://{settings.R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
                aws_access_key_id=settings.R2_ACCESS_KEY_ID,
                aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
                config=Config(signature_version="s3v4"),
                region_name="auto",
            )
        return cls._client

    @classmethod
    async def upload_original(cls, image_bytes: bytes, content_type: str) -> str:
        """Upload original image. Returns storage key."""
        key = f"originals/{uuid.uuid4()}"
        cls._get_client().put_object(
            Bucket=settings.R2_BUCKET_NAME,
            Key=key,
            Body=image_bytes,
            ContentType=content_type,
        )
        return key

    @classmethod
    async def upload_result(cls, png_bytes: bytes, job_id: str) -> str:
        """Upload processed PNG. Returns public URL."""
        key = f"results/{job_id}.png"
        cls._get_client().put_object(
            Bucket=settings.R2_BUCKET_NAME,
            Key=key,
            Body=png_bytes,
            ContentType="image/png",
        )
        return f"{settings.R2_PUBLIC_URL}/{key}"

    @classmethod
    async def get_download_url(cls, key: str, expires_in: int = 3600) -> str:
        """Generate a pre-signed download URL (expires in 1hr by default)."""
        return cls._get_client().generate_presigned_url(
            "get_object",
            Params={"Bucket": settings.R2_BUCKET_NAME, "Key": key},
            ExpiresIn=expires_in,
        )

    @classmethod
    async def delete_file(cls, key: str):
        """Delete a file from storage."""
        cls._get_client().delete_object(
            Bucket=settings.R2_BUCKET_NAME,
            Key=key,
        )
