from fastapi import APIRouter, Response, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api")

class LoginRequest(BaseModel):
    email: str
    password: str

@router.post("/login")
def login(req: LoginRequest, response: Response):
    if req.email == "admin@demo.com" and req.password == "admin123":
        response.set_cookie(key="auth", value="true", httponly=True)
        return {"success": True}
    raise HTTPException(status_code=401, detail="Invalid credentials")

@router.post("/logout")
def logout(response: Response):
    response.delete_cookie("auth")
    return {"success": True}
