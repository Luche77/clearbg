# ClearBG — Professional Background Removal

Stack: **Next.js 14** · **FastAPI** · **BiRefNet / RMBG-2.0** · **PostgreSQL** · **Redis** · **Cloudflare R2** · **Stripe** · **Clerk**

---

## Architecture

```
clearbg/
├── backend/              # Python FastAPI + AI model
│   ├── app/
│   │   ├── main.py       # FastAPI app entry point
│   │   ├── api/
│   │   │   ├── images.py     # /remove, /batch endpoints
│   │   │   ├── billing.py    # Stripe webhooks + checkout
│   │   │   ├── users.py      # User profile + usage
│   │   │   └── health.py     # Health check
│   │   ├── services/
│   │   │   ├── model_service.py    ← THE AI ENGINE
│   │   │   └── storage_service.py  # Cloudflare R2
│   │   ├── models/
│   │   │   └── models.py     # SQLAlchemy DB models
│   │   ├── core/
│   │   │   └── config.py     # All environment variables
│   │   └── worker.py         # Celery async job queue
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env.example
│
├── frontend/             # Next.js 14 + Tailwind
│   ├── src/app/
│   │   ├── page.tsx          # Landing + upload tool
│   │   ├── pricing/page.tsx  # Pricing plans
│   │   └── layout.tsx        # Root layout (Clerk + Toaster)
│   ├── package.json
│   ├── tailwind.config.ts
│   ├── next.config.js
│   └── .env.local.example
│
└── docker-compose.yml    # Full stack with GPU support
```

---

## Step-by-Step Setup

### Prerequisites

- Python 3.11+
- Node.js 20+
- Docker + Docker Compose
- NVIDIA GPU (recommended) — also works on CPU, just slower
- Accounts needed: Cloudflare, Stripe, Clerk

---

### Step 1 — Clone and configure environment

```bash
git clone https://github.com/yourusername/clearbg.git
cd clearbg

# Backend config
cp backend/.env.example backend/.env

# Frontend config
cp frontend/.env.local.example frontend/.env.local
```

---

### Step 2 — Set up Clerk (Authentication)

1. Go to https://clerk.com → Create new application
2. Enable Email + Google sign-in
3. Copy keys to `backend/.env`:
   ```
   CLERK_SECRET_KEY=sk_test_...
   CLERK_PUBLISHABLE_KEY=pk_test_...
   ```
4. Copy to `frontend/.env.local`:
   ```
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
   CLERK_SECRET_KEY=sk_test_...
   ```

---

### Step 3 — Set up Cloudflare R2 (Storage)

1. Go to https://dash.cloudflare.com → R2 Object Storage
2. Create bucket named `clearbg-images`
3. Enable public access on the bucket
4. Go to Manage R2 API Tokens → Create Token (Object Read & Write)
5. Copy to `backend/.env`:
   ```
   R2_ACCOUNT_ID=your_account_id
   R2_ACCESS_KEY_ID=...
   R2_SECRET_ACCESS_KEY=...
   R2_BUCKET_NAME=clearbg-images
   R2_PUBLIC_URL=https://pub-xxxxxxxx.r2.dev
   ```

---

### Step 4 — Set up Stripe (Payments)

1. Go to https://dashboard.stripe.com
2. Create a Product → "ClearBG Pro" → $9/month recurring price
3. Copy the Price ID (starts with `price_`)
4. Copy to `backend/.env`:
   ```
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_PRO_PRICE_ID=price_...
   ```
5. For webhooks (local dev): install Stripe CLI and run:
   ```bash
   stripe listen --forward-to localhost:8000/webhooks/stripe
   # Copy the webhook signing secret to STRIPE_WEBHOOK_SECRET
   ```

---

### Step 5 — Run with Docker (recommended)

```bash
# If you have NVIDIA GPU:
docker compose up --build

# If CPU only (remove GPU section from docker-compose.yml first):
docker compose up --build
```

The first startup downloads the RMBG-2.0 model (~1.5GB) from Hugging Face.
This is cached in a Docker volume — only happens once.

Services:
- Frontend: http://localhost:3000
- API: http://localhost:8000
- API docs: http://localhost:8000/docs

---

### Step 6 — Run locally without Docker

#### Backend
```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run API
uvicorn app.main:app --reload --port 8000

# Run Celery worker (separate terminal)
celery -A app.worker worker --loglevel=info
```

#### Frontend
```bash
cd frontend
npm install
npm run dev
# Open http://localhost:3000
```

---

### Step 7 — Run database migrations

```bash
cd backend

# Initialize Alembic (first time only)
alembic init migrations

# Create first migration
alembic revision --autogenerate -m "initial"

# Apply migrations
alembic upgrade head
```

---

## API Usage

### Remove background (file upload)
```bash
curl -X POST http://localhost:8000/api/v1/remove \
  -H "X-Api-Key: YOUR_API_KEY" \
  -F "file=@photo.jpg" \
  --output result.png
```

### Remove background (from URL)
```bash
curl -X POST http://localhost:8000/api/v1/remove/url \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/photo.jpg"}' \
  --output result.png
```

### Batch processing
```bash
curl -X POST http://localhost:8000/api/v1/batch \
  -H "X-Api-Key: YOUR_API_KEY" \
  -F "files=@photo1.jpg" \
  -F "files=@photo2.jpg"
```

---

## Model: RMBG-2.0 (BiRefNet)

The AI model used is **RMBG-2.0** by BRIA AI, available on Hugging Face:
`briaai/RMBG-2.0`

**Why it's better than remove.bg:**
- State of the art segmentation (2024 benchmarks)
- Superior on: hair strands, animal fur, glass, smoke, transparent objects
- No resolution limit — runs on full 4K/8K images
- Open weights — you control the model

The model is downloaded automatically on first startup via `transformers`.

**Switching models:** To try BiRefNet directly:
```python
# In backend/app/core/config.py, change:
MODEL_NAME = "ZhengPeng7/BiRefNet"  # Alternative — also excellent
```

---

## Deployment

### Backend → RunPod or Modal (GPU inference)

**RunPod** (cheapest GPU option):
1. Deploy backend as a serverless endpoint on RunPod
2. RTX 4090 = ~$0.74/hr → ~$0.002/image at 1 image/2 seconds
3. Auto-scales to zero when idle

**Modal** (easiest setup):
```python
# modal_deploy.py
import modal
app = modal.App("clearbg")

@app.function(gpu="A10G", image=modal.Image.debian_slim().pip_install_from_requirements("requirements.txt"))
def remove_bg(image_bytes: bytes) -> bytes:
    from app.services.model_service import ModelService
    import asyncio
    return asyncio.run(ModelService.remove_background(image_bytes))
```

### Frontend → Vercel
```bash
cd frontend
npx vercel deploy
```

### Database → Supabase
1. Create project at supabase.com
2. Copy connection string to DATABASE_URL in .env

---

## Pricing Model (suggested)

| Plan | Price | Images/day | Resolution | API |
|------|-------|-----------|------------|-----|
| Free | $0 | 5 | 1080p | ✗ |
| Pro | $9/mo | Unlimited | 8K | 500 credits |
| API | Pay-per-use | — | 8K | $0.10/image |

---

## Next Features to Build

1. **Manual edge correction** — Canvas brush tool (Fabric.js) to fix model errors
2. **Background replacement** — Solid color, gradient, custom image
3. **Integrations** — Shopify app, Figma plugin, Chrome extension
4. **Bulk uploader UI** — Drag multiple files with progress per image
5. **History page** — User's past processed images

---

## Tech Stack Summary

| Layer | Technology | Why |
|-------|-----------|-----|
| AI Model | RMBG-2.0 (BiRefNet) | Best OSS segmentation 2024 |
| Backend | FastAPI | Async, fast, Python-native for AI |
| Queue | Celery + Redis | Handle spikes, batch jobs |
| Database | PostgreSQL | Reliable, structured user/job data |
| Storage | Cloudflare R2 | Zero egress fees vs AWS S3 |
| Auth | Clerk | Best DX, social login, API keys |
| Payments | Stripe | Industry standard, great webhooks |
| Frontend | Next.js 14 | App Router, SSR, best React DX |
| Styling | Tailwind CSS | Fast, consistent |
| Animations | Framer Motion | Smooth, production quality |
| Deploy GPU | RunPod / Modal | Pay-per-use GPU, no idle cost |
| Deploy Web | Vercel | Zero config Next.js hosting |
