from pydantic import BaseModel
from typing import List, Optional

class BoardBox(BaseModel):
    x: int
    y: int
    w: int
    h: int

class ScanResponse(BaseModel):
    success: bool
    fen: str
    board_box: Optional[BoardBox] = None
    message: str
    is_flipped: Optional[bool] = False

class ErrorResponse(BaseModel):
    success: bool
    message: str
