import numpy as np
from scipy.optimize import differential_evolution
from dataclasses import dataclass

@dataclass
class LocalizationConfig:
    path_loss_exponent: float = 3.5
    pt_min_dbm: float = 20.0
    pt_max_dbm: float = 43.0
    pt_step_dbm: float = 0.5
    d0: float = 1.0
    de_seed: int = 42

def _safe_distances(tx: np.ndarray, receivers: np.ndarray) -> np.ndarray:
    d = np.linalg.norm(receivers - tx, axis=1)
    return np.where(d == 0, 1e-6, d)

def _objective(pos, receivers, powers, n):
    d = _safe_distances(np.array(pos), receivers)
    d_ref = d[0]
    return sum(
        (10 * n * np.log10(d[i] / d_ref) - (powers[0] - powers[i])) ** 2
        for i in range(1, len(receivers))
    )

def _run_de(bounds, receivers, powers, cfg: LocalizationConfig) -> np.ndarray:
    res = differential_evolution(
        _objective,
        bounds=bounds,
        args=(receivers, powers, cfg.path_loss_exponent),
        seed=cfg.de_seed,
        tol=1e-6,
        maxiter=1000,
        polish=True,
    )
    return res.x

def _initial_bounds(receivers: np.ndarray):
    return (
        (float(receivers[:, 0].min()), float(receivers[:, 0].max())),
        (float(receivers[:, 1].min()), float(receivers[:, 1].max())),
    )

def _annulus_bounds(receivers: np.ndarray, powers: np.ndarray,
                    cfg: LocalizationConfig):
    n = cfg.path_loss_exponent
    boxes = []
    for rx, pr in zip(receivers, powers):
        d_max = 10 ** ((cfg.pt_max_dbm - pr) / (10 * n))
        boxes.append((rx[0] - d_max, rx[0] + d_max,
                      rx[1] - d_max, rx[1] + d_max))

    x0 = max(b[0] for b in boxes)
    x1 = min(b[1] for b in boxes)
    y0 = max(b[2] for b in boxes)
    y1 = min(b[3] for b in boxes)

    if x0 >= x1 or y0 >= y1:
        return None
    return ((x0, x1), (y0, y1))

def localize_annulus(receivers: np.ndarray, powers: np.ndarray,
                     cfg: LocalizationConfig):
    """Annulus-intersection localization (Algorithm A)."""
    initial = _initial_bounds(receivers)
    bounds = _annulus_bounds(receivers, powers, cfg) or initial
    est = _run_de(bounds, receivers, powers, cfg)
    return est, bounds

def _circle_intersections(c1: np.ndarray, r1: float,
                          c2: np.ndarray, r2: float) -> list:
    d = np.linalg.norm(c1 - c2)
    if d > r1 + r2 or d < abs(r1 - r2) or d == 0:
        return []
    a = (r1**2 - r2**2 + d**2) / (2 * d)
    h = np.sqrt(max(0.0, r1**2 - a**2))
    mid = c1 + a * (c2 - c1) / d
    perp = np.array([c2[1] - c1[1], c1[0] - c2[0]]) / d
    p1 = mid + h * perp
    return [p1] if h == 0 else [p1, mid - h * perp]

def _point_in_polygon(point, polygon) -> bool:
    x, y = point
    n = len(polygon)
    inside = False
    p1x, p1y = polygon[0]
    for i in range(n + 1):
        p2x, p2y = polygon[i % n]
        if min(p1y, p2y) < y <= max(p1y, p2y) and x <= max(p1x, p2x):
            if p1y != p2y:
                xi = (y - p1y) * (p2x - p1x) / (p2y - p1y) + p1x
            if p1x == p2x or x <= xi:
                inside = not inside
        p1x, p1y = p2x, p2y
    return inside

def _circle_bounds(receivers: np.ndarray, powers: np.ndarray,
                   cfg: LocalizationConfig):
    n = cfg.path_loss_exponent
    top2 = np.argsort(powers)[-2:]

    pt_est = None
    for pt in np.arange(cfg.pt_min_dbm, cfg.pt_max_dbm, cfg.pt_step_dbm):
        d1 = 10 ** ((pt - powers[top2[1]]) / (10 * n))
        d2 = 10 ** ((pt - powers[top2[0]]) / (10 * n))
        if np.linalg.norm(receivers[top2[1]] - receivers[top2[0]]) <= d1 + d2:
            pt_est = pt
            break

    if pt_est is None:
        return None

    radii = [10 ** ((pt_est - p) / (10 * n)) for p in powers]
    circles = list(zip(receivers, radii))
    N = len(circles)

    pts = []
    for i in range(N):
        for j in range(i + 1, N):
            pts.extend(_circle_intersections(
                circles[i][0], circles[i][1],
                circles[j][0], circles[j][1],
            ))

    if not pts:
        return None

    quad_idx = [1, 0, 2, 3] if N >= 4 else list(range(N))
    quad = receivers[quad_idx[:N], :]
    valid = [p for p in pts if _point_in_polygon(p, quad)]

    if not valid:
        return None

    arr = np.array(valid)
    return (
        (float(arr[:, 0].min()), float(arr[:, 0].max())),
        (float(arr[:, 1].min()), float(arr[:, 1].max())),
    )

def localize_circle(receivers: np.ndarray, powers: np.ndarray,
                    cfg: LocalizationConfig):
    initial = _initial_bounds(receivers)
    bounds = _circle_bounds(receivers, powers, cfg) or initial
    est = _run_de(bounds, receivers, powers, cfg)
    return est, bounds
