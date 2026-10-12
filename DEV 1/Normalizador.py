"""Etapa 1 (parte léxica): sanitización con Regex.

Mayúsculas -> sin tildes -> sin signos de puntuación -> espacios colapsados.
Opcionalmente se descartan partículas ("DE", "DEL", "LA"...) que en los
nombres guatemaltecos aparecen o no según quién digite ("María de los Ángeles").
"""
import re
import unicodedata

_NON_ALNUM = re.compile(r"[^A-Z0-9 ]+")
_SPACES = re.compile(r"\s+")
# Excel exporta los saltos de línea como "_x000D_"; se quitan antes de normalizar
_EXCEL_CR = re.compile(r"_x000[dDaA]_")

STOPWORDS = frozenset({"DE", "DEL", "LA", "LAS", "LOS", "Y"})


def strip_accents(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(c for c in decomposed if not unicodedata.combining(c))


def normalize_name(raw: str) -> str:
    """'  Pérez-Gómez, Juan  Carlos. ' -> 'PEREZ GOMEZ JUAN CARLOS'"""
    if raw is None:
        return ""
    text = strip_accents(_EXCEL_CR.sub(" ", str(raw))).upper()
    text = _NON_ALNUM.sub(" ", text)
    return _SPACES.sub(" ", text).strip()


def tokenize(raw: str, drop_stopwords: bool = True) -> list[str]:
    tokens = normalize_name(raw).split()
    if drop_stopwords:
        tokens = [t for t in tokens if t not in STOPWORDS]
    return tokens


def normalize_boleta(raw) -> str:
    """Boleta: solo dígitos/letras, sin espacios ni guiones ni ceros a la izquierda."""
    text = re.sub(r"[^A-Za-z0-9]", "", str(raw or "")).upper()
    return text.lstrip("0") or text


def normalize_carnet(raw) -> str:
    return re.sub(r"\D", "", str(raw or ""))
