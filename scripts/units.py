# Reference values for the direct unit tests, from the installed gonogo's own Python.
import json
import math

from gonogo.compare import _mcnemar
from gonogo.stats import fmt_cut, fmt_share, required_n, wilson, z_for


def w(s, n, level):
    i = wilson(s, n, level)
    return [s, n, level, i.low, i.high]


print(json.dumps({
    "wilson": [w(*a) for a in [(47, 50, 0.95), (0, 10, 0.95), (10, 10, 0.95), (1, 1, 0.9), (33, 40, 0.8),
                              (120, 130, 0.99), (7, 20, 0.85), (250, 1000, 0.975)]],
    "required_n": [[r, t, lv, required_n(r, t, lv)] for r, t, lv in
                   [(1.0, 0.95, 0.95), (0.98, 0.9, 0.95), (0.96, 0.95, 0.95), (0.9, 0.9, 0.95), (0.999, 0.99, 0.99),
                    (0.875, 0.8, 0.95), (13 / 16, 0.5, 0.95)]],
    "z_for": [[lv, z_for(lv)] for lv in [0.975, 0.85, 0.5, 0.999, 0.01]],
    "mcnemar": [[a, b, *_mcnemar(a, b)] for a, b in
                [(0, 0), (0, 1), (1, 1), (5, 0), (14, 28), (30, 6), (0, 33), (400, 600), (1, 1000), (480, 620), (501, 500)]],
    "erfc": [[x, math.erfc(x)] for x in [0.0, 0.1, 0.49, 0.5, 1.0, 1.99, 2.0, 2.5, 4.0, 7.5, 15.0, 26.0]],
    "format": [[x, d, format(x, f".{d}f"), format(x, f".{d}%")] for x, d in
               [(0.125, 2), (0.625, 2), (0.375, 0), (0.005, 0), (0.995, 1), (0.15000000000000002, 2), (2.5, 0), (1e-9, 3)]],
    # gonogo 0.4.6: cut points and shares printed so they reproduce themselves
    "fmt_cut": [[x, fmt_cut(x)] for x in
                [0.625, 0.231, 0.8, 0.5, 0.15, 0.150375, 0.30000000000000004, 0.0, 1.0, 0.12345, 0.99995, 0.1864, 2 / 3]],
    "fmt_share": [[x, fmt_share(x)] for x in
                  [0.625, 0.29, 2 / 3, 1.0, 0.25, 0.99999, 0.0, 0.7826086956521739, 0.975, 0.0005, 0.9995]],
}))
