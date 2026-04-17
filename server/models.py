from pydantic import BaseModel
from typing import Literal, Optional

class Controller(BaseModel):
    controllerId: str
    latitude: float
    longitude: float

class MeasurementSample(BaseModel):
    frequencyHz: float
    powerDbm: float

class Measurement(BaseModel):
    controllerId: str
    samples: list[MeasurementSample]

class LocalizationConfig(BaseModel):
    algorithm: Literal["fourCircle", "annulus"] = "annulus"
    pathLossExponent: float = 3.5
    ptSearchRangeMinDbm: float = 20.0
    ptSearchRangeMaxDbm: float = 43.0
    ptSearchStepDbm: float = 0.5
    powerErrorRangeDb: float = 3.0
    channelBinHz: float = 12_500.0
    minControllersPerChannel: int = 3
    minPeakDbm: float = -110.0

class JobPayload(BaseModel):
    batchId: str
    scanId: str
    callbackUrl: str
    controllers: list[Controller]
    measurements: list[Measurement]
    localizationConfig: Optional[LocalizationConfig] = None

class BoundPoint(BaseModel):
    latitude: float
    longitude: float

class LocationResult(BaseModel):
    centerLatitude: float
    centerLongitude: float
    bounds: list[BoundPoint]
    frequencyHz: Optional[float] = None
    controllerCount: Optional[int] = None

class CallbackPayload(BaseModel):
    batchId: str
    scanId: str
    locations: list[LocationResult]
