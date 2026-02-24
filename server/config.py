from pydantic_settings import BaseSettings
from typing import Literal

class Settings(BaseSettings):
    host: str = "0.0.0.0"
    port: int = 8000

    webhook_secret: str

    localization_algo: Literal["annulus", "circle"] = "annulus"

    path_loss_exponent: float = 3.5
    pt_min_dbm: float = 20.0
    pt_max_dbm: float = 43.0

    class Config:
        env_file = ".env"

settings = Settings()
