from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    host: str = "0.0.0.0"
    port: int = 8080

    webhook_secret: str

    convex_site_url: str

    class Config:
        env_file = ".env"

settings = Settings()
