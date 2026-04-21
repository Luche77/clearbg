from pydantic_settings import BaseSettings
from typing import List
import os

class Settings(BaseSettings):
    # App
    APP_NAME: str = "ClearBG"
    DEBUG: bool = False
    SECRET_KEY: str = "change-this-in-production"

    # CORS
    ALLOWED_ORIGINS: List[str] = [
        "http://localhost:3000",
        "https://yourdomain.com",
    ]

    # Storage - Cloudflare R2 (compatible with S3 SDK)
    R2_ACCOUNT_ID: str = ""
    R2_ACCESS_KEY_ID: str = ""
    R2_SECRET_ACCESS_KEY: str = ""
    R2_BUCKET_NAME: str = "clearbg-images"
    R2_PUBLIC_URL: str = ""  # e.g. https://pub-xxx.r2.dev

    # Redis (for Celery queue)
    REDIS_URL: str = "redis://redis:6379/0"

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://user:password@localhost:5432/clearbg"

    # Model settings
    MODEL_NAME: str = "ZhengPeng7/BiRefNet"   # Best quality model on HuggingFace
    MODEL_DEVICE: str = "cuda"            # "cpu" if no GPU available
    MAX_IMAGE_SIZE_MB: int = 25
    MAX_IMAGE_DIMENSION: int = 8000       # px — no artificial limit unlike remove.bg

    # Rate limits (free tier)
    FREE_IMAGES_PER_DAY: int = 5
    FREE_MAX_RESOLUTION: int = 1080       # px height, free plan

    # Stripe
    STRIPE_SECRET_KEY: str = ""
    STRIPE_WEBHOOK_SECRET: str = ""
    STRIPE_PRO_PRICE_ID: str = ""

    # Clerk Auth
    CLERK_SECRET_KEY: str = ""
    CLERK_PUBLISHABLE_KEY: str = ""

    class Config:
        env_file = ".env"

settings = Settings()
