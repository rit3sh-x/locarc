from pydantic import BaseModel

class ControllerSettings(BaseModel):
    minFreqHz: float
    maxFreqHz: float
    sampleRate: float
    vgaGain: float
    lnaGain: float
    bufferSize: int

class Controller(BaseModel):
    controllerId: str
    latitude: float
    longitude: float
    settings: ControllerSettings

class MeasurementSample(BaseModel):
    frequency: float
    power_dbm: float

class Measurement(BaseModel):
    controllerId: str
    samples: list[MeasurementSample]

class JobPayload(BaseModel):
    batchId: str
    scanId: str
    callbackUrl: str
    controllers: list[Controller]
    measurements: list[Measurement]

class BoundPoint(BaseModel):
    latitude: float
    longitude: float

class LocationResult(BaseModel):
    centerLatitude: float
    centerLongitude: float
    bounds: list[BoundPoint]

class CallbackPayload(BaseModel):
    batchId: str
    scanId: str
    locations: list[LocationResult]
