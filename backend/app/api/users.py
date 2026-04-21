from fastapi import APIRouter

router = APIRouter()

@router.get("/users/me")
async def get_current_user():
    """
    Returns current user info from Clerk JWT.
    TODO: Validate Bearer token with Clerk SDK and return plan + usage.
    """
    return {
        "id": "user_placeholder",
        "plan": "free",
        "credits_used_today": 0,
        "credits_limit": 5,
    }
