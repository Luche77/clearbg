"""
Database models.

Tables:
  users       → User accounts (synced from Clerk)
  jobs        → Image processing jobs (history + status)
  api_keys    → API keys for developer access
"""

from sqlalchemy import Column, String, Integer, Boolean, DateTime, Enum, ForeignKey, Text
from sqlalchemy.orm import DeclarativeBase, relationship
from sqlalchemy.sql import func
import uuid
import enum


class Base(DeclarativeBase):
    pass


class PlanType(str, enum.Enum):
    free = "free"
    pro = "pro"
    api = "api"


class JobStatus(str, enum.Enum):
    pending = "pending"
    processing = "processing"
    done = "done"
    failed = "failed"


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    clerk_id = Column(String, unique=True, nullable=False, index=True)
    email = Column(String, unique=True, nullable=False)
    plan = Column(Enum(PlanType), default=PlanType.free, nullable=False)
    stripe_customer_id = Column(String, nullable=True)
    stripe_subscription_id = Column(String, nullable=True)

    # Usage tracking
    images_today = Column(Integer, default=0)
    images_total = Column(Integer, default=0)
    last_reset_date = Column(DateTime, nullable=True)  # Date when daily count was last reset

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    jobs = relationship("Job", back_populates="user")
    api_keys = relationship("ApiKey", back_populates="user")


class Job(Base):
    __tablename__ = "jobs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id"), nullable=True)  # Null for anonymous

    status = Column(Enum(JobStatus), default=JobStatus.pending, nullable=False)
    original_key = Column(String, nullable=True)   # R2 storage key
    result_url = Column(String, nullable=True)      # Public URL of result
    error_message = Column(Text, nullable=True)

    # Image metadata
    original_filename = Column(String, nullable=True)
    original_width = Column(Integer, nullable=True)
    original_height = Column(Integer, nullable=True)
    file_size_bytes = Column(Integer, nullable=True)
    processing_ms = Column(Integer, nullable=True)  # How long it took

    created_at = Column(DateTime, server_default=func.now())
    completed_at = Column(DateTime, nullable=True)

    user = relationship("User", back_populates="jobs")


class ApiKey(Base):
    __tablename__ = "api_keys"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    key_hash = Column(String, unique=True, nullable=False)  # bcrypt hash of the key
    name = Column(String, nullable=True)   # e.g. "Production", "My App"
    is_active = Column(Boolean, default=True)
    last_used_at = Column(DateTime, nullable=True)
    requests_total = Column(Integer, default=0)

    created_at = Column(DateTime, server_default=func.now())

    user = relationship("User", back_populates="api_keys")
