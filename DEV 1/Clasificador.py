"""Pipeline de 3 etapas -> zona VERDE / AMARILLA / ROJA (Sin columna concepto).

Hay dos tarifas: estudiantes (Q300) y docentes (Q150). El monto de la boleta decide
contra qué parte del padrón se compara el nombre: una boleta de Q150 solo puede
quedar a nombre de un docente y una de Q300 solo a nombre de un estudiante.
"""
from __future__ import annotations
from collections import Counter
from dataclasses import dataclass, field

from matcher import Padron
from Normalizador import normalize_boleta

VERDE, AMARILLA, ROJA = "VERDE", "AMARILLA", "ROJA"
MIN_COVERAGE_VERDE = 2

ESTUDIANTE, DOCENTE = "ESTUDIANTE", "DOCENTE"


@dataclass
class Config:
    tarifa: float                          # tarifa de estudiantes
    tolerancia_monto: float = 0.0
    tarifa_docente: float | None = None    # si se indica, también se aceptan boletas de docentes

    def tarifas(self) -> dict[str, float]:
        t = {ESTUDIANTE: self.tarifa}
        if self.tarifa_docente is not None:
            t[DOCENTE] = self.tarifa_docente
        return t


def separar_padron(registros: list[dict]) -> dict[str, Padron]:
    """Un Padron por tipo (ESTUDIANTE / DOCENTE). Sin campo 'tipo' se toma como estudiante."""
    grupos: dict[str, list[dict]] = {}
    for r in registros:
        grupos.setdefault((r.get("tipo") or ESTUDIANTE).upper(), []).append(r)
    return {tipo: Padron(regs) for tipo, regs in grupos.items()}

@dataclass
class Resultado:
    boleta: str
    zona: str
    carnet_asignado: str | None
    motivo: str
    candidatos: list[dict] = field(default_factory=list)
    k: int | None = None

    def datos_extra(self) -> dict:
        return {
            "motivo": self.motivo,
            "k": self.k,
            "candidatos": self.candidatos,
            "pipeline": "dev1-v2",
        }

def contar_boletas(pagos: list[dict]) -> Counter:
    return Counter(normalize_boleta(p.get("boleta")) for p in pagos)

def clasificar_pago(pago: dict, padron: Padron | dict[str, Padron], cfg: Config, boletas: Counter) -> Resultado:
    padrones = padron if isinstance(padron, dict) else {ESTUDIANTE: padron}
    boleta = normalize_boleta(pago.get("boleta"))

    # ---- Etapa 1: integridad contable ------------------------------------
    if not boleta:
        return Resultado(boleta, ROJA, None, "boleta_vacia")
    if boletas[boleta] > 1:
        return Resultado(boleta, ROJA, None, "boleta_duplicada")
    try:
        monto = float(str(pago.get("monto", 0)).replace(",", "").replace("Q", "").strip())
    except (TypeError, ValueError):
        return Resultado(boleta, ROJA, None, "monto_invalido")
    # El monto dice si la boleta es de estudiante o de docente
    tipos = [t for t, v in cfg.tarifas().items() if abs(monto - v) <= cfg.tolerancia_monto]
    if not tipos:
        return Resultado(boleta, ROJA, None, f"monto_anomalo({monto})")

    # ---- Etapa 2: coincidencia difusa (solo contra el padrón de ese tipo) --
    cands = sorted(
        (c for t in tipos if t in padrones for c in padrones[t].candidates(pago.get("nombre", ""), k_max=3)),
        key=lambda c: (c.k, -c.coverage, c.carnet),
    )
    info = [{"carnet": c.carnet, "nombre": c.nombre, "k": c.k, "cov": c.coverage}
            for c in cands[:5]]
    if not cands:
        motivo = "sin_coincidencias(k>=4)"
        if not any(t in padrones for t in tipos):
            motivo = f"sin_padron_{tipos[0].lower()}"  # p. ej. boleta de docente sin docentes cargados
        return Resultado(boleta, ROJA, None, motivo, info)

    # ---- Etapa 3: zonas ---------------------------------------------------
    cerca = [c for c in cands if c.k <= 1]
    if len(cerca) >= 2:
        return Resultado(boleta, AMARILLA, None, "colision_k<=1", info, cerca[0].k)
    if len(cerca) == 1 and len(cands) == 1:
        c = cerca[0]
        if c.coverage >= MIN_COVERAGE_VERDE:
            return Resultado(boleta, VERDE, c.carnet, "unico_k<=1", info, c.k)
        return Resultado(boleta, AMARILLA, None, "cobertura_insuficiente", info, c.k)
    if len(cerca) == 1:
        return Resultado(boleta, AMARILLA, None, "ambiguo_k<=1_con_otros_k<=3", info, cerca[0].k)
    
    return Resultado(boleta, AMARILLA, None,
                     "unico_2<=k<=3" if len(cands) == 1 else "multiples_2<=k<=3",
                     info, cands[0].k)

def clasificar_lote(pagos: list[dict], padron: Padron | dict[str, Padron], cfg: Config) -> list[Resultado]:
    boletas = contar_boletas(pagos)
    return [clasificar_pago(p, padron, cfg, boletas) for p in pagos]