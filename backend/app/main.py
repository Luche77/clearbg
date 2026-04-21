from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api import images, health, users
from app.core.config import settings

app = FastAPI(
    title="ClearBG API",
    description="Professional background removal API powered by BiRefNet",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, tags=["health"])
app.include_router(images.router, prefix="/api/v1", tags=["images"])
app.include_router(users.router, prefix="/api/v1", tags=["users"])

@app.on_event("startup")
async def startup_event():
    from app.services.model_service import ModelService
    await ModelService.load_model()
    print("✅ BiRefNet model loaded and ready")
