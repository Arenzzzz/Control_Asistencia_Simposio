"""Etapa 2: coincidencia token-based con Damerau-Levenshtein.

- Distancia de Damerau-Levenshtein (variante OSA): inserción, supresión,
  sustitución y transposición adyacente, todas con costo 1.
- k de un candidato = suma, sobre los tokens del pago, de la distancia al mejor
  token oficial (asignación uno a uno, cada token oficial se usa una sola vez).
  Los tokens oficiales sobrantes NO penalizan: 'Juan Pérez' vs
  'Juan Carlos Pérez Gómez' da k = 0.
- Prefiltrado (evita O(N x M)): índice invertido de "vecindad de supresiones"
  (estilo SymSpell). Dos tokens a distancia <= 1 comparten al menos una forma
  (el token mismo o el token con una letra eliminada), así que solo se calcula
  la distancia completa contra candidatos que comparten alguna forma.
"""
from __future__ import annotations

from collections import defaultdict
from functools import lru_cache
from dataclasses import dataclass
from itertools import permutations

from Normalizador import tokenize


@lru_cache(maxsize=200_000)
def damerau_levenshtein(a: str, b: str, max_dist: int | None = None) -> int:
    """Damerau-Levenshtein (OSA). Si se pasa max_dist, corta y devuelve max_dist+1."""
    if a == b:
        return 0
    la, lb = len(a), len(b)
    if max_dist is not None and abs(la - lb) > max_dist:
        return max_dist + 1
    if la == 0:
        return lb
    if lb == 0:
        return la
    prev2 = None
    prev = list(range(lb + 1))
    for i in range(1, la + 1):
        cur = [i] + [0] * lb
        row_min = cur[0]
        for j in range(1, lb + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            v = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
            if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                v = min(v, prev2[j - 2] + 1)
            cur[j] = v
            if v < row_min:
                row_min = v
        if max_dist is not None and row_min > max_dist:
            return max_dist + 1
        prev2, prev = prev, cur
    return prev[lb]


def _forms(token: str) -> set[str]:
    forms = {token}
    for i in range(len(token)):
        forms.add(token[:i] + token[i + 1:])
    return forms


@dataclass(frozen=True)
class Candidate:
    carnet: str
    nombre: str
    k: int            # distancia total (suma de distancias por token)
    coverage: int     # tokens del pago con distancia <= 1 a algún token oficial


_BIG = 99  # distancia "infinita" para tokens sin pareja
# Un nombre de más en la boleta (p. ej. el segundo nombre que el padrón no trae)
# cuesta 1, como cualquier otra edición: 'Anthony Rafael Domínguez' vs 'Anthony Domínguez' da k = 1.
SOBRANTE_PAGO = 1


def score_pair(pay_tokens: list[str], off_tokens: list[str]) -> tuple[int, int]:
    """(k, coverage) con asignación uno a uno óptima (listas de nombres son cortas)."""
    if not pay_tokens or not off_tokens:
        return _BIG, 0
    dist = [[damerau_levenshtein(p, o, max_dist=4) for o in off_tokens] for p in pay_tokens]
    n, m = len(pay_tokens), len(off_tokens)
    best_k, best_cov = None, 0
    if n <= m:
        for cols in permutations(range(m), n):
            ds = [dist[i][c] for i, c in enumerate(cols)]
            k = sum(ds)
            cov = sum(1 for d in ds if d <= 1)
            if best_k is None or (k, -cov) < (best_k, -best_cov):
                best_k, best_cov = k, cov
    else:  # más tokens en el pago que en el oficial: cada sobrante cuesta SOBRANTE_PAGO
        for rows in permutations(range(n), m):
            ds = [dist[r][j] for j, r in enumerate(rows)]
            k = sum(ds) + SOBRANTE_PAGO * (n - m)
            cov = sum(1 for d in ds if d <= 1)
            if best_k is None or (k, -cov) < (best_k, -best_cov):
                best_k, best_cov = k, cov
    return best_k, best_cov


class Padron:
    """Padrón oficial indexado para búsqueda difusa por tokens."""

    def __init__(self, registros: list[dict], campo_carnet="carnet", campo_nombre="nombre"):
        self.people: list[tuple[str, str, list[str]]] = []
        self.index: dict[str, set[int]] = defaultdict(set)
        for r in registros:
            toks = tokenize(r[campo_nombre])
            if not toks:
                continue
            pid = len(self.people)
            self.people.append((str(r[campo_carnet]), r[campo_nombre], toks))
            for t in toks:
                for f in _forms(t):
                    self.index[f].add(pid)

    def candidates(self, pay_name: str, k_max: int = 3) -> list[Candidate]:
        pay_tokens = tokenize(pay_name)
        if not pay_tokens:
            return []
        pids: set[int] = set()
        for t in pay_tokens:
            for f in _forms(t):
                pids |= self.index.get(f, set())
        out: list[Candidate] = []
        for pid in pids:
            carnet, nombre, toks = self.people[pid]
            k, cov = score_pair(pay_tokens, toks)
            if cov >= 1 and k <= k_max:
                out.append(Candidate(carnet, nombre, k, cov))
        out.sort(key=lambda c: (c.k, -c.coverage, c.carnet))
        return out
